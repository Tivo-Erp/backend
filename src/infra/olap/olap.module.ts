import { Global, Module } from '@nestjs/common';
import { DuckDbService } from './duckdb.service.js';

/**
 * BI-001 — DuckDB OLAP store (ADR-011). Global so both the API process (query
 * side) and the worker process (ETL side) share one provider definition.
 * Optional-safe: disabled when `DUCKDB_PATH` is unset.
 */
@Global()
@Module({
  providers: [DuckDbService],
  exports: [DuckDbService],
})
export class OlapModule {}
