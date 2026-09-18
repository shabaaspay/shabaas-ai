import dns from 'node:dns';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import axios, { type AxiosInstance, type CreateAxiosDefaults } from 'axios';

export class SsrfError extends Error {
  constructor(message: string, public readonly code = 'ERR_SSRF_BLOCKED') {
    super(message);
    this.name = 'SsrfError';
  }
}

/**
 * Checks whether an IPv4 address belongs to a private, loopback, link-local,
 * cloud metadata, or reserved range.
 */
function isRestrictedIpv4(ip: string): { restricted: boolean; reason?: string } {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return { restricted: true, reason: 'Malformed IPv4 address' };
  }

  const [b0, b1] = parts;

  // 0.0.0.0/8 (Current network)
  if (b0 === 0) return { restricted: true, reason: 'Current network (0.0.0.0/8)' };

  // 10.0.0.0/8 (RFC 1918 Private)
  if (b0 === 10) return { restricted: true, reason: 'Private network (10.0.0.0/8)' };

  // 127.0.0.0/8 (Loopback)
  if (b0 === 127) return { restricted: true, reason: 'Loopback address (127.0.0.0/8)' };

  // 100.64.0.0/10 (Carrier-Grade NAT)
  if (b0 === 100 && b1 >= 64 && b1 <= 127) {
    return { restricted: true, reason: 'Carrier-Grade NAT (100.64.0.0/10)' };
  }

  // 169.254.0.0/16 (Link-Local & Cloud Metadata, e.g. 169.254.169.254)
  if (b0 === 169 && b1 === 254) {
    return { restricted: true, reason: 'Link-local / Cloud metadata (169.254.0.0/16)' };
  }

  // 172.16.0.0/12 (RFC 1918 Private)
  if (b0 === 172 && b1 >= 16 && b1 <= 31) {
    return { restricted: true, reason: 'Private network (172.16.0.0/12)' };
  }

  // 192.0.2.0/24 (TEST-NET-1 Documentation)
  if (b0 === 192 && b1 === 0 && parts[2] === 2) {
    return { restricted: true, reason: 'Documentation network (192.0.2.0/24)' };
  }

  // 192.168.0.0/16 (RFC 1918 Private)
  if (b0 === 192 && b1 === 168) {
    return { restricted: true, reason: 'Private network (192.168.0.0/16)' };
  }

  // 198.18.0.0/15 (Network benchmark tests)
  if (b0 === 198 && (b1 === 18 || b1 === 19)) {
    return { restricted: true, reason: 'Benchmark network (198.18.0.0/15)' };
  }

  // 198.51.100.0/24 (TEST-NET-2 Documentation)
  if (b0 === 198 && b1 === 51 && parts[2] === 100) {
    return { restricted: true, reason: 'Documentation network (198.51.100.0/24)' };
  }

  // 203.0.113.0/24 (TEST-NET-3 Documentation)
  if (b0 === 203 && b1 === 0 && parts[2] === 113) {
    return { restricted: true, reason: 'Documentation network (203.0.113.0/24)' };
  }

  // 224.0.0.0/4 (Multicast)
  if (b0 >= 224 && b0 <= 239) {
    return { restricted: true, reason: 'Multicast network (224.0.0.0/4)' };
  }

  // 240.0.0.0/4 (Reserved)
  if (b0 >= 240) {
    return { restricted: true, reason: 'Reserved network (240.0.0.0/4)' };
  }

  return { restricted: false };
}

/**
 * Checks whether an IPv6 address belongs to a private, loopback, link-local,
 * or non-routable range.
 */
function isRestrictedIpv6(ip: string): { restricted: boolean; reason?: string } {
  const normalized = ip.toLowerCase().trim();

  // ::1 / :: (Loopback & Unspecified)
  if (normalized === '::1' || normalized === '::') {
    return { restricted: true, reason: 'IPv6 loopback / unspecified (::1 or ::)' };
  }

  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  if (normalized.startsWith('::ffff:')) {
    const v4Part = normalized.replace(/^::ffff:/, '');
    if (net.isIPv4(v4Part)) {
      return isRestrictedIpv4(v4Part);
    }
  }

  // fe80::/10 (Link-Local)
  if (/^fe[89ab]/i.test(normalized)) {
    return { restricted: true, reason: 'IPv6 link-local (fe80::/10)' };
  }

  // fc00::/7 & fd00::/8 (Unique Local Address - RFC 4193 Private)
  if (/^f[cd]/i.test(normalized)) {
    return { restricted: true, reason: 'IPv6 Unique Local Address (fc00::/7)' };
  }

  // ff00::/8 (Multicast)
  if (normalized.startsWith('ff')) {
    return { restricted: true, reason: 'IPv6 multicast (ff00::/8)' };
  }

  return { restricted: false };
}

/**
 * Public validator for any IP address. Returns true if IP is restricted/private.
 */
export function isIpRestricted(ip: string): { restricted: boolean; reason?: string } {
  const version = net.isIP(ip);
  if (version === 4) {
    return isRestrictedIpv4(ip);
  } else if (version === 6) {
    return isRestrictedIpv6(ip);
  }
  return { restricted: true, reason: 'Invalid IP address' };
}

/**
 * Known internal cloud metadata hostnames
 */
const RESTRICTED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'localhost'
]);

export type SafeDnsLookup = (
  hostname: string,
  options: any,
  callback: (err: NodeJS.ErrnoException | null, address: any, family?: any) => void
) => void;

/**
 * Custom DNS lookup handler enforcing SSRF checks at dial time.
 * Resolves all A and AAAA addresses and verifies none point to restricted destinations.
 */
export const safeDnsLookup: SafeDnsLookup = (
  hostname: string,
  options: any,
  callback: (err: NodeJS.ErrnoException | null, address: any, family?: any) => void
) => {
  if (RESTRICTED_HOSTNAMES.has(hostname.toLowerCase())) {
    return callback(new SsrfError(`Access to restricted hostname is blocked: ${hostname}`), null, 0);
  }

  // If already an IP address, validate immediately
  const ipVer = net.isIP(hostname);
  if (ipVer !== 0) {
    const check = isIpRestricted(hostname);
    if (check.restricted) {
      return callback(new SsrfError(`Direct connection to restricted IP blocked: ${hostname} (${check.reason})`), null, 0);
    }
    return callback(null, hostname, ipVer);
  }

  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) {
      return callback(err, null, 0);
    }

    if (!addresses || addresses.length === 0) {
      return callback(new Error(`DNS resolution failed for hostname: ${hostname}`), null, 0);
    }

    // Inspect every resolved A and AAAA address
    for (const record of addresses) {
      const check = isIpRestricted(record.address);
      if (check.restricted) {
        return callback(
          new SsrfError(
            `SSRF blocked: Hostname "${hostname}" resolves to restricted IP ${record.address} (${check.reason})`
          ),
          null,
          0
        );
      }
    }

    // If options.all was requested, return all safe addresses
    if (options && options.all) {
      return (callback as any)(null, addresses);
    }

    // Otherwise return first safe address
    const first = addresses[0];
    return callback(null, first.address, first.family);
  });
};

/**
 * Factory for safe Node.js HTTP/HTTPS agents with dial-time DNS pinning.
 */
export function createSafeHttpAgents() {
  const httpAgent = new http.Agent({
    lookup: safeDnsLookup,
    keepAlive: true,
    timeout: 10000
  });

  const httpsAgent = new https.Agent({
    lookup: safeDnsLookup,
    keepAlive: true,
    timeout: 10000
  });

  return { httpAgent, httpsAgent };
}

export type SsrfSafeClientOptions = CreateAxiosDefaults & {
  allowRedirects?: boolean;
  maxRedirects?: number;
};

/**
 * Creates an SSRF-safe Axios instance configured with:
 * 1. Dial-time DNS resolution blocking private, loopback, and metadata destinations.
 * 2. Disabled or re-validated HTTP redirects to mitigate DNS rebinding.
 * 3. Strict request timeouts.
 */
export function createSsrfSafeClient(options?: SsrfSafeClientOptions): AxiosInstance {
  const { httpAgent, httpsAgent } = createSafeHttpAgents();

  const allowRedirects = options?.allowRedirects ?? false;
  const maxRedirects = allowRedirects ? (options?.maxRedirects ?? 3) : 0;

  const client = axios.create({
    httpAgent,
    httpsAgent,
    maxRedirects,
    timeout: 15000,
    ...options
  });

  // Re-validate every redirect hop if redirects are enabled
  if (allowRedirects && maxRedirects > 0) {
    client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response && [301, 302, 303, 307, 308].includes(error.response.status)) {
          const redirectUrl = error.response.headers.location;
          if (redirectUrl) {
            const parsed = new URL(redirectUrl, error.config.baseURL);
            const check = isIpRestricted(parsed.hostname);
            if (check.restricted) {
              throw new SsrfError(`Redirect to restricted destination blocked: ${parsed.hostname}`);
            }
          }
        }
        return Promise.reject(error);
      }
    );
  }

  return client;
}
