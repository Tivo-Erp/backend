import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CustomerService } from './customer.service.js';
import { CustomerRepository } from '../repositories/customer.repository.js';

describe('CustomerService', () => {
  let service: CustomerService;
  const repo = {
    findByCode: jest.fn(),
    create: jest.fn(),
    findAll: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
  };

  const tenantId = 'tenant-uuid';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        { provide: CustomerRepository, useValue: repo },
      ],
    }).compile();

    service = module.get(CustomerService);
    jest.clearAllMocks();
  });

  it('create throws 409 SAL_CUSTOMER_CODE_DUPLICATE on duplicate code', async () => {
    repo.findByCode.mockResolvedValue({ id: 'c1', code: 'CUST01' });

    await expect(
      service.create(tenantId, { code: 'CUST01', name: 'Acme' }),
    ).rejects.toThrow(ConflictException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('create delegates to the repository when code is free', async () => {
    repo.findByCode.mockResolvedValue(null);
    repo.create.mockResolvedValue({ id: 'c1', code: 'CUST01' });

    await service.create(tenantId, { code: 'CUST01', name: 'Acme' });

    expect(repo.create).toHaveBeenCalledWith(tenantId, {
      code: 'CUST01',
      name: 'Acme',
    });
  });

  it('update is tenant-scoped: repo.update receives tenantId', async () => {
    repo.findById.mockResolvedValue({ id: 'c1', code: 'CUST01' });

    await service.update(tenantId, 'c1', { name: 'New Name' });

    expect(repo.update).toHaveBeenCalledWith(tenantId, 'c1', {
      name: 'New Name',
    });
  });

  it('update throws 409 when changing to a code owned by another customer', async () => {
    repo.findById.mockResolvedValue({ id: 'c1', code: 'CUST01' });
    repo.findByCode.mockResolvedValue({ id: 'c2', code: 'CUST02' });

    await expect(
      service.update(tenantId, 'c1', { code: 'CUST02' }),
    ).rejects.toThrow(ConflictException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('update throws 404 when customer is not in the tenant', async () => {
    repo.findById.mockResolvedValue(null);

    await expect(service.update(tenantId, 'c1', { name: 'X' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('deactivate is tenant-scoped and sets isActive false', async () => {
    repo.findById.mockResolvedValue({ id: 'c1' });

    await service.deactivate(tenantId, 'c1');

    expect(repo.update).toHaveBeenCalledWith(tenantId, 'c1', {
      isActive: false,
    });
  });

  it('findOne throws 404 when not found', async () => {
    repo.findById.mockResolvedValue(null);

    await expect(
      service.findOne(tenantId, 'c1', ['admin'], undefined),
    ).rejects.toThrow(NotFoundException);
  });
});
