import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Standard Security Headers (Helmet Equivalent) for MCP JSON-RPC & HTTP Endpoints.
 * Compliant with OWASP API Security and Australian Cyber Security Centre (ACSC) baselines.
 */
export const STANDARD_SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
  'X-Permitted-Cross-Domain-Policies': 'none'
};

/**
 * Enhanced Security Headers tailored for Server-Sent Events (SSE) streaming connections.
 */
export const SSE_SECURITY_HEADERS: Record<string, string> = {
  ...STANDARD_SECURITY_HEADERS,
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no' // Prevents Cloudflare / Nginx proxy buffering of event streams
};

export type CorsValidationResult = {
  allowed: boolean;
  reason?: string;
};

/**
 * Evaluates origin against allowed origins and applies strict CORS response headers.
 * Explicitly rejects unauthorized cross-origin requests.
 */
export function validateAndApplyCors(
  origin: string | undefined,
  allowedOrigins: string[] = [],
  setHeader?: (key: string, value: string) => void
): CorsValidationResult {
  // Non-browser or direct curl/m2m request without Origin header
  if (!origin) {
    return { allowed: true };
  }

  const normalizedOrigin = origin.toLowerCase().trim();
  const normalizedAllowed = allowedOrigins.map((o) => o.toLowerCase().trim());

  const isAllowed =
    normalizedAllowed.includes('*') ||
    normalizedAllowed.includes(normalizedOrigin);

  if (!isAllowed) {
    return {
      allowed: false,
      reason: `CORS policy violation: Origin "${origin}" is not authorized.`
    };
  }

  if (setHeader) {
    setHeader('Access-Control-Allow-Origin', origin);
    setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, Accept, X-ShaBaas-Client, X-Shabaas-Client, Idempotency-Key'
    );
    setHeader('Access-Control-Max-Age', '86400');
    setHeader('Vary', 'Origin');
  }

  return { allowed: true };
}

/**
 * Native Node.js HTTP middleware enforcing strict CORS and security headers
 * on MCP SSE and JSON-RPC endpoints.
 */
export function mcpSecurityMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  allowedOrigins: string[] = [],
  isSse = false
): boolean {
  const headers = isSse ? SSE_SECURITY_HEADERS : STANDARD_SECURITY_HEADERS;

  // Apply baseline security headers
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }

  const origin = req.headers.origin;
  const corsCheck = validateAndApplyCors(
    origin,
    allowedOrigins,
    (k, v) => res.setHeader(k, v)
  );

  // Reject unauthorized cross-origin calls
  if (!corsCheck.allowed) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: 'CORS_FORBIDDEN',
        message: corsCheck.reason
      })
    );
    return false;
  }

  // Handle preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return false;
  }

  return true;
}
