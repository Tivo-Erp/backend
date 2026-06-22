import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service.js';
import { RedisThrottlerStorage } from './throttler-redis.storage.js';

/**
 * INF-007 — Redis caching layer. Global so any service can inject
 * {@link CacheService} for cache-aside reads. Also exports
 * {@link RedisThrottlerStorage} so the ThrottlerModule can swap to a shared
 * store when Redis is configured.
 */
@Global()
@Module({
  providers: [CacheService, RedisThrottlerStorage],
  exports: [CacheService, RedisThrottlerStorage],
})
export class CacheModule {}
