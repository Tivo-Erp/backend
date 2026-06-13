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
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface.js';
import { LeaveService } from '../services/leave.service.js';
import {
  CreateLeaveRequestDto,
  CreateLeaveTypeDto,
  LeaveActionDto,
  LeaveRequestQueryDto,
} from '../dto/leave.dto.js';

@ApiTags('HRM — Leave')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('api/v1/hrm')
export class LeaveController {
  constructor(private readonly service: LeaveService) {}

  // ── Leave types ────────────────────────────────────────────

  @Post('leave-types')
  @RequirePermissions('hrm:leave:manage')
  @ApiOperation({ summary: 'Create a leave type' })
  @ApiResponse({ status: 409, description: 'Code already exists' })
  createLeaveType(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateLeaveTypeDto,
  ) {
    return this.service.createLeaveType(tenantId, dto);
  }

  @Get('leave-types')
  @RequirePermissions('hrm:leave:read')
  @ApiOperation({ summary: 'List leave types' })
  listLeaveTypes(@CurrentTenant() tenantId: string) {
    return this.service.listLeaveTypes(tenantId);
  }

  // ── Leave requests ─────────────────────────────────────────

  @Post('leave-requests')
  @RequirePermissions('hrm:leave:create')
  @ApiOperation({ summary: 'Submit a leave request (server computes working days)' })
  @ApiResponse({ status: 400, description: 'Insufficient balance / invalid dates' })
  createRequest(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateLeaveRequestDto,
  ) {
    return this.service.createRequest(tenantId, dto);
  }

  @Get('leave-requests')
  @RequirePermissions('hrm:leave:read')
  @ApiOperation({ summary: 'List leave requests' })
  findRequests(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: LeaveRequestQueryDto,
  ) {
    return this.service.findRequests(tenantId, query, roles);
  }

  @Post('leave-requests/:id/approve')
  @RequirePermissions('hrm:leave:approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a leave request (deducts balance)' })
  @ApiResponse({ status: 409, description: 'Not pending / insufficient balance' })
  approve(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LeaveActionDto,
  ) {
    return this.service.approve(tenantId, id, user.sub, dto);
  }

  @Post('leave-requests/:id/reject')
  @RequirePermissions('hrm:leave:approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a leave request' })
  @ApiResponse({ status: 409, description: 'Not pending' })
  reject(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LeaveActionDto,
  ) {
    return this.service.reject(tenantId, id, user.sub, dto);
  }
}
