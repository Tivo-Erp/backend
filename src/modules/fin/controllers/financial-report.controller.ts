import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { RbacGuard } from '../../../common/guards/rbac.guard.js';
import { TenantGuard } from '../../../common/guards/tenant.guard.js';
import {
  CurrentTenant,
  RequirePermissions,
} from '../../../common/decorators/index.js';
import { FinancialReportService } from '../services/financial-report.service.js';
import {
  AgingQueryDto,
  BalanceSheetQueryDto,
  DateRangeQueryDto,
  PeriodQueryDto,
} from '../dto/financial-report.dto.js';

@ApiTags('Finance — Reports')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('api/v1/finance/reports')
export class FinancialReportController {
  constructor(private readonly service: FinancialReportService) {}

  @Get('trial-balance')
  @RequirePermissions('fin:report:read')
  @ApiOperation({
    summary: 'Trial balance for a fiscal month (posted entries)',
  })
  @ApiResponse({ status: 200, description: 'Per-account debit/credit totals' })
  trialBalance(@CurrentTenant() tenantId: string, @Query() q: PeriodQueryDto) {
    return this.service.trialBalance(tenantId, q.period);
  }

  @Get('income-statement')
  @RequirePermissions('fin:report:read')
  @ApiOperation({ summary: 'Income statement (P&L) over a fiscal-month range' })
  incomeStatement(
    @CurrentTenant() tenantId: string,
    @Query() q: DateRangeQueryDto,
  ) {
    return this.service.incomeStatement(tenantId, q.from, q.to);
  }

  @Get('balance-sheet')
  @RequirePermissions('fin:report:read')
  @ApiOperation({ summary: 'Balance sheet as of a date (cumulative)' })
  balanceSheet(
    @CurrentTenant() tenantId: string,
    @Query() q: BalanceSheetQueryDto,
  ) {
    return this.service.balanceSheet(tenantId, q.date);
  }

  @Get('cash-flow')
  @RequirePermissions('fin:report:read')
  @ApiOperation({
    summary: 'Cash flow (movement of cash accounts) over a range',
  })
  cashFlow(@CurrentTenant() tenantId: string, @Query() q: DateRangeQueryDto) {
    return this.service.cashFlow(tenantId, q.from, q.to);
  }

  @Get('ap-aging')
  @RequirePermissions('fin:report:read')
  @ApiOperation({ summary: 'Accounts payable aging (supplier invoices)' })
  apAging(@CurrentTenant() tenantId: string, @Query() q: AgingQueryDto) {
    return this.service.aging(tenantId, 'purchase', q.asOfDate);
  }

  @Get('ar-aging')
  @RequirePermissions('fin:report:read')
  @ApiOperation({ summary: 'Accounts receivable aging (customer invoices)' })
  arAging(@CurrentTenant() tenantId: string, @Query() q: AgingQueryDto) {
    return this.service.aging(tenantId, 'sales', q.asOfDate);
  }
}
