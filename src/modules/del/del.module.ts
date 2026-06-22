import { forwardRef, Module } from '@nestjs/common';
import { DocumentSequenceService } from '../../infra/sequence/document-sequence.service.js';
import { ShpModule } from '../shp/shp.module.js';
import { DeliveryNoteController } from './controllers/delivery-note.controller.js';
import { DeliveryNoteService } from './services/delivery-note.service.js';

@Module({
  imports: [forwardRef(() => ShpModule)],
  controllers: [DeliveryNoteController],
  providers: [DeliveryNoteService, DocumentSequenceService],
  exports: [DeliveryNoteService],
})
export class DelModule {}
