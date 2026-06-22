import { createHmac } from 'node:crypto';
import { verifyWebhookSignature, webhookMessage } from './webhook-hmac.util.js';

const sign = (secret: string, msg: string) =>
  createHmac('sha256', secret).update(msg).digest('hex');

describe('webhook-hmac util', () => {
  const carrierId = 'c1';
  const dto = {
    trackingNumber: 'MOCK-SHP-1',
    status: 'delivered',
    eventTime: '2026-06-13T10:00:00Z',
  } as any;

  it('builds a deterministic canonical message', () => {
    expect(webhookMessage(carrierId, dto)).toBe(
      'c1.MOCK-SHP-1.delivered.2026-06-13T10:00:00Z',
    );
  });

  it('accepts a correct signature', () => {
    const msg = webhookMessage(carrierId, dto);
    const sig = sign('secret', msg);
    expect(verifyWebhookSignature('secret', msg, sig)).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const msg = webhookMessage(carrierId, dto);
    const sig = sign('secret', msg);
    const tampered = webhookMessage(carrierId, { ...dto, status: 'failed' });
    expect(verifyWebhookSignature('secret', tampered, sig)).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const msg = webhookMessage(carrierId, dto);
    expect(verifyWebhookSignature('other', msg, sign('secret', msg))).toBe(
      false,
    );
  });

  it('rejects empty / malformed signatures without throwing', () => {
    const msg = webhookMessage(carrierId, dto);
    expect(verifyWebhookSignature('secret', msg, '')).toBe(false);
    expect(verifyWebhookSignature('secret', msg, 'zzzz')).toBe(false);
  });
});
