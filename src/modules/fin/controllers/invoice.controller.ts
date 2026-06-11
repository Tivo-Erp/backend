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
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface.js';
import { INVOICE_FIELD_CONFIG } from '../config/fin.field-config.js';
import { InvoiceService } from '../services/invoice.service.js';
import { CreateInvoiceDto, InvoiceQueryDto } from '../dto/invoice.dto.js';

@ApiTags('Finance — Invoices')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('finance/invoices')
export class InvoiceController {
  constructor(private readonly service: InvoiceService) {}

  @Post()
  @RequirePermissions('fin:invoice:create')
  @ApiOperation({ summary: 'Create AR (sales) or AP (purchase) invoice' })
  @ApiResponse({ status: 404, description: 'Counterparty not found' })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.service.create(tenantId, user.sub, dto);
  }

  @Get()
  @RequirePermissions('fin:invoice:read')
  @ApiOperation({ summary: 'List invoices' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(INVOICE_FIELD_CONFIG),
  })
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: InvoiceQueryDto,
  ) {
    return this.service.findAll(tenantId, query, roles);
  }

  @Get(':id')
  @RequirePermissions('fin:invoice:read')
  @ApiOperation({ summary: 'Get invoice with allocations' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findOne(tenantId, id);
  }
}
