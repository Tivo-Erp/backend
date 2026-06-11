import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request tenant id, set by TenantGuard and consumed by PrismaService to
 * inject the RLS context (`app.current_tenant_id`) into every transaction.
 * Stored in AsyncLocalStorage so it never leaks across concurrent requests
 * the way a session-level `SET` on a pooled connection does.
 */
export const tenantContext = new AsyncLocalStorage<string>();

export function currentTenantId(): string | undefined {
  return tenantContext.getStore();
}
