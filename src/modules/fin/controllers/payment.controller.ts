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
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface.js';
import { PAYMENT_FIELD_CONFIG } from '../config/fin.field-config.js';
import { PaymentService } from '../services/payment.service.js';
import { CreatePaymentDto, PaymentQueryDto } from '../dto/payment.dto.js';

@ApiTags('Finance — Payments')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('finance/payments')
export class PaymentController {
  constructor(private readonly service: PaymentService) {}

  @Post()
  @RequirePermissions('fin:payment:create')
  @ApiOperation({ summary: 'Create payment with optional invoice allocations' })
  @ApiResponse({
    status: 400,
    description: 'Allocation exceeds payment or invoice balance',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.service.create(tenantId, user.sub, dto);
  }

  @Get()
  @RequirePermissions('fin:payment:read')
  @ApiOperation({ summary: 'List payments' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(PAYMENT_FIELD_CONFIG),
  })
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: PaymentQueryDto,
  ) {
    return this.service.findAll(tenantId, query, roles);
  }

  @Get(':id')
  @RequirePermissions('fin:payment:read')
  @ApiOperation({ summary: 'Get payment with allocations' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findOne(tenantId, id);
  }

  @Post(':id/post')
  @RequirePermissions('fin:payment:post')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Post payment — apply allocations + auto-generate journal',
  })
  @ApiResponse({ status: 409, description: 'Payment not in draft' })
  post(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.post(tenantId, id, user.sub);
  }
}
