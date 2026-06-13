import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EmployeeService } from './employee.service.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { PiiCrypto } from '../../../common/utils/pii-crypto.js';

const makePrisma = () => ({
  employee: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  user: { findFirst: jest.fn() },
});

describe('EmployeeService PII handling', () => {
  let service: EmployeeService;
  let prisma: ReturnType<typeof makePrisma>;
  const tenantId = 't1';
  const ORIGINAL_KEY = process.env.PII_ENCRYPTION_KEY;

  const row = () => ({
    id: 'e1',
    employeeCode: 'EMP001',
    userId: 'u1',
    departmentId: null,
    branchId: null,
    position: 'Accountant',
    joinDate: new Date('2026-01-05'),
    status: 'active',
    basicSalary: '20000000',
    numberOfDependents: 1,
    bankName: 'VCB',
    fullNameEncrypted: PiiCrypto.encrypt('Nguyễn Văn An'),
    dateOfBirthEncrypted: PiiCrypto.encrypt('1990-01-15'),
    idNumberEncrypted: PiiCrypto.encrypt('079123456789'),
    taxCodeEncrypted: PiiCrypto.encrypt('8765432109'),
    socialInsNumEncrypted: PiiCrypto.encrypt('0123456789'),
    bankAccNumEncrypted: PiiCrypto.encrypt('0011002233445566'),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeAll(() => {
    process.env.PII_ENCRYPTION_KEY = 'unit-test-passphrase-32-chars!!';
  });

  afterAll(() => {
    process.env.PII_ENCRYPTION_KEY = ORIGINAL_KEY;
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeeService,
        { provide: PrismaService, useFactory: makePrisma },
      ],
    }).compile();
    service = module.get(EmployeeService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  it('decrypts PII for callers with read_pii', async () => {
    prisma.employee.findFirst.mockResolvedValue(row());
    const emp: any = await service.findOne(
      tenantId, 'e1', ['tenant_owner'], true, 'fullName,idNumber,bankAccNum',
    );
    expect(emp.fullName).toBe('Nguyễn Văn An');
    expect(emp.idNumber).toBe('079123456789');
    expect(emp.bankAccNum).toBe('0011002233445566');
  });

  it('masks PII per field policy without read_pii', async () => {
    prisma.employee.findFirst.mockResolvedValue(row());
    const emp: any = await service.findOne(tenantId, 'e1', ['tenant_owner'], false,
      'fullName,dateOfBirth,idNumber,socialInsNum,bankAccNum');
    expect(emp.fullName).toBe('Nguyễn ••••'); // first token only
    expect(emp.dateOfBirth).toBe('••••'); // fully masked
    expect(emp.idNumber).toBe('••••'); // fully masked
    expect(emp.socialInsNum).toBe('••••'); // fully masked
    expect(emp.bankAccNum).toBe('••••5566'); // conventional last-4
  });

  it('honours ?fields= and never returns ciphertext columns', async () => {
    prisma.employee.findFirst.mockResolvedValue(row());
    const emp: any = await service.findOne(
      tenantId, 'e1', ['tenant_owner'], true, 'id,employeeCode,fullName',
    );
    expect(Object.keys(emp).sort()).toEqual(['employeeCode', 'fullName', 'id']);
    expect(JSON.stringify(emp)).not.toContain('Encrypted');
  });

  it('rejects fields outside the role whitelist (fail-fast 400)', async () => {
    prisma.employee.findFirst.mockResolvedValue(row());
    await expect(
      service.findOne(tenantId, 'e1', ['viewer'], false, 'basicSalary'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('defaults the list to defaultFields (no salary/PII identifiers)', async () => {
    prisma.employee.findMany.mockResolvedValue([row()]);
    prisma.employee.count.mockResolvedValue(1);
    const page: any = await service.findAll(tenantId, {} as any, ['tenant_owner'], false);
    const emp = page.data[0];
    expect(emp.basicSalary).toBeUndefined();
    expect(emp.idNumber).toBeUndefined();
    expect(emp.fullName).toBe('Nguyễn ••••');
  });
});
