import {
  Body,
  Controller,
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
  CurrentUser,
  CurrentUserRoles,
  RequirePermissions,
} from '../../../common/decorators/index.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface.js';
import { FIXED_ASSET_FIELD_CONFIG } from '../config/fixed-asset.field-config.js';
import { FixedAssetService } from '../services/fixed-asset.service.js';
import {
  ActivateAssetDto,
  CreateFixedAssetDto,
  DisposeAssetDto,
  FixedAssetQueryDto,
  RunDepreciationDto,
  TransferAssetDto,
  UpdateFixedAssetDto,
} from '../dto/fixed-asset.dto.js';

@ApiTags('Finance — Fixed Assets')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('api/v1/finance/fixed-assets')
export class FixedAssetController {
  constructor(private readonly service: FixedAssetService) {}

  @Post()
  @RequirePermissions('fin:asset:manage')
  @ApiOperation({ summary: 'Register a fixed asset (draft)' })
  @ApiResponse({ status: 409, description: 'Asset code already exists' })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateFixedAssetDto,
  ) {
    return this.service.create(tenantId, user.sub, dto);
  }

  @Post('run-depreciation')
  @RequirePermissions('fin:asset:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Run monthly depreciation for all in-use assets (posts one journal)',
  })
  @ApiResponse({ status: 409, description: 'Fiscal period not open' })
  runDepreciation(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: RunDepreciationDto,
  ) {
    return this.service.runDepreciation(tenantId, user.sub, dto);
  }

  @Get()
  @RequirePermissions('fin:asset:manage')
  @ApiOperation({ summary: 'List fixed assets' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(FIXED_ASSET_FIELD_CONFIG),
  })
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: FixedAssetQueryDto,
  ) {
    return this.service.findAll(tenantId, query, roles);
  }

  @Get(':id')
  @RequirePermissions('fin:asset:manage')
  @ApiOperation({ summary: 'Get a fixed asset' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findOne(tenantId, id);
  }

  @Get(':id/depreciation-schedule')
  @RequirePermissions('fin:asset:manage')
  @ApiOperation({ summary: 'Get an asset depreciation history' })
  schedule(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.depreciationSchedule(tenantId, id);
  }

  @Patch(':id')
  @RequirePermissions('fin:asset:manage')
  @ApiOperation({ summary: 'Update a fixed asset' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFixedAssetDto,
  ) {
    return this.service.update(tenantId, id, dto);
  }

  @Post(':id/activate')
  @RequirePermissions('fin:asset:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Activate asset (draft → in_use, starts depreciation)',
  })
  @ApiResponse({ status: 409, description: 'Asset not in draft' })
  activate(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActivateAssetDto,
  ) {
    return this.service.activate(tenantId, id, dto);
  }

  @Post(':id/dispose')
  @RequirePermissions('fin:asset:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dispose asset (posts disposal journal)' })
  @ApiResponse({ status: 409, description: 'Asset already disposed' })
  dispose(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DisposeAssetDto,
  ) {
    return this.service.dispose(tenantId, id, user.sub, dto);
  }

  @Post(':id/transfer')
  @RequirePermissions('fin:asset:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transfer asset to another branch/department' })
  @ApiResponse({ status: 409, description: 'Asset not in use' })
  transfer(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferAssetDto,
  ) {
    return this.service.transfer(tenantId, id, dto);
  }
}
