import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { REDIS_CLIENT, type RedisClient } from '../redis/redis.module.js';

/**
 * Tenant-aware cache-aside layer (INF-007 / ADR-004) built directly on the
 * shared ioredis client so it never fights `cache-manager` major-version churn.
 *
 * Optional-safe: with no Redis (or while it is down) every method degrades to a
 * miss / no-op, so read endpoints fall through to the database unchanged. Keys
 * are always tenant-scoped to prevent cross-tenant leakage:
 *   `erp:{tenantId}:{namespace}:{suffix}`
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly enabled: boolean;
  private readonly defaultTtl: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: RedisClient,
    config: ConfigService,
  ) {
    this.enabled =
      !!this.redis && config.get<boolean>('app.cacheEnabled', true);
    this.defaultTtl = config.get<number>('app.cacheTtlSec', 60);
  }

  /** Build a tenant-scoped key. `suffix` may encode sparse-fieldset cache keys. */
  key(tenantId: string, namespace: string, suffix: string): string {
    return `erp:${tenantId}:${namespace}:${suffix}`;
  }

  private get client(): RedisClient {
    // Only treat the client as usable when actually connected; a reconnecting
    // client would otherwise queue commands and stall request latency.
    if (!this.enabled || !this.redis || this.redis.status !== 'ready') {
      return null;
    }
    return this.redis;
  }

  async get<T>(key: string): Promise<T | null> {
    const c = this.client;
    if (!c) return null;
    try {
      const raw = await c.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      this.logger.debug(`cache get miss (${key}): ${(err as Error).message}`);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSec?: number): Promise<void> {
    const c = this.client;
    if (!c) return;
    try {
      await c.set(key, JSON.stringify(value), 'EX', ttlSec ?? this.defaultTtl);
    } catch (err) {
      this.logger.debug(
        `cache set skipped (${key}): ${(err as Error).message}`,
      );
    }
  }

  async del(key: string): Promise<void> {
    const c = this.client;
    if (!c) return;
    try {
      await c.del(key);
    } catch {
      /* ignore */
    }
  }

  /** Invalidate every key under a tenant namespace (e.g. after a mutation). */
  async invalidateNamespace(
    tenantId: string,
    namespace: string,
  ): Promise<void> {
    const c = this.client;
    if (!c) return;
    const pattern = `erp:${tenantId}:${namespace}:*`;
    try {
      const stream = c.scanStream({ match: pattern, count: 200 });
      const pipeline = c.pipeline();
      let count = 0;
      for await (const keys of stream as AsyncIterable<string[]>) {
        for (const k of keys) {
          pipeline.del(k);
          count++;
        }
      }
      if (count > 0) await pipeline.exec();
    } catch (err) {
      this.logger.debug(
        `cache invalidate skipped (${pattern}): ${(err as Error).message}`,
      );
    }
  }

  /** Cache-aside: return the cached value or run `loader`, caching its result. */
  async wrap<T>(
    key: string,
    ttlSec: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== null) return hit;
    const value = await loader();
    if (value !== null && value !== undefined) {
      await this.set(key, value, ttlSec);
    }
    return value;
  }
}
