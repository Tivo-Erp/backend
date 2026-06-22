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
import { WORKFLOW_DEFINITION_FIELD_CONFIG } from '../config/workflow.field-config.js';
import { WorkflowDefinitionService } from '../services/workflow-definition.service.js';
import { WorkflowEngineService } from '../services/workflow-engine.service.js';
import {
  CreateWorkflowDefinitionDto,
  StartWorkflowDto,
  UpdateWorkflowDefinitionDto,
  WorkflowActionDto,
  WorkflowDefinitionQueryDto,
  WorkflowTaskQueryDto,
} from '../dto/workflow.dto.js';

@ApiTags('Workflow — Definitions')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('api/v1/wfl/definitions')
export class WorkflowDefinitionController {
  constructor(
    private readonly definitions: WorkflowDefinitionService,
    private readonly engine: WorkflowEngineService,
  ) {}

  @Post()
  @RequirePermissions('wfl:definition:create')
  @ApiOperation({ summary: 'Create a workflow definition with ordered steps' })
  @ApiResponse({ status: 201, description: 'Definition created' })
  create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateWorkflowDefinitionDto,
  ) {
    return this.definitions.create(tenantId, dto);
  }

  @Get()
  @RequirePermissions('wfl:definition:read')
  @ApiOperation({ summary: 'List workflow definitions' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(
      WORKFLOW_DEFINITION_FIELD_CONFIG,
    ),
  })
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: WorkflowDefinitionQueryDto,
  ) {
    return this.definitions.findAll(tenantId, query, roles);
  }

  @Get(':id')
  @RequirePermissions('wfl:definition:read')
  @ApiOperation({ summary: 'Get a workflow definition with steps' })
  @ApiResponse({ status: 404, description: 'Definition not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.definitions.findOne(tenantId, id);
  }

  @Patch(':id')
  @RequirePermissions('wfl:definition:update')
  @ApiOperation({ summary: 'Update definition / replace steps' })
  @ApiResponse({ status: 404, description: 'Definition not found' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkflowDefinitionDto,
  ) {
    return this.definitions.update(tenantId, id, dto);
  }

  @Post('start')
  @RequirePermissions('wfl:instance:start')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Start a workflow instance for an entity' })
  @ApiResponse({
    status: 409,
    description: 'Definition inactive or instance already running',
  })
  start(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: StartWorkflowDto,
  ) {
    return this.engine.start(tenantId, user.sub, dto);
  }
}

@ApiTags('Workflow — My Tasks')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('api/v1/wfl/tasks')
export class WorkflowTaskController {
  constructor(private readonly engine: WorkflowEngineService) {}

  @Get()
  @RequirePermissions('wfl:task:read')
  @ApiOperation({ summary: 'List my pending approval tasks' })
  listTasks(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentUserRoles() roles: string[],
    @Query() query: WorkflowTaskQueryDto,
  ) {
    return this.engine.listTasks(tenantId, user.sub, roles, query);
  }

  @Post(':instanceId/approve')
  @RequirePermissions('wfl:task:action')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve the current step of a workflow instance' })
  @ApiResponse({
    status: 403,
    description: 'Not an approver for the current step',
  })
  @ApiResponse({ status: 409, description: 'Instance not running' })
  approve(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentUserRoles() roles: string[],
    @Param('instanceId', ParseUUIDPipe) instanceId: string,
    @Body() dto: WorkflowActionDto,
  ) {
    return this.engine.approve(tenantId, instanceId, user.sub, roles, dto);
  }

  @Post(':instanceId/reject')
  @RequirePermissions('wfl:task:action')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a workflow instance' })
  @ApiResponse({
    status: 403,
    description: 'Not an approver for the current step',
  })
  @ApiResponse({ status: 409, description: 'Instance not running' })
  reject(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentUserRoles() roles: string[],
    @Param('instanceId', ParseUUIDPipe) instanceId: string,
    @Body() dto: WorkflowActionDto,
  ) {
    return this.engine.reject(tenantId, instanceId, user.sub, roles, dto);
  }
}
