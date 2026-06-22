import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { PrismaService } from '../database/prisma.service.js';
import { EVENT } from './event-catalog.js';

type Connection = Awaited<ReturnType<typeof amqp.connect>>;
type Channel = Awaited<ReturnType<Connection['createChannel']>>;

/** Durable queue consumed by the worker for in-app notification fan-out. */
const QUEUE_NAME = 'erp.ntf';

/** Routing keys this consumer cares about — the events the producers emit. */
const BINDINGS: string[] = [
  EVENT.SO_CONFIRMED,
  EVENT.PAYMENT_POSTED,
  EVENT.PAYROLL_APPROVED,
  EVENT.LEAVE_APPROVED,
];

/** Envelope published by the outbox dispatcher. */
interface EventEnvelope {
  id: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

/** Human-readable titles per event type (fallback: the raw routing key). */
const TITLES: Record<string, string> = {
  [EVENT.SO_CONFIRMED]: 'Sales order confirmed',
  [EVENT.PAYMENT_POSTED]: 'Payment posted',
  [EVENT.PAYROLL_APPROVED]: 'Payroll run approved',
  [EVENT.LEAVE_APPROVED]: 'Leave request approved',
};

/**
 * INF-002 consumer side — runs in the WORKER process only (registered in
 * WorkerModule). Binds a durable queue to the `erp.events` topic exchange for
 * the routing keys above and turns each event into an in-app notification for
 * the tenant's owner (same system-actor heuristic as the cron processor).
 *
 * Delivery semantics: manual ack after the notification row is committed.
 * Handler errors are logged and nacked WITHOUT requeue (at-least-once overall;
 * a poison message must not wedge the queue). The insert is idempotent — the
 * outbox event id is stored as `entityId` with `entityType: 'event'` and
 * checked before insert, so broker redeliveries don't duplicate notifications.
 *
 * Optional-safe: with no `RABBITMQ_URL` it logs and idles.
 */
@Injectable()
export class NotificationEventsConsumer
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationEventsConsumer.name);
  private readonly url: string;
  private readonly exchange: string;
  private connection: Connection | null = null;
  private channel: Channel | null = null;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.url = config.get<string>('app.rabbitmqUrl', '');
    this.exchange = config.get<string>('app.rabbitmqExchange', 'erp.events');
  }

  async onApplicationBootstrap() {
    if (!this.url) {
      this.logger.warn(
        'RABBITMQ_URL not set — event consumer disabled (skipping).',
      );
      return;
    }
    try {
      await this.start();
    } catch (err) {
      // Worker stays usable for BullMQ jobs even if the broker is down at
      // boot; the outbox keeps events safe until the consumer comes back.
      this.logger.error(
        `Event consumer failed to start: ${(err as Error).message}`,
      );
    }
  }

  private async start() {
    const conn = await amqp.connect(this.url);
    conn.on('error', (err: Error) =>
      this.logger.error(`consumer connection error: ${err.message}`),
    );
    conn.on('close', () => {
      this.connection = null;
      this.channel = null;
    });
    const ch = await conn.createChannel();
    await ch.assertExchange(this.exchange, 'topic', { durable: true });
    await ch.assertQueue(QUEUE_NAME, { durable: true });
    for (const key of BINDINGS) {
      await ch.bindQueue(QUEUE_NAME, this.exchange, key);
    }
    await ch.prefetch(10);
    await ch.consume(
      QUEUE_NAME,
      (msg) => {
        if (!msg) return;
        void this.handle(ch, msg);
      },
      { noAck: false },
    );
    this.connection = conn;
    this.channel = ch;
    this.logger.log(
      `Event consumer started — queue "${QUEUE_NAME}" bound to [${BINDINGS.join(', ')}].`,
    );
  }

  private async handle(ch: Channel, msg: amqp.ConsumeMessage) {
    try {
      const evt = JSON.parse(msg.content.toString()) as EventEnvelope;
      if (!evt?.id || !evt?.tenantId || !evt?.eventType) {
        this.logger.warn(
          'Dropping malformed event message (missing envelope fields).',
        );
        ch.ack(msg);
        return;
      }
      await this.createNotification(evt);
      ch.ack(msg);
    } catch (err) {
      this.logger.error(
        `event handling failed: ${(err as Error).message} — dropping (no requeue).`,
      );
      // At-least-once + idempotent insert; requeueing a poison message would
      // only spin the queue.
      try {
        ch.nack(msg, false, false);
      } catch {
        /* channel may already be gone */
      }
    }
  }

  /**
   * Create one in-app notification per event for the tenant's system actor.
   * System-scoped (no per-request RLS context) like the cron processor —
   * tenant isolation comes from the explicit tenantId taken from the event.
   */
  private async createNotification(evt: EventEnvelope) {
    // Idempotency: the outbox event id is recorded on the notification; a
    // redelivered message finds it and becomes a no-op.
    const existing = await this.prisma.notification.findFirst({
      where: { tenantId: evt.tenantId, entityType: 'event', entityId: evt.id },
      select: { id: true },
    });
    if (existing) return;

    const userId = await this.systemUserFor(evt.tenantId);
    if (!userId) {
      this.logger.warn(
        `No active user for tenant ${evt.tenantId} — skipping notification for ${evt.eventType}.`,
      );
      return;
    }

    await this.prisma.notification.create({
      data: {
        tenantId: evt.tenantId,
        userId,
        title: TITLES[evt.eventType] ?? evt.eventType,
        body: `${evt.aggregateType} ${evt.aggregateId} — ${evt.eventType}`,
        category: 'info',
        entityType: 'event',
        entityId: evt.id,
      },
    });
  }

  /** Tenant owner, else any active user (mirrors CronProcessor.systemUserFor). */
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

  async onModuleDestroy() {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch {
      /* ignore */
    }
  }
}
