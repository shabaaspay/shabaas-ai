import crypto from 'node:crypto';

export interface IntentClaims {
  iss: string; // Issuer, e.g. "urn:shabaas:approval-service"
  aud: string; // Audience, e.g. "urn:shabaas:mcp:write"
  sub: string; // Merchant ID or authorized user identity
  intent_hash: string; // SHA-256 hash of canonicalized transaction payload
  nonce: string; // One-time cryptographically random nonce
  iat: number; // Issued at timestamp (seconds since epoch)
  exp: number; // Expiration timestamp (seconds since epoch)
  action?: string; // e.g. "initiate_payment" or "create_payment_agreement"
}

export interface NonceStore {
  /**
   * Atomically consumes a nonce, transitioning state from UNUSED to CONSUMED.
   * Returns true if successfully consumed, false if already consumed or invalid.
   */
  consumeNonce(
    nonce: string,
    intentHash: string,
    merchantId: string,
    expiresAt: Date
  ): Promise<{ consumed: boolean; reason?: string }>;
}

/**
 * In-memory reference implementation of NonceStore with atomic check-and-set
 * and automatic cleanup of expired nonces. Suitable for single-instance / local testing.
 * 
 * Production PostgreSQL Equivalent:
 * UPDATE mcp_intent_nonces
 * SET status = 'CONSUMED', consumed_at = NOW()
 * WHERE nonce_id = :nonce AND status = 'UNUSED' AND expires_at > NOW();
 */
export class InMemoryNonceStore implements NonceStore {
  private readonly consumed = new Map<string, { intentHash: string; merchantId: string; expiresAt: Date }>();

  async consumeNonce(
    nonce: string,
    intentHash: string,
    merchantId: string,
    expiresAt: Date
  ): Promise<{ consumed: boolean; reason?: string }> {
    this.purgeExpired();

    if (this.consumed.has(nonce)) {
      return { consumed: false, reason: `Nonce "${nonce}" has already been consumed (replay attempt detected).` };
    }

    if (expiresAt.getTime() < Date.now()) {
      return { consumed: false, reason: `Nonce "${nonce}" is already expired.` };
    }

    this.consumed.set(nonce, { intentHash, merchantId, expiresAt });
    return { consumed: true };
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [nonce, data] of this.consumed.entries()) {
      if (data.expiresAt.getTime() < now) {
        this.consumed.delete(nonce);
      }
    }
  }

  clear(): void {
    this.consumed.clear();
  }
}

/**
 * Default global in-memory nonce store instance (can be overridden with database store)
 */
export const defaultNonceStore = new InMemoryNonceStore();

export interface IntentValidatorOptions {
  publicKey?: string | crypto.KeyObject; // Ed25519 public key (PEM or KeyObject)
  expectedIssuer?: string; // Default: 'urn:shabaas:approval-service'
  expectedAudience?: string; // Default: 'urn:shabaas:mcp:write'
  maxAgeSeconds?: number; // Default: 300 (5 minutes)
  nonceStore?: NonceStore;
  clockSkewSeconds?: number; // Default: 10 seconds
}

export type ValidationResult = {
  valid: boolean;
  claims?: IntentClaims;
  error?: string;
  errorCode?:
    | 'TOKEN_MISSING'
    | 'TOKEN_MALFORMED'
    | 'SIGNATURE_INVALID'
    | 'ISSUER_MISMATCH'
    | 'AUDIENCE_MISMATCH'
    | 'TOKEN_EXPIRED'
    | 'TOKEN_TOO_OLD'
    | 'INTENT_HASH_MISMATCH'
    | 'NONCE_REPLAY_DETECTED'
    | 'INTERNAL_ERROR';
};

/**
 * Deterministically canonicalizes an object to JSON for consistent hashing.
 * Sorts object keys recursively and strips undefined fields.
 */
export function canonicalizeJson(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map((item) => canonicalizeJson(item)).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys
    .filter((k) => obj[k] !== undefined && k !== 'intent_token' && k !== 'authorization')
    .map((k) => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`);
  return '{' + pairs.join(',') + '}';
}

/**
 * Computes SHA-256 digest of canonicalized transaction payload.
 */
export function computeIntentHash(payload: any): string {
  const canonical = canonicalizeJson(payload);
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Validates an Ed25519-signed Intent Token against transaction payload and security boundaries.
 */
export async function validateIntentToken(
  tokenString: string | undefined,
  transactionPayload: any,
  options: IntentValidatorOptions = {}
): Promise<ValidationResult> {
  if (!tokenString || tokenString.trim() === '') {
    return {
      valid: false,
      errorCode: 'TOKEN_MISSING',
      error: 'Missing mandatory intent_token for write operation.'
    };
  }

  const expectedIssuer = options.expectedIssuer ?? 'urn:shabaas:approval-service';
  const expectedAudience = options.expectedAudience ?? 'urn:shabaas:mcp:write';
  const maxAgeSeconds = options.maxAgeSeconds ?? 300; // Maximum 5 minutes
  const clockSkew = options.clockSkewSeconds ?? 10;
  const nonceStore = options.nonceStore ?? defaultNonceStore;

  try {
    let claims: IntentClaims;
    let signatureBuffer: Buffer;
    let signedContent: Buffer;

    // Support standard 3-part compact JWT format: <header>.<payload>.<sig>
    if (tokenString.includes('.')) {
      const parts = tokenString.split('.');
      if (parts.length !== 3) {
        return {
          valid: false,
          errorCode: 'TOKEN_MALFORMED',
          error: 'Intent token must be a valid 3-part compact token (<header>.<payload>.<signature>).'
        };
      }

      const [headerB64, payloadB64, sigB64] = parts;
      const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
      claims = JSON.parse(payloadJson);
      signedContent = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
      signatureBuffer = Buffer.from(sigB64, 'base64url');
    } else {
      // Support JSON envelope format: { payload: IntentClaims, signature: "..." }
      const parsed = JSON.parse(tokenString);
      if (!parsed.payload || !parsed.signature) {
        return {
          valid: false,
          errorCode: 'TOKEN_MALFORMED',
          error: 'Intent token JSON envelope must contain "payload" and "signature".'
        };
      }
      claims = parsed.payload;
      signedContent = Buffer.from(canonicalizeJson(claims), 'utf8');
      signatureBuffer = Buffer.from(parsed.signature, 'base64');
    }

    // 1. Validate Cryptographic Ed25519 Signature if public key is configured
    if (options.publicKey) {
      const isVerified = crypto.verify(
        undefined, // Ed25519 algorithm is self-specifying in Node crypto
        signedContent,
        options.publicKey,
        signatureBuffer
      );

      if (!isVerified) {
        return {
          valid: false,
          errorCode: 'SIGNATURE_INVALID',
          error: 'Ed25519 cryptographic signature verification failed.'
        };
      }
    }

    const nowSeconds = Math.floor(Date.now() / 1000);

    // 2. Issuer Validation
    if (claims.iss !== expectedIssuer) {
      return {
        valid: false,
        errorCode: 'ISSUER_MISMATCH',
        error: `Invalid token issuer: expected "${expectedIssuer}", got "${claims.iss}".`
      };
    }

    // 3. Audience Validation
    if (claims.aud !== expectedAudience) {
      return {
        valid: false,
        errorCode: 'AUDIENCE_MISMATCH',
        error: `Invalid token audience: expected "${expectedAudience}", got "${claims.aud}".`
      };
    }

    // 4. Expiry Validation (Token must not be expired)
    if (claims.exp + clockSkew < nowSeconds) {
      return {
        valid: false,
        errorCode: 'TOKEN_EXPIRED',
        error: `Intent token has expired at ${new Date(claims.exp * 1000).toISOString()}.`
      };
    }

    // 5. Max Age Validation (Token must not be older than 5 minutes from issue)
    if (nowSeconds - claims.iat > maxAgeSeconds + clockSkew) {
      return {
        valid: false,
        errorCode: 'TOKEN_TOO_OLD',
        error: `Intent token exceeds maximum permitted age of ${maxAgeSeconds} seconds.`
      };
    }

    // 6. Exact Intent Digest Validation (Matches transaction payload)
    const computedHash = computeIntentHash(transactionPayload);
    if (claims.intent_hash !== computedHash) {
      return {
        valid: false,
        errorCode: 'INTENT_HASH_MISMATCH',
        error: `Intent digest mismatch: token was signed for a different payload. Expected hash "${claims.intent_hash}", got "${computedHash}".`
      };
    }

    // 7. Atomic Nonce Consumption (Replay prevention)
    const expiresAtDate = new Date(claims.exp * 1000);
    const nonceResult = await nonceStore.consumeNonce(
      claims.nonce,
      claims.intent_hash,
      claims.sub,
      expiresAtDate
    );

    if (!nonceResult.consumed) {
      return {
        valid: false,
        errorCode: 'NONCE_REPLAY_DETECTED',
        error: nonceResult.reason || 'Replay detected: nonce has already been consumed.'
      };
    }

    return { valid: true, claims };
  } catch (err: any) {
    return {
      valid: false,
      errorCode: 'INTERNAL_ERROR',
      error: `Token validation error: ${err.message}`
    };
  }
}
