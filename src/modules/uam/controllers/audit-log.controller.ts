import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { AuditLogService } from '../services/audit-log.service.js';
import { AuditLogQueryDto } from '../dto/audit-log-query.dto.js';
import { CurrentTenant, CurrentUserRoles, RequirePermissions } from '../../../common/decorators/index.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { AUDIT_LOG_FIELD_CONFIG } from '../config/audit-log.field-config.js';

@ApiTags('UAM — Audit Logs')
@ApiBearerAuth('JWT-Auth')
@Controller('api/v1/uam/audit-logs')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @RequirePermissions('uam:audit:read')
  @ApiOperation({ summary: 'List Audit Logs', description: 'Paginated audit log query with Sparse Fieldsets support.' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(AUDIT_LOG_FIELD_CONFIG),
    example: 'id,module,action,userId,createdAt',
  })
  @ApiResponse({ status: 200, description: 'Paginated audit logs with selected fields' })
  async findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() userRoles: string[],
    @Query() query: AuditLogQueryDto,
  ) {
    return this.auditLogService.findAll(tenantId, query, userRoles);
  }
}
