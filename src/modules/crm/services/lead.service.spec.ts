import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { LeadService } from './lead.service.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { DocumentSequenceService } from '../../../infra/sequence/document-sequence.service.js';

const makePrisma = () => ({
  lead: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  $transaction: jest.fn(),
});

describe('LeadService.convert', () => {
  let service: LeadService;
  let prisma: ReturnType<typeof makePrisma>;
  const sequences = { getNextNumber: jest.fn().mockResolvedValue('CUS-2026-00001') };
  const tenantId = 't1';
  const userId = 'u1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadService,
        { provide: PrismaService, useFactory: makePrisma },
        { provide: DocumentSequenceService, useValue: sequences },
      ],
    }).compile();
    service = module.get(LeadService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
    sequences.getNextNumber.mockResolvedValue('CUS-2026-00001');
  });

  it('rejects converting a lead that is not qualified', async () => {
    const tx = {
      lead: { findFirst: jest.fn().mockResolvedValue({ id: 'l1', status: 'new' }) },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    await expect(service.convert(tenantId, userId, 'l1', {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('creates customer + opportunity and marks the lead won', async () => {
    const tx = {
      lead: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'l1', status: 'qualified', companyName: 'ACME', contactName: 'Jo',
          email: 'a@b.co', phone: '123', estimatedValue: '5000000', assignedTo: 'rep1', customerId: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      customer: { create: jest.fn().mockResolvedValue({ id: 'cust1' }) },
      pipelineStage: { findFirst: jest.fn().mockResolvedValue({ id: 'stage1' }) },
      opportunity: { create: jest.fn().mockImplementation((a: any) => ({ id: 'opp1', ...a.data })) },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    const res: any = await service.convert(tenantId, userId, 'l1', {});
    expect(tx.customer.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ code: 'CUS-2026-00001', name: 'ACME' }) }),
    );
    expect(tx.opportunity.create).toHaveBeenCalled();
    expect(tx.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'won', customerId: 'cust1' }) }),
    );
    expect(res.customerId).toBe('cust1');
  });

  it('conflicts when there is no pipeline stage to place the opportunity', async () => {
    const tx = {
      lead: { findFirst: jest.fn().mockResolvedValue({ id: 'l1', status: 'qualified', companyName: 'ACME', customerId: null }) },
      customer: { create: jest.fn().mockResolvedValue({ id: 'cust1' }) },
      pipelineStage: { findFirst: jest.fn().mockResolvedValue(null) },
      opportunity: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    await expect(service.convert(tenantId, userId, 'l1', {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('404s on an unknown lead', async () => {
    const tx = { lead: { findFirst: jest.fn().mockResolvedValue(null) } };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    await expect(service.convert(tenantId, userId, 'missing', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
