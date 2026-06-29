# ERP Backend — NestJS Modular Monolith

Multi-tenant ERP backend built with NestJS 11 (Fastify adapter) + Prisma ORM + PostgreSQL 17.

## Tech Stack (ADR-pinned versions)

| Component | Version | ADR |
|-----------|---------|-----|
| **NestJS** | 11 LTS | [ADR-009](../docs/ADR/ADR-009-nestjs-modular-monolith-backend.md) |
| **PostgreSQL** | 17 LTS (alpine) | [ADR-001](../docs/ADR/ADR-001-database-postgresql-pgbouncer-timescale.md) |
| **Redis** | 7 (alpine) | [ADR-004](../docs/ADR/ADR-004-redis-cache-bullmq-jobs.md) |
| **Prisma ORM** | ^7.x | [ADR-009](../docs/ADR/ADR-009-nestjs-modular-monolith-backend.md) |
| **TypeScript** | 5.x (strict) | [ADR-002](../docs/ADR/ADR-002-frontend-react-vite-typescript.md) |
| **Fastify** | via @nestjs/platform-fastify ^11 | [ADR-009](../docs/ADR/ADR-009-nestjs-modular-monolith-backend.md) |
| **Auth** | RS256 JWT (Passport.js + bcryptjs) | [ADR-013](../docs/ADR/ADR-013-custom-jwt-auth-passport.md) |

---

## Prerequisites

- **Node.js** ≥ 22 LTS
- **npm** ≥ 10
- **Docker** + Docker Compose
- **OpenSSL** (for RS256 key generation)

---

## Quick Start (Development)

### 1. Clone & install

```bash
cd erp-backend
npm install
```

### 2. Start infrastructure (PostgreSQL + Redis)

```bash
docker compose up -d
```

This starts:
- `postgres:17-alpine` on port **5432** (DB: `erp_dev`, user: `erp_admin`)
- `redis:7-alpine` on port **6379**

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env if needed — defaults work for local development
```

### 4. Generate RSA key pair (JWT RS256)

```bash
mkdir -p keys
openssl genrsa -out keys/private.pem 2048
openssl rsa -in keys/private.pem -pubout -out keys/public.pem
```

### 5. Database setup

```bash
# Generate Prisma client
npm run prisma:generate

# Run migrations (creates all tables)
npm run prisma:migrate

# Seed initial data (plans, permissions)
npm run prisma:seed
```

### 6. Start development server

```bash
npm run start:dev
```

Server runs at: **http://localhost:3000**
Swagger docs: **http://localhost:3000/api/docs**

---

## Tenant Onboarding Workflow

### Auth Model

Hệ thống ERP là **multi-tenant SaaS**. Không có global superadmin mặc định.

| Khái niệm | Giải thích |
|-----------|------------|
| **Platform Admin** | User có `isSuperAdmin = true`. Quản lý cross-tenant (suspend, view all). Được tạo qua seed hoặc DB trực tiếp. |
| **Tenant Owner** | User đầu tiên của mỗi tenant, tự động được gán role `tenant_owner` + **toàn bộ 18 permissions**. |
| **Self-service Registration** | Endpoint `POST /register` là **public** — tạo tenant + user + roles + subscription trong 1 transaction. |

### Luồng khởi tạo Tenant (Mermaid)

```mermaid
sequenceDiagram
    participant Client
    participant API as ERP API
    participant DB as PostgreSQL

    Note over Client,DB: 1️⃣ REGISTER TENANT (Public - No Auth Required)
    Client->>API: POST /api/v1/org/tenants/register<br/>{ name, slug, email, password }
    API->>DB: BEGIN TRANSACTION
    DB-->>API: Check slug unique ✓
    DB-->>API: Check email unique ✓
    API->>DB: INSERT tenant (status=active)
    API->>DB: INSERT user (owner, status=active)
    API->>DB: INSERT 5 system roles
    API->>DB: INSERT role_permissions (owner = all 18 perms)
    API->>DB: INSERT user_role (user → tenant_owner)
    API->>DB: INSERT subscription (starter plan, 14-day trial)
    API->>DB: INSERT 13 document_sequences
    API->>DB: COMMIT
    API-->>Client: { tenantId, userId, slug, status }

    Note over Client,DB: 2️⃣ (Tùy chọn) TENANT DISCOVERY (Public - chọn tenant khi multi-tenant)
    Client->>API: POST /api/v1/auth/tenants<br/>{ email, password }
    API->>DB: Verify credentials trên từng tenant
    API-->>Client: { tenants: [{ tenantId, tenantSlug, tenantName, logoUrl }] }

    Note over Client,DB: 3️⃣ LOGIN (Public - Get JWT Token)
    Client->>API: POST /api/v1/auth/login<br/>{ email, password, tenantSlug }
    API->>DB: Verify credentials + check locks
    API-->>Client: { accessToken (RS256), refreshToken, user }

    Note over Client,DB: 4️⃣ GET PROFILE (Authenticated)
    Client->>API: GET /api/v1/auth/me<br/>🔒 Bearer Token
    API-->>Client: { id, email, name, tenant, roles, permissions }

    Note over Client,DB: 5️⃣ SETUP ORG STRUCTURE (Authenticated)
    Client->>API: POST /api/v1/org/branches<br/>🔒 Bearer Token
    API-->>Client: Branch created

    Note over Client,DB: 6️⃣ INVITE TEAM MEMBERS
    Client->>API: POST /api/v1/uam/users/invite<br/>🔒 Bearer Token
    API->>DB: INSERT user (status=invited)
    API-->>Client: User invited

    Note over Client,DB: 7️⃣ CONFIGURE ROLES & PERMISSIONS
    Client->>API: POST /api/v1/uam/roles<br/>🔒 Bearer Token
    API-->>Client: Custom role created
```

### Step-by-step: Khởi tạo Tenant đầy đủ

```bash
# ── Step 1: Register tenant (PUBLIC - không cần auth) ──
curl -X POST http://localhost:3000/api/v1/org/tenants/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Công ty TNHH ABC",
    "slug": "cty-abc",
    "email": "admin@abc.vn",
    "password": "SecureP@ss123"
  }'
# → Response: { tenantId, userId, slug }
# → User "admin@abc.vn" được tạo tự động với role "tenant_owner"

# ── Step 2 (tùy chọn): Lấy danh sách tenant của user (khi 1 email thuộc nhiều tenant) ──
curl -s -X POST http://localhost:3000/api/v1/auth/tenants \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@abc.vn","password":"SecureP@ss123"}' | python3 -m json.tool
# → { "tenants": [ { "tenantId", "tenantSlug", "tenantName", "logoUrl" }, ... ] }
# → Dùng tenantSlug nhận được cho bước login bên dưới (nếu có nhiều tenant)

# ── Step 3: Login để lấy JWT token (thêm "tenantSlug" nếu email thuộc nhiều tenant) ──
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@abc.vn","password":"SecureP@ss123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

# ── Step 3b: Lấy profile user hiện tại từ token ──
curl -s http://localhost:3000/api/v1/auth/me \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
# → { id, email, firstName, lastName, tenantSlug, roles, permissions, ... }

# ── Step 3: Tạo chi nhánh ──
curl -X POST http://localhost:3000/api/v1/org/branches \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code":"HQ","name":"Trụ sở chính","isHeadquarters":true}'

# ── Step 4: Lấy danh sách roles (để biết roleId cho invite) ──
curl -s http://localhost:3000/api/v1/uam/roles \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# ── Step 5: Invite thêm user ──
curl -X POST http://localhost:3000/api/v1/uam/users/invite \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "staff@abc.vn",
    "firstName": "Nguyen",
    "lastName": "Van B",
    "roleIds": ["<staff-role-uuid-from-step-4>"]
  }'
```

### Dữ liệu tự động tạo khi Register

| Entity | Số lượng | Chi tiết |
|--------|----------|----------|
| **Tenant** | 1 | `status: active` |
| **User (Owner)** | 1 | `status: active`, role = `tenant_owner` |
| **System Roles** | 5 | `tenant_owner`, `tenant_admin`, `manager`, `staff`, `viewer` |
| **Role Permissions** | 18 | Owner role gets ALL permissions |
| **Subscription** | 1 | Plan `starter`, trial 14 ngày |
| **Document Sequences** | 13 | PO, PR, SO, SQ, INV, CN, DN, GRN, WO, NCR, PAY, JB, TKT |

### Flowchart: Phân quyền theo Role

```mermaid
graph TD
    A["🔐 tenant_owner"] -->|"ALL 18 permissions"| B["Full Access"]
    C["🔧 tenant_admin"] -->|"Manual assign"| D["Admin-level"]
    E["📋 manager"] -->|"Manual assign"| F["Read + Approve"]
    G["👤 staff"] -->|"Manual assign"| H["CRUD own data"]
    I["👁️ viewer"] -->|"Manual assign"| J["Read-only"]
    
    style A fill:#059669,color:#fff
    style C fill:#2563eb,color:#fff
    style E fill:#d97706,color:#fff
    style G fill:#6366f1,color:#fff
    style I fill:#6b7280,color:#fff
```

> **Lưu ý:** Chỉ `tenant_owner` được auto-assign toàn bộ permissions khi register. Các role khác (admin, manager, staff, viewer) cần **tenant owner** tự assign permissions qua `PATCH /api/v1/uam/roles/:id`.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://erp_admin:erp_secret_dev@localhost:5432/erp_dev` | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `JWT_PRIVATE_KEY_PATH` | `./keys/private.pem` | RS256 private key path |
| `JWT_PUBLIC_KEY_PATH` | `./keys/public.pem` | RS256 public key path |
| `JWT_ACCESS_TTL` | `3600` | Access token TTL (seconds) |
| `JWT_REFRESH_TTL` | `604800` | Refresh token TTL (seconds) |
| `PORT` | `3000` | API host port (container always listens on 3000) |
| `APP_BIND_HOST` | `127.0.0.1` | Host interface the API binds to (prod). Loopback-only by default — front with nginx |
| `POSTGRES_PORT` | `5432` | Postgres internal port (prod). Not published to host |
| `REDIS_PORT` | `6379` | Redis internal port (prod). Not published to host |
| `RABBITMQ_PORT` | `5672` | RabbitMQ AMQP internal port (prod). Not published to host |
| `AUTH_MAX_FAILED_ATTEMPTS` | `5` | Failed logins before lockout |
| `AUTH_LOCK_DURATION_SEC` | `1800` | Lockout duration (seconds) |
| `REDIS_MAX_MEMORY` | `256mb` | Redis memory cap (prod only) |

> See [`.env.prod.example`](.env.prod.example) for the full documented production variable list.

---

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run start:dev` | Start in watch mode (development) |
| `npm run start:debug` | Start in debug + watch mode |
| `npm run start:prod` | Start production server (`node dist/main`) |
| `npm run start:worker` | Start background worker (BullMQ jobs + cron + event consumers) |
| `npm run start:worker:dev` | Start worker in watch mode (development) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run lint` | Run ESLint with auto-fix |
| `npm run format` | Run Prettier |
| `npm run test` | Run unit tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:cov` | Run tests with coverage |
| `npm run test:e2e` | Run e2e tests |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:migrate` | Run Prisma migrations (dev) |
| `npm run prisma:studio` | Open Prisma Studio (DB GUI) |
| `npm run prisma:seed` | Seed database |

---

## API Documentation

Swagger/OpenAPI docs are auto-generated and available at:

```
http://localhost:3000/api/docs
```

### API Design Standards

All API endpoints follow the [API Design Guidelines](../docs/erp-specs/API_Design_Guidelines.md):

- **Sparse Fieldsets**: `?fields=id,name,email` — client selects returned fields
- **Field Whitelisting**: Each endpoint defines `allowed_fields` per role
- **Prisma-level SELECT**: Fields are pushed down to DB query (no `SELECT *`)
- **Pagination**: `?page=1&limit=20&sortBy=createdAt&sortOrder=desc`
- **FieldSelector utility**: `src/common/utils/field-selector.ts`

### API Endpoint Pattern

```
Base URL: /api/v1
Auth:     /api/v1/auth/tenants, /api/v1/auth/login, /api/v1/auth/refresh, /api/v1/auth/logout, /api/v1/auth/me
Org:      /api/v1/org/tenants/*, /api/v1/org/branches/*
UAM:      /api/v1/uam/users/*, /api/v1/uam/roles/*
MAT:      /api/v1/master-data/items/*
WMS:      /api/v1/warehouse/warehouses/*
INV:      /api/v1/inventory/balances, /api/v1/inventory/adjustments
PUR:      /api/v1/purchase/suppliers/*, /api/v1/purchase/purchase-orders/*
SAL:      /api/v1/sales/customers/*, /api/v1/sales/sales-orders/*
FIN:      /api/v1/finance/chart-of-accounts/*, /api/v1/finance/journal-batches/*
MFG:      /api/v1/manufacturing/work-orders/*
QC:       /api/v1/qc/inspections/*
HRM:      /api/v1/hrm/employees/*, /api/v1/hrm/payroll/*
WFL:      /api/v1/wfl/definitions/*, /api/v1/wfl/tasks/*
NTF:      /api/v1/ntf/notifications/*
```

---

## Project Structure

```
src/
├── main.ts                      # Fastify bootstrap + Swagger setup
├── app.module.ts                # Root module
├── worker.ts                    # Background worker entry (BullMQ jobs + cron + event consumers)
├── common/                      # Shared kernel
│   ├── decorators/              # @CurrentTenant, @CurrentUser, @Public, @RequirePermissions
│   ├── dto/                     # PaginationQueryDto, ErrorResponseDto
│   ├── exceptions/              # BusinessException
│   ├── filters/                 # AllExceptionsFilter
│   ├── guards/                  # JwtAuthGuard, TenantGuard, RbacGuard
│   ├── health/                  # /health, /health/ready (Terminus)
│   ├── interceptors/            # AuditLogInterceptor
│   ├── middleware/              # CorrelationIdMiddleware
│   └── utils/                   # FieldSelector, PII crypto (AES-256-GCM), TOTP
├── config/
│   └── app.config.ts            # ConfigModule registration
├── infra/
│   ├── database/                # PrismaService (onModuleInit, forTenant) + schema + seed
│   ├── cache/                   # Redis cache + Redis-backed throttler storage
│   ├── redis/                   # Shared Redis connection
│   ├── queue/                   # BullMQ producers + processors (email, cron)
│   ├── events/                  # Transactional outbox + RabbitMQ publisher/consumer
│   ├── email/                   # Transactional email (Resend) + templates
│   ├── storage/                 # S3 / MinIO presigned uploads
│   ├── observability/           # Prometheus metrics + Sentry error tracking
│   ├── olap/                    # DuckDB analytics store (BI ETL target)
│   └── sequence/                # Per-tenant document number sequences
├── modules/                     # Domain modules (1:1 BRD)
│   ├── auth/                    # Authentication (JWT RS256, MFA/TOTP, lockout)
│   ├── uam/                     # M-UAM: Users, Roles, Permissions, Audit Log
│   ├── org/                     # M-ORG: Tenant + Branch
│   ├── mat/                     # M-MAT: Master Data (Items, BOM)
│   ├── wms/                     # M-WMS: Warehouse, Zone, Bin
│   ├── inv/                     # M-INV: Inventory
│   ├── pur/                     # M-PUR: Procurement
│   ├── sal/                     # M-SAL: Sales
│   ├── fin/                     # M-FIN: Finance
│   ├── mfg/                     # M-MFG: Manufacturing
│   ├── qc/                      # M-QC: Quality Control
│   ├── hrm/                     # M-HRM: Human Resources
│   ├── del/                     # M-DEL: Delivery Notes
│   ├── shp/                     # M-SHP: Shipping (carriers, shipments, tracking)
│   ├── crm/                     # M-CRM: Leads, Opportunities, Tickets
│   ├── pmo/                     # M-PMO: Projects, Tasks, Timesheets
│   ├── bi/                      # M-BI: Dashboards / OLAP analytics
│   ├── wfl/                     # M-WFL: Workflow engine
│   ├── ntf/                     # M-NTF: Notifications (realtime + email)
│   ├── files/                   # File upload presign endpoints
│   └── search/                  # Cross-module search
└── keys/                        # RS256 key pair (gitignored)
```

---

## Production Deployment

### Requirements

| Component | Minimum Version | Notes |
|-----------|----------------|-------|
| **OS** | Ubuntu 20.04 LTS / CentOS 7 | Ubuntu 22.04+ recommended (CentOS 7 EOL Jun 2024) |
| **Docker Engine** | 20.10+ | Install via [docker-ce](https://docs.docker.com/engine/install/) |
| **Docker Compose Plugin** | v2.x | `docker compose` (plugin), NOT standalone `docker-compose` v1 |
| **RAM** | 2 GB min | 4 GB recommended |
| **Disk** | 20 GB+ | For Docker images + PostgreSQL data |

> **Ubuntu install one-liner:**
> ```bash
> curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER
> ```

---

### Network Topology & Port Exposure (Production)

The production stack runs on a private Docker bridge network (`erp-network`).
Services address each other by **service name** over the internal network — so
the backing stores never need a host port. Only the API is published, and only
on the loopback interface so a reverse proxy fronts it.

```
            ┌───────── host ─────────┐
 Internet ─▶│ nginx (443) ─▶ 127.0.0.1:${PORT} │   ← only published port
            └────────────┬───────────┘
                         │  erp-network (bridge, internal DNS)
      ┌──────────┬───────┴───────┬───────────┬──────────┐
      ▼          ▼               ▼           ▼          ▼
   app:3000   worker        postgres:5432  redis:6379  rabbitmq:5672
 (published)  (no port)     (internal)     (internal)  (internal)
```

| Service | Internal port | Published to host? | Rationale |
|---------|--------------|--------------------|-----------|
| **app** (API) | 3000 | **Yes — `${APP_BIND_HOST:-127.0.0.1}:${PORT}` only** | Fronted by nginx; never exposed straight to the internet |
| **worker** | — | No | Background process, no listener |
| **postgres** | `${POSTGRES_PORT:-5432}` | No | Reached as `postgres:5432` on `erp-network` |
| **redis** | `${REDIS_PORT:-6379}` | No | Reached as `redis:6379` on `erp-network` |
| **rabbitmq** | `${RABBITMQ_PORT:-5672}` | No | Reached as `rabbitmq:5672`; mgmt UI (15672) also internal |

**Changing ports** — all ports above are declarable in `.env.prod` (see table).
Each is wired consistently into the server config, the connection URL, and the
healthcheck, so changing one variable is enough. Do **not** publish postgres /
redis / rabbitmq to the host — exposing a datastore or broker is a security risk.
For occasional admin access (psql, RabbitMQ UI) use `docker exec` or an SSH
tunnel instead of a permanent port mapping.

> Changing a port is a runtime change only — `docker compose ... up -d` is enough,
> no image rebuild required.

---

### Step-by-step: First Deploy

#### 1. Install Docker (Ubuntu 22.04)

```bash
# Install Docker Engine + Compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version          # Docker version 24.x+
docker compose version    # Docker Compose version v2.x
```

#### 2. Clone project & enter directory

```bash
git clone <your-repo-url>
cd erp-backend
```

#### 3. Generate RS256 key pair (JWT)

```bash
mkdir -p keys
openssl genrsa -out keys/private.pem 2048
openssl rsa -in keys/private.pem -pubout -out keys/public.pem

# ⚠️ BẮT BUỘC: cấp quyền cho user trong container đọc được khóa.
# Container chạy bằng non-root user `erp` (uid 1001). Docker Compose
# (non-swarm) bind-mount thẳng file khóa vào /run/secrets/ và GIỮ NGUYÊN
# owner/mode của file host. Nếu khóa thuộc root + mode 600, uid 1001 sẽ
# không đọc được → app crash khi khởi động:
#   ERROR [ExceptionHandler] Error: EACCES: permission denied, open '/run/secrets/jwt_private_key'
sudo chown 1001:1001 keys/private.pem keys/public.pem
chmod 600 keys/private.pem keys/public.pem
```

> Store `keys/` directory securely. Add it to `.gitignore` (already done).
>
> **Lưu ý quyền khóa:** trường `uid/gid/mode` của `secrets` trong compose chỉ có
> tác dụng ở **Swarm mode** — `docker compose` thường bỏ qua, nên phải set owner
> bằng tay như trên. Mỗi khi **tạo lại khóa**, chạy lại 2 lệnh `chown`/`chmod`.
> Cách này giữ mode `600` (không world-readable) nhưng vẫn cho uid 1001 đọc được.
> Nếu sau này chuyển sang Docker Swarm, có thể khai báo `uid/gid/mode` trong
> compose và bỏ bước `chown` thủ công.

#### 4. Configure production environment

```bash
cp .env.prod.example .env.prod
nano .env.prod
```

**Required fields to change:**
```bash
POSTGRES_PASSWORD=<generate: openssl rand -base64 32>
```

#### 5. Build & start all services

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

This will:
1. Build the Docker image (multi-stage, ~2-3 min — re-builds are much faster
   thanks to the BuildKit npm cache mount)
2. Start PostgreSQL 17 → waits for healthy
3. Start Redis 7 → waits for healthy
4. Start app → **automatically runs `prisma migrate deploy`** then starts NestJS

#### 6. First-time database seed (permissions + plans)

Run **once**, after the stack is up (the app applies migrations on boot, so the
tables exist). The seed is idempotent — re-running it is safe.

```bash
docker exec erp-backend node dist/infra/database/prisma/seed.js
```

> ⚠️ Do **not** use `npx prisma db seed` against the production container — that
> command runs `ts-node src/...`, which is not present in the production image
> (dev-only tooling + no `src/`). The compiled `dist/.../seed.js` above is the
> production path (also available as `npm run prisma:seed:prod`).
>
> Verify it worked:
> ```bash
> docker exec erp-postgres psql -U erp_admin -d erp_prod -c "SELECT count(*) FROM permissions;"
> ```
> Without seeding, `POST /org/tenants/register` returns
> `500 SYSTEM_PLAN_NOT_FOUND — "Starter plan not found. Run database seed first."`

#### 7. Verify deployment

```bash
# Check all containers are running
docker compose -f docker-compose.prod.yml ps

# Check app logs
docker compose -f docker-compose.prod.yml logs -f app

# Test health endpoint
curl http://localhost:3000/api/health
# → { "status": "ok" }

# Test Swagger (only if port 3000 is open or via SSH tunnel)
# ssh -L 3000:localhost:3000 user@server
# Then open: http://localhost:3000/api/docs
```

#### 8. Set up Nginx reverse proxy (recommended)

```nginx
# /etc/nginx/sites-available/erp-backend
server {
    listen 80;
    server_name api.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
    }
}
```

```bash
# Enable + reload nginx
sudo ln -s /etc/nginx/sites-available/erp-backend /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

### Update / Deploy New Version (Zero Data Loss)

```bash
# 1. Pull latest code
git pull origin main

# 2. Rebuild image and restart app container
#    - Existing volumes (pgdata, redisdata) are NEVER touched
#    - App auto-runs `prisma migrate deploy` on startup
#    - PostgreSQL and Redis containers are NOT restarted (only app)
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build app

# 3. Verify
docker compose -f docker-compose.prod.yml logs -f app --tail=50
```

> **Data safety guarantee:**
> - `docker compose down` → stops containers, **data volumes preserved**
> - `docker compose up -d --build` → rebuilds image, **mounts same volumes**
> - `docker compose restart` → restarts containers, **data untouched**
> - `docker compose down -v` → ⚠️ **DELETES ALL VOLUMES** — never run on prod

---

### Backup & Restore

#### Backup PostgreSQL

```bash
# Full backup (gzip compressed)
docker exec erp-postgres pg_dump -U erp_admin erp_prod \
  | gzip > /backups/erp_prod_$(date +%Y%m%d_%H%M%S).sql.gz

# Schedule daily backup via cron (as root or docker user)
# crontab -e
0 2 * * * docker exec erp-postgres pg_dump -U erp_admin erp_prod | gzip > /backups/erp_prod_$(date +\%Y\%m\%d).sql.gz
```

#### Restore PostgreSQL

```bash
# Stop the app first to avoid writes during restore
docker compose -f docker-compose.prod.yml stop app

# Restore
gunzip -c /backups/erp_prod_20260610.sql.gz \
  | docker exec -i erp-postgres psql -U erp_admin -d erp_prod

# Restart app
docker compose -f docker-compose.prod.yml start app
```

#### Backup Redis (AOF file)

```bash
# Redis AOF is at: /var/lib/docker/volumes/erp-backend_redisdata/_data/appendonly.aof
# Simple copy (while running is safe with AOF):
docker exec erp-redis redis-cli BGSAVE
cp /var/lib/docker/volumes/erp-backend_redisdata/_data/dump.rdb /backups/redis_$(date +%Y%m%d).rdb
```

---

### Useful Commands

```bash
# Live logs
docker compose -f docker-compose.prod.yml logs -f app

# Enter app container
docker exec -it erp-backend sh

# Enter PostgreSQL CLI
docker exec -it erp-postgres psql -U erp_admin -d erp_prod

# Enter Redis CLI
docker exec -it erp-redis redis-cli

# Check resource usage
docker stats erp-backend erp-postgres erp-redis

# Restart only app (keep DB/Redis running)
docker compose -f docker-compose.prod.yml restart app

# Full restart
docker compose -f docker-compose.prod.yml down && \
  docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

---

## Testing

```bash
# Unit tests
npm run test

# Watch mode
npm run test:watch

# Coverage report
npm run test:cov

# E2E tests
npm run test:e2e
```

---

## ADR Reference

Full architecture decisions: [`docs/ADR/`](../docs/ADR/)

| ADR | Topic |
|-----|-------|
| ADR-001 | PostgreSQL 17 + PgBouncer + TimescaleDB |
| ADR-004 | Redis 7 + BullMQ |
| ADR-005 | RabbitMQ 3.x (FIFO ordering) |
| ADR-009 | NestJS 11 Modular Monolith |
| ADR-012 | MinIO S3 Storage |
| ADR-013 | JWT RS256 Auth (Passport.js) |
| ADR-014 | Socket.IO + Redis Adapter |
| ADR-016 | Resend Email Service |
