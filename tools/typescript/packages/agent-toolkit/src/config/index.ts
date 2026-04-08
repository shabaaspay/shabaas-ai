export type Config = {
  environment: 'sandbox' | 'production';
  shabaasAuthUuid: string;
  sandboxUrl: string;
  productionUrl: string;
  httpPort: number;
  httpHost: string;
  mcpHttpApiKey: string;
  mcpStdioApiKey: string;
  allowedOrigins: string[];
  rateLimitPerMinute: number;
  rateLimitPerHour: number;
  authTokenMaxAgeMinutes: number;
  policyCacheTtlMs: number;
};

export function getApiUrl(config: Config): string {
  return config.environment === 'production'
    ? config.productionUrl
    : config.sandboxUrl;
}

