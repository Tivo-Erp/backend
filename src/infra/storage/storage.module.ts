import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service.js';
import { FilesController } from '../../modules/files/files.controller.js';

/** INF-003 — object storage. Global so any module (DEL POD, SHP label) can inject it. */
@Global()
@Module({
  controllers: [FilesController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
