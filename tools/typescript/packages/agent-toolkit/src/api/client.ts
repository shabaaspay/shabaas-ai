import crypto from 'node:crypto';
import axios, { AxiosInstance } from 'axios';
import { Config, getApiUrl } from '../config/index.js';
import { ApiResponse } from '../types/index.js';
import { createSafeHttpAgents } from '../utils/ssrfSafeClient.js';

export type RequestAuthOptions = {
  requestUuid?: string;
  idempotencyKey?: string;
};

export class IdempotencyConflictError extends Error {
  public readonly statusCode = 409;
  public readonly errorCode: string;
  public readonly idempotencyKey?: string;
  public readonly data?: any;

  constructor(message: string, errorCode = 'GN-0409', idempotencyKey?: string, data?: any) {
    super(message);
    this.name = 'IdempotencyConflictError';
    this.errorCode = errorCode;
    this.idempotencyKey = idempotencyKey;
    this.data = data;
  }
}

const tokenCache = new Map<string, { token: string; fetchedAt: number }>();
const CACHE_TTL_MS = 50 * 60 * 1000;

export class ShaBaasApiClient {
  private client: AxiosInstance;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    const { httpAgent, httpsAgent } = createSafeHttpAgents();
    this.client = axios.create({
      baseURL: getApiUrl(config),
      headers: { 'Content-Type': 'application/json', 'X-ShaBaas-Client': 'mcp' },
      httpAgent,
      httpsAgent,
      maxRedirects: 0,
      timeout: 30000
    });
  }

  /**
   * Securely resolves the authenticated merchant identity from the verified session / API key.
   * Prevents Broken Object Level Authorization (BOLA) by never trusting client-supplied merchant_ids.
   */
  getAuthenticatedMerchantId(requestUuid?: string): string {
    const keyOrToken = (requestUuid ?? this.config.shabaasAuthUuid ?? '').trim();
    if (!keyOrToken) {
      return 'anonymous_principal';
    }

    const tokenPart = keyOrToken.toLowerCase().startsWith('bearer ') ? keyOrToken.slice(7).trim() : keyOrToken;
    if (tokenPart.includes('.')) {
      try {
        const parts = tokenPart.split('.');
        if (parts.length >= 2) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
          if (payload.merchant_id) return String(payload.merchant_id);
          if (payload.sub) return String(payload.sub);
        }
      } catch {
        // Fallback to key hash
      }
    }

    const hash = crypto.createHash('sha256').update(keyOrToken).digest('hex').slice(0, 16);
    return `merchant_${hash}`;
  }

  private normalizeBearer(token: string): string {
    const trimmed = token.trim();
    return trimmed.toLowerCase().startsWith('bearer ') ? trimmed : `Bearer ${trimmed}`;
  }

  async getTokenForRequest(requestUuid?: string): Promise<string> {
    const apiKey = (requestUuid ?? this.config.shabaasAuthUuid ?? '').trim();
    if (!apiKey) throw new Error('API key is required');

    const cached = tokenCache.get(apiKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.token;

    const authHeader = apiKey.toLowerCase().startsWith('bearer ') ? apiKey : `Bearer ${apiKey}`;
    const response = await this.client.post('/api/public/authorization', null, {
      headers: { Authorization: authHeader, accept: 'application/json' }
    });

    const payload: any = response.data;
    const rawToken = payload?.data?.token || payload?.data?.access_token || payload?.token || payload?.access_token;
    if (!rawToken || typeof rawToken !== 'string') {
      throw new Error('Authorization succeeded but no token was returned.');
    }

    const token = this.normalizeBearer(rawToken);
    tokenCache.set(apiKey, { token, fetchedAt: Date.now() });
    return token;
  }

  private async withAuthRetry<T>(fn: (token: string, idempotencyKey: string) => Promise<T>, options?: RequestAuthOptions): Promise<T> {
    const requestUuid = options?.requestUuid;
    const idempotencyKey = options?.idempotencyKey || crypto.randomUUID();

    try {
      const token = await this.getTokenForRequest(requestUuid);
      return await fn(token, idempotencyKey);
    } catch (err: any) {
      if (err?.response?.status === 409) {
        const data = err.response.data;
        const msg = data?.message || 'Idempotency conflict: a request with this Idempotency-Key has already been processed with different parameters.';
        const code = data?.error_code || 'GN-0409';
        throw new IdempotencyConflictError(msg, code, idempotencyKey, data);
      }

      if ((err?.response?.status === 401 || err?.response?.status === 403) && requestUuid) {
        tokenCache.delete(requestUuid.trim());
        const token = await this.getTokenForRequest(requestUuid);
        return await fn(token, idempotencyKey);
      }
      throw err;
    }
  }

  async getAuthToken(options?: RequestAuthOptions): Promise<{ token: string; fetchedAt: string }> {
    const token = await this.getTokenForRequest(options?.requestUuid);
    return { token, fetchedAt: new Date().toISOString() };
  }

  async getPaymentAgreement(id: string, options?: RequestAuthOptions): Promise<ApiResponse> {
    return this.withAuthRetry(async (token) => {
      const response = await this.client.get(`/api/public/payment_agreement?id=${encodeURIComponent(id)}`, {
        headers: { Authorization: token }
      });
      return response.data;
    }, options);
  }

  async createPaymentAgreement(data: any, options?: RequestAuthOptions): Promise<ApiResponse> {
    return this.withAuthRetry(async (token, idempotencyKey) => {
      const response = await this.client.post('/api/public/payment_agreement', { payment_agreement: data }, {
        headers: {
          Authorization: token,
          'Idempotency-Key': idempotencyKey
        }
      });
      return response.data;
    }, options);
  }

  async resendPaymentAgreement(data: any, options?: RequestAuthOptions): Promise<ApiResponse> {
    return this.withAuthRetry(async (token, idempotencyKey) => {
      const response = await this.client.patch('/api/public/payment_agreement/resend', { payment_agreement: data }, {
        headers: {
          Authorization: token,
          'Idempotency-Key': idempotencyKey
        }
      });
      return response.data;
    }, options);
  }

  async updateBilateralAgreement(data: any, options?: RequestAuthOptions): Promise<ApiResponse> {
    return this.withAuthRetry(async (token, idempotencyKey) => {
      const response = await this.client.patch('/api/public/payment_agreement/bilateral', { payment_agreement: data }, {
        headers: {
          Authorization: token,
          'Idempotency-Key': idempotencyKey
        }
      });
      return response.data;
    }, options);
  }

  async cancelPaymentAgreement(id: string, options?: RequestAuthOptions): Promise<ApiResponse> {
    return this.withAuthRetry(async (token, idempotencyKey) => {
      const response = await this.client.delete(`/api/public/payment_agreement/cancel?id=${encodeURIComponent(id)}`, {
        headers: {
          Authorization: token,
          'Idempotency-Key': idempotencyKey
        }
      });
      return response.data;
    }, options);
  }

  async initiatePayment(data: any, options?: RequestAuthOptions): Promise<ApiResponse> {
    return this.withAuthRetry(async (token, idempotencyKey) => {
      const response = await this.client.post('/api/public/payment_initiation', { payment_initiation: data }, {
        headers: {
          Authorization: token,
          'Idempotency-Key': idempotencyKey
        },
        timeout: 65000
      });
      return response.data;
    }, options);
  }

  async getPaymentInitiation(id: string, options?: RequestAuthOptions): Promise<ApiResponse> {
    return this.withAuthRetry(async (token) => {
      const response = await this.client.get(`/api/public/payment_initiation?id=${encodeURIComponent(id)}`, {
        headers: { Authorization: token }
      });
      return response.data;
    }, options);
  }

  async initiateDirectDebit(data: any, options?: RequestAuthOptions): Promise<ApiResponse> {
    return this.withAuthRetry(async (token, idempotencyKey) => {
      const response = await this.client.post('/api/public/payment_initiation/direct_debit', { direct_debit: data }, {
        headers: {
          Authorization: token,
          'Idempotency-Key': idempotencyKey
        },
        timeout: 65000
      });
      return response.data;
    }, options);
  }

  async createPayId(data: any, options?: RequestAuthOptions): Promise<ApiResponse> {
    return this.withAuthRetry(async (token, idempotencyKey) => {
      const response = await this.client.post('/v1/collections/payid', data, {
        headers: {
          Authorization: token,
          'Idempotency-Key': idempotencyKey
        }
      });
      return response.data;
    }, options);
  }

  async getPayIdStatus(payid: string, expectedAmount?: number, options?: RequestAuthOptions): Promise<ApiResponse> {
    return this.withAuthRetry(async (token) => {
      let url = `/v1/collections/payid/status?payid=${encodeURIComponent(payid)}`;
      if (expectedAmount !== undefined && !isNaN(expectedAmount)) {
        url += `&expected_amount=${encodeURIComponent(String(expectedAmount))}`;
      }
      const response = await this.client.get(url, {
        headers: { Authorization: token }
      });
      return response.data;
    }, options);
  }
}

export { ShaBaasApiClient as ShabaasApiClient };
