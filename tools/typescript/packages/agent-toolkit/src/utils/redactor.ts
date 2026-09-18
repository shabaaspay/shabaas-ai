/**
 * Sensitive Data Redactor & Response Size Limiter
 * Compliant with Australian Privacy Principle 11 (APP 11) and Banking Data Minimization.
 */

export const MAX_MCP_RESPONSE_BYTES = 50 * 1024; // 50 KB strict maximum response payload

const SENSITIVE_KEY_PATTERNS = [
  /bsb/i,
  /account_?number/i,
  /account_?no/i,
  /pay_?id/i,
  /phone(_number)?/i,
  /token/i,
  /access_?token/i,
  /auth(orization)?/i,
  /api_?key/i,
  /secret/i,
  /private_?key/i,
  /password/i,
  /signature/i
];

/**
 * Masks a 6-digit BSB (e.g., "082-902" or "082902" -> "***-***")
 */
export function maskBsb(bsb: string | number): string {
  const str = String(bsb).replace(/\D/g, '');
  if (str.length === 6) {
    return '***-***';
  }
  return '***-***';
}

/**
 * Masks an Australian bank account number (retaining only the last 3 digits)
 */
export function maskAccountNumber(acc: string | number): string {
  const str = String(acc).trim();
  if (str.length <= 4) {
    return '****';
  }
  return `****${str.slice(-3)}`;
}

/**
 * Masks a PayID (email or Australian phone number)
 */
export function maskPayId(payId: string): string {
  const trimmed = payId.trim();
  if (trimmed.includes('@')) {
    const [local, domain] = trimmed.split('@');
    const maskedLocal = local.length > 2 ? `${local[0]}***${local.slice(-1)}` : `${local[0]}***`;
    return `${maskedLocal}@${domain}`;
  }
  // Phone number (e.g., 0412345678 or +61412345678)
  const cleanPhone = trimmed.replace(/\s+/g, '');
  if (cleanPhone.length >= 8) {
    return `+61 4** *** ${cleanPhone.slice(-3)}`;
  }
  return '****PAYID****';
}

/**
 * Masks a Bearer token or long secret string
 */
export function maskToken(token: string): string {
  if (token.toLowerCase().startsWith('bearer ')) {
    return 'Bearer [REDACTED]';
  }
  if (token.toLowerCase().startsWith('shabaas_')) {
    return 'shabaas_[REDACTED]';
  }
  if (token.length > 8) {
    return `${token.slice(0, 4)}...[REDACTED]`;
  }
  return '[REDACTED]';
}

/**
 * Scans a string with regexes and masks any embedded credentials, BSBs, or tokens.
 */
export function redactString(str: string): string {
  return str
    // Bearer tokens
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    // Standard BSB format (123-456 or 123 456)
    .replace(/\b\d{3}[-\s]\d{3}\b/g, '***-***')
    // ShaBaas API Keys (e.g. shabaas_live_abc123)
    .replace(/shabaas_[a-zA-Z0-9_\-]+/gi, 'shabaas_[REDACTED]')
    // Email addresses
    .replace(/\b([A-Za-z0-9._%+-]{1,2})[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, '$1***@$2');
}

/**
 * Recursively redacts sensitive banking attributes, tokens, and credentials in an object or array.
 */
export function redactSensitiveData<T>(input: T): T {
  if (input === null || input === undefined) {
    return input;
  }

  if (typeof input === 'string') {
    return redactString(input) as unknown as T;
  }

  if (typeof input === 'number' || typeof input === 'boolean') {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactSensitiveData(item)) as unknown as T;
  }

  if (typeof input === 'object') {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(input)) {
      const isSensitiveKey = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));

      if (isSensitiveKey) {
        if (/bsb/i.test(key) && (typeof value === 'string' || typeof value === 'number')) {
          result[key] = maskBsb(value);
        } else if (/account_?(number|no)/i.test(key) && (typeof value === 'string' || typeof value === 'number')) {
          result[key] = maskAccountNumber(value);
        } else if (/pay_?id/i.test(key) && typeof value === 'string') {
          result[key] = maskPayId(value);
        } else if (typeof value === 'string') {
          result[key] = maskToken(value);
        } else {
          result[key] = '[REDACTED]';
        }
      } else {
        result[key] = redactSensitiveData(value);
      }
    }
    return result as T;
  }

  return input;
}

/**
 * Enforces pagination and payload response size limits (max 50KB) on read tool outputs.
 * Prevents host LLM context exhaustion and data exfiltration.
 */
export function enforceResponseSizeLimits<T>(data: T, maxBytes = MAX_MCP_RESPONSE_BYTES): T {
  const jsonStr = JSON.stringify(data);
  const sizeBytes = Buffer.byteLength(jsonStr, 'utf8');

  if (sizeBytes <= maxBytes) {
    return data;
  }

  // If payload exceeds limit and contains an array of items, truncate with pagination hint
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const record = data as Record<string, any>;
    for (const key of Object.keys(record)) {
      if (Array.isArray(record[key]) && record[key].length > 1) {
        const halfLength = Math.max(1, Math.floor(record[key].length / 2));
        record[key] = record[key].slice(0, halfLength);
        record._paginationNotice = {
          truncated: true,
          originalSizeKb: Math.round(sizeBytes / 1024),
          maxLimitKb: Math.round(maxBytes / 1024),
          message: 'Output was truncated to comply with MCP 50KB response limits. Use pagination parameters (limit/offset) to fetch subsequent records.'
        };
        return record as T;
      }
    }
  }

  // Fallback truncation
  return {
    success: false,
    error: 'RESPONSE_SIZE_EXCEEDED',
    message: `MCP response exceeded safe size boundary (${Math.round(sizeBytes / 1024)}KB > ${Math.round(maxBytes / 1024)}KB). Please narrow query filters.`,
    data: null
  } as unknown as T;
}

/**
 * Secure logging utility that redacts sensitive identifiers before printing to stdout.
 */
export function safeLog(message: string, meta?: any): void {
  const safeMessage = redactString(message);
  if (meta) {
    const safeMeta = redactSensitiveData(meta);
    console.log(`[SECURE LOG] ${safeMessage}`, JSON.stringify(safeMeta));
  } else {
    console.log(`[SECURE LOG] ${safeMessage}`);
  }
}
