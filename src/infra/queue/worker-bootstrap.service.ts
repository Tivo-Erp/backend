import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, Job, type ConnectionOptions } from 'bullmq';
import { CronProcessor } from './processors/cron.processor.js';
import { EmailProcessor } from './processors/email.processor.js';
import { QUEUE_CRON, QUEUE_EMAIL } from './queue.constants.js';
import { EmailJobData } from '../email/email.service.js';

/**
 * Starts BullMQ {@link Worker}s in the standalone worker process and routes each
 * job to its processor. Each worker gets its own (blocking) Redis connection as
 * BullMQ requires; with no `REDIS_URL` the worker process simply idles.
 */
@Injectable()
export class WorkerBootstrap
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(WorkerBootstrap.name);
  private readonly workers: Worker<unknown, unknown, string>[] = [];

  constructor(
    private readonly config: ConfigService,
    private readonly cron: CronProcessor,
    private readonly email: EmailProcessor,
  ) {}

  onApplicationBootstrap() {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.logger.warn(
        'REDIS_URL not set — worker has nothing to consume; idling.',
      );
      return;
    }
    // BullMQ manages the (blocking) connection itself from the Redis URL,
    // forcing maxRetriesPerRequest=null as workers require. The URL must be
    // passed via the `url` option field (a bare string is spread into
    // char-indexed props and silently falls back to localhost:6379).
    const connection: ConnectionOptions = { url };

    this.workers.push(
      new Worker<unknown, unknown, string>(
        QUEUE_CRON,
        async (job: Job<unknown, unknown, string>) =>
          this.cron.handle(job.name),
        {
          connection,
          concurrency: 1,
        },
      ),
    );
    this.workers.push(
      new Worker<EmailJobData, unknown, string>(
        QUEUE_EMAIL,
        async (job: Job<EmailJobData, unknown, string>) =>
          this.email.handle(job.data),
        { connection, concurrency: 5 },
      ),
    );

    for (const w of this.workers) {
      w.on('failed', (job, err) =>
        this.logger.error(`job ${job?.name} failed: ${err.message}`),
      );
      w.on('error', (err) => this.logger.error(`worker error: ${err.message}`));
    }
    this.logger.log(
      `Worker started — ${this.workers.length} queues consuming.`,
    );
  }

  async onModuleDestroy() {
    await Promise.all(
      this.workers.map((w) => w.close().catch(() => undefined)),
    );
  }
}
