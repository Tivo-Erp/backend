import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';

type Connection = Awaited<ReturnType<typeof amqp.connect>>;
type ConfirmChannel = Awaited<ReturnType<Connection['createConfirmChannel']>>;

/**
 * Thrown when the broker itself is unreachable (not configured, connect
 * failed, or the channel died). Callers (the outbox dispatcher) treat this as
 * "retry later" and must NOT count it against a message's attempt budget.
 */
export class BrokerUnavailableError extends Error {
  constructor(message = 'RabbitMQ broker unavailable') {
    super(message);
    this.name = 'BrokerUnavailableError';
  }
}

/**
 * INF-002 — RabbitMQ topic-exchange publisher (ADR-005). Lazily connects on the
 * first publish and reuses a *confirm* channel; reconnects on error.
 *
 * Delivery contract: {@link publish} resolves only after the broker has
 * CONFIRMED the message (publisher confirms), so the outbox dispatcher can
 * safely mark the row `published`. It throws {@link BrokerUnavailableError}
 * when no channel is available (including the not-configured case) and rethrows
 * genuine per-message publish failures.
 */
@Injectable()
export class RabbitPublisher implements OnModuleDestroy {
  private readonly logger = new Logger(RabbitPublisher.name);
  private readonly url: string;
  private readonly exchange: string;
  private connection: Connection | null = null;
  private channel: ConfirmChannel | null = null;
  private connecting: Promise<ConfirmChannel | null> | null = null;

  constructor(config: ConfigService) {
    this.url = config.get<string>('app.rabbitmqUrl', '');
    this.exchange = config.get<string>('app.rabbitmqExchange', 'erp.events');
  }

  get configured(): boolean {
    return !!this.url;
  }

  /** Exchange name, exposed so consumers can bind to the same exchange. */
  get exchangeName(): string {
    return this.exchange;
  }

  private async getChannel(): Promise<ConfirmChannel | null> {
    if (!this.url) return null;
    if (this.channel) return this.channel;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      try {
        const conn = await amqp.connect(this.url);
        conn.on('error', (err: Error) =>
          this.logger.error(`RabbitMQ connection error: ${err.message}`),
        );
        conn.on('close', () => {
          this.connection = null;
          this.channel = null;
        });
        // Confirm channel: publishes are acknowledged by the broker, so a
        // resolved publish() really means "persisted by RabbitMQ".
        const ch = await conn.createConfirmChannel();
        await ch.assertExchange(this.exchange, 'topic', { durable: true });
        this.connection = conn;
        this.channel = ch;
        this.logger.log(
          `RabbitMQ connected; exchange "${this.exchange}" ready (confirm mode).`,
        );
        return ch;
      } catch (err) {
        this.logger.error(`RabbitMQ connect failed: ${(err as Error).message}`);
        this.connection = null;
        this.channel = null;
        return null;
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  /**
   * Publish a persistent message keyed by `routingKey` and wait for the
   * broker's confirm.
   *
   * @throws {BrokerUnavailableError} when the broker is unreachable — the
   *   message was definitely not handed over; safe to retry without counting
   *   an attempt.
   * @throws {Error} when the broker nacked / errored this specific message —
   *   a genuine per-message failure the caller may count against its budget.
   */
  async publish(
    routingKey: string,
    payload: Record<string, any>,
    headers?: Record<string, any>,
  ): Promise<void> {
    const ch = await this.getChannel();
    if (!ch) throw new BrokerUnavailableError();
    await new Promise<void>((resolve, reject) => {
      try {
        ch.publish(
          this.exchange,
          routingKey,
          Buffer.from(JSON.stringify(payload)),
          { persistent: true, contentType: 'application/json', headers },
          // Confirm callback: err here is a broker NACK for THIS message —
          // a genuine per-message failure, surfaced as an Error.
          (err: Error | null) => (err ? reject(err) : resolve()),
        );
      } catch (err) {
        // Synchronous throw means the channel is closed/poisoned — drop it so
        // the next publish reconnects, and report broker-unavailable (the
        // message was never handed over; retry without burning an attempt).
        this.logger.error(
          `publish ${routingKey} failed (channel dead): ${(err as Error).message}`,
        );
        this.channel = null;
        reject(new BrokerUnavailableError((err as Error).message));
      }
    });
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
