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
    const payload = {
      payment_agreement_id: 'pa_test_123',
      amount: 100
    };
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

    // First attempt succeeds
    const firstResult = await validateIntentToken(token, payload, {
      publicKey: exportedPublicKeyPem,
      nonceStore: store
    });
    assert.equal(firstResult.valid, true);

    // Immediate second attempt with identical nonce must fail
    const secondResult = await validateIntentToken(token, payload, {
      publicKey: exportedPublicKeyPem,
      nonceStore: store
    });
    assert.equal(secondResult.valid, false);
    assert.equal(secondResult.errorCode, 'NONCE_REPLAY_DETECTED');
  });
});

describe('MCP Service Separation & Tool Isolation', () => {
  const dummyConfig = {
    environment: 'sandbox' as const,
    shabaasAuthUuid: 'test_key',
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

  test('Read tools module exposes only queries and search', () => {
    const readTools = createReadTools(apiClient, dummyConfig);
    const toolNames = Object.keys(readTools);
    assert.ok(toolNames.includes('get_auth_token'));
    assert.ok(toolNames.includes('get_payment_agreement'));
    assert.ok(toolNames.includes('get_payment_initiation'));
    assert.ok(!toolNames.includes('initiate_payment'));
    assert.ok(!toolNames.includes('create_payment_agreement'));
  });

  test('Write tools module exposes only state mutations', () => {
    const writeTools = createWriteTools(apiClient, dummyConfig);
    const toolNames = Object.keys(writeTools);
    assert.ok(toolNames.includes('initiate_payment'));
    assert.ok(toolNames.includes('create_payment_agreement'));
    assert.ok(!toolNames.includes('get_auth_token'));
    assert.ok(!toolNames.includes('get_payment_agreement'));
  });

  test('Production write tools block unverified invocations by default', () => {
    const prodConfig = { ...dummyConfig, environment: 'production' as const };
    const check = checkWritePermission(prodConfig, 'initiate_payment', {});
    assert.equal(check.allowed, false);
    assert.equal(check.errorCode, 'INTENT_TOKEN_REQUIRED');
  });

  test('Read-only mode blocks write tools unconditionally', () => {
    const readOnlyConfig = { ...dummyConfig, readOnly: true };
    const check = checkWritePermission(readOnlyConfig, 'create_payment_agreement', {
      intent_token: 'valid_looking_token_12345'
    });
    assert.equal(check.allowed, false);
    assert.equal(check.errorCode, 'READ_ONLY_MODE');
  });
});
