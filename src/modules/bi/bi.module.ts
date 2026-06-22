import { Module } from '@nestjs/common';
import { BiController } from './controllers/bi.controller.js';
import { BiService } from './services/bi.service.js';
import { EtlService } from './services/etl.service.js';

/**
 * M-BI (Batch 7). Query API + dashboards over the DuckDB OLAP store, plus the
 * ETL service that reloads it from OLTP. {@link DuckDbService} comes from the
 * global {@link OlapModule}. {@link EtlService} is exported so the worker's cron
 * processor can drive scheduled syncs.
 */
@Module({
  controllers: [BiController],
  providers: [BiService, EtlService],
  exports: [EtlService, BiService],
})
export class BiModule {}
