import { BadRequestException } from '@nestjs/common';

/**
 * Configuration per module — defines default + allowed fields per role.
 * Each module creates its own FieldConfig object.
 */
export interface FieldConfig {
  /** Fields returned when ?fields= is NOT provided */
  defaultFields: string[];
  /** Whitelist of allowed fields per role (key = role name) */
  allowedFields: Record<string, string[]>;
}

const MAX_NESTING_DEPTH = 2;

/**
 * Sparse Fieldsets utility — implements API Design Guidelines sections 2-5.
 *
 * Responsibilities:
 * - Parse ?fields= query string
 * - Validate against role-based whitelist (fail-fast)
 * - Build Prisma `select` object (push down to DB)
 * - Sort fields for cache-key determinism
 */
export class FieldSelector {
  /**
   * Parse, validate, and build Prisma select object.
   *
   * @param queryFields  Raw `?fields=id,name,...` string from query
   * @param userRoles    Array of role names from JWT payload
   * @param config       Module's FieldConfig (defaultFields + allowedFields per role)
   * @returns            Prisma-compatible select object
   * @throws BadRequestException if any field is not in the whitelist
   */
  static buildPrismaSelect(
    queryFields: string | undefined,
    userRoles: string[],
    config: FieldConfig,
  ): Record<string, any> {
    const allowed = this.resolveAllowedFields(userRoles, config);
    const requested = this.parseAndValidate(queryFields, allowed, config.defaultFields);
    return this.toPrismaSelect(requested);
  }

  /**
   * Resolve allowed fields via UNION of all user roles.
   * If a role is not found in config, it gets no extra fields.
   */
  static resolveAllowedFields(
    userRoles: string[],
    config: FieldConfig,
  ): Set<string> {
    const allowed = new Set<string>();

    for (const role of userRoles) {
      const roleFields = config.allowedFields[role];
      if (roleFields) {
        for (const f of roleFields) allowed.add(f);
      }
    }

    // Fallback: if no role matched, use default fields as allowed
    if (allowed.size === 0) {
      for (const f of config.defaultFields) allowed.add(f);
    }

    return allowed;
  }

  /**
   * Parse comma-separated fields string, validate each against whitelist.
   * Returns sorted array for cache-key determinism.
   */
  private static parseAndValidate(
    queryFields: string | undefined,
    allowed: Set<string>,
    defaultFields: string[],
  ): string[] {
    if (!queryFields || queryFields.trim().length === 0) {
      return [...defaultFields].sort();
    }

    const requested = queryFields
      .split(',')
      .map((f) => f.trim())
      .filter((f) => f.length > 0);

    // Validate nesting depth
    for (const field of requested) {
      const depth = field.split('.').length;
      if (depth > MAX_NESTING_DEPTH) {
        throw new BadRequestException(
          `Field '${field}' exceeds max nesting depth of ${MAX_NESTING_DEPTH}. Use a dedicated endpoint for deeply nested data.`,
        );
      }
    }

    // Fail-fast: reject any field not in whitelist
    const invalid = requested.filter((f) => !allowed.has(f));
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Invalid or unauthorized fields requested: ${invalid.join(', ')}`,
      );
    }

    return requested.sort();
  }

  /**
   * Convert sorted field array to Prisma `select` object.
   * Supports flat fields ('name' → { name: true }) and
   * dot-notation ('subscription.planCode' → { subscription: { select: { planCode: true } } })
   */
  private static toPrismaSelect(
    fields: string[],
  ): Record<string, any> {
    const selectObj: Record<string, any> = {};

    for (const field of fields) {
      if (field.includes('.')) {
        const [relation, ...rest] = field.split('.');
        const nestedField = rest.join('.');

        if (!selectObj[relation]) {
          selectObj[relation] = { select: {} };
        }
        selectObj[relation].select[nestedField] = true;
      } else {
        selectObj[field] = true;
      }
    }

    return selectObj;
  }

  /**
   * Generate a human-readable description of allowed/default fields for Swagger.
   */
  static describeForSwagger(config: FieldConfig): string {
    const lines: string[] = [
      'Sparse Fieldsets — comma-separated field names.',
      '',
      `**Default (when omitted):** \`${config.defaultFields.join(', ')}\``,
      '',
      '**Allowed fields per role:**',
    ];

    for (const [role, fields] of Object.entries(config.allowedFields)) {
      lines.push(`- \`${role}\`: ${fields.join(', ')}`);
    }

    lines.push('', 'Example: `?fields=id,name,status`');
    return lines.join('\n');
  }

  /**
   * Generate a deterministic cache key from fields query.
   * Sorts alphabetically to avoid cache fragmentation (guidelines 4.2).
   */
  static toCacheKey(queryFields: string | undefined): string {
    if (!queryFields) return '_default_';
    return queryFields
      .split(',')
      .map((f) => f.trim())
      .filter((f) => f.length > 0)
      .sort()
      .join(',');
  }
}
