import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { CreateRoleDto, UpdateRoleDto } from '../dto/role.dto.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { ROLE_FIELD_CONFIG } from '../config/role.field-config.js';
import { BusinessException } from '../../../common/exceptions/business.exception.js';

@Injectable()
export class RoleService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateRoleDto) {
    const existing = await this.prisma.role.findFirst({
      where: { tenantId, name: dto.name },
    });
    if (existing) {
      throw new BusinessException(
        'UAM_ROLE_NAME_DUPLICATE',
        `Role name '${dto.name}' already exists`,
        HttpStatus.CONFLICT,
      );
    }

    return this.prisma.role.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        isSystem: false,
        rolePermissions: {
          create: dto.permissionIds.map((permissionId) => ({ permissionId })),
        },
      },
      include: {
        rolePermissions: { include: { permission: true } },
      },
    });
  }

  async findAll(tenantId: string, queryFields?: string, userRoles: string[] = []) {
    // Resolve which fields to return
    const allowed = FieldSelector.resolveAllowedFields(userRoles, ROLE_FIELD_CONFIG);
    const requestedFields = queryFields
      ? queryFields.split(',').map((f) => f.trim())
      : ROLE_FIELD_CONFIG.defaultFields;

    // Validate
    if (queryFields) {
      const invalid = requestedFields.filter((f) => !allowed.has(f));
      if (invalid.length > 0) {
        throw new BusinessException(
          'VALIDATION_ERROR',
          `Invalid or unauthorized fields requested: ${invalid.join(', ')}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // Separate flat vs relation fields
    const flatFields = requestedFields.filter((f) => !f.includes('.'));
    const needsPermissions = requestedFields.some((f) => f.startsWith('permissions.'));
    const permFields = requestedFields
      .filter((f) => f.startsWith('permissions.'))
      .map((f) => f.replace('permissions.', ''));

    const selectObj: Record<string, any> = {};
    for (const f of flatFields) selectObj[f] = true;

    if (needsPermissions) {
      selectObj.rolePermissions = {
        select: {
          permission: {
            select: Object.fromEntries(permFields.map((f) => [f, true])),
          },
        },
      };
    }

    const roles = await this.prisma.role.findMany({
      where: { tenantId },
      select: selectObj,
      orderBy: { isSystem: 'desc' },
    });

    // Transform rolePermissions → permissions in response
    return roles.map((r: any) => {
      const result = { ...r };
      if (result.rolePermissions) {
        result.permissions = result.rolePermissions.map((rp: any) => rp.permission);
        delete result.rolePermissions;
      }
      return result;
    });
  }

  async update(tenantId: string, roleId: string, dto: UpdateRoleDto) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role || role.tenantId !== tenantId) {
      throw new BusinessException(
        'UAM_ROLE_NOT_FOUND',
        'Role not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (role.isSystem) {
      throw new BusinessException(
        'UAM_ROLE_SYSTEM_IMMUTABLE',
        'System roles cannot be modified',
        HttpStatus.FORBIDDEN,
      );
    }

    if (dto.name && dto.name !== role.name) {
      const existing = await this.prisma.role.findFirst({
        where: { tenantId, name: dto.name },
      });
      if (existing) {
        throw new BusinessException(
          'UAM_ROLE_NAME_DUPLICATE',
          `Role name '${dto.name}' already exists`,
          HttpStatus.CONFLICT,
        );
      }
    }

    if (dto.permissionIds) {
      await this.prisma.rolePermission.deleteMany({ where: { roleId } });
      await this.prisma.rolePermission.createMany({
        data: dto.permissionIds.map((permissionId) => ({
          roleId,
          permissionId,
        })),
      });
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;

    return this.prisma.role.update({
      where: { id: roleId },
      data,
      include: {
        rolePermissions: { include: { permission: true } },
      },
    });
  }

  async delete(tenantId: string, roleId: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role || role.tenantId !== tenantId) {
      throw new BusinessException(
        'UAM_ROLE_NOT_FOUND',
        'Role not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (role.isSystem) {
      throw new BusinessException(
        'UAM_ROLE_SYSTEM_IMMUTABLE',
        'System roles cannot be deleted',
        HttpStatus.FORBIDDEN,
      );
    }

    const usersWithRole = await this.prisma.userRole.count({
      where: { roleId },
    });
    if (usersWithRole > 0) {
      throw new BusinessException(
        'UAM_ROLE_IN_USE',
        `Cannot delete role assigned to ${usersWithRole} user(s)`,
        HttpStatus.CONFLICT,
      );
    }

    await this.prisma.rolePermission.deleteMany({ where: { roleId } });
    return this.prisma.role.delete({ where: { id: roleId } });
  }

  async getAllPermissions() {
    return this.prisma.permission.findMany({
      orderBy: { module: 'asc' },
    });
  }
}
