import { Module } from '@nestjs/common';
import { DocumentSequenceService } from '../../infra/sequence/document-sequence.service.js';
import { SupplierController } from './controllers/supplier.controller.js';
import { PurchaseOrderController } from './controllers/purchase-order.controller.js';
import { GoodsReceiptController } from './controllers/goods-receipt.controller.js';
import { SupplierService } from './services/supplier.service.js';
import { PurchaseOrderService } from './services/purchase-order.service.js';
import { GoodsReceiptService } from './services/goods-receipt.service.js';
import { SupplierRepository } from './repositories/supplier.repository.js';

@Module({
  controllers: [
    SupplierController,
    PurchaseOrderController,
    GoodsReceiptController,
  ],
  providers: [
    SupplierService,
    PurchaseOrderService,
    GoodsReceiptService,
    SupplierRepository,
    DocumentSequenceService,
  ],
  exports: [SupplierService, PurchaseOrderService, GoodsReceiptService],
})
export class PurModule {}
