import { Module } from '@nestjs/common';
import { DocumentSequenceService } from '../../infra/sequence/document-sequence.service.js';
import { WorkOrderController } from './controllers/work-order.controller.js';
import { WorkOrderService } from './services/work-order.service.js';

@Module({
  controllers: [WorkOrderController],
  providers: [WorkOrderService, DocumentSequenceService],
  exports: [WorkOrderService],
})
export class MfgModule {}
