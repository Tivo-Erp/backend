import { Injectable, HttpStatus } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { TenantRepository } from '../repositories/tenant.repository.js';
import { RegisterTenantDto } from '../dto/register-tenant.dto.js';
import { UpdateTenantProfileDto } from '../dto/update-tenant-profile.dto.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { TENANT_FIELD_CONFIG } from '../config/tenant.field-config.js';
import { BusinessException } from '../../../common/exceptions/business.exception.js';
import { CHART_OF_ACCOUNTS_VN } from '../../fin/data/chart-of-accounts-vn.js';

const DEFAULT_DOC_TYPES = [
  'PO', 'PR', 'SO', 'SQ', 'INV', 'CN', 'DN', 'GRN', 'WO', 'NCR', 'PAY', 'JB', 'TKT',
];

@Injectable()
export class TenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantRepository: TenantRepository,
  ) {}

  async register(dto: RegisterTenantDto) {
    return this.prisma.$transaction(async (tx) => {
      const existingSlug = await tx.tenant.findUnique({
        where: { slug: dto.slug },
      });
      if (existingSlug) {
        throw new BusinessException(
          'ORG_TENANT_SLUG_TAKEN',
          'This slug is already in use',
          HttpStatus.CONFLICT,
        );
      }

      const existingEmail = await tx.user.findFirst({
        where: { email: dto.email },
      });
      if (existingEmail) {
        throw new BusinessException(
          'UAM_USER_ALREADY_EXISTS',
          'An account with this email already exists',
          HttpStatus.CONFLICT,
        );
      }

      const tenant = await tx.tenant.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          taxCode: dto.taxCode,
          timezone: dto.timezone || 'Asia/Ho_Chi_Minh',
          status: 'active',
        },
      });

      const passwordHash = await bcrypt.hash(dto.password, 12);
      const nameParts = dto.name.split(' ');

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: dto.email,
          passwordHash,
          firstName: nameParts[0] || 'Owner',
          lastName: nameParts.slice(1).join(' ') || '',
          status: 'active',
        },
      });

      const systemRoles = [
        { name: 'tenant_owner', description: 'Full access' },
        { name: 'tenant_admin', description: 'Admin access' },
        { name: 'manager', description: 'Manager access' },
        { name: 'staff', description: 'Standard access' },
        { name: 'viewer', description: 'Read-only access' },
      ];

      const createdRoles = [];
      for (const role of systemRoles) {
        const created = await tx.role.create({
          data: {
            tenantId: tenant.id,
            name: role.name,
            description: role.description,
            isSystem: true,
          },
        });
        createdRoles.push(created);
      }

      const ownerRole = createdRoles[0];
      const allPermissions = await tx.permission.findMany();
      if (allPermissions.length > 0) {
        await tx.rolePermission.createMany({
          data: allPermissions.map((p) => ({
            roleId: ownerRole.id,
            permissionId: p.id,
          })),
        });
      }

      await tx.userRole.create({
        data: { userId: user.id, roleId: ownerRole.id },
      });

      const starterPlan = await tx.plan.findUnique({
        where: { code: 'starter' },
      });
      if (!starterPlan) {
        throw new BusinessException(
          'SYSTEM_PLAN_NOT_FOUND',
          'Starter plan not found. Run database seed first.',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          planId: starterPlan.id,
          status: 'trialing',
          trialEndDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        },
      });

      await tx.documentSequence.createMany({
        data: DEFAULT_DOC_TYPES.map((dt) => ({
          tenantId: tenant.id,
          documentType: dt,
          prefix: dt,
          padding: 5,
          resetYearly: true,
        })),
      });

      // FIN-001: seed Vietnamese Chart of Accounts (TT200) for the new tenant
      await tx.chartOfAccount.createMany({
        data: CHART_OF_ACCOUNTS_VN.map((a) => ({
          tenantId: tenant.id,
          accountCode: a.accountCode,
          accountName: a.accountName,
          accountType: a.accountType,
          normalBalance: a.normalBalance,
          isGroup: a.isGroup,
          parentCode: a.parentCode ?? null,
        })),
      });

      return {
        tenantId: tenant.id,
        userId: user.id,
        slug: tenant.slug,
        status: tenant.status,
        message: 'Tenant registered successfully',
      };
    });
  }

  async getProfile(tenantId: string, queryFields: string | undefined, userRoles: string[]) {
    const tenant = await this.tenantRepository.findWithSubscription(tenantId);
    if (!tenant) {
      throw new BusinessException(
        'ORG_TENANT_NOT_FOUND',
        'Tenant not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // Build full data object first (since tenant profile is a single resource with computed fields)
    const subscription = tenant.subscriptions[0];
    const fullData: Record<string, any> = {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      legalName: tenant.legalName,
      taxCode: tenant.taxCode,
      logoUrl: tenant.logoUrl,
      timezone: tenant.timezone,
      locale: tenant.locale,
      baseCurrency: tenant.baseCurrency,
      status: tenant.status,
      settings: tenant.settings,
    };

    if (subscription) {
      fullData['subscription.planCode'] = subscription.plan.code;
      fullData['subscription.planName'] = subscription.plan.name;
      fullData['subscription.status'] = subscription.status;
      fullData['subscription.trialEndDate'] = subscription.trialEndDate;
      fullData['subscription.currentPeriodEnd'] = subscription.currentPeriodEnd;
      fullData['subscription.maxUsers'] = subscription.plan.maxUsers;
    }

    // Resolve which fields to return
    const allowed = FieldSelector.resolveAllowedFields(userRoles, TENANT_FIELD_CONFIG);
    const fieldsToReturn = queryFields
      ? queryFields.split(',').map((f) => f.trim())
      : TENANT_FIELD_CONFIG.defaultFields;

    // Validate requested fields
    if (queryFields) {
      const invalid = fieldsToReturn.filter((f) => !allowed.has(f));
      if (invalid.length > 0) {
        throw new BusinessException(
          'VALIDATION_ERROR',
          `Invalid or unauthorized fields requested: ${invalid.join(', ')}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // Build response with only requested fields
    const result: Record<string, any> = {};
    const subscriptionObj: Record<string, any> = {};
    let hasSubscription = false;

    for (const field of fieldsToReturn) {
      if (field.startsWith('subscription.')) {
        hasSubscription = true;
        const subField = field.replace('subscription.', '');
        if (fullData[field] !== undefined) {
          subscriptionObj[subField] = fullData[field];
        }
      } else if (fullData[field] !== undefined) {
        result[field] = fullData[field];
      }
    }

    if (hasSubscription && Object.keys(subscriptionObj).length > 0) {
      result.subscription = subscriptionObj;
    }

    return result;
  }

  async updateProfile(tenantId: string, dto: UpdateTenantProfileDto) {
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.legalName !== undefined) data.legalName = dto.legalName;
    if (dto.taxCode !== undefined) data.taxCode = dto.taxCode;
    if (dto.logoUrl !== undefined) data.logoUrl = dto.logoUrl;
    if (dto.timezone !== undefined) data.timezone = dto.timezone;
    if (dto.settings !== undefined) data.settings = dto.settings;

    return this.tenantRepository.update(tenantId, data);
  }
}
