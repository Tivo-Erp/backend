import { Module } from '@nestjs/common';
import { InventoryController } from './controllers/inventory.controller.js';
import { InventoryService } from './services/inventory.service.js';

@Module({
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InvModule {}
