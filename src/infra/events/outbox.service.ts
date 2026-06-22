import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { EventType } from './event-catalog.js';

export interface OutboxWrite {
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  // `EventType` keeps editor autocomplete of the known catalog events while
  // `string & {}` still admits any ad-hoc event name without the wider
  // `string` collapsing the union away.
  eventType: EventType | (string & {});
  payload: Record<string, any>;
}

/** Minimal client surface so callers can pass either the PrismaService or a
 *  transaction client. */
type PrismaLike = {
  outboxEvent: {
    create: (args: { data: any }) => Promise<any>;
  };
};

/**
 * INF-002 — transactional outbox writer. Call {@link record} with the SAME `tx`
 * client used by the business mutation so the event row commits atomically with
 * it (no lost events, no phantom events). The {@link OutboxDispatcher} drains
 * the rows to RabbitMQ out-of-band.
 */
@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService) {}

  async record(tx: PrismaLike, event: OutboxWrite): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        tenantId: event.tenantId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload: event.payload as Prisma.InputJsonValue,
        status: 'pending',
      },
    });
  }

  /**
   * Admin/ops replay hook: re-queue events parked as 'failed' (attempt budget
   * exhausted) so the dispatcher picks them up again. Resets `attempts` to 0.
   * Optionally limited to one tenant. Returns the number of rows re-queued.
   * Intentionally has no HTTP surface — call it from a console/REPL or a
   * future admin endpoint.
   */
  async requeueFailed(tenantId?: string): Promise<number> {
    const res = await this.prisma.outboxEvent.updateMany({
      where: { status: 'failed', ...(tenantId ? { tenantId } : {}) },
      data: { status: 'pending', attempts: 0, claimedAt: null },
    });
    return res.count;
  }
}
