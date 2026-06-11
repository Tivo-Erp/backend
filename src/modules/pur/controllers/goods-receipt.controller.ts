import {
  Body,
  Controller,
  Get,
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
import { GOODS_RECEIPT_FIELD_CONFIG } from '../config/goods-receipt.field-config.js';
import { GoodsReceiptService } from '../services/goods-receipt.service.js';
import {
  CreateGoodsReceiptDto,
  GoodsReceiptQueryDto,
} from '../dto/goods-receipt.dto.js';

@ApiTags('Purchase — Goods Receipts')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('api/v1/purchase/goods-receipts')
export class GoodsReceiptController {
  constructor(private readonly service: GoodsReceiptService) {}

  @Post()
  @RequirePermissions('pur:grn:create')
  @ApiOperation({
    summary: 'Receive goods against a PO (updates inventory + PO received qty)',
  })
  @ApiResponse({ status: 201, description: 'GRN created, stock updated' })
  @ApiResponse({
    status: 400,
    description:
      'Exceeds PO qty, duplicate PO line, bin mismatch or lot required',
  })
  @ApiResponse({
    status: 409,
    description: 'PO not receivable or lot conflict',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateGoodsReceiptDto,
  ) {
    return this.service.create(tenantId, user.sub, dto);
  }

  @Get()
  @RequirePermissions('pur:grn:read')
  @ApiOperation({ summary: 'List goods receipts' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(GOODS_RECEIPT_FIELD_CONFIG),
  })
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: GoodsReceiptQueryDto,
  ) {
    return this.service.findAll(tenantId, query, roles);
  }

  @Get(':id')
  @RequirePermissions('pur:grn:read')
  @ApiOperation({ summary: 'Get goods receipt with lines' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(GOODS_RECEIPT_FIELD_CONFIG),
  })
  @ApiResponse({ status: 404, description: 'GRN not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginatedFieldsQueryDto,
  ) {
    return this.service.findOne(tenantId, id, roles, query.fields);
  }
}
