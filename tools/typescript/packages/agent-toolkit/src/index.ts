import { ShabaasApiClient } from './api/client.js';
import { CANONICAL_PRODUCTION_BASE_URL, CANONICAL_SANDBOX_BASE_URL } from './constants/backend-urls.js';
import type { Config } from './config/index.js';
import { createAllTools } from './tools/index.js';

export type ShabaasAgentToolkitOptions = {
  apiKey: string;
  environment?: 'sandbox' | 'production';
};

export type ShabaasFunctionTool = {
  name: string;
  description: string;
  inputSchema: unknown;
  execute: (args?: Record<string, unknown>) => Promise<unknown>;
};

function toToolkitConfig(options: ShabaasAgentToolkitOptions): Config {
  const environment = options.environment ?? 'sandbox';
  return {
    environment,
    shabaasAuthUuid: options.apiKey,
    sandboxUrl: CANONICAL_SANDBOX_BASE_URL,
    productionUrl: CANONICAL_PRODUCTION_BASE_URL,
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
}

export class ShabaasAgentToolkit {
  private readonly apiKey: string;
  private readonly tools: ReturnType<typeof createAllTools>;

  constructor(options: ShabaasAgentToolkitOptions) {
    if (!options.apiKey) {
      throw new Error('ShabaasAgentToolkit requires apiKey');
    }

    this.apiKey = options.apiKey;
    const config = toToolkitConfig(options);
    const apiClient = new ShabaasApiClient(config);
    this.tools = createAllTools(apiClient, config);
  }

  getTools(): ShabaasFunctionTool[] {
    return Object.values(this.tools).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      execute: async (args?: Record<string, unknown>) => tool.execute(args ?? {}, { requestUuid: this.apiKey })
    }));
  }
}

