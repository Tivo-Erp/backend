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
import { PaginatedFieldsQueryDto } from '../../../common/dto/fields-query.dto.js';
import { CARRIER_FIELD_CONFIG } from '../config/shp.field-config.js';
import { CarrierService } from '../services/carrier.service.js';
import {
  CarrierQueryDto,
  CreateCarrierDto,
  UpdateCarrierDto,
} from '../dto/carrier.dto.js';

@ApiTags('Shipping — Carriers')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('api/v1/shipping/carriers')
export class CarrierController {
  constructor(private readonly service: CarrierService) {}

  @Post()
  @RequirePermissions('shp:carrier:manage')
  @ApiOperation({ summary: 'Register a carrier (apiKey stored encrypted)' })
  @ApiResponse({ status: 201, description: 'Carrier created' })
  @ApiResponse({ status: 409, description: 'Carrier code already in use' })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateCarrierDto) {
    return this.service.create(tenantId, dto);
  }

  @Get()
  @RequirePermissions('shp:carrier:manage')
  @ApiOperation({ summary: 'List carriers' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(CARRIER_FIELD_CONFIG),
  })
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: CarrierQueryDto,
  ) {
    return this.service.findAll(tenantId, query, roles);
  }

  @Get(':id')
  @RequirePermissions('shp:carrier:manage')
  @ApiOperation({ summary: 'Get a carrier' })
  @ApiResponse({ status: 404, description: 'Carrier not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginatedFieldsQueryDto,
  ) {
    return this.service.findOne(tenantId, id, roles, query.fields);
  }

  @Patch(':id')
  @RequirePermissions('shp:carrier:manage')
  @ApiOperation({ summary: 'Update a carrier' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCarrierDto,
  ) {
    return this.service.update(tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('shp:carrier:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete (or deactivate) a carrier' })
  @ApiResponse({ status: 409, description: 'Carrier has active shipments' })
  remove(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(tenantId, id);
  }
}
