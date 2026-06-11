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
import { FiscalPeriodService } from '../services/fiscal-period.service.js';
import {
  FiscalPeriodQueryDto,
  InitFiscalPeriodsDto,
} from '../dto/fiscal-period.dto.js';

@ApiTags('Finance — Fiscal Periods')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('finance/fiscal-periods')
export class FiscalPeriodController {
  constructor(private readonly service: FiscalPeriodService) {}

  @Post('init')
  @RequirePermissions('fin:period:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initialize 12 monthly periods for a year' })
  init(@CurrentTenant() tenantId: string, @Body() dto: InitFiscalPeriodsDto) {
    return this.service.init(tenantId, dto);
  }

  @Get()
  @RequirePermissions('fin:period:read')
  @ApiOperation({ summary: 'List fiscal periods' })
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: FiscalPeriodQueryDto,
  ) {
    return this.service.findAll(tenantId, query);
  }

  @Post(':id/close')
  @RequirePermissions('fin:period:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close a fiscal period' })
  @ApiResponse({
    status: 409,
    description: 'Has draft journals / previous period open',
  })
  close(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.close(tenantId, id, user.sub);
  }
}
