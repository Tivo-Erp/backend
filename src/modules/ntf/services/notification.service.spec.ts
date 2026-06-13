import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from './notification.service.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { NotificationGateway } from '../gateways/notification.gateway.js';

const makePrisma = () => ({
  notification: {
    create: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    updateMany: jest.fn(),
    findFirst: jest.fn(),
  },
  notificationPreference: { findFirst: jest.fn() },
});

describe('NotificationService', () => {
  let service: NotificationService;
  let prisma: ReturnType<typeof makePrisma>;
  const gateway = { emitNew: jest.fn(), emitBadge: jest.fn() };
  const tenantId = 't1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: PrismaService, useFactory: makePrisma },
        { provide: NotificationGateway, useValue: gateway },
      ],
    }).compile();
    service = module.get(NotificationService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
    prisma.notification.count.mockResolvedValue(0);
  });

  describe('create', () => {
    it('persists and emits when no preference blocks the category', async () => {
      prisma.notificationPreference.findFirst.mockResolvedValue(null);
      prisma.notification.create.mockResolvedValue({ id: 'n1', userId: 'u1' });
      const res = await service.create(tenantId, {
        userId: 'u1', title: 'Hi', category: 'info',
      } as any);
      expect(res).toEqual({ id: 'n1', userId: 'u1' });
      expect(gateway.emitNew).toHaveBeenCalledWith(tenantId, 'u1', { id: 'n1', userId: 'u1' });
    });

    it('suppresses delivery when the user disabled the category in-app', async () => {
      prisma.notificationPreference.findFirst.mockResolvedValue({ inAppEnabled: false });
      const res = await service.create(tenantId, {
        userId: 'u1', title: 'Hi', category: 'info',
      } as any);
      expect(res).toBeNull();
      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(gateway.emitNew).not.toHaveBeenCalled();
    });
  });

  describe('markRead', () => {
    it('flips an unread notification and pushes a fresh badge', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 1 });
      const res = await service.markRead(tenantId, 'u1', 'n1');
      expect(res).toEqual({ success: true });
      expect(prisma.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'n1', tenantId, userId: 'u1', isRead: false },
        }),
      );
    });

    it('is idempotent when already read (exists but count 0)', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });
      prisma.notification.findFirst.mockResolvedValue({ id: 'n1' });
      await expect(service.markRead(tenantId, 'u1', 'n1')).resolves.toEqual({
        success: true,
      });
    });

    it('404s when the notification does not belong to the user', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });
      prisma.notification.findFirst.mockResolvedValue(null);
      await expect(service.markRead(tenantId, 'u1', 'n1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
