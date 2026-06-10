import { Module } from '@nestjs/common';
import { WarehouseController } from './controllers/warehouse.controller.js';
import { WarehouseService } from './services/warehouse.service.js';

@Module({
  controllers: [WarehouseController],
  providers: [WarehouseService],
  exports: [WarehouseService],
})
export class WmsModule {}
