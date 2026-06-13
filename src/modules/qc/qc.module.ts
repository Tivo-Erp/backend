import { Module } from '@nestjs/common';
import { DocumentSequenceService } from '../../infra/sequence/document-sequence.service.js';
import {
  NcrController,
  QcInspectionController,
} from './controllers/qc.controller.js';
import { QcInspectionService } from './services/qc-inspection.service.js';
import { NcrService } from './services/ncr.service.js';

@Module({
  controllers: [QcInspectionController, NcrController],
  providers: [QcInspectionService, NcrService, DocumentSequenceService],
  exports: [QcInspectionService, NcrService],
})
export class QcModule {}
