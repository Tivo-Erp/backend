import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiBody, ApiParam, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { RoleService } from '../services/role.service.js';
import { CreateRoleDto, UpdateRoleDto } from '../dto/role.dto.js';
import { CurrentTenant, CurrentUserRoles, RequirePermissions } from '../../../common/decorators/index.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { ROLE_FIELD_CONFIG } from '../config/role.field-config.js';
import { FieldsQueryDto } from '../../../common/dto/fields-query.dto.js';

@ApiTags('UAM — Roles')
@ApiBearerAuth('JWT-Auth')
@Controller('api/v1/uam/roles')
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Post()
  @RequirePermissions('uam:role:create')
  @ApiOperation({ summary: 'Create Role', description: 'Create a custom role with assigned permissions.' })
  @ApiBody({ type: CreateRoleDto })
  @ApiResponse({ status: 201, description: 'Role created' })
  @ApiResponse({ status: 409, description: 'Role name already exists in tenant' })
  async create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateRoleDto,
  ) {
    return this.roleService.create(tenantId, dto);
  }

  @Get()
  @RequirePermissions('uam:role:read')
  @ApiOperation({ summary: 'List Roles', description: 'List roles with Sparse Fieldsets support.' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(ROLE_FIELD_CONFIG),
    example: 'id,name,description,permissions.code',
  })
  @ApiResponse({ status: 200, description: 'Role list with selected fields' })
  async findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() userRoles: string[],
    @Query() query: FieldsQueryDto,
  ) {
    return this.roleService.findAll(tenantId, query.fields, userRoles);
  }

  @Patch(':id')
  @RequirePermissions('uam:role:update')
  @ApiOperation({ summary: 'Update Role', description: 'Update role name/description/permissions. System roles cannot be updated.' })
  @ApiParam({ name: 'id', description: 'Role UUID', format: 'uuid' })
  @ApiBody({ type: UpdateRoleDto })
  @ApiResponse({ status: 200, description: 'Role updated' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @ApiResponse({ status: 403, description: 'Cannot update system role' })
  async update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.roleService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('uam:role:delete')
  @ApiOperation({ summary: 'Delete Role', description: 'Delete a custom role. System roles cannot be deleted.' })
  @ApiParam({ name: 'id', description: 'Role UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Role deleted' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @ApiResponse({ status: 403, description: 'Cannot delete system role' })
  async delete(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.roleService.delete(tenantId, id);
  }
}
