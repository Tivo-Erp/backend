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
import { DELIVERY_NOTE_FIELD_CONFIG } from '../config/delivery-note.field-config.js';
import { DeliveryNoteService } from '../services/delivery-note.service.js';
import {
  ConfirmPackedDto,
  ConfirmPickedDto,
  CreateDeliveryNoteDto,
  DeliveryNoteQueryDto,
  DeliveryScheduleQueryDto,
  DispatchDeliveryDto,
  FailDeliveryDto,
  ReturnDeliveryDto,
  SubmitPODDto,
} from '../dto/delivery-note.dto.js';

@ApiTags('Delivery — Delivery Notes')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('api/v1/delivery')
export class DeliveryNoteController {
  constructor(private readonly service: DeliveryNoteService) {}

  @Post('delivery-notes')
  @RequirePermissions('sal:dn:create')
  @ApiOperation({ summary: 'Create a delivery note from a sales order' })
  @ApiResponse({ status: 201, description: 'Delivery note created (draft)' })
  @ApiResponse({ status: 409, description: 'SO not in an approved state' })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateDeliveryNoteDto,
  ) {
    return this.service.create(tenantId, user.sub, dto);
  }

  @Get('delivery-notes')
  @RequirePermissions('sal:dn:read')
  @ApiOperation({ summary: 'List delivery notes' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(DELIVERY_NOTE_FIELD_CONFIG),
  })
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: DeliveryNoteQueryDto,
  ) {
    return this.service.findAll(tenantId, query, roles);
  }

  @Get('schedule')
  @RequirePermissions('del:schedule:read')
  @ApiOperation({ summary: 'View delivery schedule for a date range' })
  schedule(
    @CurrentTenant() tenantId: string,
    @Query() query: DeliveryScheduleQueryDto,
  ) {
    return this.service.schedule(tenantId, query);
  }

  @Get('delivery-notes/:id')
  @RequirePermissions('sal:dn:read')
  @ApiOperation({ summary: 'Get a delivery note with lines' })
  @ApiResponse({ status: 404, description: 'Delivery note not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginatedFieldsQueryDto,
  ) {
    return this.service.findOne(tenantId, id, roles, query.fields);
  }

  @Post('delivery-notes/:id/start-picking')
  @RequirePermissions('del:picking:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start picking (draft → picking, validates stock)' })
  @ApiResponse({ status: 400, description: 'Insufficient stock' })
  @ApiResponse({ status: 409, description: 'DN not in draft' })
  startPicking(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.startPicking(tenantId, id);
  }

  @Post('delivery-notes/:id/confirm-picked')
  @RequirePermissions('del:picking:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm picked quantities (picking → picked)' })
  @ApiResponse({ status: 400, description: 'Picked qty mismatch' })
  @ApiResponse({ status: 409, description: 'DN not in picking' })
  confirmPicked(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmPickedDto,
  ) {
    return this.service.confirmPicked(tenantId, id, dto);
  }

  @Post('delivery-notes/:id/pack')
  @RequirePermissions('del:packing:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm packing (picked → packed)' })
  @ApiResponse({ status: 409, description: 'DN not in picked' })
  pack(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmPackedDto,
  ) {
    return this.service.pack(tenantId, id, dto);
  }

  @Post('delivery-notes/:id/dispatch')
  @RequirePermissions('del:dispatch:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Dispatch for delivery (packed → out_for_delivery)',
  })
  @ApiResponse({ status: 400, description: 'Driver/carrier required' })
  @ApiResponse({ status: 409, description: 'DN not in packed' })
  dispatch(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DispatchDeliveryDto,
  ) {
    return this.service.dispatch(tenantId, user.sub, id, dto);
  }

  @Post('delivery-notes/:id/pod')
  @RequirePermissions('del:pod:submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit proof of delivery (→ delivered, deducts stock)',
  })
  @ApiResponse({ status: 400, description: 'POD evidence required' })
  @ApiResponse({ status: 409, description: 'DN not out for delivery' })
  pod(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitPODDto,
  ) {
    return this.service.submitPod(tenantId, user.sub, id, dto);
  }

  @Post('delivery-notes/:id/fail')
  @RequirePermissions('del:dispatch:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a failed delivery attempt' })
  @ApiResponse({ status: 409, description: 'DN not out for delivery' })
  fail(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FailDeliveryDto,
  ) {
    return this.service.fail(tenantId, id, dto);
  }

  @Post('delivery-notes/:id/redispatch')
  @RequirePermissions('del:dispatch:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Re-attempt a failed delivery (failed → out_for_delivery)',
  })
  @ApiResponse({
    status: 409,
    description: 'Not failed or max retries exceeded',
  })
  redispatch(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.redispatch(tenantId, id);
  }

  @Post('delivery-notes/:id/return')
  @RequirePermissions('del:return:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark as returned (releases reservation)' })
  @ApiResponse({ status: 409, description: 'DN not failed' })
  returnDelivery(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReturnDeliveryDto,
  ) {
    return this.service.returnDelivery(tenantId, id, dto);
  }
}
