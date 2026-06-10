import { Module } from '@nestjs/common';
import { WarehouseController } from './controllers/warehouse.controller.js';
import { WarehouseService } from './services/warehouse.service.js';
import { WarehouseRepository } from './repositories/warehouse.repository.js';

@Module({
  controllers: [WarehouseController],
  providers: [WarehouseService, WarehouseRepository],
  exports: [WarehouseService],
})
export class WmsModule {}
