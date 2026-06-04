import { Controller, Post, Get, Patch, Body, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiBody, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { TenantService } from '../services/tenant.service.js';
import { RegisterTenantDto } from '../dto/register-tenant.dto.js';
import { UpdateTenantProfileDto } from '../dto/update-tenant-profile.dto.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { TENANT_FIELD_CONFIG } from '../config/tenant.field-config.js';
import { Public, CurrentTenant, CurrentUserRoles, RequirePermissions } from '../../../common/decorators/index.js';
import { FieldsQueryDto } from '../../../common/dto/fields-query.dto.js';

@ApiTags('Org — Tenants')
@Controller('api/v1/org/tenants')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Post('register')
  @Public()
  @ApiOperation({ summary: 'Register Tenant', description: 'Self-service tenant registration. Creates tenant + first admin user + starter plan subscription.' })
  @ApiBody({ type: RegisterTenantDto })
  @ApiResponse({ status: 201, description: 'Tenant created successfully' })
  @ApiResponse({ status: 409, description: 'Slug or email already exists' })
  async register(@Body() dto: RegisterTenantDto) {
    return this.tenantService.register(dto);
  }

  @Get('profile')
  @ApiBearerAuth('JWT-Auth')
  @ApiOperation({ summary: 'Get Tenant Profile', description: 'Get current tenant profile with Sparse Fieldsets support.' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(TENANT_FIELD_CONFIG),
    example: 'id,slug,name,status,subscription.planCode',
  })
  @ApiResponse({ status: 200, description: 'Tenant profile with selected fields' })
  @ApiResponse({ status: 401, description: 'Unauthorized — invalid/missing JWT' })
  async getProfile(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() userRoles: string[],
    @Query() query: FieldsQueryDto,
  ) {
    return this.tenantService.getProfile(tenantId, query.fields, userRoles);
  }

  @Patch('profile')
  @ApiBearerAuth('JWT-Auth')
  @RequirePermissions('org:tenant:update')
  @ApiOperation({ summary: 'Update Tenant Profile', description: 'Update current tenant settings. Requires `org:tenant:update` permission.' })
  @ApiBody({ type: UpdateTenantProfileDto })
  @ApiResponse({ status: 200, description: 'Tenant updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Missing permission: org:tenant:update' })
  async updateProfile(
    @CurrentTenant() tenantId: string,
    @Body() dto: UpdateTenantProfileDto,
  ) {
    return this.tenantService.updateProfile(tenantId, dto);
  }
}
