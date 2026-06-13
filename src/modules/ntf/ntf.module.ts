import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import {
  NotificationController,
  NotificationPreferenceController,
} from './controllers/notification.controller.js';
import { NotificationService } from './services/notification.service.js';
import { NotificationGateway } from './gateways/notification.gateway.js';

@Module({
  imports: [AuthModule],
  controllers: [NotificationController, NotificationPreferenceController],
  providers: [NotificationService, NotificationGateway],
  exports: [NotificationService],
})
export class NtfModule {}
