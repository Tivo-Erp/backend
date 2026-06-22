/**
 * Pure (client-free) object-key validation helpers for INF-003 storage.
 * Kept dependency-free so modules (e.g. DEL POD) can validate keys even when
 * S3/MinIO is not configured on the server.
 */

/** Module slugs allowed to own object keys (`{tenantId}/{module}/...`). */
export const STORAGE_MODULES = [
  'del',
  'shp',
  'hrm',
  'fin',
  'docs',
  'crm',
  'pur',
  'sal',
  'pmo',
  'qc',
  'mfg',
  'wms',
] as const;
export type StorageModule = (typeof STORAGE_MODULES)[number];

/** Sane default content-type allowlist for presigned uploads. */
export const DEFAULT_ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Per-module content-type allowlists. Modules not listed fall back to
 * {@link DEFAULT_ALLOWED_CONTENT_TYPES}.
 */
export const MODULE_CONTENT_TYPES: Partial<Record<string, readonly string[]>> =
  {
    // POD photos are camera shots — images only.
    del: IMAGE_CONTENT_TYPES,
    // Document attachments — pdf + images.
    docs: [...IMAGE_CONTENT_TYPES, 'application/pdf'],
  };

/** Max declared upload size for presigned POSTs (25 MB). */
export const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;

/**
 * Structural key validation: rejects empty keys, leading '/', backslashes,
 * percent-encoding tricks, and any ''/'.'/'..' path segment.
 */
export function isStructurallyValidKey(key: string): boolean {
  if (typeof key !== 'string' || key.length === 0 || key.length > 1024) {
    return false;
  }
  if (key.startsWith('/') || key.includes('\\') || key.includes('%')) {
    return false;
  }
  return key
    .split('/')
    .every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/**
 * True when `key` is structurally valid AND lives under
 * `{tenantId}/{module}/{entityId}/`.
 */
export function isTenantModuleEntityKey(
  tenantId: string,
  module: string,
  entityId: string,
  key: string,
): boolean {
  return (
    isStructurallyValidKey(key) &&
    key.startsWith(`${tenantId}/${module}/${entityId}/`)
  );
}
