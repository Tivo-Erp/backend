import { Module } from '@nestjs/common';
import { ItemController } from './controllers/item.controller.js';
import { ItemService } from './services/item.service.js';
import { ItemRepository } from './repositories/item.repository.js';

@Module({
  controllers: [ItemController],
  providers: [ItemService, ItemRepository],
  exports: [ItemService],
})
export class MatModule {}
