/**
 * Restricts a client-supplied `?sortBy=` value to a whitelist of sortable
 * columns. An unknown value falls back instead of reaching Prisma, where it
 * would throw a validation error (HTTP 500) and would let callers order by
 * fields outside their role's field whitelist.
 */
export function safeSortBy(
  sortBy: string | undefined,
  allowed: readonly string[],
  fallback = 'createdAt',
): string {
  return sortBy && allowed.includes(sortBy) ? sortBy : fallback;
}
