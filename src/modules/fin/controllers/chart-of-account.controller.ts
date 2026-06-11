import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
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
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { ACCOUNT_FIELD_CONFIG } from '../config/fin.field-config.js';
import { ChartOfAccountService } from '../services/chart-of-account.service.js';
import {
  ChartOfAccountQueryDto,
  CreateChartOfAccountDto,
  UpdateChartOfAccountDto,
} from '../dto/chart-of-account.dto.js';

@ApiTags('Finance — Chart of Accounts')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('finance/chart-of-accounts')
export class ChartOfAccountController {
  constructor(private readonly service: ChartOfAccountService) {}

  @Post('seed')
  @RequirePermissions('fin:account:create')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Seed default Vietnamese chart of accounts (idempotent)',
  })
  seed(@CurrentTenant() tenantId: string) {
    return this.service.seedDefaults(tenantId);
  }

  @Post()
  @RequirePermissions('fin:account:create')
  @ApiOperation({ summary: 'Create a custom account' })
  @ApiResponse({ status: 409, description: 'Account code duplicate' })
  create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateChartOfAccountDto,
  ) {
    return this.service.create(tenantId, dto);
  }

  @Get()
  @RequirePermissions('fin:account:read')
  @ApiOperation({ summary: 'List accounts' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(ACCOUNT_FIELD_CONFIG),
  })
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: ChartOfAccountQueryDto,
  ) {
    return this.service.findAll(tenantId, query, roles);
  }

  @Patch(':id')
  @RequirePermissions('fin:account:update')
  @ApiOperation({ summary: 'Rename / deactivate account' })
  @ApiResponse({ status: 404, description: 'Account not found' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChartOfAccountDto,
  ) {
    return this.service.update(tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('fin:account:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete account (only if no journals reference it)',
  })
  @ApiResponse({ status: 409, description: 'Account has journals' })
  async remove(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.remove(tenantId, id);
  }
}
