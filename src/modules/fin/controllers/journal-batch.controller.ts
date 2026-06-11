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
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface.js';
import { JOURNAL_BATCH_FIELD_CONFIG } from '../config/fin.field-config.js';
import { JournalBatchService } from '../services/journal-batch.service.js';
import {
  CreateJournalBatchDto,
  JournalBatchQueryDto,
  UpdateJournalBatchDto,
} from '../dto/journal-batch.dto.js';

@ApiTags('Finance — Journal Batches')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('finance/journal-batches')
export class JournalBatchController {
  constructor(private readonly service: JournalBatchService) {}

  @Post()
  @RequirePermissions('fin:journal:create')
  @ApiOperation({
    summary: 'Create draft journal batch (double-entry validated)',
  })
  @ApiResponse({
    status: 400,
    description: 'Unbalanced / invalid line amounts',
  })
  @ApiResponse({ status: 409, description: 'Fiscal period closed' })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateJournalBatchDto,
  ) {
    return this.service.create(tenantId, user.sub, dto);
  }

  @Get()
  @RequirePermissions('fin:journal:read')
  @ApiOperation({ summary: 'List journal batches' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(JOURNAL_BATCH_FIELD_CONFIG),
  })
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: JournalBatchQueryDto,
  ) {
    return this.service.findAll(tenantId, query, roles);
  }

  @Get(':id')
  @RequirePermissions('fin:journal:read')
  @ApiOperation({ summary: 'Get journal batch with entries' })
  @ApiResponse({ status: 404, description: 'Journal not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findOne(tenantId, id);
  }

  @Patch(':id')
  @RequirePermissions('fin:journal:update')
  @ApiOperation({
    summary: 'Update a DRAFT journal batch (replaces entries when provided)',
  })
  @ApiResponse({
    status: 400,
    description: 'Unbalanced / invalid line amounts',
  })
  @ApiResponse({ status: 404, description: 'Journal not found' })
  @ApiResponse({
    status: 409,
    description: 'Journal not in draft / fiscal period closed',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJournalBatchDto,
  ) {
    return this.service.update(tenantId, id, user.sub, dto);
  }

  @Delete(':id')
  @RequirePermissions('fin:journal:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a DRAFT journal batch (hard delete)' })
  @ApiResponse({ status: 404, description: 'Journal not found' })
  @ApiResponse({ status: 409, description: 'Journal not in draft' })
  remove(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(tenantId, id);
  }

  @Post(':id/post')
  @RequirePermissions('fin:journal:post')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Post journal batch (draft → posted)' })
  @ApiResponse({ status: 409, description: 'Journal not in draft' })
  post(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.post(tenantId, id, user.sub);
  }

  @Post(':id/reverse')
  @RequirePermissions('fin:journal:reverse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reverse a posted journal (creates a mirrored batch)',
  })
  @ApiResponse({ status: 409, description: 'Journal not posted' })
  reverse(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.reverse(tenantId, id, user.sub);
  }
}
