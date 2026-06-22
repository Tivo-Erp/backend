import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobProducer } from '../queue/job-producer.service.js';
import { QUEUE_EMAIL, JOB } from '../queue/queue.constants.js';
import { EmailTemplate, renderTemplate } from './email.templates.js';

export interface EmailJobData {
  to: string;
  template: EmailTemplate;
  data: Record<string, any>;
}

/**
 * INF-005 — transactional email via Resend's HTTP API (no SDK dependency; uses
 * global fetch). Optional-safe: with no `RESEND_API_KEY` it logs the rendered
 * email instead of sending (dev mode), so flows like password-reset still work
 * end-to-end locally.
 *
 * Callers should prefer {@link enqueue} so delivery happens on the BullMQ email
 * queue (background + retry). {@link send} performs the actual HTTP call and is
 * what the email worker invokes.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly apiKey: string;
  private readonly from: string;

  constructor(
    config: ConfigService,
    private readonly producer: JobProducer,
  ) {
    this.apiKey = config.get<string>('app.resendApiKey', '');
    this.from = config.get<string>(
      'app.emailFrom',
      'ERP <no-reply@example.com>',
    );
  }

  /** Queue an email for background delivery. Falls back to direct send if the
   * queue is disabled (Redis off) so the message is not silently dropped. */
  async enqueue(job: EmailJobData): Promise<void> {
    const id = await this.producer.enqueue(QUEUE_EMAIL, JOB.EMAIL_SEND, {
      ...job,
    });
    if (!id) await this.send(job);
  }

  /** Render + deliver one email. Never throws to the caller. */
  async send(job: EmailJobData): Promise<boolean> {
    try {
      return await this.deliver(job);
    } catch (err) {
      this.logger.error(`Resend send error: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Render + deliver one email, THROWING on delivery failure so queue workers
   * (BullMQ attempts/backoff) can retry. Dev mode (no API key) is not an
   * error — it logs and resolves so jobs don't retry pointlessly.
   */
  async sendOrThrow(job: EmailJobData): Promise<void> {
    // deliver() returns false only in dev mode (no API key) — treat as done.
    await this.deliver(job);
  }

  /**
   * Actual render + HTTP call. Returns false when sending is disabled (dev
   * mode without RESEND_API_KEY); throws on any delivery failure.
   */
  private async deliver(job: EmailJobData): Promise<boolean> {
    const rendered = renderTemplate(job.template, job.data);

    if (!this.apiKey) {
      this.logger.log(
        `[email:dev] to=${job.to} subject="${rendered.subject}" (RESEND_API_KEY unset — not sent)`,
      );
      return false;
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: job.to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Resend send failed (${res.status}): ${detail}`);
    }
    return true;
  }
}
