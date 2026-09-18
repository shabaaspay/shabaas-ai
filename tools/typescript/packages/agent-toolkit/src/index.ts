import { ShabaasApiClient } from './api/client.js';
import { CANONICAL_PRODUCTION_BASE_URL, CANONICAL_SANDBOX_BASE_URL } from './constants/backend-urls.js';
import type { Config } from './config/index.js';
import { createAllTools } from './tools/index.js';

declare const process: any;

export type ShabaasAgentToolkitOptions = {
  apiKey: string;
  environment?: 'sandbox' | 'production';
  readOnly?: boolean;
  allowUnverifiedWrites?: boolean;
};

export type ShabaasFunctionTool = {
  name: string;
  description: string;
  inputSchema: unknown;
  execute: (args?: Record<string, unknown>) => Promise<unknown>;
};

function getEnvVar(key: string): string | undefined {
  if (typeof process !== 'undefined' && (process as any).env) {
    return (process as any).env[key];
  }
  return undefined;
}

function toToolkitConfig(options: ShabaasAgentToolkitOptions): Config {
  const environment = options.environment ?? 'sandbox';
  const readOnly = options.readOnly ?? (getEnvVar('SHABAAS_MCP_READ_ONLY') === 'true');
  const allowUnverifiedWrites = options.allowUnverifiedWrites ?? (getEnvVar('SHABAAS_ALLOW_UNVERIFIED_WRITES') === 'true');
  return {
    environment,
    readOnly,
    allowUnverifiedWrites,
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
  private readonly config: Config;
  private readonly tools: ReturnType<typeof createAllTools>;

  constructor(options: ShabaasAgentToolkitOptions) {
    if (!options.apiKey) {
      throw new Error('ShabaasAgentToolkit requires apiKey');
    }

    this.apiKey = options.apiKey;
    this.config = toToolkitConfig(options);
    const apiClient = new ShabaasApiClient(this.config);
    this.tools = createAllTools(apiClient, this.config);
  }

  getConfig(): Readonly<Config> {
    return this.config;
  }

  getTools(options?: { readOnlyOnly?: boolean }): ShabaasFunctionTool[] {
    const isReadOnly = options?.readOnlyOnly ?? this.config.readOnly;
    const writeToolNames = new Set(['initiate_payment', 'create_payment_agreement']);

    return Object.values(this.tools)
      .filter((tool) => !isReadOnly || !writeToolNames.has(tool.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        execute: async (args?: Record<string, unknown>) => tool.execute(args ?? {}, { requestUuid: this.apiKey })
      }));
  }
}

