import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
  CurrentUser,
  RequirePermissions,
} from '../../../common/decorators/index.js';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface.js';
import { PayrollService } from '../services/payroll.service.js';
import { CalculatePayrollDto, PayrollQueryDto } from '../dto/payroll.dto.js';

@ApiTags('HRM — Payroll')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('api/v1/hrm/payroll')
export class PayrollController {
  constructor(private readonly service: PayrollService) {}

  @Post('calculate')
  @RequirePermissions('hrm:payroll:calculate')
  @ApiOperation({ summary: 'Calculate a monthly payroll run (VN statutory formula)' })
  @ApiResponse({ status: 201, description: 'Payroll run created (draft)' })
  @ApiResponse({ status: 409, description: 'Payroll run already exists for period' })
  calculate(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CalculatePayrollDto,
  ) {
    return this.service.calculate(tenantId, user.sub, dto);
  }

  @Get()
  @RequirePermissions('hrm:payroll:read')
  @ApiOperation({ summary: 'List payroll runs' })
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: PayrollQueryDto,
  ) {
    return this.service.findAll(tenantId, query);
  }

  @Get(':id')
  @RequirePermissions('hrm:payroll:read')
  @ApiOperation({ summary: 'Get a payroll run with lines' })
  @ApiResponse({ status: 404, description: 'Payroll run not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findOne(tenantId, id);
  }

  @Post(':id/approve')
  @RequirePermissions('hrm:payroll:approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve payroll run → auto-create posted journal batch' })
  @ApiResponse({ status: 409, description: 'Not draft / fiscal period closed' })
  approve(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.approve(tenantId, id, user.sub);
  }
}
