# ============================================================
# Stage 1: Builder — Install deps, generate Prisma, build TS
# ============================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Install OpenSSL for Prisma engine compatibility
RUN apk add --no-cache openssl

# Copy dependency manifests first (cache layer)
COPY package.json package-lock.json ./

# Install ALL dependencies (dev + prod) for build
RUN npm ci

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
FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl dumb-init

# Create non-root user for security
RUN addgroup -g 1001 -S erp && \
    adduser -S erp -u 1001 -G erp

# Copy dependency manifests
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Copy Prisma schema + generated client from builder
COPY --from=builder /app/src/infra/database/prisma/ ./src/infra/database/prisma/
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Copy built application
COPY --from=builder /app/dist ./dist

# Prisma 7 requires prisma.config.js at the working directory root to find
# datasource.url when running `prisma migrate deploy`. Copy the compiled version.
COPY --from=builder /app/dist/prisma.config.js ./prisma.config.js

# Set ownership
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
