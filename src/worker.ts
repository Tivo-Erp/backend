import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker/worker.module.js';

/**
 * Standalone BullMQ worker entry point (INF-001). Boots a Nest application
 * context — no HTTP listener — that registers the queue processors and consumes
 * background + cron jobs. Run with `npm run start:worker`.
 */
async function bootstrap() {
  const logger = new Logger('Worker');
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: false,
  });
  logger.log('ERP worker process started.');

  // Single shutdown path: manual signal handlers only (enableShutdownHooks
  // would register a second, competing close on the same signals). The guard
  // makes a repeated signal a no-op, and process.exit only runs after the
  // async cleanup (lifecycle hooks, queue/AMQP close) completed.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`Received ${signal}, shutting down worker...`);
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      logger.error(`Shutdown error: ${(err as Error).message}`);
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('Worker failed to start:', err);
  process.exit(1);
});
