import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
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
  CurrentUserRoles,
  RequirePermissions,
} from '../../../common/decorators/index.js';
import { BiService } from '../services/bi.service.js';
import { OlapQueryDto } from '../dto/bi.dto.js';

@ApiTags('Business Intelligence')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('api/v1/bi')
export class BiController {
  constructor(private readonly service: BiService) {}

  @Post('query')
  @RequirePermissions('fin:report:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run an OLAP cube query (tenant auto-scoped)' })
  @ApiResponse({ status: 200, description: 'Aggregated rows' })
  @ApiResponse({
    status: 400,
    description: 'Unknown cube/dimension/measure or bad range',
  })
  @ApiResponse({ status: 503, description: 'OLAP store not configured' })
  query(@CurrentTenant() tenantId: string, @Body() dto: OlapQueryDto) {
    return this.service.query(tenantId, dto);
  }

  @Get('dashboards')
  @RequirePermissions('fin:report:read')
  @ApiOperation({ summary: 'Role-scoped dashboard widget catalog' })
  dashboards(@CurrentUserRoles() roles: string[]) {
    return this.service.dashboards(roles);
  }

  @Get('kpi/pipeline')
  @RequirePermissions('fin:report:read')
  @ApiOperation({ summary: 'Real-time open sales pipeline value (OLTP)' })
  pipeline(@CurrentTenant() tenantId: string) {
    return this.service.pipelineValue(tenantId);
  }

  @Get('kpi/headcount')
  @RequirePermissions('fin:report:read')
  @ApiOperation({ summary: 'Real-time active headcount (OLTP)' })
  headcount(@CurrentTenant() tenantId: string) {
    return this.service.headcount(tenantId);
  }
}
