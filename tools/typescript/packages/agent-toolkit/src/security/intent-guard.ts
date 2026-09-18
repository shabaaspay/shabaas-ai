import { Config } from '../config/index.js';
import { validateIntentToken, type IntentValidatorOptions } from './intentValidator.js';

export type WritePermissionResult = {
  allowed: boolean;
  reason?: string;
  errorCode?:
    | 'READ_ONLY_MODE'
    | 'INTENT_TOKEN_REQUIRED'
    | 'INVALID_INTENT_TOKEN'
    | 'TOKEN_EXPIRED'
    | 'TOKEN_TOO_OLD'
    | 'ISSUER_MISMATCH'
    | 'AUDIENCE_MISMATCH'
    | 'SIGNATURE_INVALID'
    | 'INTENT_HASH_MISMATCH'
    | 'NONCE_REPLAY_DETECTED';
};

const WRITE_TOOLS = new Set(['initiate_payment', 'create_payment_agreement']);

export function isWriteTool(toolName: string): boolean {
  return WRITE_TOOLS.has(toolName);
}

/**
 * Synchronous fast-path check for write tool availability and token presence.
 */
export function checkWritePermission(
  config: Config,
  toolName: string,
  args?: { intent_token?: string }
): WritePermissionResult {
  if (!isWriteTool(toolName)) {
    return { allowed: true };
  }

  // Explicit read-only mode blocks all write operations
  if (config.readOnly) {
    return {
      allowed: false,
      errorCode: 'READ_ONLY_MODE',
      reason: `Write tool "${toolName}" is disabled: toolkit/MCP server is operating in read-only mode.`
    };
  }

  // Production write lockdown gate
  if (config.environment === 'production' && !config.allowUnverifiedWrites) {
    if (!args?.intent_token || args.intent_token.trim() === '') {
      return {
        allowed: false,
        errorCode: 'INTENT_TOKEN_REQUIRED',
        reason:
          `Production payment execution for "${toolName}" is restricted: an externally approved, single-use Ed25519 intent token is required. ` +
          `Write capabilities remain locked down under the ShaBaas Pay Security Implementation Plan until human verification is completed.`
      };
    }

    if (args.intent_token.length < 16) {
      return {
        allowed: false,
        errorCode: 'INVALID_INTENT_TOKEN',
        reason: `Provided intent token is malformed or invalid.`
      };
    }
  }

  return { allowed: true };
}

/**
 * Complete asynchronous cryptographic verification gate for write tools.
 * Verifies Ed25519 signature, issuer, audience, expiry, exact intent digest, and consumes nonce atomically.
 */
export async function verifyWriteIntentAsync(
  config: Config,
  toolName: string,
  args: any,
  options?: IntentValidatorOptions
): Promise<WritePermissionResult> {
  const baseCheck = checkWritePermission(config, toolName, args);
  if (!baseCheck.allowed) {
    return baseCheck;
  }

  // If in production or an intent token is provided, verify cryptographic validity
  if (args?.intent_token) {
    const result = await validateIntentToken(args.intent_token, args, options);
    if (!result.valid) {
      return {
        allowed: false,
        errorCode: result.errorCode as any,
        reason: result.error
      };
    }
  }

  return { allowed: true };
}
