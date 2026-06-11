import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

/** Minimal Prisma client surface used by this service (PrismaService or a $transaction client). */
type PrismaLike = Pick<PrismaService, '$executeRaw' | '$queryRaw'>;

/** Sensible default prefixes per document type, used when a sequence is auto-created on first use. */
const DEFAULT_PREFIX: Record<string, string> = {
  PO: 'PO',
  GRN: 'GRN',
  SO: 'SO',
  DN: 'DN',
  INV: 'INV',
  JV: 'JV',
  JB: 'JB',
  PAY: 'PAY',
};

interface ClaimedSequence {
  prefix: string;
  separator: string;
  includeYear: boolean;
  yearFormat: string;
  padding: number;
  lastNumber: number;
}

@Injectable()
export class DocumentSequenceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the next formatted document number for a given type, atomically
   * incrementing the underlying sequence row. The sequence is auto-created with
   * sensible defaults on first use so callers never need to pre-seed per tenant.
   *
   * Concurrency-safe: the row is created with `INSERT ... ON CONFLICT DO NOTHING`
   * (never errors, so it is safe inside a surrounding transaction) and the
   * number is claimed with a single `UPDATE ... RETURNING`, which takes a row
   * lock — concurrent callers serialize on it and can never observe the same
   * number. The yearly reset happens inside the same atomic UPDATE.
   *
   * Pass a `$transaction` client as `client` to make the increment participate
   * in the surrounding transaction (recommended for document creation flows).
   */
  async getNextNumber(
    tenantId: string,
    documentType: string,
    branchId?: string,
    client?: PrismaLike,
  ): Promise<string> {
    const db = client ?? this.prisma;
    const currentYear = new Date().getFullYear();
    const prefix = DEFAULT_PREFIX[documentType] ?? documentType;
    const branch = branchId ?? null;

    // Ensure the sequence row exists. ON CONFLICT DO NOTHING never raises, so
    // a lost create race cannot abort the caller's transaction. Requires the
    // unique indexes on (tenantId, documentType, branchId) incl. the partial
    // index for branchId IS NULL.
    await db.$executeRaw`
      INSERT INTO document_sequences
        ("id", "tenantId", "documentType", "prefix", "branchId", "lastNumber", "lastResetYear")
      VALUES
        (gen_random_uuid(), ${tenantId}::uuid, ${documentType}, ${prefix}, ${branch}::uuid, 0, ${currentYear})
      ON CONFLICT DO NOTHING
    `;

    const rows = await db.$queryRaw<ClaimedSequence[]>`
      UPDATE document_sequences
      SET "lastNumber" = CASE
            WHEN "resetYearly" AND "lastResetYear" IS DISTINCT FROM ${currentYear} THEN 1
            ELSE "lastNumber" + 1
          END,
          "lastResetYear" = ${currentYear}
      WHERE "tenantId" = ${tenantId}::uuid
        AND "documentType" = ${documentType}
        AND "branchId" IS NOT DISTINCT FROM ${branch}::uuid
      RETURNING "prefix", "separator", "includeYear", "yearFormat", "padding", "lastNumber"
    `;

    if (rows.length === 0) {
      throw new Error(
        `Document sequence missing for tenant=${tenantId} type=${documentType}`,
      );
    }

    const seq = rows[0];
    const yearPart = seq.includeYear
      ? seq.yearFormat === 'YY'
        ? String(currentYear).slice(-2)
        : String(currentYear)
      : '';

    const numberPart = String(seq.lastNumber).padStart(seq.padding, '0');
    const parts = [seq.prefix, yearPart, numberPart].filter(Boolean);
    return parts.join(seq.separator);
  }
}
