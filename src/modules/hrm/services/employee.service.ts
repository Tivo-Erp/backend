import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { safeSortBy } from '../../../common/utils/sort.util.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { PiiCrypto } from '../../../common/utils/pii-crypto.js';
import { EMPLOYEE_FIELD_CONFIG } from '../config/employee.field-config.js';
import {
  CreateEmployeeDto,
  EmployeeQueryDto,
  UpdateEmployeeDto,
} from '../dto/employee.dto.js';

const EMP_SORTABLE = [
  'createdAt',
  'updatedAt',
  'employeeCode',
  'joinDate',
  'status',
] as const;

@Injectable()
export class EmployeeService {
  constructor(private readonly prisma: PrismaService) {}

  // ── HRM-001: Onboard (PII encrypted before storage) ───────────

  async create(tenantId: string, dto: CreateEmployeeDto) {
    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('UAM_USER_NOT_FOUND');

    try {
      const employee = await this.prisma.employee.create({
        data: {
          tenantId,
          userId: dto.userId,
          employeeCode: dto.employeeCode,
          departmentId: dto.departmentId ?? null,
          branchId: dto.branchId ?? null,
          position: dto.position ?? null,
          joinDate: new Date(dto.joinDate),
          status: 'probation',
          basicSalary: new Prisma.Decimal(dto.basicSalary ?? 0),
          numberOfDependents: dto.numberOfDependents ?? 0,
          bankName: dto.bankName ?? null,
          fullNameEncrypted: PiiCrypto.encrypt(dto.fullName),
          dateOfBirthEncrypted: PiiCrypto.encryptOptional(dto.dateOfBirth),
          idNumberEncrypted: PiiCrypto.encryptOptional(dto.idNumber),
          taxCodeEncrypted: PiiCrypto.encryptOptional(dto.taxCode),
          socialInsNumEncrypted: PiiCrypto.encryptOptional(dto.socialInsNum),
          bankAccNumEncrypted: PiiCrypto.encryptOptional(dto.bankAccNum),
        },
      });
      return this.toResponse(employee, true, undefined);
    } catch (e) {
      this.rethrowUnique(e);
    }
  }

  async update(tenantId: string, id: string, dto: UpdateEmployeeDto) {
    const emp = await this.prisma.employee.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!emp) throw new NotFoundException('HRM_EMPLOYEE_NOT_FOUND');

    try {
      const updated = await this.prisma.employee.update({
        where: { id },
        data: {
          ...(dto.departmentId !== undefined && {
            departmentId: dto.departmentId,
          }),
          ...(dto.branchId !== undefined && { branchId: dto.branchId }),
          ...(dto.position !== undefined && { position: dto.position }),
          ...(dto.status !== undefined && { status: dto.status }),
          ...(dto.basicSalary !== undefined && {
            basicSalary: new Prisma.Decimal(dto.basicSalary),
          }),
          ...(dto.numberOfDependents !== undefined && {
            numberOfDependents: dto.numberOfDependents,
          }),
          ...(dto.bankName !== undefined && { bankName: dto.bankName }),
          ...(dto.fullName !== undefined && {
            fullNameEncrypted: PiiCrypto.encrypt(dto.fullName),
          }),
          ...(dto.bankAccNum !== undefined && {
            bankAccNumEncrypted: PiiCrypto.encryptOptional(dto.bankAccNum),
          }),
        },
      });
      return this.toResponse(updated, true, undefined);
    } catch (e) {
      this.rethrowUnique(e);
    }
  }

  // ── Queries ───────────────────────────────────────────────────

  async findAll(
    tenantId: string,
    query: EmployeeQueryDto,
    userRoles: string[],
    canReadPii: boolean,
  ) {
    // Field names here are logical (decrypted) names, not DB columns, so the
    // selector is used for validation/whitelisting and the projection happens
    // in toResponse rather than via a Prisma select.
    const fields = new Set(
      Object.keys(
        FieldSelector.buildPrismaSelect(
          query.fields,
          userRoles,
          EMPLOYEE_FIELD_CONFIG,
        ),
      ),
    );
    const {
      page = 1,
      limit = 20,
      sortOrder = 'desc',
      status,
      departmentId,
      search,
    } = query;
    const sortBy = safeSortBy(query.sortBy, EMP_SORTABLE);

    const where: Prisma.EmployeeWhereInput = {
      tenantId,
      ...(status && { status }),
      ...(departmentId && { departmentId }),
      ...(search && {
        employeeCode: { contains: search, mode: 'insensitive' },
      }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.employee.count({ where }),
    ]);

    const data = rows.map((e) => this.toResponse(e, canReadPii, fields));
    return PaginatedResponseDto.create(data, total, page, limit);
  }

  async findOne(
    tenantId: string,
    id: string,
    userRoles: string[],
    canReadPii: boolean,
    queryFields?: string,
  ) {
    const emp = await this.prisma.employee.findFirst({
      where: { id, tenantId },
    });
    if (!emp) throw new NotFoundException('HRM_EMPLOYEE_NOT_FOUND');
    const fields = new Set(
      Object.keys(
        FieldSelector.buildPrismaSelect(
          queryFields,
          userRoles,
          EMPLOYEE_FIELD_CONFIG,
        ),
      ),
    );
    return this.toResponse(emp, canReadPii, fields);
  }

  // ── Mapping: decrypt or mask PII, filter to allowed fields ────

  private toResponse(
    e: {
      id: string;
      employeeCode: string;
      userId: string;
      departmentId: string | null;
      branchId: string | null;
      position: string | null;
      joinDate: Date;
      status: string;
      basicSalary: Prisma.Decimal;
      numberOfDependents: number;
      bankName: string | null;
      fullNameEncrypted: string;
      dateOfBirthEncrypted: string | null;
      idNumberEncrypted: string | null;
      taxCodeEncrypted: string | null;
      socialInsNumEncrypted: string | null;
      bankAccNumEncrypted: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
    canReadPii: boolean,
    fields: Set<string> | undefined,
  ) {
    const want = (k: string) => !fields || fields.has(k);
    const out: Record<string, unknown> = {};

    const plain: Record<string, unknown> = {
      id: e.id,
      employeeCode: e.employeeCode,
      userId: e.userId,
      departmentId: e.departmentId,
      branchId: e.branchId,
      position: e.position,
      joinDate: e.joinDate,
      status: e.status,
      basicSalary: Number(e.basicSalary),
      numberOfDependents: e.numberOfDependents,
      bankName: e.bankName,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    };
    for (const [k, v] of Object.entries(plain)) {
      if (want(k)) out[k] = v;
    }

    // PII decrypted lazily — only for fields actually returned. Masking policy
    // without read_pii: name keeps first token, bank account keeps last 4,
    // everything else (DOB / ID / tax / social insurance) fully masked.
    if (want('fullName')) {
      out.fullName = canReadPii
        ? PiiCrypto.decrypt(e.fullNameEncrypted)
        : PiiCrypto.maskName(e.fullNameEncrypted);
    }
    if (want('dateOfBirth')) {
      out.dateOfBirth = canReadPii
        ? PiiCrypto.decryptOptional(e.dateOfBirthEncrypted)
        : PiiCrypto.maskFull(e.dateOfBirthEncrypted);
    }
    if (want('idNumber')) {
      out.idNumber = canReadPii
        ? PiiCrypto.decryptOptional(e.idNumberEncrypted)
        : PiiCrypto.maskFull(e.idNumberEncrypted);
    }
    if (want('taxCode')) {
      out.taxCode = canReadPii
        ? PiiCrypto.decryptOptional(e.taxCodeEncrypted)
        : PiiCrypto.maskFull(e.taxCodeEncrypted);
    }
    if (want('socialInsNum')) {
      out.socialInsNum = canReadPii
        ? PiiCrypto.decryptOptional(e.socialInsNumEncrypted)
        : PiiCrypto.maskFull(e.socialInsNumEncrypted);
    }
    if (want('bankAccNum')) {
      out.bankAccNum = canReadPii
        ? PiiCrypto.decryptOptional(e.bankAccNumEncrypted)
        : PiiCrypto.maskTail(e.bankAccNumEncrypted);
    }

    return out;
  }

  private rethrowUnique(e: unknown): never {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      const target = (e.meta?.target as string[] | undefined)?.join(',') ?? '';
      throw new ConflictException(
        target.includes('userId')
          ? 'HRM_EMPLOYEE_USER_EXISTS'
          : 'HRM_EMPLOYEE_CODE_EXISTS',
      );
    }
    throw e;
  }
}
