import {
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { OLAP_DDL } from './olap-schema.js';

/** Node-style callback the `duckdb` driver invokes for non-returning statements. */
type DuckRunCallback = (err: Error | null) => void;
/** Node-style callback the `duckdb` driver invokes with returned rows. */
type DuckAllCallback<T> = (err: Error | null, rows: T[]) => void;

/** Minimal slice of the `duckdb` Connection API this service relies on. */
interface DuckConnection {
  run(sql: string, ...args: [...unknown[], DuckRunCallback]): void;
  all<T>(sql: string, ...args: [...unknown[], DuckAllCallback<T>]): void;
  close?(): void;
}

/** Minimal slice of the `duckdb` Database API this service relies on. */
interface DuckDatabase {
  connect(): DuckConnection;
  close?(): void;
}

interface DuckDatabaseConstructor {
  new (path: string): DuckDatabase;
}

/** Shape of the dynamically `import`ed `duckdb` module (CJS or ESM default). */
interface DuckDbModule {
  Database: DuckDatabaseConstructor;
  default?: { Database: DuckDatabaseConstructor };
}

/**
 * BI-001 — DuckDB OLAP column store (ADR-011).
 *
 * Optional-safe: when `DUCKDB_PATH` is unset, or the `duckdb` native package is
 * not installed, the service stays disabled and every query raises
 * `BI_OLAP_UNAVAILABLE` (503) instead of crashing boot — matching the batch-6
 * "safe when env absent" principle. The package is loaded via a dynamic import
 * with a runtime-computed specifier so the build does not hard-depend on it.
 */
@Injectable()
export class DuckDbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DuckDbService.name);
  private readonly path: string;
  private db: DuckDatabase | null = null;
  private conn: DuckConnection | null = null;

  constructor(config: ConfigService) {
    this.path = config.get<string>('app.duckdbPath', '');
  }

  get configured(): boolean {
    return !!this.conn;
  }

  async onModuleInit() {
    if (!this.path) {
      this.logger.warn('DUCKDB_PATH not set — BI/OLAP disabled.');
      return;
    }
    try {
      // Runtime-computed specifier: keeps `duckdb` an optional dependency that
      // tsc/nest build do not need resolved at compile time.
      const specifier = 'duckdb';
      const duckdb = (await import(specifier)) as DuckDbModule;
      const mod = duckdb.default ?? duckdb;
      this.db = new mod.Database(this.path);
      this.conn = this.db.connect();
      await this.initSchema();
      this.logger.log(`DuckDB OLAP store ready at "${this.path}".`);
    } catch (err) {
      this.db = null;
      this.conn = null;
      this.logger.error(
        `DuckDB init failed (BI disabled): ${(err as Error).message}`,
      );
    }
  }

  private require(): DuckConnection {
    if (!this.conn) {
      throw new BusinessException(
        'BI_OLAP_UNAVAILABLE',
        'Business-intelligence store is not configured on this server',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.conn;
  }

  private async initSchema(): Promise<void> {
    for (const ddl of OLAP_DDL) await this.run(ddl);
  }

  /** Run a non-returning statement. */
  run(sql: string, ...params: unknown[]): Promise<void> {
    const conn = this.require();
    return new Promise((resolve, reject) => {
      conn.run(sql, ...params, (err: Error | null) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  /**
   * Run a parameterized query and return rows. Callers MUST pass the tenant id
   * as a bound parameter (never string-interpolated) — see {@link BiQueryBuilder}.
   */
  all<T = Record<string, unknown>>(
    sql: string,
    ...params: unknown[]
  ): Promise<T[]> {
    const conn = this.require();
    return new Promise((resolve, reject) => {
      conn.all(sql, ...params, (err: Error | null, rows: T[]) =>
        err ? reject(err) : resolve(rows ?? []),
      );
    });
  }

  /** Replace all rows for a tenant in a fact/dim table, then bulk-insert. */
  async reloadTenantTable(
    table: string,
    tenantId: string,
    rows: Record<string, unknown>[],
    columns: string[],
  ): Promise<number> {
    this.require();
    await this.run(`DELETE FROM ${table} WHERE tenant_id = ?`, tenantId);
    if (rows.length === 0) return 0;
    const placeholders = `(${columns.map(() => '?').join(', ')})`;
    const colList = columns.join(', ');
    // Insert row-by-row (DuckDB handles this fine for ETL batch sizes; keeps
    // the bound-parameter contract simple and injection-proof).
    for (const row of rows) {
      await this.run(
        `INSERT INTO ${table} (${colList}) VALUES ${placeholders}`,
        ...columns.map((c) => row[c] ?? null),
      );
    }
    return rows.length;
  }

  onModuleDestroy() {
    try {
      this.conn?.close?.();
      this.db?.close?.();
    } catch {
      /* ignore */
    }
  }
}
