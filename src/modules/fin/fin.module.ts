import { Module } from '@nestjs/common';
import { DocumentSequenceService } from '../../infra/sequence/document-sequence.service.js';
import { ChartOfAccountController } from './controllers/chart-of-account.controller.js';
import { FiscalPeriodController } from './controllers/fiscal-period.controller.js';
import { JournalBatchController } from './controllers/journal-batch.controller.js';
import { InvoiceController } from './controllers/invoice.controller.js';
import { PaymentController } from './controllers/payment.controller.js';
import { ChartOfAccountService } from './services/chart-of-account.service.js';
import { FiscalPeriodService } from './services/fiscal-period.service.js';
import { JournalBatchService } from './services/journal-batch.service.js';
import { InvoiceService } from './services/invoice.service.js';
import { PaymentService } from './services/payment.service.js';

@Module({
  controllers: [
    ChartOfAccountController,
    FiscalPeriodController,
    JournalBatchController,
    InvoiceController,
    PaymentController,
  ],
  providers: [
    DocumentSequenceService,
    ChartOfAccountService,
    FiscalPeriodService,
    JournalBatchService,
    InvoiceService,
    PaymentService,
  ],
  exports: [ChartOfAccountService, FiscalPeriodService, JournalBatchService],
})
export class FinModule {}
