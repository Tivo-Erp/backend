import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface.js';
import { REDIS_CLIENT, type RedisClient } from '../redis/redis.module.js';

/**
 * Redis-backed throttler store (INF-007) so rate-limit counters are shared
 * across instances instead of living in each process's memory. `ttl` and
 * `blockDuration` arrive in milliseconds (throttler v6).
 *
 * Atomicity comes from a single Lua script: INCR the hit counter, set its TTL
 * on first hit, and — when the limit is exceeded — write a block key. Returns
 * the record shape the ThrottlerGuard expects. If Redis is unavailable (or a
 * call errors) requests are NOT let through unthrottled: an embedded
 * in-memory {@link ThrottlerStorageService} takes over so per-instance limits
 * still apply (fail-safe instead of fail-open).
 */
@Injectable()
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnApplicationShutdown
{
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  /** Per-instance fallback used whenever Redis is unavailable or errors. */
  private readonly fallback = new ThrottlerStorageService();

  // KEYS[1]=hit counter, KEYS[2]=block marker
  // ARGV[1]=ttl(ms) ARGV[2]=limit ARGV[3]=blockDuration(ms)
  private static readonly SCRIPT = `
    local blockTtl = redis.call('PTTL', KEYS[2])
    if blockTtl > 0 then
      return { tonumber(redis.call('GET', KEYS[2])) or tonumber(ARGV[2]) + 1, -1, 1, blockTtl }
    end
    local hits = redis.call('INCR', KEYS[1])
    if hits == 1 then
      redis.call('PEXPIRE', KEYS[1], ARGV[1])
    end
    local ttl = redis.call('PTTL', KEYS[1])
    if hits > tonumber(ARGV[2]) then
      redis.call('SET', KEYS[2], hits, 'PX', ARGV[3])
      return { hits, ttl, 1, tonumber(ARGV[3]) }
    end
    return { hits, ttl, 0, 0 }
  `;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClient) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const c = this.redis && this.redis.status === 'ready' ? this.redis : null;
    if (!c) {
      // No shared store this instant — enforce per-instance limits in memory.
      // ThrottlerStorageService takes ms in/returns timeToExpire in seconds,
      // matching the normalization of the Redis path below.
      return this.fallback.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }
    const hitKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `throttle:block:${throttlerName}:${key}`;
    try {
      const res = (await c.eval(
        RedisThrottlerStorage.SCRIPT,
        2,
        hitKey,
        blockKey,
        String(ttl),
        String(limit),
        String(blockDuration),
      )) as [number, number, number, number];
      return {
        totalHits: res[0],
        timeToExpire: Math.ceil(res[1] / 1000),
        isBlocked: res[2] === 1,
        timeToBlockExpire: Math.ceil(res[3] / 1000),
      };
    } catch (err) {
      this.logger.debug(
        `throttler redis error — using in-memory fallback: ${(err as Error).message}`,
      );
      return this.fallback.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }
  }

  onApplicationShutdown(): void {
    // The embedded in-memory store keeps decrement timers; clear them.
    this.fallback.onApplicationShutdown();
  }
}
