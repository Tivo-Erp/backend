import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RoleService } from '../services/role.service.js';

@ApiTags('UAM — Permissions')
@ApiBearerAuth('JWT-Auth')
@Controller('api/v1/uam/permissions')
export class PermissionController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  @ApiOperation({ summary: 'List Permissions', description: 'List all system permissions. Used to populate role assignment UI.' })
  @ApiResponse({ status: 200, description: 'Array of permissions grouped by module' })
  async findAll() {
    return this.roleService.getAllPermissions();
  }
}
