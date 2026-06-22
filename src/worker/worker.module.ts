import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { appConfig } from '../config/app.config.js';
import { DatabaseModule } from '../infra/database/database.module.js';
import { RedisModule } from '../infra/redis/redis.module.js';
import { EventsModule } from '../infra/events/events.module.js';
import { QueueModule } from '../infra/queue/queue.module.js';
import { EmailModule } from '../infra/email/email.module.js';
import { OlapModule } from '../infra/olap/olap.module.js';
import { FinModule } from '../modules/fin/fin.module.js';
import { BiModule } from '../modules/bi/bi.module.js';
import { CronProcessor } from '../infra/queue/processors/cron.processor.js';
import { EmailProcessor } from '../infra/queue/processors/email.processor.js';
import { WorkerBootstrap } from '../infra/queue/worker-bootstrap.service.js';
import { NotificationEventsConsumer } from '../infra/events/notification.consumer.js';

/**
 * Module for the standalone worker process (`npm run start:worker`). It boots a
 * Nest application *context* (no HTTP/WebSocket server), wires the business
 * services the processors need, and starts the BullMQ workers.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [appConfig] }),
    DatabaseModule,
    RedisModule,
    EventsModule,
    QueueModule,
    EmailModule,
    OlapModule,
    FinModule,
    BiModule,
  ],
  providers: [
    CronProcessor,
    EmailProcessor,
    WorkerBootstrap,
    // INF-002 consumer side: RabbitMQ → in-app notifications (worker only).
    NotificationEventsConsumer,
  ],
})
export class WorkerModule {}
