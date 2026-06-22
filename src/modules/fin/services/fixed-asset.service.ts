import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { safeSortBy } from '../../../common/utils/sort.util.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { FIXED_ASSET_FIELD_CONFIG } from '../config/fixed-asset.field-config.js';
import { JournalBatchService } from './journal-batch.service.js';
import { calcPeriodDepreciation } from './asset-depreciation-calc.js';
import {
  ActivateAssetDto,
  CreateFixedAssetDto,
  DisposeAssetDto,
  FixedAssetQueryDto,
  RunDepreciationDto,
  TransferAssetDto,
  UpdateFixedAssetDto,
} from '../dto/fixed-asset.dto.js';

const dec = (n: number | string | Prisma.Decimal) => new Prisma.Decimal(n);
const ZERO = new Prisma.Decimal(0);

const ASSET_SORTABLE = [
  'createdAt',
  'updatedAt',
  'assetCode',
  'name',
  'acquisitionDate',
  'status',
] as const;

/** Accumulated-depreciation GL account (Hao mòn TSCĐ hữu hình). */
const ACCUM_DEPRECIATION_ACC = '2141';
/** Other expense / other income for disposal loss / gain. */
const OTHER_EXPENSE_ACC = '811';
const OTHER_INCOME_ACC = '711';
/** Cash account credited with disposal proceeds. */
const CASH_ACC = '112';

@Injectable()
export class FixedAssetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journals: JournalBatchService,
  ) {}

  // ── Register ──────────────────────────────────────────────────

  async create(tenantId: string, userId: string, dto: CreateFixedAssetDto) {
    if (dto.residualValue >= dto.acquisitionCost) {
      throw new BadRequestException('FIN_ASSET_RESIDUAL_GTE_COST');
    }
    try {
      return await this.prisma.fixedAsset.create({
        data: {
          tenantId,
          assetCode: dto.assetCode,
          name: dto.name,
          accountCode: dto.accountCode,
          acquisitionCost: dec(dto.acquisitionCost),
          residualValue: dec(dto.residualValue),
          acquisitionDate: new Date(dto.acquisitionDate),
          inServiceDate: dto.inServiceDate ? new Date(dto.inServiceDate) : null,
          depreciationMethod: dto.depreciationMethod,
          usefulLifeMonths: dto.usefulLifeMonths,
          status: 'draft',
          expenseAccountCode: dto.expenseAccountCode ?? '642',
          departmentId: dto.departmentId ?? null,
          branchId: dto.branchId ?? null,
          notes: dto.notes ?? null,
          createdBy: userId,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('FIN_ASSET_CODE_EXISTS');
      }
      throw e;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateFixedAssetDto) {
    await this.require(tenantId, id);
    return this.prisma.fixedAsset.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.departmentId !== undefined && {
          departmentId: dto.departmentId,
        }),
        ...(dto.branchId !== undefined && { branchId: dto.branchId }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  async activate(tenantId: string, id: string, dto: ActivateAssetDto) {
    await this.require(tenantId, id);
    const { count } = await this.prisma.fixedAsset.updateMany({
      where: { id, tenantId, status: 'draft', deletedAt: null },
      data: {
        status: 'in_use',
        inServiceDate: dto.inServiceDate
          ? new Date(dto.inServiceDate)
          : new Date(),
      },
    });
    if (count === 0) throw new ConflictException('FIN_ASSET_NOT_DRAFT');
    return this.prisma.fixedAsset.findFirst({ where: { id, tenantId } });
  }

  async transfer(tenantId: string, id: string, dto: TransferAssetDto) {
    const asset = await this.require(tenantId, id);
    if (asset.status !== 'in_use')
      throw new ConflictException('FIN_ASSET_NOT_IN_USE');
    return this.prisma.fixedAsset.update({
      where: { id },
      data: {
        status: 'transferred',
        ...(dto.branchId !== undefined && { branchId: dto.branchId }),
        ...(dto.departmentId !== undefined && {
          departmentId: dto.departmentId,
        }),
      },
    });
  }

  /**
   * Disposal posts a balanced journal removing the asset from the books:
   *   Dr 2141 accumulated depreciation
   *   Dr 112  cash proceeds (if any)
   *   Dr 811  loss   OR   Cr 711 gain  (the balancing figure vs net book value)
   *   Cr <asset GL account> acquisition cost
   */
  async dispose(
    tenantId: string,
    id: string,
    userId: string,
    dto: DisposeAssetDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.fixedAsset.findFirst({ where: { id, tenantId } });
      if (!asset) throw new NotFoundException('FIN_ASSET_NOT_FOUND');
      if (asset.status === 'disposed')
        throw new ConflictException('FIN_ASSET_ALREADY_DISPOSED');

      const cost = dec(asset.acquisitionCost);
      const accumulated = dec(asset.accumulatedDepreciation);
      const proceeds = dec(dto.disposalProceeds ?? 0);
      const netBookValue = cost.sub(accumulated);
      const gainLoss = proceeds.sub(netBookValue); // >0 gain, <0 loss

      const entries: Array<{
        accountCode: string;
        description?: string;
        debitAmount: Prisma.Decimal;
        creditAmount: Prisma.Decimal;
      }> = [];
      if (accumulated.gt(0)) {
        entries.push({
          accountCode: ACCUM_DEPRECIATION_ACC,
          description: 'Remove accumulated depreciation',
          debitAmount: accumulated,
          creditAmount: ZERO,
        });
      }
      if (proceeds.gt(0)) {
        entries.push({
          accountCode: CASH_ACC,
          description: 'Disposal proceeds',
          debitAmount: proceeds,
          creditAmount: ZERO,
        });
      }
      if (gainLoss.lt(0)) {
        entries.push({
          accountCode: OTHER_EXPENSE_ACC,
          description: 'Loss on disposal',
          debitAmount: gainLoss.abs(),
          creditAmount: ZERO,
        });
      } else if (gainLoss.gt(0)) {
        entries.push({
          accountCode: OTHER_INCOME_ACC,
          description: 'Gain on disposal',
          debitAmount: ZERO,
          creditAmount: gainLoss,
        });
      }
      entries.push({
        accountCode: asset.accountCode,
        description: 'Remove asset cost',
        debitAmount: ZERO,
        creditAmount: cost,
      });

      // Always post the disposal journal so the GL has a full audit trail.
      // entries always contains at least the Cr <assetCode> line; every valid
      // asset (cost > 0) also produces a Dr 811 loss or Dr 2141 + Dr 112 line
      // so the journal is always balanced.
      if (entries.length >= 1) {
        await this.journals.createPosted(tx, tenantId, userId, {
          description: `Disposal of asset ${asset.assetCode}`,
          journalDate: new Date(dto.disposalDate),
          sourceType: 'adjustment',
          sourceId: asset.id,
          entries,
        });
      }

      const { count } = await tx.fixedAsset.updateMany({
        where: {
          id,
          tenantId,
          status: { in: ['in_use', 'transferred', 'draft'] },
        },
        data: {
          status: 'disposed',
          disposalDate: new Date(dto.disposalDate),
          disposalProceeds: proceeds,
        },
      });
      if (count === 0)
        throw new ConflictException('FIN_ASSET_ALREADY_DISPOSED');

      return tx.fixedAsset.findFirst({ where: { id, tenantId } });
    });
  }

  // ── Depreciation run (manual period trigger; cron deferred) ───

  async runDepreciation(
    tenantId: string,
    userId: string,
    dto: RunDepreciationDto,
  ) {
    const journalDate = new Date(Date.UTC(dto.year, dto.month - 1, 28));

    return this.prisma.$transaction(async (tx) => {
      const assets = await tx.fixedAsset.findMany({
        where: { tenantId, status: 'in_use', deletedAt: null },
      });

      const results: Array<{
        assetId: string;
        amount: Prisma.Decimal;
        expenseAccountCode: string;
      }> = [];

      for (const asset of assets) {
        // Skip if this period was already depreciated for this asset.
        const existing = await tx.assetDepreciationEntry.findFirst({
          where: { assetId: asset.id, year: dto.year, month: dto.month },
          select: { id: true },
        });
        if (existing) continue;

        // Count only periods that come BEFORE the target period so that
        // re-running a past month receives the correct elapsed count instead
        // of a count inflated by later periods.
        const periodsElapsed = await tx.assetDepreciationEntry.count({
          where: {
            assetId: asset.id,
            OR: [
              { year: { lt: dto.year } },
              { year: dto.year, month: { lt: dto.month } },
            ],
          },
        });
        const amount = calcPeriodDepreciation({
          acquisitionCost: asset.acquisitionCost,
          residualValue: asset.residualValue,
          usefulLifeMonths: asset.usefulLifeMonths,
          method: asset.depreciationMethod as
            | 'straight_line'
            | 'declining_balance',
          accumulatedDepreciation: asset.accumulatedDepreciation,
          periodsElapsed,
        });
        if (amount.lte(0)) continue;

        const newAccumulated = dec(asset.accumulatedDepreciation).add(amount);
        await tx.assetDepreciationEntry.create({
          data: {
            tenantId,
            assetId: asset.id,
            year: dto.year,
            month: dto.month,
            depreciationAmount: amount,
            accumulatedTotal: newAccumulated,
          },
        });
        await tx.fixedAsset.update({
          where: { id: asset.id },
          data: { accumulatedDepreciation: newAccumulated },
        });
        results.push({
          assetId: asset.id,
          amount,
          expenseAccountCode: asset.expenseAccountCode,
        });
      }

      if (results.length === 0) {
        return {
          year: dto.year,
          month: dto.month,
          assetsDepreciated: 0,
          totalDepreciation: 0,
          journalBatchId: null,
        };
      }

      // One posted journal for the whole run, grouped by expense account.
      const total = results.reduce((s, r) => s.add(r.amount), ZERO);
      const byExpense = new Map<string, Prisma.Decimal>();
      for (const r of results) {
        byExpense.set(
          r.expenseAccountCode,
          (byExpense.get(r.expenseAccountCode) ?? ZERO).add(r.amount),
        );
      }
      const entries = [
        ...[...byExpense.entries()].map(([accountCode, amt]) => ({
          accountCode,
          description: 'Depreciation expense',
          debitAmount: amt,
          creditAmount: ZERO,
        })),
        {
          accountCode: ACCUM_DEPRECIATION_ACC,
          description: 'Accumulated depreciation',
          debitAmount: ZERO,
          creditAmount: total,
        },
      ];

      const batch = await this.journals.createPosted(tx, tenantId, userId, {
        description: `Depreciation ${dto.month}/${dto.year}`,
        journalDate,
        sourceType: 'depreciation',
        entries,
      });

      // Stamp the journal id on this period's entries.
      await tx.assetDepreciationEntry.updateMany({
        where: {
          tenantId,
          year: dto.year,
          month: dto.month,
          assetId: { in: results.map((r) => r.assetId) },
        },
        data: { journalBatchId: batch.id },
      });

      return {
        year: dto.year,
        month: dto.month,
        assetsDepreciated: results.length,
        totalDepreciation: total.toNumber(),
        journalBatchId: batch.id,
      };
    });
  }

  // ── Queries ───────────────────────────────────────────────────

  async findAll(
    tenantId: string,
    query: FixedAssetQueryDto,
    userRoles: string[],
  ) {
    const select = FieldSelector.buildPrismaSelect(
      query.fields,
      userRoles,
      FIXED_ASSET_FIELD_CONFIG,
    );
    const {
      page = 1,
      limit = 20,
      sortOrder = 'desc',
      status,
      branchId,
      search,
    } = query;
    const sortBy = safeSortBy(query.sortBy, ASSET_SORTABLE);

    const where: Prisma.FixedAssetWhereInput = {
      tenantId,
      deletedAt: null,
      ...(status && { status }),
      ...(branchId && { branchId }),
      ...(search && {
        OR: [
          { assetCode: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.fixedAsset.findMany({
        where,
        select,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.fixedAsset.count({ where }),
    ]);
    return PaginatedResponseDto.create(data, total, page, limit);
  }

  async findOne(tenantId: string, id: string) {
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!asset) throw new NotFoundException('FIN_ASSET_NOT_FOUND');
    return asset;
  }

  async depreciationSchedule(tenantId: string, id: string) {
    await this.require(tenantId, id);
    return this.prisma.assetDepreciationEntry.findMany({
      where: { tenantId, assetId: id },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    });
  }

  private async require(tenantId: string, id: string) {
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, status: true, accountCode: true },
    });
    if (!asset) throw new NotFoundException('FIN_ASSET_NOT_FOUND');
    return asset;
  }
}
