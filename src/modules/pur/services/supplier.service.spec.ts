import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { SupplierService } from './supplier.service.js';
import { SupplierRepository } from '../repositories/supplier.repository.js';

const makeRepo = () => ({
  findByCode: jest.fn(),
  create: jest.fn(),
  findAll: jest.fn(),
  findById: jest.fn(),
  update: jest.fn(),
});

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

describe('SupplierService', () => {
  let service: SupplierService;
  let repo: ReturnType<typeof makeRepo>;

  const tenantId = 'tenant-uuid';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierService,
        { provide: SupplierRepository, useFactory: makeRepo },
      ],
    }).compile();

    service = module.get(SupplierService);
    repo = module.get(SupplierRepository);
    jest.clearAllMocks();
  });

  describe('create', () => {
    const dto: any = { code: 'SUP-001', name: 'ACME' };

    it('creates a supplier when code is unique', async () => {
      repo.findByCode.mockResolvedValue(null);
      repo.create.mockResolvedValue({ id: 's1', ...dto });

      const result = await service.create(tenantId, dto);

      expect(result).toEqual({ id: 's1', ...dto });
      expect(repo.create).toHaveBeenCalledWith(tenantId, dto);
    });

    it('throws 409 PUR_SUPPLIER_CODE_DUPLICATE on pre-check hit', async () => {
      repo.findByCode.mockResolvedValue({ id: 'existing' });

      await expect(service.create(tenantId, dto)).rejects.toThrow(
        ConflictException,
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('converts a P2002 race on create into the same 409', async () => {
      repo.findByCode.mockResolvedValue(null);
      repo.create.mockRejectedValue(p2002());

      await expect(service.create(tenantId, dto)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.create(tenantId, dto)).rejects.toThrow(
        /PUR_SUPPLIER_CODE_DUPLICATE/,
      );
    });

    it('rethrows non-P2002 errors untouched', async () => {
      repo.findByCode.mockResolvedValue(null);
      repo.create.mockRejectedValue(new Error('db down'));

      await expect(service.create(tenantId, dto)).rejects.toThrow('db down');
    });
  });

  describe('update', () => {
    it('throws 404 when supplier not found', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        service.update(tenantId, 's1', { name: 'X' } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 409 when changing to an already-used code', async () => {
      repo.findById.mockResolvedValue({ id: 's1', code: 'OLD' });
      repo.findByCode.mockResolvedValue({ id: 's2', code: 'NEW' });

      await expect(
        service.update(tenantId, 's1', { code: 'NEW' } as any),
      ).rejects.toThrow(ConflictException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('converts a P2002 race on update into 409', async () => {
      repo.findById.mockResolvedValue({ id: 's1', code: 'OLD' });
      repo.findByCode.mockResolvedValue(null);
      repo.update.mockRejectedValue(p2002());

      await expect(
        service.update(tenantId, 's1', { code: 'NEW' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('updates when code unchanged', async () => {
      repo.findById.mockResolvedValue({ id: 's1', code: 'SUP-001' });
      repo.update.mockResolvedValue({ id: 's1', name: 'New name' });

      const result = await service.update(tenantId, 's1', {
        name: 'New name',
      });

      expect(result).toEqual({ id: 's1', name: 'New name' });
      expect(repo.findByCode).not.toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    it('sets isActive false', async () => {
      repo.findById.mockResolvedValue({ id: 's1' });
      await service.deactivate(tenantId, 's1');
      expect(repo.update).toHaveBeenCalledWith('s1', { isActive: false });
    });

    it('throws 404 when supplier missing', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.deactivate(tenantId, 's1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
