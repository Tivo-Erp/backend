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
import { SHIPMENT_FIELD_CONFIG } from '../config/shp.field-config.js';
import { ShipmentService } from '../services/shipment.service.js';
import {
  CreateShipmentDto,
  ManualTrackingDto,
  RateCompareDto,
  ShipmentQueryDto,
} from '../dto/shipment.dto.js';

@ApiTags('Shipping — Shipments')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('api/v1/shipping')
export class ShipmentController {
  constructor(private readonly service: ShipmentService) {}

  @Post('shipments')
  @RequirePermissions('shp:shipment:create')
  @ApiOperation({
    summary: 'Create a shipment for a delivery note (label + tracking)',
  })
  @ApiResponse({ status: 201, description: 'Shipment created' })
  @ApiResponse({
    status: 409,
    description: 'DN not shippable or shipment exists',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateShipmentDto,
  ) {
    return this.service.create(tenantId, user.sub, dto);
  }

  @Get('shipments')
  @RequirePermissions('shp:shipment:read')
  @ApiOperation({ summary: 'List shipments' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(SHIPMENT_FIELD_CONFIG),
  })
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: ShipmentQueryDto,
  ) {
    return this.service.findAll(tenantId, query, roles);
  }

  @Post('rates/compare')
  @RequirePermissions('shp:rate:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Compare shipping rates across active carriers (cached 15m)',
  })
  compareRates(@CurrentTenant() tenantId: string, @Body() dto: RateCompareDto) {
    return this.service.compareRates(tenantId, dto);
  }

  @Get('shipments/:id')
  @RequirePermissions('shp:shipment:read')
  @ApiOperation({ summary: 'Get a shipment' })
  @ApiResponse({ status: 404, description: 'Shipment not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginatedFieldsQueryDto,
  ) {
    return this.service.findOne(tenantId, id, roles, query.fields);
  }

  @Get('shipments/:id/track')
  @RequirePermissions('shp:shipment:read')
  @ApiOperation({ summary: 'Get the tracking timeline for a shipment' })
  track(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.track(tenantId, id);
  }

  @Get('shipments/:id/label')
  @RequirePermissions('shp:shipment:read')
  @ApiOperation({ summary: 'Pre-signed shipping-label download URL' })
  @ApiResponse({ status: 404, description: 'Label not available' })
  label(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getLabelUrl(tenantId, id);
  }

  @Post('shipments/:id/tracking')
  @RequirePermissions('shp:shipment:create')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Manually set the carrier tracking number (no live API)',
  })
  @ApiResponse({
    status: 409,
    description: 'Tracking already set or number taken',
  })
  setTracking(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ManualTrackingDto,
  ) {
    return this.service.setManualTracking(tenantId, id, dto);
  }
}
