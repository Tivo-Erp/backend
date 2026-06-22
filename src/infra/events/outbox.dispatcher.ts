import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import {
  BrokerUnavailableError,
  RabbitPublisher,
} from './rabbitmq.publisher.js';

const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 10;
/** 'processing' rows claimed longer ago than this are presumed orphaned
 *  (crashed dispatcher) and reclaimed to 'pending'. */
const STALE_PROCESSING_MS = 5 * 60 * 1000;

interface ClaimedRow {
  id: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  attempts: number;
  createdAt: Date;
}

/**
 * INF-002 — drains pending {@link OutboxEvent} rows to RabbitMQ. Invoked by the
 * outbox cron/worker job.
 *
 * Concurrency: a batch is CLAIMED atomically (status pending → processing via
 * `FOR UPDATE SKIP LOCKED`), so two overlapping dispatcher runs never publish
 * the same row twice. Rows stuck in 'processing' (crashed run) are reclaimed
 * after {@link STALE_PROCESSING_MS}.
 *
 * Failure semantics: {@link BrokerUnavailableError} (broker down / channel
 * dead) does NOT consume an attempt — the batch is released back to 'pending'
 * and retried next tick. Only genuine per-message broker errors bump
 * `attempts`; past {@link MAX_ATTEMPTS} the row is parked as 'failed' (see
 * {@link OutboxService.requeueFailed} for replay).
 */
@Injectable()
export class OutboxDispatcher {
  private readonly logger = new Logger(OutboxDispatcher.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: RabbitPublisher,
  ) {}

  async dispatchPending(): Promise<{ published: number; failed: number }> {
    if (!this.publisher.configured) return { published: 0, failed: 0 };

    // Reclaim rows orphaned by a crashed run before claiming a new batch.
    await this.prisma.$executeRaw`
      UPDATE "outbox_events"
      SET "status" = 'pending', "claimedAt" = NULL
      WHERE "status" = 'processing'
        AND "claimedAt" < NOW() - make_interval(secs => ${STALE_PROCESSING_MS / 1000})
    `;

    // Atomic claim: pending → processing, skipping rows locked by another
    // concurrent dispatcher (single statement, so no explicit transaction).
    const claimed = await this.prisma.$queryRaw<ClaimedRow[]>`
      UPDATE "outbox_events"
      SET "status" = 'processing', "claimedAt" = NOW()
      WHERE "id" IN (
        SELECT "id" FROM "outbox_events"
        WHERE "status" = 'pending'
        ORDER BY "createdAt" ASC
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "tenantId", "aggregateType", "aggregateId",
                "eventType", "payload", "attempts", "createdAt"
    `;

    let published = 0;
    let failed = 0;
    const release: string[] = []; // claimed but not attempted (broker down)

    for (let i = 0; i < claimed.length; i++) {
      const evt = claimed[i];
      try {
        await this.publisher.publish(
          evt.eventType,
          {
            id: evt.id,
            tenantId: evt.tenantId,
            aggregateType: evt.aggregateType,
            aggregateId: evt.aggregateId,
            eventType: evt.eventType,
            occurredAt: evt.createdAt,
            data: evt.payload,
          },
          {
            'x-tenant-id': evt.tenantId,
            'x-aggregate-type': evt.aggregateType,
          },
        );
        // Guarded: only flip the row we still own.
        await this.prisma.outboxEvent.updateMany({
          where: { id: evt.id, status: 'processing' },
          data: { status: 'published', publishedAt: new Date() },
        });
        published++;
      } catch (err) {
        if (err instanceof BrokerUnavailableError) {
          // Broker down — release this row and the rest of the batch back to
          // 'pending' WITHOUT consuming an attempt; retry next tick.
          release.push(...claimed.slice(i).map((r) => r.id));
          this.logger.warn(
            `Broker unavailable — released ${claimed.length - i} claimed events back to pending.`,
          );
          break;
        }
        // Genuine per-message failure: count it against the budget.
        const attempts = evt.attempts + 1;
        await this.prisma.outboxEvent.updateMany({
          where: { id: evt.id, status: 'processing' },
          data: {
            attempts,
            claimedAt: null,
            status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          },
        });
        failed++;
        this.logger.error(
          `publish ${evt.eventType} (${evt.id}) failed (attempt ${attempts}): ${(err as Error).message}`,
        );
      }
    }

    if (release.length > 0) {
      await this.prisma.outboxEvent.updateMany({
        where: { id: { in: release }, status: 'processing' },
        data: { status: 'pending', claimedAt: null },
      });
    }

    if (published || failed) {
      this.logger.log(
        `Outbox dispatch: ${published} published, ${failed} failed.`,
      );
    }
    return { published, failed };
  }
}
