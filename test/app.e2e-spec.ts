/**
 * End-to-end test suite (real stack, no mocks).
 *
 * Boots a throwaway postgres:17 via Testcontainers, runs `prisma migrate
 * deploy` + the permission/plan seed against it, then starts the full Nest
 * application on the Fastify adapter (mirroring src/main.ts bootstrap) and
 * exercises a real business flow over HTTP:
 *
 *   register tenant (+ owner) → login (JWT) → create warehouse → create item
 *   → create customer → create sales order → fetch it back.
 *
 * Redis / RabbitMQ / S3 / Resend / Sentry are intentionally NOT configured —
 * the app is designed to no-op those features when their env vars are empty.
 *
 * If Docker is unreachable the suite self-skips with a console warning
 * instead of failing (useful on machines without a Docker daemon).
 */
import { execSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { IoAdapter } from '@nestjs/platform-socket.io';
import request from 'supertest';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

const REPO_ROOT = path.resolve(__dirname, '..');
const PRISMA_SCHEMA = 'src/infra/database/prisma/schema.prisma';

const TENANT = {
  name: 'E2E Test Corp',
  slug: 'e2e-test-corp',
  email: 'owner@e2e-test.example.com',
  password: 'Str0ngPassw0rd!',
};

const step = (msg: string) =>
  process.stderr.write(`[e2e] ${new Date().toISOString()} ${msg}\n`);

function dockerIsAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('ERP backend (e2e)', () => {
  let app: NestFastifyApplication | undefined;
  let container: StartedPostgreSqlContainer | undefined;
  let keyDir: string | undefined;
  let dockerAvailable = false;

  // Shared state for the sequential business flow.
  let accessToken = '';
  let warehouseId = '';
  let itemId = '';
  let customerId = '';
  let salesOrderId = '';

  const authed = () => ({ Authorization: `Bearer ${accessToken}` });
  const server = () => app!.getHttpServer();

  beforeAll(async () => {
    dockerAvailable = dockerIsAvailable();
    if (!dockerAvailable) {
      console.warn(
        '[e2e] Docker daemon is unreachable — skipping the e2e suite. ' +
          'Start Docker and re-run `npm run test:e2e` to execute it.',
      );
      return;
    }

    // ── 1. Throwaway PostgreSQL ────────────────────────────────
    step('starting postgres container');
    container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('erp_e2e')
      .withUsername('erp_e2e')
      .withPassword('erp_e2e_secret')
      .start();
    const databaseUrl = container.getConnectionUri();
    step('container ready: ' + databaseUrl);

    // ── 2. Migrations + base seed (permissions, plans) ─────────
    const childEnv = { ...process.env, DATABASE_URL: databaseUrl };
    step('running migrate deploy');
    execSync(`npx prisma migrate deploy --schema=${PRISMA_SCHEMA}`, {
      cwd: REPO_ROOT,
      env: childEnv,
      stdio: 'pipe',
    });
    step('running seed');
    execSync('npx ts-node src/infra/database/prisma/seed.ts', {
      cwd: REPO_ROOT,
      env: childEnv,
      stdio: 'pipe',
    });

    step('seed done');
    // ── 3. RS256 keypair for JWT (fresh, never the repo dev keys) ──
    keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-e2e-keys-'));
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    fs.writeFileSync(path.join(keyDir, 'private.pem'), privateKey);
    fs.writeFileSync(path.join(keyDir, 'public.pem'), publicKey);

    // ── 4. Environment (must be set BEFORE the module compiles) ──
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_PRIVATE_KEY_PATH = path.join(keyDir, 'private.pem');
    process.env.JWT_PUBLIC_KEY_PATH = path.join(keyDir, 'public.pem');
    process.env.PII_ENCRYPTION_KEY = 'e2e-pii-passphrase-32-chars!!!!!';
    // Optional infra OFF — empty string disables each feature (no-op path).
    process.env.REDIS_URL = '';
    process.env.RABBITMQ_URL = '';
    process.env.S3_ENDPOINT = '';
    process.env.SENTRY_DSN = '';
    process.env.RESEND_API_KEY = '';
    process.env.CRON_ENABLED = 'false';
    process.env.CACHE_ENABLED = 'false';
    // Keep the throttler out of the way (login is limited to 5/min by default).
    process.env.THROTTLE_LIMIT = '1000';
    process.env.LOG_LEVEL = 'silent';

    // ── 5. Boot the app like src/main.ts does ──────────────────
    step('importing AppModule');
    const { AppModule } = await import('../src/app.module.js');
    const { AllExceptionsFilter } =
      await import('../src/common/filters/all-exceptions.filter.js');

    step('compiling testing module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useWebSocketAdapter(new IoAdapter(app));

    step('app.init');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    step('app ready');
  });

  afterAll(async () => {
    await app?.close();
    await container?.stop();
    if (keyDir) fs.rmSync(keyDir, { recursive: true, force: true });
  });

  /** Skip-guard: returns true when the test should bail out (no Docker). */
  const skipped = (): boolean => {
    if (!dockerAvailable) {
      console.warn('[e2e] skipped — Docker unavailable');
      return true;
    }
    return false;
  };

  // ─── Health ────────────────────────────────────────────────────

  it('GET /health/live → 200 ok', async () => {
    if (skipped()) return;
    const res = await request(server()).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /health/ready → 200 (db up, redis disabled)', async () => {
    if (skipped()) return;
    const res = await request(server()).get('/health/ready');
    expect(res.status).toBe(200);
  });

  // ─── Tenant registration + auth ────────────────────────────────

  it('POST /api/v1/org/tenants/register → creates tenant + owner', async () => {
    if (skipped()) return;
    const res = await request(server())
      .post('/api/v1/org/tenants/register')
      .send(TENANT);
    expect(res.status).toBe(201);
  });

  it('rejects a duplicate tenant slug with 409', async () => {
    if (skipped()) return;
    const res = await request(server())
      .post('/api/v1/org/tenants/register')
      .send({ ...TENANT, email: 'someone-else@e2e-test.example.com' });
    expect(res.status).toBe(409);
  });

  it('POST /api/v1/auth/login → returns JWT tokens', async () => {
    if (skipped()) return;
    const res = await request(server())
      .post('/api/v1/auth/login')
      .send({ email: TENANT.email, password: TENANT.password });
    expect([200, 201]).toContain(res.status);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    accessToken = res.body.accessToken;
  });

  it('rejects unauthenticated requests with 401', async () => {
    if (skipped()) return;
    const res = await request(server()).get('/master-data/items');
    expect(res.status).toBe(401);
  });

  // ─── Authenticated business flow ───────────────────────────────

  it('POST /warehouse/warehouses → creates a warehouse', async () => {
    if (skipped()) return;
    const res = await request(server())
      .post('/warehouse/warehouses')
      .set(authed())
      .send({ code: 'WH-E2E', name: 'E2E Main Warehouse' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    warehouseId = res.body.id;
  });

  it('POST /master-data/items → creates an item', async () => {
    if (skipped()) return;
    const res = await request(server())
      .post('/master-data/items')
      .set(authed())
      .send({
        sku: 'SKU-E2E-001',
        name: 'E2E Widget',
        itemType: 'product',
        baseUom: 'PCS',
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    itemId = res.body.id;
  });

  it('GET /master-data/items → lists the created item', async () => {
    if (skipped()) return;
    const res = await request(server()).get('/master-data/items').set(authed());
    expect(res.status).toBe(200);
    const items = Array.isArray(res.body) ? res.body : res.body.data;
    expect(Array.isArray(items)).toBe(true);
    expect(items.some((i: { id: string }) => i.id === itemId)).toBe(true);
  });

  it('POST /sales/customers → creates a customer', async () => {
    if (skipped()) return;
    const res = await request(server())
      .post('/sales/customers')
      .set(authed())
      .send({ code: 'CUS-E2E', name: 'E2E Customer Ltd' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    customerId = res.body.id;
  });

  it('POST /sales/sales-orders → creates a sales order', async () => {
    if (skipped()) return;
    const res = await request(server())
      .post('/sales/sales-orders')
      .set(authed())
      .send({
        customerId,
        warehouseId,
        lines: [{ itemId, quantity: 5, uom: 'PCS', unitPrice: 50000 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    salesOrderId = res.body.id;
  });

  it('GET /sales/sales-orders/:id → fetches the sales order back', async () => {
    if (skipped()) return;
    const res = await request(server())
      .get(`/sales/sales-orders/${salesOrderId}`)
      .set(authed());
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(salesOrderId);
    expect(res.body.customerId).toBe(customerId);
  });

  // TODO(e2e): extend the chain — confirm/approve the sales order, then cover
  // the procurement side (supplier → purchase order → GRN) and fulfilment
  // (delivery note → invoice → payment) once those flows are stable enough to
  // assert deterministically in CI.
});
