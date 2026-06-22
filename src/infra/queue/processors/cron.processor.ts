import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { FixedAssetService } from '../../../modules/fin/services/fixed-asset.service.js';
import { EtlService } from '../../../modules/bi/services/etl.service.js';
import { OutboxDispatcher } from '../../events/outbox.dispatcher.js';
import { JOB } from '../queue.constants.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Handlers for the scheduled cron jobs (INF-001). These replace the manual
 * triggers / read-time derivations deferred in batches 4–5:
 *  - monthly fixed-asset depreciation posting,
 *  - auto-close of long-resolved support tickets,
 *  - SLA-breach escalation notifications.
 *
 * Each handler is system-scoped (no per-request RLS context); tenant isolation
 * comes from explicit `where: { tenantId }` filters, matching the out-of-tx
 * read pattern documented on {@link PrismaService}.
 */
@Injectable()
export class CronProcessor {
  private readonly logger = new Logger(CronProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fixedAssets: FixedAssetService,
    private readonly outbox: OutboxDispatcher,
    private readonly etl: EtlService,
  ) {}

  /** Route a cron job name to its handler. */
  async handle(jobName: string): Promise<void> {
    switch (jobName) {
      case JOB.DEPRECIATION_RUN:
        return this.runDepreciation();
      case JOB.TICKET_AUTOCLOSE:
        return this.autoCloseTickets();
      case JOB.SLA_ESCALATION:
        return this.escalateSlaBreaches();
      case JOB.OUTBOX_DISPATCH:
        await this.outbox.dispatchPending();
        return;
      case JOB.BI_ETL_SYNC:
        return this.etl.syncAll();
      default:
        this.logger.warn(`Unknown cron job: ${jobName}`);
    }
  }

  /** Post depreciation for the previous calendar month, every active tenant. */
  async runDepreciation(): Promise<void> {
    const now = new Date();
    const prev = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );
    const year = prev.getUTCFullYear();
    const month = prev.getUTCMonth() + 1;

    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'active' },
      select: { id: true },
    });
    let posted = 0;
    for (const tenant of tenants) {
      const systemUser = await this.systemUserFor(tenant.id);
      if (!systemUser) continue;
      try {
        await this.fixedAssets.runDepreciation(tenant.id, systemUser, {
          year,
          month,
        });
        posted++;
      } catch (err) {
        this.logger.error(
          `depreciation ${year}-${month} failed for tenant ${tenant.id}: ${(err as Error).message}`,
        );
      }
    }
    this.logger.log(
      `Depreciation ${year}-${month}: processed ${posted}/${tenants.length} tenants.`,
    );
  }

  /** Close tickets that have sat in `resolved` for more than 7 days. */
  async autoCloseTickets(): Promise<void> {
    const cutoff = new Date(Date.now() - SEVEN_DAYS_MS);
    const res = await this.prisma.supportTicket.updateMany({
      where: { status: 'resolved', resolvedAt: { lt: cutoff } },
      data: { status: 'closed' },
    });
    if (res.count > 0)
      this.logger.log(`Auto-closed ${res.count} resolved tickets.`);
  }

  /**
   * Notify ticket owners (or the tenant owner) of breached SLAs.
   *
   * Uses the persisted `slaEscalatedAt` watermark instead of a sliding time
   * window: every breached ticket is escalated exactly once, regardless of
   * cron cadence or worker downtime (no double notifications when windows
   * overlap, no missed breaches when the worker was down past the window).
   */
  async escalateSlaBreaches(): Promise<void> {
    const now = new Date();
    const breached = await this.prisma.supportTicket.findMany({
      where: {
        status: { in: ['open', 'in_progress', 'waiting_customer', 'reopened'] },
        slaDueAt: { lt: now },
        slaEscalatedAt: null,
      },
      select: {
        id: true,
        tenantId: true,
        ticketNumber: true,
        subject: true,
        assignedTo: true,
      },
    });
    if (breached.length === 0) return;

    const rows = [];
    for (const t of breached) {
      const recipient = t.assignedTo ?? (await this.systemUserFor(t.tenantId));
      if (!recipient) continue;
      rows.push({
        tenantId: t.tenantId,
        userId: recipient,
        title: `SLA breached: ${t.ticketNumber}`,
        body: t.subject,
        category: 'sla',
        entityType: 'support_ticket',
        entityId: t.id,
      });
    }
    if (rows.length > 0) {
      await this.prisma.notification.createMany({ data: rows });
      this.logger.log(`SLA escalation: ${rows.length} notifications created.`);
    }
    // Watermark ALL scanned breaches (even recipient-less ones) so each ticket
    // is escalated at most once and never rescanned forever.
    await this.prisma.supportTicket.updateMany({
      where: { id: { in: breached.map((t) => t.id) }, slaEscalatedAt: null },
      data: { slaEscalatedAt: now },
    });
  }

  /** Pick a stable system actor for a tenant — its owner, else any active user. */
  private async systemUserFor(tenantId: string): Promise<string | null> {
    const owner = await this.prisma.user.findFirst({
      where: {
        tenantId,
        status: 'active',
        deletedAt: null,
        userRoles: { some: { role: { name: 'tenant_owner' } } },
      },
      select: { id: true },
    });
    if (owner) return owner.id;
    const any = await this.prisma.user.findFirst({
      where: { tenantId, status: 'active', deletedAt: null },
      select: { id: true },
    });
    return any?.id ?? null;
  }
}
