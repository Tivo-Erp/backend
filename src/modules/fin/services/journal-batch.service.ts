import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { DocumentSequenceService } from '../../../infra/sequence/document-sequence.service.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { safeSortBy } from '../../../common/utils/sort.util.js';
import { JOURNAL_BATCH_FIELD_CONFIG } from '../config/fin.field-config.js';
import { FiscalPeriodService } from './fiscal-period.service.js';
import {
  CreateJournalBatchDto,
  JournalBatchQueryDto,
  JournalEntryLineDto,
  UpdateJournalBatchDto,
} from '../dto/journal-batch.dto.js';

const JOURNAL_SORTABLE = [
  'batchNumber',
  'journalDate',
  'status',
  'sourceType',
  'totalDebit',
  'totalCredit',
  'createdAt',
  'updatedAt',
] as const;

const dec = (n: number | string | Prisma.Decimal) => new Prisma.Decimal(n);

export interface InternalJournalInput {
  description?: string;
  journalDate: Date;
  sourceType: string;
  sourceId?: string;
  entries: {
    accountCode: string;
    description?: string;
    debitAmount: number;
    creditAmount: number;
  }[];
}

@Injectable()
export class JournalBatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: DocumentSequenceService,
    private readonly fiscalPeriods: FiscalPeriodService,
  ) {}

  // ── FIN-002: Create draft journal batch ───────────────────────

  async create(tenantId: string, userId: string, dto: CreateJournalBatchDto) {
    const journalDate = new Date(dto.journalDate);
    const { totalDebit, totalCredit } = this.validateEntries(dto.entries);
    await this.fiscalPeriods.assertOpen(tenantId, journalDate);

    return this.prisma.$transaction(async (tx) => {
      await this.assertAccountsExist(
        tx,
        tenantId,
        dto.entries.map((e) => e.accountCode),
      );

      const batchNumber = await this.sequences.getNextNumber(
        tenantId,
        'JB',
        undefined,
        tx,
      );

      return tx.journalBatch.create({
        data: {
          tenantId,
          batchNumber,
          description: dto.description ?? null,
          reference: dto.reference ?? null,
          journalDate,
          status: 'draft',
          sourceType: dto.sourceType,
          sourceId: dto.sourceId ?? null,
          totalDebit: totalDebit.toNumber(),
          totalCredit: totalCredit.toNumber(),
          createdBy: userId,
          entries: {
            create: dto.entries.map((e) => ({
              accountCode: e.accountCode,
              description: e.description ?? null,
              debitAmount: e.debitAmount,
              creditAmount: e.creditAmount,
              costCenterId: e.costCenterId ?? null,
            })),
          },
        },
        include: { entries: true },
      });
    });
  }

  /** Validates lines and returns Decimal totals (rounded to 2dp). */
  private validateEntries(entries: JournalEntryLineDto[]) {
    if (!entries || entries.length < 2) {
      throw new BadRequestException('FIN_JOURNAL_MIN_TWO_ENTRIES');
    }
    for (const e of entries) {
      if (e.debitAmount > 0 && e.creditAmount > 0) {
        throw new BadRequestException('FIN_JOURNAL_LINE_BOTH_AMOUNTS');
      }
      if (e.debitAmount === 0 && e.creditAmount === 0) {
        throw new BadRequestException('FIN_JOURNAL_LINE_ZERO_AMOUNT');
      }
    }
    const totalDebit = entries
      .reduce((s, e) => s.add(dec(e.debitAmount)), dec(0))
      .toDecimalPlaces(2);
    const totalCredit = entries
      .reduce((s, e) => s.add(dec(e.creditAmount)), dec(0))
      .toDecimalPlaces(2);
    if (!totalDebit.equals(totalCredit)) {
      throw new BadRequestException('FIN_JOURNAL_UNBALANCED');
    }
    return { totalDebit, totalCredit };
  }

  private async assertAccountsExist(
    tx: any,
    tenantId: string,
    codes: string[],
  ) {
    const unique = [...new Set(codes)];
    const found = await tx.chartOfAccount.findMany({
      where: { tenantId, accountCode: { in: unique } },
      select: { accountCode: true },
    });
    const foundSet = new Set(found.map((a: any) => a.accountCode));
    const missing = unique.filter((c) => !foundSet.has(c));
    if (missing.length > 0) {
      throw new NotFoundException(
        `FIN_ACCOUNT_NOT_FOUND: ${missing.join(', ')}`,
      );
    }
  }

  // ── FIN-003 helper: create an already-posted journal in a tx ──

  async createPosted(
    tx: any,
    tenantId: string,
    userId: string,
    input: InternalJournalInput,
  ) {
    const { totalDebit, totalCredit } = this.validateEntries(input.entries);
    await this.fiscalPeriods.assertOpen(tenantId, input.journalDate);
    await this.assertAccountsExist(
      tx,
      tenantId,
      input.entries.map((e) => e.accountCode),
    );

    const batchNumber = await this.sequences.getNextNumber(
      tenantId,
      'JB',
      undefined,
      tx,
    );

    return tx.journalBatch.create({
      data: {
        tenantId,
        batchNumber,
        description: input.description ?? null,
        journalDate: input.journalDate,
        status: 'posted',
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        totalDebit: totalDebit.toNumber(),
        totalCredit: totalCredit.toNumber(),
        postedBy: userId,
        postedAt: new Date(),
        createdBy: userId,
        entries: {
          create: input.entries.map((e) => ({
            accountCode: e.accountCode,
            description: e.description ?? null,
            debitAmount: e.debitAmount,
            creditAmount: e.creditAmount,
          })),
        },
      },
    });
  }

  // ── State machine ─────────────────────────────────────────────

  async post(tenantId: string, id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.journalBatch.findFirst({
        where: { id, tenantId },
        select: { id: true, status: true, journalDate: true },
      });
      if (!batch) throw new NotFoundException('FIN_JOURNAL_NOT_FOUND');
      if (batch.status !== 'draft')
        throw new ConflictException('FIN_JOURNAL_NOT_DRAFT');

      await this.fiscalPeriods.assertOpen(tenantId, batch.journalDate);

      // Race-safe claim: only one concurrent post can flip draft → posted.
      const claimed = await tx.journalBatch.updateMany({
        where: { id, tenantId, status: 'draft' },
        data: { status: 'posted', postedBy: userId, postedAt: new Date() },
      });
      if (claimed.count === 0)
        throw new ConflictException('FIN_JOURNAL_NOT_DRAFT');

      return tx.journalBatch.findFirst({
        where: { id, tenantId },
        include: { entries: true },
      });
    });
  }

  async reverse(tenantId: string, id: string, userId: string) {
    const reversalDate = new Date();
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.journalBatch.findFirst({
        where: { id, tenantId },
        include: { entries: true },
      });
      if (!batch) throw new NotFoundException('FIN_JOURNAL_NOT_FOUND');
      if (batch.status !== 'posted')
        throw new ConflictException('FIN_JOURNAL_NOT_POSTED');

      // The reversal entry is dated today — its period must be open.
      await this.fiscalPeriods.assertOpen(tenantId, reversalDate);

      // Race-safe claim: only one concurrent reverse can flip posted → reversed.
      const claimed = await tx.journalBatch.updateMany({
        where: { id, tenantId, status: 'posted' },
        data: { status: 'reversed' },
      });
      if (claimed.count === 0)
        throw new ConflictException('FIN_JOURNAL_NOT_POSTED');

      const batchNumber = await this.sequences.getNextNumber(
        tenantId,
        'JB',
        undefined,
        tx,
      );
      return tx.journalBatch.create({
        data: {
          tenantId,
          batchNumber,
          description: `Reversal of ${batch.batchNumber}`,
          journalDate: reversalDate,
          status: 'posted',
          sourceType: batch.sourceType,
          sourceId: batch.sourceId,
          reversalOf: batch.id,
          totalDebit: batch.totalCredit,
          totalCredit: batch.totalDebit,
          postedBy: userId,
          postedAt: new Date(),
          createdBy: userId,
          entries: {
            create: batch.entries.map((e) => ({
              accountCode: e.accountCode,
              description: `Reversal: ${e.description ?? ''}`.trim(),
              debitAmount: e.creditAmount,
              creditAmount: e.debitAmount,
              costCenterId: e.costCenterId,
            })),
          },
        },
        include: { entries: true },
      });
    });
  }

  // ── Draft maintenance (update / delete) ───────────────────────

  async update(
    tenantId: string,
    id: string,
    userId: string,
    dto: UpdateJournalBatchDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.journalBatch.findFirst({
        where: { id, tenantId },
        include: { entries: true },
      });
      if (!batch) throw new NotFoundException('FIN_JOURNAL_NOT_FOUND');
      if (batch.status !== 'draft')
        throw new ConflictException('FIN_JOURNAL_NOT_DRAFT');

      const journalDate = dto.journalDate
        ? new Date(dto.journalDate)
        : batch.journalDate;
      await this.fiscalPeriods.assertOpen(tenantId, journalDate);

      const data: Record<string, unknown> = {
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.reference !== undefined && { reference: dto.reference }),
        ...(dto.journalDate !== undefined && { journalDate }),
        ...(dto.sourceType !== undefined && { sourceType: dto.sourceType }),
        ...(dto.sourceId !== undefined && { sourceId: dto.sourceId }),
      };

      if (dto.entries) {
        const { totalDebit, totalCredit } = this.validateEntries(dto.entries);
        await this.assertAccountsExist(
          tx,
          tenantId,
          dto.entries.map((e) => e.accountCode),
        );
        data.totalDebit = totalDebit.toNumber();
        data.totalCredit = totalCredit.toNumber();
      }

      // Race-safe claim: refuse if the batch left draft state meanwhile.
      const claimed = await tx.journalBatch.updateMany({
        where: { id, tenantId, status: 'draft' },
        data,
      });
      if (claimed.count === 0)
        throw new ConflictException('FIN_JOURNAL_NOT_DRAFT');

      if (dto.entries) {
        await tx.journalEntry.deleteMany({ where: { batchId: id } });
        await tx.journalEntry.createMany({
          data: dto.entries.map((e) => ({
            batchId: id,
            accountCode: e.accountCode,
            description: e.description ?? null,
            debitAmount: e.debitAmount,
            creditAmount: e.creditAmount,
            costCenterId: e.costCenterId ?? null,
          })),
        });
      }

      return tx.journalBatch.findFirst({
        where: { id, tenantId },
        include: { entries: true },
      });
    });
  }

  async remove(tenantId: string, id: string) {
    const batch = await this.prisma.journalBatch.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true },
    });
    if (!batch) throw new NotFoundException('FIN_JOURNAL_NOT_FOUND');
    if (batch.status !== 'draft')
      throw new ConflictException('FIN_JOURNAL_NOT_DRAFT');

    // Race-safe: status guard inside the delete itself (entries cascade).
    const deleted = await this.prisma.journalBatch.deleteMany({
      where: { id, tenantId, status: 'draft' },
    });
    if (deleted.count === 0)
      throw new ConflictException('FIN_JOURNAL_NOT_DRAFT');
  }

  // ── Queries ───────────────────────────────────────────────────

  async findAll(
    tenantId: string,
    query: JournalBatchQueryDto,
    userRoles: string[],
  ) {
    const select = FieldSelector.buildPrismaSelect(
      query.fields,
      userRoles,
      JOURNAL_BATCH_FIELD_CONFIG,
    );
    const {
      page = 1,
      limit = 20,
      sortOrder = 'desc',
      status,
      sourceType,
      dateFrom,
      dateTo,
    } = query;
    const sortBy = safeSortBy(query.sortBy, JOURNAL_SORTABLE, 'journalDate');

    const where: any = {
      tenantId,
      ...(status && { status }),
      ...(sourceType && { sourceType }),
      ...((dateFrom || dateTo) && {
        journalDate: {
          ...(dateFrom && { gte: new Date(dateFrom) }),
          ...(dateTo && { lte: new Date(dateTo + 'T23:59:59Z') }),
        },
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.journalBatch.findMany({
        where,
        select,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.journalBatch.count({ where }),
    ]);

    return PaginatedResponseDto.create(data, total, page, limit);
  }

  async findOne(tenantId: string, id: string) {
    const batch = await this.prisma.journalBatch.findFirst({
      where: { id, tenantId },
      include: { entries: true },
    });
    if (!batch) throw new NotFoundException('FIN_JOURNAL_NOT_FOUND');
    return batch;
  }
}
