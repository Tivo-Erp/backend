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
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface.js';
import {
  LEAD_FIELD_CONFIG,
  OPPORTUNITY_FIELD_CONFIG,
  TICKET_FIELD_CONFIG,
} from '../config/crm.field-config.js';
import { LeadService } from '../services/lead.service.js';
import { OpportunityService } from '../services/opportunity.service.js';
import { TicketService } from '../services/ticket.service.js';
import {
  ConvertLeadDto,
  CreateLeadDto,
  CreateOpportunityDto,
  CreateTicketDto,
  LeadQueryDto,
  OpportunityQueryDto,
  TicketQueryDto,
  UpdateLeadDto,
  UpdateOpportunityDto,
  UpdateTicketDto,
} from '../dto/crm.dto.js';

@ApiTags('CRM — Leads')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('api/v1/crm/leads')
export class LeadController {
  constructor(private readonly service: LeadService) {}

  @Post()
  @RequirePermissions('crm:lead:create')
  @ApiOperation({ summary: 'Create a lead' })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateLeadDto,
  ) {
    return this.service.create(tenantId, user.sub, dto);
  }

  @Get()
  @RequirePermissions('crm:lead:read')
  @ApiOperation({ summary: 'List leads' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(LEAD_FIELD_CONFIG),
  })
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: LeadQueryDto,
  ) {
    return this.service.findAll(tenantId, query, roles);
  }

  @Get(':id')
  @RequirePermissions('crm:lead:read')
  @ApiOperation({ summary: 'Get a lead' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findOne(tenantId, id);
  }

  @Patch(':id')
  @RequirePermissions('crm:lead:create')
  @ApiOperation({ summary: 'Update a lead (status / assignment / score)' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadDto,
  ) {
    return this.service.update(tenantId, id, dto);
  }

  @Patch(':id/convert')
  @RequirePermissions('crm:opportunity:manage')
  @ApiOperation({ summary: 'Convert a qualified lead to customer + opportunity' })
  @ApiResponse({ status: 409, description: 'Lead not qualified' })
  convert(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConvertLeadDto,
  ) {
    return this.service.convert(tenantId, user.sub, id, dto);
  }
}

@ApiTags('CRM — Opportunities')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('api/v1/crm/opportunities')
export class OpportunityController {
  constructor(private readonly service: OpportunityService) {}

  @Post()
  @RequirePermissions('crm:opportunity:manage')
  @ApiOperation({ summary: 'Create an opportunity' })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateOpportunityDto,
  ) {
    return this.service.create(tenantId, user.sub, dto);
  }

  @Get()
  @RequirePermissions('crm:opportunity:manage')
  @ApiOperation({ summary: 'List opportunities' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(OPPORTUNITY_FIELD_CONFIG),
  })
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: OpportunityQueryDto,
  ) {
    return this.service.findAll(tenantId, query, roles);
  }

  @Get(':id')
  @RequirePermissions('crm:opportunity:manage')
  @ApiOperation({ summary: 'Get an opportunity' })
  @ApiResponse({ status: 404, description: 'Opportunity not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findOne(tenantId, id);
  }

  @Patch(':id')
  @RequirePermissions('crm:opportunity:manage')
  @ApiOperation({ summary: 'Update opportunity (stage drives won/lost)' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOpportunityDto,
  ) {
    return this.service.update(tenantId, id, dto);
  }
}

@ApiTags('CRM — Support Tickets')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('api/v1/crm/tickets')
export class TicketController {
  constructor(private readonly service: TicketService) {}

  @Post()
  @RequirePermissions('crm:ticket:create')
  @ApiOperation({ summary: 'Create a support ticket (auto-numbered, SLA set)' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateTicketDto,
  ) {
    return this.service.create(tenantId, user.sub, dto);
  }

  @Get()
  @RequirePermissions('crm:ticket:manage')
  @ApiOperation({ summary: 'List tickets (with derived SLA-breach flag)' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(TICKET_FIELD_CONFIG),
  })
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: TicketQueryDto,
  ) {
    return this.service.findAll(tenantId, query, roles);
  }

  @Get(':id')
  @RequirePermissions('crm:ticket:manage')
  @ApiOperation({ summary: 'Get a ticket with comments' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findOne(tenantId, id);
  }

  @Patch(':id')
  @RequirePermissions('crm:ticket:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update ticket status / assignment / add comment' })
  @ApiResponse({ status: 409, description: 'Ticket already closed' })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketDto,
  ) {
    return this.service.update(tenantId, user.sub, id, dto);
  }
}
