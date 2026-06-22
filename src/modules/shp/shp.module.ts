import { forwardRef, Module } from '@nestjs/common';
import { DocumentSequenceService } from '../../infra/sequence/document-sequence.service.js';
import { DelModule } from '../del/del.module.js';
import { CarrierController } from './controllers/carrier.controller.js';
import { ShipmentController } from './controllers/shipment.controller.js';
import { ShippingPublicController } from './controllers/shipping-public.controller.js';
import { CarrierService } from './services/carrier.service.js';
import { ShipmentService } from './services/shipment.service.js';
import { CarrierAdapterFactory } from './adapters/carrier-adapter.factory.js';

@Module({
  imports: [forwardRef(() => DelModule)],
  controllers: [
    CarrierController,
    ShipmentController,
    ShippingPublicController,
  ],
  providers: [
    CarrierService,
    ShipmentService,
    CarrierAdapterFactory,
    DocumentSequenceService,
  ],
  exports: [ShipmentService, CarrierService],
})
export class ShpModule {}
