import {
  HttpStatus,
  Injectable,
  Logger,
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
  close?(cb?: (err: Error | null) => void): void;
}

/** DuckDB access-mode config object (`new Database(path, { access_mode })`). */
interface DuckOpenConfig {
  access_mode?: 'READ_ONLY' | 'READ_WRITE';
}

interface DuckDatabaseConstructor {
  new (path: string, config?: DuckOpenConfig): DuckDatabase;
}

/** Shape of the dynamically `import`ed `duckdb` module (CJS or ESM default). */
interface DuckDbModule {
  Database: DuckDatabaseConstructor;
  default?: { Database: DuckDatabaseConstructor };
}

/** A short-lived open connection plus a function to release it (closes the file). */
interface OpenHandle {
  conn: DuckConnection;
  release: () => void;
}

const LOCK_RETRY_ATTEMPTS = 4;
const LOCK_RETRY_DELAY_MS = 250;

/**
 * BI-001 — DuckDB OLAP column store (ADR-011).
 *
 * Optional-safe: when `DUCKDB_PATH` is unset, or the `duckdb` native package is
 * not installed, the service stays disabled and every query raises
 * `BI_OLAP_UNAVAILABLE` (503) instead of crashing boot.
 *
 * Concurrency model — DuckDB is single-writer per file: a process holding it
 * read-write takes an EXCLUSIVE lock that even blocks readers in other
 * processes. The ERP runs two processes against one cube file (the worker's ETL
 * writes; the API queries). To make that safe we never hold a persistent
 * connection: each operation opens the file, does its work, and closes it.
 *   • Writer (worker, DUCKDB_READONLY=false) → opens READ_WRITE only for the
 *     brief duration of a reload, then releases the lock.
 *   • Reader (API, DUCKDB_READONLY=true) → opens READ_ONLY per query, with a
 *     short retry if it collides with a writer's lock mid-reload.
 * `:memory:` is single-process only (each open is a fresh empty db) — fine for
 * dev/tests, not for the two-process prod topology.
 */
@Injectable()
export class DuckDbService implements OnModuleInit {
  private readonly logger = new Logger(DuckDbService.name);
  private readonly path: string;
  private readonly readonly: boolean;
  private mod: DuckDbModule | null = null;
  private available = false;

  constructor(config: ConfigService) {
    this.path = config.get<string>('app.duckdbPath', '');
    this.readonly = config.get<boolean>('app.duckdbReadonly', false);
  }

  get configured(): boolean {
    return this.available;
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
      this.mod = duckdb.default ?? duckdb;
      this.available = true;
      // The writer owns schema creation; it opens READ_WRITE once at boot to
      // create the file + fact tables, then releases the lock. Readers never
      // run DDL (a READ_ONLY connection can't), so they skip this.
      if (!this.readonly) {
        await this.withConnection(true, async (conn) => {
          for (const ddl of OLAP_DDL) await this.runOn(conn, ddl);
        });
      }
      this.logger.log(
        `DuckDB OLAP store ready at "${this.path}" (${this.readonly ? 'read-only' : 'read-write'}).`,
      );
    } catch (err) {
      this.mod = null;
      this.available = false;
      this.logger.error(
        `DuckDB init failed (BI disabled): ${(err as Error).message}`,
      );
    }
  }

  private requireModule(): DuckDbModule {
    if (!this.mod || !this.available) {
      throw new BusinessException(
        'BI_OLAP_UNAVAILABLE',
        'Business-intelligence store is not configured on this server',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.mod;
  }

  /** Open a short-lived connection in the requested mode. */
  private open(forWrite: boolean): OpenHandle {
    const mod = this.requireModule();
    const config: DuckOpenConfig | undefined = forWrite
      ? undefined // default READ_WRITE
      : { access_mode: 'READ_ONLY' };
    const db = new mod.Database(this.path, config);
    const conn = db.connect();
    return {
      conn,
      release: () => {
        try {
          conn.close?.();
          db.close?.();
        } catch {
          /* ignore close errors */
        }
      },
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** True when the error is DuckDB's file-lock contention (writer vs reader). */
  private isLockError(err: unknown): boolean {
    const msg = (err as Error)?.message?.toLowerCase() ?? '';
    return (
      msg.includes('lock') ||
      msg.includes('conflict') ||
      msg.includes('being used by another')
    );
  }

  /**
   * Acquire a connection, run `fn`, and always release it. Read-only opens that
   * lose the race to a concurrent writer are retried a few times — the writer's
   * reload window is short, so a brief backoff clears it.
   */
  private async withConnection<T>(
    forWrite: boolean,
    fn: (conn: DuckConnection) => Promise<T>,
  ): Promise<T> {
    let lastErr: unknown;
    const attempts = forWrite ? 1 : LOCK_RETRY_ATTEMPTS;
    for (let i = 0; i < attempts; i++) {
      let handle: OpenHandle | null = null;
      try {
        handle = this.open(forWrite);
        return await fn(handle.conn);
      } catch (err) {
        lastErr = err;
        // Retry a read-only open that lost the race to the writer's lock.
        if (!forWrite && this.isLockError(err) && i < attempts - 1) {
          await this.sleep(LOCK_RETRY_DELAY_MS * (i + 1));
          continue;
        }
        // An error opening the file on the read path (missing file because the
        // writer hasn't built the cube yet, or the lock never cleared) means the
        // store isn't ready — surface the optional-safe 503, not a raw 500. An
        // error AFTER opening (handle set) is a real query error → propagate.
        if (!forWrite && handle === null) {
          throw new BusinessException(
            'BI_OLAP_UNAVAILABLE',
            'Business-intelligence store is not ready yet',
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        }
        throw err;
      } finally {
        handle?.release();
      }
    }
    throw lastErr as Error;
  }

  private runOn(conn: DuckConnection, sql: string, ...params: unknown[]) {
    return new Promise<void>((resolve, reject) => {
      conn.run(sql, ...params, (err: Error | null) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  /** Run a non-returning statement (writer path). */
  run(sql: string, ...params: unknown[]): Promise<void> {
    return this.withConnection(!this.readonly, (conn) =>
      this.runOn(conn, sql, ...params),
    );
  }

  /**
   * Run a parameterized query and return rows. Callers MUST pass the tenant id
   * as a bound parameter (never string-interpolated) — see {@link BiQueryBuilder}.
   */
  all<T = Record<string, unknown>>(
    sql: string,
    ...params: unknown[]
  ): Promise<T[]> {
    // Readers open READ_ONLY; the writer process reads on its READ_WRITE conn.
    return this.withConnection(!this.readonly, (conn) => {
      return new Promise<T[]>((resolve, reject) => {
        conn.all<T>(sql, ...params, (err: Error | null, rows: T[]) =>
          err ? reject(err) : resolve(rows ?? []),
        );
      });
    });
  }

  /**
   * Replace all rows for a tenant in a fact/dim table, then bulk-insert. The
   * whole table reload runs on ONE write connection so the exclusive lock is
   * taken once per table (not per statement) and released immediately after.
   */
  async reloadTenantTable(
    table: string,
    tenantId: string,
    rows: Record<string, unknown>[],
    columns: string[],
  ): Promise<number> {
    await this.withConnection(true, async (conn) => {
      await this.runOn(conn, `DELETE FROM ${table} WHERE tenant_id = ?`, tenantId);
      if (rows.length === 0) return;
      const placeholders = `(${columns.map(() => '?').join(', ')})`;
      const colList = columns.join(', ');
      // Insert row-by-row (DuckDB handles this fine for ETL batch sizes; keeps
      // the bound-parameter contract simple and injection-proof).
      for (const row of rows) {
        await this.runOn(
          conn,
          `INSERT INTO ${table} (${colList}) VALUES ${placeholders}`,
          ...columns.map((c) => row[c] ?? null),
        );
      }
    });
    return rows.length;
  }
}
