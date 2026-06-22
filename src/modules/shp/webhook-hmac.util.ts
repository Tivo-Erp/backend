import { createHmac, timingSafeEqual } from 'node:crypto';
import { TrackingWebhookDto } from './dto/shipment.dto.js';

/**
 * Canonical message signed by a carrier webhook. Deterministic and independent
 * of JSON key ordering/whitespace so the HMAC is stable regardless of how the
 * body was serialized: `carrierId.trackingNumber.status.eventTime`.
 */
export function webhookMessage(
  carrierId: string,
  dto: TrackingWebhookDto,
): string {
  return [carrierId, dto.trackingNumber, dto.status, dto.eventTime ?? ''].join(
    '.',
  );
}

/** Constant-time HMAC-SHA256 verification of a hex signature. */
export function verifyWebhookSignature(
  secret: string,
  message: string,
  signatureHex: string,
): boolean {
  if (!signatureHex) return false;
  const expected = createHmac('sha256', secret).update(message).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signatureHex, 'hex');
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
