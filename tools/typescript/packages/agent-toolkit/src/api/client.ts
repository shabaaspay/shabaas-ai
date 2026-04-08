import axios, { AxiosInstance } from 'axios';
import { Config, getApiUrl } from '../config/index.js';
import { ApiResponse } from '../types/index.js';

export type RequestAuthOptions = { requestUuid?: string };

const tokenCache = new Map<string, { token: string; fetchedAt: number }>();
const CACHE_TTL_MS = 50 * 60 * 1000;

export class ShabaasApiClient {
  private client: AxiosInstance;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.client = axios.create({
      baseURL: getApiUrl(config),
      headers: { 'Content-Type': 'application/json', 'X-Shabaas-Client': 'mcp' },
      timeout: 30000
    });
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

  private async withAuthRetry<T>(fn: (token: string) => Promise<T>, requestUuid?: string): Promise<T> {
    try {
      const token = await this.getTokenForRequest(requestUuid);
      return await fn(token);
    } catch (err: any) {
      if ((err?.response?.status === 401 || err?.response?.status === 403) && requestUuid) {
        tokenCache.delete(requestUuid.trim());
        const token = await this.getTokenForRequest(requestUuid);
        return await fn(token);
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
    }, options?.requestUuid);
  }

  async createPaymentAgreement(data: any, options?: RequestAuthOptions): Promise<ApiResponse> {
    return this.withAuthRetry(async (token) => {
      const response = await this.client.post('/api/public/payment_agreement', { payment_agreement: data }, {
        headers: { Authorization: token }
      });
      return response.data;
    }, options?.requestUuid);
  }

  async initiatePayment(data: any, options?: RequestAuthOptions): Promise<ApiResponse> {
    return this.withAuthRetry(async (token) => {
      const response = await this.client.post('/api/public/payment_initiation', { payment_initiation: data }, {
        headers: { Authorization: token },
        timeout: 65000
      });
      return response.data;
    }, options?.requestUuid);
  }

  async getPaymentInitiation(id: string, options?: RequestAuthOptions): Promise<ApiResponse> {
    return this.withAuthRetry(async (token) => {
      const response = await this.client.get(`/api/public/payment_initiation?id=${encodeURIComponent(id)}`, {
        headers: { Authorization: token }
      });
      return response.data;
    }, options?.requestUuid);
  }
}

