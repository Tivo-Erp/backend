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
  PROJECT_FIELD_CONFIG,
  TASK_FIELD_CONFIG,
  TIMESHEET_FIELD_CONFIG,
} from '../config/pmo.field-config.js';
import { ProjectService } from '../services/project.service.js';
import { TaskService } from '../services/task.service.js';
import { TimesheetService } from '../services/timesheet.service.js';
import {
  ApproveTimesheetDto,
  CreateMilestoneDto,
  CreateProjectDto,
  CreateTaskDto,
  CreateTimesheetDto,
  ProjectQueryDto,
  TaskQueryDto,
  TimesheetQueryDto,
  UpdateProjectDto,
  UpdateTaskDto,
} from '../dto/pmo.dto.js';

@ApiTags('PMO — Projects')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('api/v1/pmo/projects')
export class ProjectController {
  constructor(
    private readonly projects: ProjectService,
    private readonly tasks: TaskService,
  ) {}

  @Post()
  @RequirePermissions('pmo:project:create')
  @ApiOperation({ summary: 'Create a project (auto-coded)' })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projects.create(tenantId, user.sub, dto);
  }

  @Get()
  @RequirePermissions('pmo:project:read')
  @ApiOperation({ summary: 'List projects' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(PROJECT_FIELD_CONFIG),
  })
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: ProjectQueryDto,
  ) {
    return this.projects.findAll(tenantId, query, roles);
  }

  @Get(':id')
  @RequirePermissions('pmo:project:read')
  @ApiOperation({ summary: 'Get a project with members and milestones' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.projects.findOne(tenantId, id);
  }

  @Patch(':id')
  @RequirePermissions('pmo:project:create')
  @ApiOperation({ summary: 'Update project (status / budget / progress)' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(tenantId, id, dto);
  }

  // ── Milestones ────────────────────────────────────────────────

  @Post(':id/milestones')
  @RequirePermissions('pmo:project:create')
  @ApiOperation({ summary: 'Add a milestone to a project' })
  addMilestone(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateMilestoneDto,
  ) {
    return this.projects.addMilestone(tenantId, id, dto);
  }

  @Get(':id/milestones')
  @RequirePermissions('pmo:project:read')
  @ApiOperation({ summary: 'List project milestones' })
  listMilestones(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.projects.listMilestones(tenantId, id);
  }

  // ── Tasks (nested under project) ──────────────────────────────

  @Post(':id/tasks')
  @RequirePermissions('pmo:task:manage')
  @ApiOperation({ summary: 'Create a task under a project' })
  createTask(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasks.create(tenantId, projectId, dto);
  }

  @Get(':id/tasks')
  @RequirePermissions('pmo:task:read')
  @ApiOperation({ summary: 'List tasks of a project' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(TASK_FIELD_CONFIG),
  })
  listTasks(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Param('id', ParseUUIDPipe) projectId: string,
    @Query() query: TaskQueryDto,
  ) {
    return this.tasks.findAll(tenantId, projectId, query, roles);
  }

  @Patch(':id/tasks/:taskId')
  @RequirePermissions('pmo:task:manage')
  @ApiOperation({
    summary: 'Update a task (status recomputes project progress)',
  })
  @ApiResponse({ status: 404, description: 'Task not found' })
  updateTask(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasks.update(tenantId, projectId, taskId, dto);
  }
}

@ApiTags('PMO — Timesheets')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('api/v1/pmo/timesheets')
export class TimesheetController {
  constructor(private readonly service: TimesheetService) {}

  @Post()
  @RequirePermissions('pmo:timesheet:manage')
  @ApiOperation({ summary: 'Log a time entry (max 24h/day, no future dates)' })
  @ApiResponse({
    status: 400,
    description: 'Future date / daily limit exceeded',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateTimesheetDto,
  ) {
    return this.service.create(tenantId, user.sub, dto);
  }

  @Get()
  @RequirePermissions('pmo:timesheet:manage')
  @ApiOperation({ summary: 'List timesheets' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(TIMESHEET_FIELD_CONFIG),
  })
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: TimesheetQueryDto,
  ) {
    return this.service.findAll(tenantId, query, roles);
  }

  @Patch(':id/approve')
  @RequirePermissions('pmo:timesheet:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve or reject a timesheet' })
  @ApiResponse({ status: 409, description: 'Already decided' })
  approve(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveTimesheetDto,
  ) {
    return this.service.approve(tenantId, id, user.sub, dto);
  }
}
