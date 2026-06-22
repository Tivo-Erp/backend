process.env.PII_ENCRYPTION_KEY ||= 'test-pii-key-1234567890';

import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { CarrierService } from './carrier.service.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { PiiCrypto } from '../../../common/utils/pii-crypto.js';

const makePrisma = () => ({
  carrier: {
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  shipment: { count: jest.fn() },
});

describe('CarrierService', () => {
  let service: CarrierService;
  let prisma: ReturnType<typeof makePrisma>;
  const tenantId = 't1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CarrierService,
        { provide: PrismaService, useFactory: makePrisma },
      ],
    }).compile();
    service = module.get(CarrierService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  it('encrypts the apiKey before persisting (never stores plaintext)', async () => {
    prisma.carrier.create.mockImplementation((a: any) => ({
      id: 'c1',
      ...a.data,
    }));
    await service.create(tenantId, {
      code: 'GHN',
      name: 'Giao Hàng Nhanh',
      apiKey: 'super-secret',
    });
    const data = prisma.carrier.create.mock.calls[0][0].data;
    expect(data.apiKeyEncrypted).toBeTruthy();
    expect(data.apiKeyEncrypted).not.toContain('super-secret');
    expect(PiiCrypto.decrypt(data.apiKeyEncrypted)).toBe('super-secret');
  });

  it('maps a duplicate code to 409', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'x',
    });
    prisma.carrier.create.mockRejectedValue(err);
    await expect(
      service.create(tenantId, { code: 'GHN', name: 'X' } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to delete a carrier with active shipments', async () => {
    prisma.carrier.findFirst.mockResolvedValue({ id: 'c1' });
    prisma.shipment.count.mockResolvedValueOnce(2); // active shipments
    await expect(service.remove(tenantId, 'c1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('deactivates (not hard-deletes) a carrier with only historical shipments', async () => {
    prisma.carrier.findFirst.mockResolvedValue({ id: 'c1' });
    prisma.shipment.count
      .mockResolvedValueOnce(0) // no active
      .mockResolvedValueOnce(3); // but has historical
    prisma.carrier.update.mockResolvedValue({});
    const res = await service.remove(tenantId, 'c1');
    expect(res).toEqual({ id: 'c1', deactivated: true });
    expect(prisma.carrier.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
    expect(prisma.carrier.delete).not.toHaveBeenCalled();
  });

  it('hard-deletes a carrier with no shipments at all', async () => {
    prisma.carrier.findFirst.mockResolvedValue({ id: 'c1' });
    prisma.shipment.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    prisma.carrier.delete.mockResolvedValue({});
    const res = await service.remove(tenantId, 'c1');
    expect(res).toEqual({ id: 'c1', deleted: true });
  });
});
