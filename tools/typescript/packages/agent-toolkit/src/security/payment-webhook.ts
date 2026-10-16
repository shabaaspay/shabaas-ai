import { createHmac, timingSafeEqual } from 'node:crypto';

export interface PaymentEvent {
  event_id: string;
  schema_version: 2;
  merchant_id: number;
  environment: string;
  state_version: number;
  [key: string]: unknown;
}

/** Verify original bytes BEFORE JSON middleware. Persist event_id + state_version
 * transactionally with business effects; this helper intentionally does not ACK. */
export function verifyPaymentWebhook(input: {
  rawBody: Buffer;
  signature: string;
  timestamp: string;
  eventId: string;
  keys: Readonly<Record<string, string>>;
  merchantId: number;
  environment: string;
  nowSeconds?: number;
}): PaymentEvent {
  if (!Buffer.isBuffer(input.rawBody) || input.rawBody.length > 1024 * 1024) throw new Error('Original webhook bytes required (maximum 1 MiB)');
  if (!/^\d{1,12}$/.test(input.timestamp)) throw new Error('Invalid webhook timestamp');
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(now) || Math.abs(now - Number(input.timestamp)) > 300) throw new Error('Webhook timestamp outside tolerance');
  if (typeof input.signature !== 'string' || input.signature.length > 2048) throw new Error('Invalid webhook signature');
  let valid = false;
  for (const entry of input.signature.split(';')) {
    const match = /^kid=([A-Za-z0-9_-]{1,128}),v1=([a-f0-9]{64})$/.exec(entry);
    if (!match || !Object.prototype.hasOwnProperty.call(input.keys, match[1])) continue;
    const secret = input.keys[match[1]];
    if (!secret || secret.length < 32) continue;
    const expected = createHmac('sha256', secret).update(input.timestamp + '.').update(input.rawBody).digest();
    valid = timingSafeEqual(expected, Buffer.from(match[2], 'hex')) || valid;
  }
  if (!valid) throw new Error('Webhook signature verification failed');
  const event = JSON.parse(input.rawBody.toString('utf8'));
  if (!event || event.schema_version !== 2 || typeof event.event_id !== 'string' || !event.event_id.startsWith('evt_') || event.event_id !== input.eventId || event.merchant_id !== input.merchantId || event.environment !== input.environment || !Number.isSafeInteger(event.state_version) || event.state_version < 1) {
    throw new Error('Webhook event identity or scope mismatch');
  }
  return event as PaymentEvent;
}
