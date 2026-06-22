import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { CacheService } from '../../../infra/cache/cache.service.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { safeSortBy } from '../../../common/utils/sort.util.js';
import { ACCOUNT_FIELD_CONFIG } from '../config/fin.field-config.js';
import { CHART_OF_ACCOUNTS_VN } from '../data/chart-of-accounts-vn.js';
import {
  ChartOfAccountQueryDto,
  CreateChartOfAccountDto,
  UpdateChartOfAccountDto,
} from '../dto/chart-of-account.dto.js';

/** Cache namespace for the chart-of-accounts list (INF-007). */
const CACHE_NS = 'fin:coa:list';
const CACHE_TTL_SEC = 120;

@Injectable()
export class ChartOfAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /** Idempotently seed the default VN chart of accounts (skips existing codes). */
  async seedDefaults(tenantId: string) {
    const result = await this.prisma.chartOfAccount.createMany({
      data: CHART_OF_ACCOUNTS_VN.map((a) => ({
        tenantId,
        accountCode: a.accountCode,
        accountName: a.accountName,
        accountType: a.accountType,
        normalBalance: a.normalBalance,
        isGroup: a.isGroup,
        parentCode: a.parentCode ?? null,
      })),
      skipDuplicates: true,
    });
    if (result.count > 0) {
      await this.cache.invalidateNamespace(tenantId, CACHE_NS);
    }
    return { seeded: result.count };
  }

  async create(tenantId: string, dto: CreateChartOfAccountDto) {
    const exists = await this.prisma.chartOfAccount.findFirst({
      where: { tenantId, accountCode: dto.accountCode },
    });
    if (exists) throw new ConflictException('FIN_ACCOUNT_CODE_DUPLICATE');
    const created = await this.prisma.chartOfAccount.create({
      data: {
        tenantId,
        accountCode: dto.accountCode,
        accountName: dto.accountName,
        accountType: dto.accountType,
        normalBalance: dto.normalBalance,
        parentCode: dto.parentCode ?? null,
        isGroup: dto.isGroup ?? false,
      },
    });
    await this.cache.invalidateNamespace(tenantId, CACHE_NS);
    return created;
  }

  async findAll(
    tenantId: string,
    query: ChartOfAccountQueryDto,
    userRoles: string[],
  ) {
    const select = FieldSelector.buildPrismaSelect(
      query.fields,
      userRoles,
      ACCOUNT_FIELD_CONFIG,
    );
    const {
      page = 1,
      limit = 20,
      sortOrder = 'asc',
      accountType,
      isActive,
      search,
    } = query;
    const sortBy = safeSortBy(
      query.sortBy,
      [
        'accountCode',
        'accountName',
        'accountType',
        'normalBalance',
        'isActive',
      ],
      'accountCode',
    );

    const where: Prisma.ChartOfAccountWhereInput = {
      tenantId,
      ...(accountType && { accountType }),
      ...(isActive !== undefined && { isActive }),
      ...(search && {
        OR: [
          { accountCode: { contains: search, mode: 'insensitive' } },
          { accountName: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };
    const orderBy: Prisma.ChartOfAccountOrderByWithRelationInput = {
      [sortBy]: sortOrder,
    };

    // INF-007 cache-aside. Field validation (role whitelist) runs above,
    // before any cache read. The chart of accounts is tenant-wide (no
    // user/branch scoping), so tenantId + filters + fields fully key it.
    const suffix = [
      `p${page}`,
      `l${limit}`,
      `sb${sortBy}`,
      `so${sortOrder}`,
      `at${accountType ?? ''}`,
      `ia${isActive ?? ''}`,
      `q${search ?? ''}`,
      `f${FieldSelector.toCacheKey(query.fields)}`,
    ].join(':');
    const key = this.cache.key(tenantId, CACHE_NS, suffix);

    return this.cache.wrap(key, CACHE_TTL_SEC, async () => {
      const [data, total] = await Promise.all([
        this.prisma.chartOfAccount.findMany({
          where,
          select,
          skip: (page - 1) * limit,
          take: limit,
          orderBy,
        }),
        this.prisma.chartOfAccount.count({ where }),
      ]);

      return PaginatedResponseDto.create(data, total, page, limit);
    });
  }

  async update(tenantId: string, id: string, dto: UpdateChartOfAccountDto) {
    const acc = await this.prisma.chartOfAccount.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!acc) throw new NotFoundException('FIN_ACCOUNT_NOT_FOUND');
    const updated = await this.prisma.chartOfAccount.update({
      where: { id },
      data: dto,
    });
    await this.cache.invalidateNamespace(tenantId, CACHE_NS);
    return updated;
  }

  async remove(tenantId: string, id: string) {
    const acc = await this.prisma.chartOfAccount.findFirst({
      where: { id, tenantId },
      select: { id: true, accountCode: true },
    });
    if (!acc) throw new NotFoundException('FIN_ACCOUNT_NOT_FOUND');

    const used = await this.prisma.journalEntry.count({
      where: { accountCode: acc.accountCode, batch: { tenantId } },
    });
    if (used > 0) throw new ConflictException('FIN_ACCOUNT_HAS_JOURNALS');

    await this.prisma.chartOfAccount.delete({ where: { id } });
    await this.cache.invalidateNamespace(tenantId, CACHE_NS);
  }
}
