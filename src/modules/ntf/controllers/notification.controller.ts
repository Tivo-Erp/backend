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
import { NOTIFICATION_FIELD_CONFIG } from '../config/notification.field-config.js';
import { NotificationService } from '../services/notification.service.js';
import {
  NotificationQueryDto,
  UpdatePreferenceDto,
} from '../dto/notification.dto.js';

@ApiTags('Notifications')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('api/v1/ntf/notifications')
export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  @Get()
  @RequirePermissions('ntf:notification:read')
  @ApiOperation({ summary: 'List my notifications (with unread count)' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(NOTIFICATION_FIELD_CONFIG),
  })
  findMine(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @CurrentUserRoles() roles: string[],
    @Query() query: NotificationQueryDto,
  ) {
    return this.service.findMine(tenantId, user.sub, query, roles);
  }

  @Patch(':id/read')
  @RequirePermissions('ntf:notification:update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  markRead(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.markRead(tenantId, user.sub, id);
  }

  @Post('read-all')
  @RequirePermissions('ntf:notification:update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all my notifications as read' })
  markAllRead(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.markAllRead(tenantId, user.sub);
  }
}

@ApiTags('Notifications — Preferences')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('api/v1/ntf/preferences')
export class NotificationPreferenceController {
  constructor(private readonly service: NotificationService) {}

  @Get()
  @RequirePermissions('ntf:preference:read')
  @ApiOperation({ summary: 'Get my notification preferences' })
  getPreferences(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.getPreferences(tenantId, user.sub);
  }

  @Patch()
  @RequirePermissions('ntf:preference:update')
  @ApiOperation({ summary: 'Create or update a category preference' })
  upsertPreference(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdatePreferenceDto,
  ) {
    return this.service.upsertPreference(tenantId, user.sub, dto);
  }
}
