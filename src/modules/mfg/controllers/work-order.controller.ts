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
  CurrentUser,
  CurrentUserRoles,
  RequirePermissions,
} from '../../../common/decorators/index.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { PaginatedFieldsQueryDto } from '../../../common/dto/fields-query.dto.js';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface.js';
import { WORK_ORDER_FIELD_CONFIG } from '../config/work-order.field-config.js';
import { WorkOrderService } from '../services/work-order.service.js';
import {
  CreateWorkOrderDto,
  ReportMaterialConsumptionDto,
  ReportOutputDto,
  UpdateWorkOrderDto,
  WorkOrderQueryDto,
} from '../dto/work-order.dto.js';

@ApiTags('Manufacturing — Work Orders')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('api/v1/manufacturing/work-orders')
export class WorkOrderController {
  constructor(private readonly service: WorkOrderService) {}

  @Post()
  @RequirePermissions('mfg:wo:create')
  @ApiOperation({ summary: 'Create work order (auto-numbered)' })
  @ApiResponse({ status: 201, description: 'Work order created' })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateWorkOrderDto,
  ) {
    return this.service.create(tenantId, user.sub, dto);
  }

  @Get()
  @RequirePermissions('mfg:wo:read')
  @ApiOperation({ summary: 'List work orders' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(WORK_ORDER_FIELD_CONFIG),
  })
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: WorkOrderQueryDto,
  ) {
    return this.service.findAll(tenantId, query, roles);
  }

  @Get(':id')
  @RequirePermissions('mfg:wo:read')
  @ApiOperation({ summary: 'Get a work order' })
  @ApiResponse({ status: 404, description: 'Work order not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginatedFieldsQueryDto,
  ) {
    return this.service.findOne(tenantId, id, roles, query.fields);
  }

  @Patch(':id')
  @RequirePermissions('mfg:wo:update')
  @ApiOperation({ summary: 'Update work order (draft only)' })
  @ApiResponse({ status: 409, description: 'Work order not in draft' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkOrderDto,
  ) {
    return this.service.update(tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('mfg:wo:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete work order (draft only)' })
  @ApiResponse({ status: 409, description: 'Work order not in draft' })
  async remove(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.remove(tenantId, id);
  }

  @Post(':id/plan')
  @RequirePermissions('mfg:wo:update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Plan work order (draft → planned)' })
  plan(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.plan(tenantId, id);
  }

  @Post(':id/release')
  @RequirePermissions('mfg:wo:release')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Release work order (planned → released)' })
  @ApiResponse({ status: 409, description: 'Invalid transition' })
  release(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.release(tenantId, id);
  }

  @Post(':id/material-consumption')
  @RequirePermissions('mfg:wo:execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Report material consumption (deduct raw materials)',
  })
  @ApiResponse({ status: 400, description: 'Insufficient stock' })
  @ApiResponse({ status: 409, description: 'Work order not executable' })
  consume(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportMaterialConsumptionDto,
  ) {
    return this.service.reportConsumption(tenantId, user.sub, id, dto);
  }

  @Post(':id/output')
  @RequirePermissions('mfg:wo:execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Report finished output (add finished goods)' })
  @ApiResponse({ status: 400, description: 'Output exceeds planned qty' })
  @ApiResponse({ status: 409, description: 'Work order not executable' })
  output(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportOutputDto,
  ) {
    return this.service.reportOutput(tenantId, user.sub, id, dto);
  }

  @Post(':id/close')
  @RequirePermissions('mfg:wo:update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close work order (completed → closed)' })
  @ApiResponse({ status: 409, description: 'Invalid transition' })
  close(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.close(tenantId, id);
  }

  @Post(':id/cancel')
  @RequirePermissions('mfg:wo:cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel work order (draft/planned/released)' })
  @ApiResponse({ status: 409, description: 'Invalid transition' })
  cancel(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.cancel(tenantId, id);
  }
}
