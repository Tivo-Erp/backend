import { forwardRef, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as fs from 'node:fs';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Server, Socket } from 'socket.io';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface.js';
import { NotificationService } from '../services/notification.service.js';

/** Identity stashed on a socket after a successful handshake verification. */
interface AuthedSocketData {
  userId?: string;
  tenantId?: string;
}

/** A connected socket carrying our verified auth identity in `data`. */
type AuthedSocket = Socket<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  AuthedSocketData
>;

/**
 * Socket.IO gateway for realtime notifications (ADR-014).
 *
 * Auth: clients pass their JWT via `auth.token` (or `Authorization` header) on
 * the handshake; it is verified with the RS256 public key. Each socket joins a
 * tenant-scoped per-user room `t:<tenantId>:u:<userId>` so a leaked userId from
 * one tenant cannot be addressed from another.
 *
 * Horizontal scale: when `REDIS_URL` is set the server attaches the
 * `@socket.io/redis-adapter` so emits fan out across instances. Without Redis
 * it runs single-instance (dev / single pod) — emits still work locally.
 */
// Same CORS posture as the HTTP API (main.ts): explicit origins via
// CORS_ORIGINS, otherwise cross-origin only outside production.
@WebSocketGateway({
  namespace: '/ntf',
  cors: {
    origin: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
      : process.env.NODE_ENV !== 'production',
  },
})
export class NotificationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  // This gateway declares a namespace, so the injected value is the Namespace
  // (not the root Server). Emits/rooms work on it directly; the Redis adapter,
  // however, must be attached to the root io Server (`namespace.server`).
  @WebSocketServer() private server!: Namespace;
  private readonly logger = new Logger(NotificationGateway.name);
  private readonly publicKey: Buffer;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(forwardRef(() => NotificationService))
    private readonly notifications: NotificationService,
  ) {
    const path = this.config.get<string>(
      'app.jwtPublicKeyPath',
      './keys/public.pem',
    );
    this.publicKey = fs.readFileSync(path);
  }

  async afterInit(server: Namespace | Server) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      this.logger.warn(
        'REDIS_URL not set — notification gateway runs single-instance (no cross-pod fan-out).',
      );
      return;
    }
    // afterInit receives the Namespace for a namespaced gateway; the adapter
    // setter lives on the root Server, reachable via `namespace.server`.
    const io: Server = (server as Namespace).server ?? (server as Server);
    try {
      const { createAdapter } = await import('@socket.io/redis-adapter');
      const { Redis } = await import('ioredis');
      const pub = new Redis(redisUrl);
      const sub = pub.duplicate();
      io.adapter(createAdapter(pub, sub));
      this.logger.log('Notification gateway attached to Redis adapter.');
    } catch (err) {
      this.logger.error(
        `Failed to attach Redis adapter, falling back to in-memory: ${String(err)}`,
      );
    }
  }

  handleConnection(client: AuthedSocket) {
    try {
      const token = this.extractToken(client);
      const payload = this.jwt.verify<JwtPayload>(token, {
        publicKey: this.publicKey,
        algorithms: ['RS256'],
      });
      client.data.userId = payload.sub;
      client.data.tenantId = payload.tenantId;
      void client.join(this.room(payload.tenantId, payload.sub));
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect() {
    // rooms are cleaned up automatically by socket.io on disconnect
  }

  /**
   * client → server: mark a notification read. Identity comes exclusively from
   * the verified handshake token (`client.data`), never from the payload, and
   * `markRead` enforces ownership server-side.
   */
  @SubscribeMessage('notification:read')
  async onNotificationRead(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { id?: string },
  ) {
    const userId = client.data.userId;
    const tenantId = client.data.tenantId;
    if (!userId || !tenantId || typeof body?.id !== 'string') {
      return { success: false };
    }
    try {
      return await this.notifications.markRead(tenantId, userId, body.id);
    } catch {
      return { success: false };
    }
  }

  /** server → client: a new notification arrived. */
  emitNew(tenantId: string, userId: string, notification: unknown) {
    this.server
      ?.to(this.room(tenantId, userId))
      .emit('notification:new', notification);
  }

  /** server → client: unread badge count changed. */
  emitBadge(tenantId: string, userId: string, unreadCount: number) {
    this.server
      ?.to(this.room(tenantId, userId))
      .emit('notification:badge', { unreadCount });
  }

  private room(tenantId: string, userId: string): string {
    return `t:${tenantId}:u:${userId}`;
  }

  private extractToken(client: AuthedSocket): string {
    const fromAuth = (client.handshake.auth as { token?: string })?.token;
    if (fromAuth) return fromAuth.replace(/^Bearer\s+/i, '');
    const header = client.handshake.headers['authorization'];
    if (typeof header === 'string') return header.replace(/^Bearer\s+/i, '');
    throw new Error('NTF_WS_NO_TOKEN');
  }
}
