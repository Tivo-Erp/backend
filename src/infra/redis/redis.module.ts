import {
  Global,
  Module,
  Logger,
  OnModuleDestroy,
  Inject,
} from '@nestjs/common';
import Redis from 'ioredis';

/** DI token for the shared ioredis client (or `null` when Redis is not configured). */
export const REDIS_CLIENT = 'REDIS_CLIENT';
export type RedisClient = Redis | null;

/**
 * Builds a single shared ioredis connection from `REDIS_URL`, reused by the
 * cache layer (INF-007), the Redis throttler store, and BullMQ (INF-001).
 *
 * Optional-safe (ADR-004 / batch-6 principle): when `REDIS_URL` is unset the
 * provider resolves to `null` and every consumer degrades to a no-op / in-memory
 * path. Connection errors are logged once and never crash the process — a
 * `lazyConnect` client retries in the background.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (): RedisClient => {
        const url = process.env.REDIS_URL;
        if (!url) {
          new Logger('RedisModule').warn(
            'REDIS_URL not set — cache, distributed rate-limiting and queues are disabled.',
          );
          return null;
        }
        const logger = new Logger('RedisModule');
        const client = new Redis(url, {
          lazyConnect: false,
          maxRetriesPerRequest: null,
          enableReadyCheck: true,
          retryStrategy: (times) => Math.min(times * 200, 5000),
        });
        let loggedError = false;
        client.on('error', (err) => {
          if (!loggedError) {
            loggedError = true;
            logger.error(`Redis connection error: ${err.message}`);
          }
        });
        client.on('ready', () => {
          loggedError = false;
          logger.log('Redis connection ready.');
        });
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: RedisClient) {}

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit().catch(() => undefined);
    }
  }
}
