import {
  Body,
  Controller,
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
import { FieldsQueryDto } from '../../../common/dto/fields-query.dto.js';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface.js';
import {
  NCR_FIELD_CONFIG,
  QC_INSPECTION_FIELD_CONFIG,
} from '../config/qc.field-config.js';
import { QcInspectionService } from '../services/qc-inspection.service.js';
import { NcrService } from '../services/ncr.service.js';
import {
  CreateInspectionDto,
  CreateNCRDto,
  InspectionQueryDto,
  NCRQueryDto,
  SubmitResultsDto,
  UpdateNCRDto,
} from '../dto/qc.dto.js';

@ApiTags('Quality Control — Inspections')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('api/v1/qc/inspections')
export class QcInspectionController {
  constructor(private readonly service: QcInspectionService) {}

  @Post()
  @RequirePermissions('qc:inspection:create')
  @ApiOperation({ summary: 'Create an inspection (auto-numbered)' })
  create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateInspectionDto,
  ) {
    return this.service.create(tenantId, dto);
  }

  @Get()
  @RequirePermissions('qc:inspection:read')
  @ApiOperation({ summary: 'List inspections (filter by status to find pending)' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(QC_INSPECTION_FIELD_CONFIG),
  })
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: InspectionQueryDto,
  ) {
    return this.service.findAll(tenantId, query, roles);
  }

  @Get(':id')
  @RequirePermissions('qc:inspection:read')
  @ApiOperation({ summary: 'Get inspection with results' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(QC_INSPECTION_FIELD_CONFIG),
  })
  @ApiResponse({ status: 404, description: 'Inspection not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: FieldsQueryDto,
  ) {
    return this.service.findOne(tenantId, id, roles, query.fields);
  }

  @Post(':id/results')
  @RequirePermissions('qc:inspection:execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit inspection results (derives pass/fail/partial)' })
  @ApiResponse({ status: 400, description: 'accepted + rejected must equal totalQty' })
  @ApiResponse({ status: 409, description: 'Inspection already finalized' })
  submitResults(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitResultsDto,
  ) {
    return this.service.submitResults(tenantId, user.sub, id, dto);
  }
}

@ApiTags('Quality Control — NCR Reports')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('api/v1/qc/ncr-reports')
export class NcrController {
  constructor(private readonly service: NcrService) {}

  @Post()
  @RequirePermissions('qc:ncr:create')
  @ApiOperation({ summary: 'Create a non-conformance report (auto-numbered)' })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateNCRDto,
  ) {
    return this.service.create(tenantId, user.sub, dto);
  }

  @Get()
  @RequirePermissions('qc:ncr:read')
  @ApiOperation({ summary: 'List NCR reports' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(NCR_FIELD_CONFIG),
  })
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: NCRQueryDto,
  ) {
    return this.service.findAll(tenantId, query, roles);
  }

  @Get(':id')
  @RequirePermissions('qc:ncr:read')
  @ApiOperation({ summary: 'Get an NCR report' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(NCR_FIELD_CONFIG),
  })
  @ApiResponse({ status: 404, description: 'NCR not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: FieldsQueryDto,
  ) {
    return this.service.findOne(tenantId, id, roles, query.fields);
  }

  @Patch(':id')
  @RequirePermissions('qc:ncr:update')
  @ApiOperation({ summary: 'Update NCR disposition / assignment / status' })
  @ApiResponse({ status: 404, description: 'NCR not found' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNCRDto,
  ) {
    return this.service.update(tenantId, id, dto);
  }
}
