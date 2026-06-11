import { Module } from '@nestjs/common';
import { DocumentSequenceService } from '../../infra/sequence/document-sequence.service.js';
import { CustomerController } from './controllers/customer.controller.js';
import { SalesOrderController } from './controllers/sales-order.controller.js';
import { CustomerService } from './services/customer.service.js';
import { SalesOrderService } from './services/sales-order.service.js';
import { CustomerRepository } from './repositories/customer.repository.js';

@Module({
  controllers: [CustomerController, SalesOrderController],
  providers: [
    CustomerService,
    SalesOrderService,
    CustomerRepository,
    DocumentSequenceService,
  ],
  exports: [CustomerService, SalesOrderService],
})
export class SalModule {}
