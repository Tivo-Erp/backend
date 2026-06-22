import { Global, Module } from '@nestjs/common';
import { JobProducer } from './job-producer.service.js';

/**
 * INF-001 — BullMQ job queue (enqueue side). Global so any module can inject
 * {@link JobProducer} to schedule background work. The consuming workers live
 * in the standalone worker process (see `src/worker.ts` + `WorkerModule`).
 */
@Global()
@Module({
  providers: [JobProducer],
  exports: [JobProducer],
})
export class QueueModule {}
