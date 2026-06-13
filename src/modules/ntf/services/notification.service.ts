import {
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { NOTIFICATION_FIELD_CONFIG } from '../config/notification.field-config.js';
import { NotificationGateway } from '../gateways/notification.gateway.js';
import {
  CreateNotificationDto,
  NotificationQueryDto,
  UpdatePreferenceDto,
} from '../dto/notification.dto.js';

/** Minimal Prisma surface accepted by `create` (PrismaService or a tx client). */
type PrismaLike = Pick<PrismaService, 'notification' | 'notificationPreference'>;

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => NotificationGateway))
    private readonly gateway: NotificationGateway,
  ) {}

  /**
   * Persist a notification and push it over the websocket. Respects the user's
   * in-app preference for the category (defaults to enabled when unset).
   *
   * Callable from other modules (workflow, leave approval, …). Pass a tx client
   * to make the row part of a surrounding transaction; the websocket emit always
   * fires after the row is written (best-effort, never throws to the caller).
   */
  async create(
    tenantId: string,
    dto: CreateNotificationDto,
    client?: PrismaLike,
  ) {
    const db = client ?? this.prisma;

    const pref = await db.notificationPreference.findFirst({
      where: { tenantId, userId: dto.userId, category: dto.category },
      select: { inAppEnabled: true },
    });
    if (pref && !pref.inAppEnabled) return null;

    const notification = await db.notification.create({
      data: {
        tenantId,
        userId: dto.userId,
        title: dto.title,
        body: dto.body ?? null,
        category: dto.category,
        entityType: dto.entityType ?? null,
        entityId: dto.entityId ?? null,
        actionUrl: dto.actionUrl ?? null,
      },
    });

    // Best-effort realtime push — failure must not abort the business flow.
    // The badge count reads via the SAME client so a tx caller sees its row.
    try {
      this.gateway.emitNew(tenantId, dto.userId, notification);
      const unread = await db.notification.count({
        where: { tenantId, userId: dto.userId, isRead: false },
      });
      this.gateway.emitBadge(tenantId, dto.userId, unread);
    } catch {
      /* ignore transport errors */
    }

    return notification;
  }

  async findMine(
    tenantId: string,
    userId: string,
    query: NotificationQueryDto,
    userRoles: string[],
  ) {
    const select = FieldSelector.buildPrismaSelect(
      query.fields,
      userRoles,
      NOTIFICATION_FIELD_CONFIG,
    );
    const { page = 1, limit = 20, category, isRead } = query;

    const where = {
      tenantId,
      userId,
      ...(category && { category }),
      ...(isRead !== undefined && { isRead }),
    };

    const [data, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        select,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: { tenantId, userId, isRead: false },
      }),
    ]);

    const result = PaginatedResponseDto.create(data, total, page, limit);
    return { ...result, unreadCount };
  }

  async markRead(tenantId: string, userId: string, id: string) {
    // Guarded by userId so users can only flip their own notifications.
    const { count } = await this.prisma.notification.updateMany({
      where: { id, tenantId, userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    if (count === 0) {
      const exists = await this.prisma.notification.findFirst({
        where: { id, tenantId, userId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('NTF_NOTIFICATION_NOT_FOUND');
    }
    this.pushBadge(tenantId, userId);
    return { success: true };
  }

  async markAllRead(tenantId: string, userId: string) {
    const { count } = await this.prisma.notification.updateMany({
      where: { tenantId, userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    this.pushBadge(tenantId, userId);
    return { success: true, marked: count };
  }

  // ── Preferences ───────────────────────────────────────────────

  async getPreferences(tenantId: string, userId: string) {
    return this.prisma.notificationPreference.findMany({
      where: { tenantId, userId },
      orderBy: { category: 'asc' },
    });
  }

  async upsertPreference(
    tenantId: string,
    userId: string,
    dto: UpdatePreferenceDto,
  ) {
    return this.prisma.notificationPreference.upsert({
      where: {
        tenantId_userId_category: {
          tenantId,
          userId,
          category: dto.category,
        },
      },
      update: {
        ...(dto.inAppEnabled !== undefined && { inAppEnabled: dto.inAppEnabled }),
        ...(dto.emailEnabled !== undefined && { emailEnabled: dto.emailEnabled }),
      },
      create: {
        tenantId,
        userId,
        category: dto.category,
        inAppEnabled: dto.inAppEnabled ?? true,
        emailEnabled: dto.emailEnabled ?? false,
      },
    });
  }

  private pushBadge(tenantId: string, userId: string) {
    void this.prisma.notification
      .count({ where: { tenantId, userId, isRead: false } })
      .then((unread) => this.gateway.emitBadge(tenantId, userId, unread))
      .catch(() => undefined);
  }
}
