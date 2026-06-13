import {
  Body,
  Controller,
  Get,
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
import { FieldsQueryDto } from '../../../common/dto/fields-query.dto.js';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface.js';
import { EMPLOYEE_FIELD_CONFIG } from '../config/employee.field-config.js';
import { EmployeeService } from '../services/employee.service.js';
import {
  CreateEmployeeDto,
  EmployeeQueryDto,
  UpdateEmployeeDto,
} from '../dto/employee.dto.js';

const PII_PERMISSION = 'hrm:employee:read_pii';

@ApiTags('HRM — Employees')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('api/v1/hrm/employees')
export class EmployeeController {
  constructor(private readonly service: EmployeeService) {}

  @Post()
  @RequirePermissions('hrm:employee:create')
  @ApiOperation({ summary: 'Onboard an employee (PII encrypted at rest)' })
  @ApiResponse({ status: 201, description: 'Employee created' })
  @ApiResponse({ status: 409, description: 'Employee code / user already exists' })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateEmployeeDto) {
    return this.service.create(tenantId, dto);
  }

  @Get()
  @RequirePermissions('hrm:employee:read')
  @ApiOperation({ summary: 'List employees (PII masked unless read_pii granted)' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(EMPLOYEE_FIELD_CONFIG),
  })
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentUserRoles() roles: string[],
    @Query() query: EmployeeQueryDto,
  ) {
    return this.service.findAll(tenantId, query, roles, this.canReadPii(user));
  }

  @Get(':id')
  @RequirePermissions('hrm:employee:read')
  @ApiOperation({ summary: 'Get an employee (PII masked unless read_pii granted)' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(EMPLOYEE_FIELD_CONFIG),
  })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentUserRoles() roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: FieldsQueryDto,
  ) {
    return this.service.findOne(tenantId, id, roles, this.canReadPii(user), query.fields);
  }

  @Patch(':id')
  @RequirePermissions('hrm:employee:update')
  @ApiOperation({ summary: 'Update an employee' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.service.update(tenantId, id, dto);
  }

  private canReadPii(user: JwtPayload): boolean {
    return (
      user.isSuperAdmin === true ||
      (user.permissions ?? []).includes(PII_PERMISSION)
    );
  }
}
