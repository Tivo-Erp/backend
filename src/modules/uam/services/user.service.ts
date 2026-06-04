import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { InviteUserDto, UpdateUserDto } from '../dto/user.dto.js';
import { PaginationQueryDto, PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { USER_FIELD_CONFIG } from '../config/user.field-config.js';
import { BusinessException } from '../../../common/exceptions/business.exception.js';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async invite(tenantId: string, dto: InviteUserDto) {
    const existingUser = await this.prisma.user.findFirst({
      where: { tenantId, email: dto.email },
    });
    if (existingUser) {
      throw new BusinessException(
        'UAM_USER_ALREADY_EXISTS',
        'A user with this email already exists in this organization',
        HttpStatus.CONFLICT,
      );
    }

    await this.checkUserLimit(tenantId);

    const roles = await this.prisma.role.findMany({
      where: { id: { in: dto.roleIds }, tenantId },
    });
    if (roles.length !== dto.roleIds.length) {
      throw new BusinessException(
        'UAM_ROLE_NOT_FOUND',
        'One or more roles not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        passwordHash: '',
        status: 'invited',
        userRoles: {
          create: dto.roleIds.map((roleId) => ({ roleId })),
        },
      },
      include: {
        userRoles: { include: { role: true } },
      },
    });

    return user;
  }

  async findAll(
    tenantId: string,
    query: PaginationQueryDto & {
      status?: string;
      search?: string;
      roleId?: string;
      fields?: string;
    },
    userRoles: string[],
  ) {
    const where: any = { tenantId, deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.roleId) {
      where.userRoles = { some: { roleId: query.roleId } };
    }
    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    // Resolve which fields to select
    const allowed = FieldSelector.resolveAllowedFields(userRoles, USER_FIELD_CONFIG);
    const requestedFields = query.fields
      ? query.fields.split(',').map((f) => f.trim())
      : USER_FIELD_CONFIG.defaultFields;

    // Validate
    if (query.fields) {
      const invalid = requestedFields.filter((f) => !allowed.has(f));
      if (invalid.length > 0) {
        throw new BusinessException(
          'VALIDATION_ERROR',
          `Invalid or unauthorized fields requested: ${invalid.join(', ')}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // Separate flat user fields from relation fields (roles.*)
    const flatFields = requestedFields.filter((f) => !f.includes('.'));
    const needsRoles = requestedFields.some((f) => f.startsWith('roles.'));
    const roleFields = requestedFields
      .filter((f) => f.startsWith('roles.'))
      .map((f) => f.replace('roles.', ''));

    // Build Prisma select for flat fields
    const selectObj: Record<string, any> = {};
    for (const f of flatFields) selectObj[f] = true;

    // Always include userRoles relation if roles.* requested
    if (needsRoles) {
      selectObj.userRoles = {
        select: {
          role: {
            select: Object.fromEntries(roleFields.map((f) => [f, true])),
          },
        },
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: ((query.page || 1) - 1) * (query.limit || 20),
        take: query.limit || 20,
        orderBy: { [query.sortBy || 'createdAt']: query.sortOrder || 'desc' },
        select: selectObj,
      }),
      this.prisma.user.count({ where }),
    ]);

    // Transform userRoles → roles in response
    const sanitized = data.map((u: any) => {
      const result = { ...u };
      if (result.userRoles) {
        result.roles = result.userRoles.map((ur: any) => ur.role);
        delete result.userRoles;
      }
      return result;
    });

    return PaginatedResponseDto.create(
      sanitized,
      total,
      query.page || 1,
      query.limit || 20,
    );
  }

  async update(tenantId: string, userId: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.tenantId !== tenantId) {
      throw new BusinessException(
        'UAM_USER_NOT_FOUND',
        'User not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const data: any = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;

    if (dto.roleIds) {
      const roles = await this.prisma.role.findMany({
        where: { id: { in: dto.roleIds }, tenantId },
      });
      if (roles.length !== dto.roleIds.length) {
        throw new BusinessException(
          'UAM_ROLE_NOT_FOUND',
          'One or more roles not found',
          HttpStatus.NOT_FOUND,
        );
      }

      await this.prisma.userRole.deleteMany({ where: { userId } });
      await this.prisma.userRole.createMany({
        data: dto.roleIds.map((roleId) => ({ userId, roleId })),
      });
    }

    return this.prisma.user.update({
      where: { id: userId },
      data,
      include: { userRoles: { include: { role: true } } },
    });
  }

  async deactivate(tenantId: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.tenantId !== tenantId) {
      throw new BusinessException(
        'UAM_USER_NOT_FOUND',
        'User not found',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return this.prisma.user.update({
      where: { id: userId },
      data: { status: 'inactive' },
    });
  }

  private async checkUserLimit(tenantId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { tenantId },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription?.plan.maxUsers) return;

    const activeUserCount = await this.prisma.user.count({
      where: { tenantId, status: { not: 'inactive' }, deletedAt: null },
    });

    if (activeUserCount >= subscription.plan.maxUsers) {
      throw new BusinessException(
        'ORG_SUBSCRIPTION_USER_LIMIT',
        `User limit reached (${subscription.plan.maxUsers} users for ${subscription.plan.name} plan)`,
        HttpStatus.FORBIDDEN,
      );
    }
  }
}
