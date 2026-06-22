import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, JobsOptions, type ConnectionOptions } from 'bullmq';
import { REDIS_CLIENT, type RedisClient } from '../redis/redis.module.js';
import { ALL_QUEUES, CRON_SCHEDULES, QUEUE_CRON } from './queue.constants.js';

/**
 * Enqueue side of INF-001. Owns one BullMQ {@link Queue} per logical queue,
 * bound to the shared Redis connection, and registers the repeatable cron jobs
 * on startup (idempotent — BullMQ dedupes by repeat key).
 *
 * Optional-safe: when Redis is absent every enqueue is a logged no-op so the
 * business flow that fired the job is never blocked (e.g. an email that just
 * won't be sent in a Redis-less dev box).
 */
@Injectable()
export class JobProducer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobProducer.name);
  private readonly queues = new Map<string, Queue>();
  private readonly enabled: boolean;
  private readonly cronEnabled: boolean;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: RedisClient,
    config: ConfigService,
  ) {
    this.enabled = !!this.redis;
    this.cronEnabled = config.get<boolean>('app.cronEnabled', true);
  }

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.warn('Redis not configured — job queue disabled (no-op).');
      return;
    }
    for (const name of ALL_QUEUES) this.getQueue(name);
    if (this.cronEnabled) await this.registerCronJobs();
  }

  private getQueue(name: string): Queue | null {
    if (!this.redis) return null;
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, {
        // bullmq bundles its own ioredis copy; the instance is compatible at
        // runtime but the duplicated type declarations don't unify, so we go
        // through `unknown` to bullmq's own ConnectionOptions (never `any`).
        connection: this.redis as unknown as ConnectionOptions,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 24 * 3600 },
        },
      });
      q.on('error', (err) =>
        this.logger.error(`queue ${name} error: ${err.message}`),
      );
      this.queues.set(name, q);
    }
    return q;
  }

  /** Fire-and-forget enqueue. Returns the job id, or null when disabled. */
  async enqueue(
    queueName: string,
    jobName: string,
    data: Record<string, unknown> = {},
    opts?: JobsOptions,
  ): Promise<string | null> {
    const q = this.getQueue(queueName);
    if (!q) {
      this.logger.debug(`enqueue skipped (Redis off): ${queueName}/${jobName}`);
      return null;
    }
    try {
      const job = await q.add(jobName, data, opts);
      return job.id ?? null;
    } catch (err) {
      this.logger.error(
        `enqueue failed ${queueName}/${jobName}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async registerCronJobs() {
    const q = this.getQueue(QUEUE_CRON);
    if (!q) return;
    for (const { name, pattern } of CRON_SCHEDULES) {
      try {
        // BullMQ v5 job schedulers: one scheduler id per cron, upserted
        // idempotently (replaces the legacy repeat+custom-jobId combination,
        // which conflicts with BullMQ's repeat-key bookkeeping).
        await q.upsertJobScheduler(
          `cron:${name}`,
          { pattern, tz: 'UTC' },
          { name },
        );
      } catch (err) {
        this.logger.error(
          `cron register ${name} failed: ${(err as Error).message}`,
        );
      }
    }
    this.logger.log(
      `Registered ${CRON_SCHEDULES.length} repeatable cron jobs.`,
    );
  }

  async onModuleDestroy() {
    for (const q of this.queues.values()) {
      await q.close().catch(() => undefined);
    }
  }
}
