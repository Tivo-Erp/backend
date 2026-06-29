# syntax=docker/dockerfile:1
# ============================================================
# Stage 1: Builder — Install deps, generate Prisma, build TS
# ============================================================
# Debian (glibc) base — NOT alpine/musl — so the duckdb native package (BI/OLAP)
# can download its prebuilt glibc binary instead of compiling from source.
FROM node:22-slim AS builder

WORKDIR /app

# OpenSSL for Prisma engine; ca-certificates so node-pre-gyp can fetch the
# duckdb prebuilt binary over HTTPS.
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests first (cache layer)
COPY package.json package-lock.json ./

# Install ALL dependencies (dev + prod) for build.
# BuildKit cache mount keeps npm's download cache (incl. the duckdb prebuilt)
# across builds, so re-builds with an unchanged lockfile are near-instant.
RUN --mount=type=cache,target=/root/.npm npm ci

# Copy Prisma schema & config for client generation
COPY prisma.config.ts ./
COPY src/infra/database/prisma/ ./src/infra/database/prisma/

# Generate Prisma Client
RUN npx prisma generate --schema=src/infra/database/prisma/schema.prisma

# Copy rest of source
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src/ ./src/

# Build TypeScript → dist/
RUN npm run build

# ============================================================
# Stage 2: Runner — Production-only, minimal image
# ============================================================
FROM node:22-slim AS runner

WORKDIR /app

# openssl (Prisma) · ca-certificates (duckdb prebuilt fetch) · dumb-init (PID 1)
# · wget (Docker/compose HEALTHCHECK — not bundled in debian slim).
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates dumb-init wget \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd -g 1001 erp && \
    useradd -u 1001 -g erp -m -s /bin/sh erp

# Copy dependency manifests
COPY package.json package-lock.json ./

# Install production dependencies only. The npm cache lives in a BuildKit cache
# mount (not in the image layer), so no `npm cache clean` is needed to stay slim.
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# Copy Prisma schema + generated client from builder
COPY --from=builder /app/src/infra/database/prisma/ ./src/infra/database/prisma/
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Copy built application
COPY --from=builder /app/dist ./dist

# Prisma 7 loads prisma.config.ts directly with its built-in TS runtime.
# Must be present at the working directory root for `prisma migrate deploy`.
COPY prisma.config.ts ./

# Writable data dir for the optional DuckDB OLAP cube. Created erp-owned so that
# a fresh `duckdbdata` named volume mounted here inherits writable ownership for
# the non-root user (Docker copies the mount point's perms into a new volume).
RUN mkdir -p /app/data

# Set ownership (covers /app/data so the non-root user can write the cube)
RUN chown -R erp:erp /app

USER erp

# Expose app port
EXPOSE 3000

# Health check — uses dedicated /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Use dumb-init to handle PID 1 properly (signal forwarding)
ENTRYPOINT ["dumb-init", "--"]
# Run Prisma migrations before starting the app.
# 'prisma migrate deploy' is idempotent — safe to run on every startup.
# It will apply any pending migrations without touching existing data.
CMD ["sh", "-c", "npx prisma migrate deploy --schema=src/infra/database/prisma/schema.prisma && node dist/main.js"]
