import { Module } from '@nestjs/common';
import { UserController } from './controllers/user.controller.js';
import { RoleController } from './controllers/role.controller.js';
import { PermissionController } from './controllers/permission.controller.js';
import { AuditLogController } from './controllers/audit-log.controller.js';
import { UserService } from './services/user.service.js';
import { RoleService } from './services/role.service.js';
import { AuditLogService } from './services/audit-log.service.js';

@Module({
  controllers: [
    UserController,
    RoleController,
    PermissionController,
    AuditLogController,
  ],
  providers: [UserService, RoleService, AuditLogService],
  exports: [AuditLogService],
})
export class UamModule {}
