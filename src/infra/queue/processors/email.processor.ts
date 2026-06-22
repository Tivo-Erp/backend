import { Injectable, Logger } from '@nestjs/common';
import { EmailService, EmailJobData } from '../../email/email.service.js';

/**
 * Worker-side handler for the email queue (INF-001 + INF-005). Throws on
 * delivery failure so BullMQ's attempts/backoff actually retry the job.
 */
@Injectable()
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly email: EmailService) {}

  async handle(data: EmailJobData): Promise<void> {
    try {
      await this.email.sendOrThrow(data);
    } catch (err) {
      this.logger.warn(
        `email to ${data.to} (${data.template}) failed — will retry: ${(err as Error).message}`,
      );
      throw err;
    }
  }
}
