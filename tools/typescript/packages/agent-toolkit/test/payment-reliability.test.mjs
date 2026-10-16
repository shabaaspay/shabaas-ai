import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyPaymentWebhook } from '../dist/security/payment-webhook.js';
import { ShabaasApiClient } from '../dist/api/client.js';
import { InitiatePaymentInputSchema } from '../dist/types/index.js';
import { createPaymentInitiationTools } from '../dist/tools/payment-initiations.js';
const config = { environment: 'sandbox', sandboxUrl: 'https://invalid.example', shabaasAuthUuid: '' };
const key = 'payment-invoice-4201-v1';
const payload = { payment_agreement_id: '1PA123', amount: '10.00', merchant_reference: 'invoice-4201' };
const secret = 'a'.repeat(64);
const body = Buffer.from(JSON.stringify({ event_id: 'evt_contract', schema_version: 2, merchant_id: 42, environment: 'test', state_version: 3 }));
const timestamp = '1791432045';
const signature = (bytes = body, ts = timestamp, kid = 'current', sec = secret) => `kid=${kid},v1=${createHmac('sha256', sec).update(ts + '.').update(bytes).digest('hex')}`;
const signed = (extra = {}) => ({ rawBody: body, signature: signature(), timestamp, eventId: 'evt_contract', keys: { current: secret }, merchantId: 42, environment: 'test', nowSeconds: Number(timestamp), ...extra });

test('signature verification works without Authorization and accepts either rotating key', () => {
  assert.equal(verifyPaymentWebhook(signed()).event_id, 'evt_contract');
  assert.equal(verifyPaymentWebhook(signed({ signature: signature(body, timestamp, 'new', 'b'.repeat(64)) + ';' + signature(), keys: { current: secret } })).state_version, 3);
});
for (const [name, extra] of [
  ['body tampering', { rawBody: Buffer.concat([body, Buffer.from(' ')]) }],
  ['stale timestamp', { nowSeconds: Number(timestamp) + 301 }],
  ['future timestamp', { nowSeconds: Number(timestamp) - 301 }],
  ['unknown signing key', { keys: { other: secret } }],
  ['wrong event ID', { eventId: 'evt_forged' }],
  ['cross-merchant event', { merchantId: 43 }],
  ['cross-environment event', { environment: 'production' }],
  ['parsed body', { rawBody: JSON.parse(body.toString()) }],
  ['malformed signature', { signature: 'kid=current,v1=00' }],
]) test(`rejects ${name}`, () => assert.throws(() => verifyPaymentWebhook(signed(extra))));

test('payment tool requires persisted identity and exact positive money', () => {
  assert.equal(InitiatePaymentInputSchema.safeParse(payload).success, false);
  for (const amount of ['0', '-1', '1.001', '1e2', 'Infinity', ' 10 ', Infinity]) {
    assert.equal(InitiatePaymentInputSchema.safeParse({ ...payload, idempotency_key: key, amount }).success, false);
  }
  assert.equal(InitiatePaymentInputSchema.safeParse({ ...payload, idempotency_key: key }).success, true);
});

test('key and business reference survive an authentication retry unchanged', async () => {
  const client = new ShabaasApiClient(config);
  client.getTokenForRequest = async () => 'Bearer test';
  const requests = [];
  client.client.defaults.adapter = async (request) => {
    requests.push(request);
    if (requests.length === 1) throw { response: { status: 401 } };
    return { status: 200, statusText: 'OK', headers: {}, config: request, data: { data: { status: 'accp' } } };
  };
  await client.initiatePayment(payload, { requestUuid: 'test-only-key', idempotencyKey: key });
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.headers.get('Idempotency-Key'), key);
    assert.equal(JSON.parse(request.data).payment_initiation.merchant_reference, payload.merchant_reference);
    assert.equal(JSON.parse(request.data).payment_initiation.amount, payload.amount);
  }
  assert.equal(requests[0].data, requests[1].data);
});

test('missing identity fails before any network request', async () => {
  const client = new ShabaasApiClient(config);
  client.getTokenForRequest = async () => { throw new Error('Network must not be called'); };
  await assert.rejects(client.initiatePayment(payload), /idempotency key/);
});

test('tools forward the key as a header option, never as payment data', async () => {
  const requests = [];
  const api = { initiatePayment: async (body, options) => { requests.push({ body, options }); return { data: { status: 'accp' } }; } };
  const tool = createPaymentInitiationTools(api, config).initiate_payment;
  const result = await tool.execute({ ...payload, idempotency_key: key, authorization: 'test-only', enrich: false }, { requestUuid: 'test-only' });
  assert.equal(result.success, true);
  assert.equal(requests[0].options.idempotencyKey, key);
  assert.equal(requests[0].body.merchant_reference, payload.merchant_reference);
  assert.equal(requests[0].body.idempotency_key, undefined);
  assert.equal(requests[0].body.authorization, undefined);
});
