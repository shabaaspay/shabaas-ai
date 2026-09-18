import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { isIpRestricted } from '../dist/utils/ssrfSafeClient.js';
import {
  validateIntentToken,
  computeIntentHash,
  canonicalizeJson,
  InMemoryNonceStore,
  type IntentClaims
} from '../dist/security/intentValidator.js';
import { checkWritePermission } from '../dist/security/intent-guard.js';
import { createReadTools } from '../dist/tools/read-tools.js';
import { createWriteTools } from '../dist/tools/write-tools.js';
import { ShabaasApiClient } from '../dist/api/client.js';
import {
  redactSensitiveData,
  maskBsb,
  maskAccountNumber,
  maskPayId,
  enforceResponseSizeLimits,
  MAX_MCP_RESPONSE_BYTES
} from '../dist/utils/redactor.js';
import {
  InMemorySpendingLimitStore,
  type SpendingLimitStore
} from '../dist/security/spendingBudgetGuard.js';
import {
  validateAndApplyCors,
  STANDARD_SECURITY_HEADERS,
  SSE_SECURITY_HEADERS
} from '../dist/utils/securityHeaders.js';

describe('SSRF Protection (Egress Guardrails)', () => {
  test('rejects IPv4 loopback, link-local, and private IP ranges', () => {
    assert.equal(isIpRestricted('127.0.0.1').restricted, true);
    assert.equal(isIpRestricted('127.0.0.53').restricted, true);
    assert.equal(isIpRestricted('10.0.0.1').restricted, true);
    assert.equal(isIpRestricted('172.16.0.1').restricted, true);
    assert.equal(isIpRestricted('192.168.1.1').restricted, true);
    assert.equal(isIpRestricted('169.254.169.254').restricted, true); // Cloud Metadata
    assert.equal(isIpRestricted('100.64.0.1').restricted, true); // CGNAT
    assert.equal(isIpRestricted('0.0.0.0').restricted, true);
  });

  test('rejects IPv6 loopback, link-local, and mapped IPv4 addresses', () => {
    assert.equal(isIpRestricted('::1').restricted, true);
    assert.equal(isIpRestricted('::').restricted, true);
    assert.equal(isIpRestricted('fe80::1').restricted, true);
    assert.equal(isIpRestricted('fc00::1').restricted, true);
    assert.equal(isIpRestricted('::ffff:127.0.0.1').restricted, true);
    assert.equal(isIpRestricted('::ffff:169.254.169.254').restricted, true);
  });

  test('permits legitimate public IP addresses', () => {
    assert.equal(isIpRestricted('1.1.1.1').restricted, false);
    assert.equal(isIpRestricted('8.8.8.8').restricted, false);
    assert.equal(isIpRestricted('104.16.123.96').restricted, false);
    assert.equal(isIpRestricted('2606:4700:4700::1111').restricted, false);
  });
});

describe('Write-MCP Ed25519 Intent Gate & Atomic Nonces', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const exportedPublicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

  test('validates authentic Ed25519 token matching exact intent payload', async () => {
    const payload = { payment_agreement_id: 'pa_test_123', amount: 100 };
    const intentHash = computeIntentHash(payload);
    const now = Math.floor(Date.now() / 1000);
    const claims: IntentClaims = {
      iss: 'urn:shabaas:approval-service',
      aud: 'urn:shabaas:mcp:write',
      sub: 'merchant_abc',
      intent_hash: intentHash,
      nonce: crypto.randomUUID(),
      iat: now,
      exp: now + 120
    };

    const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signedData = Buffer.from(`${header}.${body}`);
    const signature = crypto.sign(undefined, signedData, privateKey).toString('base64url');
    const token = `${header}.${body}.${signature}`;

    const store = new InMemoryNonceStore();
    const result = await validateIntentToken(token, payload, {
      publicKey: exportedPublicKeyPem,
      nonceStore: store
    });

    assert.equal(result.valid, true);
    assert.equal(result.claims?.sub, 'merchant_abc');
  });

  test('rejects tampered transaction payload (intent hash mismatch)', async () => {
    const originalPayload = { payment_agreement_id: 'pa_test_123', amount: 100 };
    const tamperedPayload = { payment_agreement_id: 'pa_test_123', amount: 50000 };

    const intentHash = computeIntentHash(originalPayload);
    const now = Math.floor(Date.now() / 1000);
    const claims: IntentClaims = {
      iss: 'urn:shabaas:approval-service',
      aud: 'urn:shabaas:mcp:write',
      sub: 'merchant_abc',
      intent_hash: intentHash,
      nonce: crypto.randomUUID(),
      iat: now,
      exp: now + 120
    };

    const header = Buffer.from(JSON.stringify({ alg: 'EdDSA' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = crypto.sign(undefined, Buffer.from(`${header}.${body}`), privateKey).toString('base64url');
    const token = `${header}.${body}.${signature}`;

    const result = await validateIntentToken(token, tamperedPayload, {
      publicKey: exportedPublicKeyPem
    });

    assert.equal(result.valid, false);
    assert.equal(result.errorCode, 'INTENT_HASH_MISMATCH');
  });

  test('prevents replay attacks via atomic nonce consumption', async () => {
    const payload = { payment_agreement_id: 'pa_test_123', amount: 50 };
    const intentHash = computeIntentHash(payload);
    const now = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomUUID();

    const claims: IntentClaims = {
      iss: 'urn:shabaas:approval-service',
      aud: 'urn:shabaas:mcp:write',
      sub: 'merchant_abc',
      intent_hash: intentHash,
      nonce,
      iat: now,
      exp: now + 120
    };

    const header = Buffer.from(JSON.stringify({ alg: 'EdDSA' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = crypto.sign(undefined, Buffer.from(`${header}.${body}`), privateKey).toString('base64url');
    const token = `${header}.${body}.${signature}`;

    const store = new InMemoryNonceStore();

    const firstResult = await validateIntentToken(token, payload, {
      publicKey: exportedPublicKeyPem,
      nonceStore: store
    });
    assert.equal(firstResult.valid, true);

    const secondResult = await validateIntentToken(token, payload, {
      publicKey: exportedPublicKeyPem,
      nonceStore: store
    });
    assert.equal(secondResult.valid, false);
    assert.equal(secondResult.errorCode, 'NONCE_REPLAY_DETECTED');
  });
});

describe('Read-MCP: Redaction & Export Size Limits', () => {
  test('masks BSB, account numbers, PayIDs, and bearer tokens', () => {
    assert.equal(maskBsb('082902'), '***-***');
    assert.equal(maskAccountNumber('123456789'), '****789');
    assert.equal(maskPayId('contact@shabaas.com'), 'c***t@shabaas.com');
    assert.equal(maskPayId('0412345678'), '+61 4** *** 678');

    const sample = {
      bsb: '062-000',
      account_number: '987654321',
      pay_id: 'test@merchant.com',
      token: 'Bearer eyJhbGciOi...',
      nested: {
        api_key: 'shabaas_live_secret123',
        safe_field: 'public_agreement_title'
      }
    };

    const redacted = redactSensitiveData(sample);
    assert.equal(redacted.bsb, '***-***');
    assert.equal(redacted.account_number, '****321');
    assert.equal(redacted.pay_id, 't***t@merchant.com');
    assert.equal(redacted.token, 'Bearer [REDACTED]');
    assert.equal(redacted.nested.api_key, 'shabaas_[REDACTED]');
    assert.equal(redacted.nested.safe_field, 'public_agreement_title');
  });

  test('enforces 50KB payload boundary and truncates oversized responses', () => {
    const hugeArray = Array.from({ length: 1000 }, (_, i) => ({
      agreement_id: `pa_record_${i}`,
      name: `Customer Agreement Record #${i}`,
      description: 'Long descriptive agreement text designed to simulate large MCP reports'
    }));

    const result = enforceResponseSizeLimits({ agreements: hugeArray });
    assert.ok((result as any)._paginationNotice);
    assert.equal((result as any)._paginationNotice.truncated, true);
  });
});

describe('Read-MCP: Tenant-Bound Authorization (BOLA Prevention)', () => {
  const dummyConfig = {
    environment: 'sandbox' as const,
    shabaasAuthUuid: 'key_merchant_real123',
    sandboxUrl: 'https://dev-api.shabaas.com',
    productionUrl: 'https://api.shabaas.com',
    httpPort: 3001,
    httpHost: '0.0.0.0',
    mcpHttpApiKey: '',
    mcpStdioApiKey: '',
    allowedOrigins: ['*'],
    rateLimitPerMinute: 60,
    rateLimitPerHour: 1000,
    authTokenMaxAgeMinutes: 50,
    policyCacheTtlMs: 300_000
  };

  const apiClient = new ShabaasApiClient(dummyConfig);
  const readTools = createReadTools(apiClient, dummyConfig);

  test('rejects cross-tenant queries when model attempts to access a different merchant_id', async () => {
    const result = await readTools.get_payment_agreement.execute({
      payment_agreement_id: 'pa_test_001',
      merchant_id: 'merchant_victim_999' // Spoofed merchant ID
    });

    assert.equal(result.success, false);
    assert.equal(result.insights.status, 'unauthorized_tenant_access');
    assert.ok(result.summary.includes('Cross-tenant access forbidden'));
  });
});

describe('Write-MCP: Agent Spending Limits & Velocity Guard', () => {
  test('rejects single payment exceeding max transaction threshold', async () => {
    const store = new InMemorySpendingLimitStore({
      maxSingleTransactionAmount: 5000,
      dailyRollingBudget: 20000
    });

    const check = await store.checkAndRecordSpend('merch_1', 6000);
    assert.equal(check.allowed, false);
    assert.equal(check.errorCode, 'EXCEEDS_SINGLE_TRANSACTION_LIMIT');
  });

  test('tracks rolling spend and blocks transactions exceeding 24-hour budget', async () => {
    const store = new InMemorySpendingLimitStore({
      maxSingleTransactionAmount: 5000,
      dailyRollingBudget: 8000
    });

    const first = await store.checkAndRecordSpend('merch_1', 4000);
    assert.equal(first.allowed, true);
    assert.equal(first.remainingDailyBudget, 4000);

    const second = await store.checkAndRecordSpend('merch_1', 3500);
    assert.equal(second.allowed, true);
    assert.equal(second.remainingDailyBudget, 500);

    // Third attempt for $1000 exceeds the remaining $500 budget
    const third = await store.checkAndRecordSpend('merch_1', 1000);
    assert.equal(third.allowed, false);
    assert.equal(third.errorCode, 'EXCEEDS_DAILY_BUDGET');
    assert.equal(third.remainingDailyBudget, 500);
  });
});

describe('HTTP/SSE Edge Hardening & CORS', () => {
  test('strictly rejects unauthorized origins', () => {
    const allowed = ['https://dashboard.shabaas.com', 'https://mcp.shabaas.com'];

    const forbidden = validateAndApplyCors('https://malicious-attacker.com', allowed);
    assert.equal(forbidden.allowed, false);
    assert.ok(forbidden.reason?.includes('CORS policy violation'));

    const accepted = validateAndApplyCors('https://dashboard.shabaas.com', allowed);
    assert.equal(accepted.allowed, true);
  });

  test('verifies standard and SSE security headers', () => {
    assert.equal(STANDARD_SECURITY_HEADERS['X-Content-Type-Options'], 'nosniff');
    assert.equal(STANDARD_SECURITY_HEADERS['X-Frame-Options'], 'DENY');
    assert.ok(STANDARD_SECURITY_HEADERS['Content-Security-Policy'].includes("frame-ancestors 'none'"));
    assert.equal(SSE_SECURITY_HEADERS['Content-Type'], 'text/event-stream; charset=utf-8');
    assert.equal(SSE_SECURITY_HEADERS['X-Accel-Buffering'], 'no');
  });
});
