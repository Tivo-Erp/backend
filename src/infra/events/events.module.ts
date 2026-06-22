import { Global, Module } from '@nestjs/common';
import { OutboxService } from './outbox.service.js';
import { RabbitPublisher } from './rabbitmq.publisher.js';
import { OutboxDispatcher } from './outbox.dispatcher.js';

/**
 * INF-002 — domain event bus. Global so any module can inject {@link OutboxService}
 * to record events inside its transactions. The dispatcher + publisher are used
 * by the worker process and the outbox cron job.
 */
@Global()
@Module({
  providers: [OutboxService, RabbitPublisher, OutboxDispatcher],
  exports: [OutboxService, RabbitPublisher, OutboxDispatcher],
})
export class EventsModule {}
