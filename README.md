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

    Note over Client,DB: 2️⃣ LOGIN (Public - Get JWT Token)
    Client->>API: POST /api/v1/auth/login<br/>{ email, password, tenantSlug }
    API->>DB: Verify credentials + check locks
    API-->>Client: { accessToken (RS256), refreshToken, user }

    Note over Client,DB: 3️⃣ SETUP ORG STRUCTURE (Authenticated)
    Client->>API: POST /api/v1/org/branches<br/>🔒 Bearer Token
    API-->>Client: Branch created

    Note over Client,DB: 4️⃣ INVITE TEAM MEMBERS
    Client->>API: POST /api/v1/uam/users/invite<br/>🔒 Bearer Token
    API->>DB: INSERT user (status=invited)
    API-->>Client: User invited

    Note over Client,DB: 5️⃣ CONFIGURE ROLES & PERMISSIONS
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

# ── Step 2: Login để lấy JWT token ──
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@abc.vn","password":"SecureP@ss123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

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
| `PORT` | `3000` | Server port |

---

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run start:dev` | Start in watch mode (development) |
| `npm run start:debug` | Start in debug + watch mode |
| `npm run start:prod` | Start production server (`node dist/main`) |
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
Auth:     /api/v1/auth/login, /api/v1/auth/refresh, /api/v1/auth/logout
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
├── worker.ts                    # BullMQ worker entry (placeholder)
├── common/                      # Shared kernel
│   ├── decorators/              # @CurrentTenant, @CurrentUser, @Public, @RequirePermissions
│   ├── dto/                     # PaginationQueryDto, ErrorResponseDto
│   ├── exceptions/              # BusinessException
│   ├── filters/                 # AllExceptionsFilter
│   ├── guards/                  # JwtAuthGuard, TenantGuard, RbacGuard
│   ├── interceptors/            # LoggingInterceptor, TransformInterceptor
│   ├── middleware/              # CorrelationIdMiddleware
│   └── utils/                   # FieldSelector (sparse fieldsets)
├── config/
│   └── app.config.ts            # ConfigModule registration
├── infra/
│   ├── database/
│   │   ├── prisma.service.ts    # PrismaService (onModuleInit, forTenant)
│   │   └── prisma/
│   │       ├── schema.prisma    # Single source of truth for DB schema
│   │       └── seed.ts          # Seed script
│   └── sequence/
│       └── document-sequence.service.ts
├── modules/                     # Domain modules (1:1 BRD)
│   ├── auth/                    # M-UAM: Authentication
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
│   ├── wfl/                     # M-WFL: Workflow
│   └── ntf/                     # M-NTF: Notifications
└── keys/                        # RS256 key pair (gitignored)
```

---

## Production Build

### Build

```bash
npm run build
```

Compiled output is in `dist/`.

### Run production

```bash
# Set production environment variables
export NODE_ENV=production
export DATABASE_URL=postgresql://user:password@host:5432/erp_prod
export REDIS_URL=redis://host:6379

npm run start:prod
```

### Docker production (multi-stage)

```dockerfile
# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build
RUN npm run prisma:generate

# Stage 2: Run
FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src/infra/database/prisma ./prisma
EXPOSE 3000
CMD ["node", "dist/main.js"]
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
