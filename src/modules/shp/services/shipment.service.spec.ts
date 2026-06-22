process.env.PII_ENCRYPTION_KEY ||= 'test-pii-key-1234567890';

import { Test, TestingModule } from '@nestjs/testing';
import { ShipmentService } from './shipment.service.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { DocumentSequenceService } from '../../../infra/sequence/document-sequence.service.js';
import { StorageService } from '../../../infra/storage/storage.service.js';
import { CacheService } from '../../../infra/cache/cache.service.js';
import { OutboxService } from '../../../infra/events/outbox.service.js';
import { CarrierAdapterFactory } from '../adapters/carrier-adapter.factory.js';
import { DeliveryNoteService } from '../../del/services/delivery-note.service.js';

const makePrisma = () => ({
  shipment: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
  },
  trackingEvent: { create: jest.fn() },
  carrier: { findFirst: jest.fn(), findUnique: jest.fn() },
  $transaction: jest.fn(),
});

describe('ShipmentService.applyTrackingUpdate', () => {
  let service: ShipmentService;
  let prisma: ReturnType<typeof makePrisma>;
  const deliveryNotes = {
    completeFromShipment: jest.fn(),
    failFromShipment: jest.fn(),
  };
  const outbox = { record: jest.fn() };
  const tenantId = 't1';
  const carrierId = 'c1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShipmentService,
        { provide: PrismaService, useFactory: makePrisma },
        {
          provide: DocumentSequenceService,
          useValue: { getNextNumber: jest.fn() },
        },
        { provide: StorageService, useValue: { configured: false } },
        { provide: CacheService, useValue: {} },
        { provide: OutboxService, useValue: outbox },
        { provide: CarrierAdapterFactory, useValue: { forCode: jest.fn() } },
        { provide: DeliveryNoteService, useValue: deliveryNotes },
      ],
    }).compile();
    service = module.get(ShipmentService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  it('advances status on a forward update and completes the DN when delivered', async () => {
    const tx = {
      shipment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 's1',
          dnId: 'dn1',
          status: 'out_for_delivery',
          trackingNumber: 'TN-1',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      trackingEvent: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    const res = await service.applyTrackingUpdate(tenantId, carrierId, {
      trackingNumber: 'TN-1',
      status: 'delivered',
    });

    expect(res).toEqual({ accepted: true, status: 'delivered' });
    expect(tx.shipment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1', status: 'out_for_delivery' },
        data: expect.objectContaining({ status: 'delivered' }),
      }),
    );
    expect(outbox.record).toHaveBeenCalled();
    expect(deliveryNotes.completeFromShipment).toHaveBeenCalledWith(
      tenantId,
      'dn1',
    );
  });

  it('records the event but does not regress status on an out-of-order update', async () => {
    const tx = {
      shipment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 's1',
          dnId: 'dn1',
          status: 'delivered',
          trackingNumber: 'TN-1',
        }),
        updateMany: jest.fn(),
      },
      trackingEvent: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    const res = await service.applyTrackingUpdate(tenantId, carrierId, {
      trackingNumber: 'TN-1',
      status: 'in_transit',
    });

    expect(tx.trackingEvent.create).toHaveBeenCalled();
    expect(tx.shipment.updateMany).not.toHaveBeenCalled();
    expect(deliveryNotes.completeFromShipment).not.toHaveBeenCalled();
    expect(res.status).toBe('delivered');
  });

  it('ignores an unmapped carrier status (no transition, no DN sync)', async () => {
    prisma.shipment.findFirst.mockResolvedValue({
      id: 's1',
      status: 'in_transit',
    });
    prisma.trackingEvent.create.mockResolvedValue({});
    const res = await service.applyTrackingUpdate(tenantId, carrierId, {
      trackingNumber: 'TN-1',
      status: 'teleported',
    });
    expect(res.accepted).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
