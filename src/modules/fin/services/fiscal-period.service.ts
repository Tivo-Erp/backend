import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import {
  FiscalPeriodQueryDto,
  InitFiscalPeriodsDto,
} from '../dto/fiscal-period.dto.js';

@Injectable()
export class FiscalPeriodService {
  constructor(private readonly prisma: PrismaService) {}

  /** Initialize 12 monthly periods for a year (idempotent). */
  async init(tenantId: string, dto: InitFiscalPeriodsDto) {
    const result = await this.prisma.fiscalPeriod.createMany({
      data: Array.from({ length: 12 }, (_, i) => ({
        tenantId,
        year: dto.year,
        month: i + 1,
        status: 'open',
      })),
      skipDuplicates: true,
    });
    return { year: dto.year, created: result.count };
  }

  async findAll(tenantId: string, query: FiscalPeriodQueryDto) {
    const { page = 1, limit = 20, year } = query;
    const where: any = { tenantId, ...(year && { year }) };

    const [data, total] = await Promise.all([
      this.prisma.fiscalPeriod.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      }),
      this.prisma.fiscalPeriod.count({ where }),
    ]);

    return PaginatedResponseDto.create(data, total, page, limit);
  }

  async close(tenantId: string, id: string, userId: string) {
    const period = await this.prisma.fiscalPeriod.findFirst({
      where: { id, tenantId },
    });
    if (!period) throw new NotFoundException('FIN_PERIOD_NOT_FOUND');
    if (period.status === 'closed')
      throw new ConflictException('FIN_PERIOD_ALREADY_CLOSED');

    // Previous period must be closed first
    const prev = this.previousMonth(period.year, period.month);
    const prevPeriod = await this.prisma.fiscalPeriod.findFirst({
      where: { tenantId, year: prev.year, month: prev.month },
    });
    if (prevPeriod && prevPeriod.status !== 'closed') {
      throw new ConflictException('FIN_PERIOD_PREVIOUS_OPEN');
    }

    // No draft journals within the period
    const { start, end } = this.monthBounds(period.year, period.month);
    const draftCount = await this.prisma.journalBatch.count({
      where: {
        tenantId,
        status: 'draft',
        journalDate: { gte: start, lte: end },
      },
    });
    if (draftCount > 0)
      throw new ConflictException('FIN_PERIOD_HAS_DRAFT_JOURNALS');

    return this.prisma.fiscalPeriod.update({
      where: { id },
      data: { status: 'closed', closedAt: new Date(), closedBy: userId },
    });
  }

  /** Throws if the given date falls in a closed or non-initialized period. */
  async assertOpen(tenantId: string, date: Date) {
    const period = await this.prisma.fiscalPeriod.findFirst({
      where: {
        tenantId,
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
      },
    });
    if (!period) {
      throw new ConflictException('FIN_PERIOD_NOT_INITIALIZED');
    }
    if (period.status === 'closed') {
      throw new ConflictException('FIN_PERIOD_CLOSED');
    }
  }

  private previousMonth(year: number, month: number) {
    return month === 1
      ? { year: year - 1, month: 12 }
      : { year, month: month - 1 };
  }

  private monthBounds(year: number, month: number) {
    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    return { start, end };
  }
}
