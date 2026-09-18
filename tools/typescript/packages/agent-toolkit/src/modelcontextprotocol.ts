import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ShabaasApiClient } from './api/client.js';
import { Config, getApiUrl } from './config/index.js';
import { CANONICAL_PRODUCTION_BASE_URL, CANONICAL_SANDBOX_BASE_URL } from './constants/backend-urls.js';
import { createReadTools, createWriteTools, createAllTools, type ToolContext } from './tools/index.js';
import { ShabaasAgentToolkit, type ShabaasAgentToolkitOptions } from './index.js';
import {
  mcpSecurityMiddleware,
  validateAndApplyCors,
  STANDARD_SECURITY_HEADERS,
  SSE_SECURITY_HEADERS,
  type CorsValidationResult
} from './utils/securityHeaders.js';

export {
  mcpSecurityMiddleware,
  validateAndApplyCors,
  STANDARD_SECURITY_HEADERS,
  SSE_SECURITY_HEADERS,
  type CorsValidationResult
};

export type McpServiceMode = 'read' | 'write' | 'full';

export type ShabaasMcpServerOptions = ShabaasAgentToolkitOptions & {
  mode?: McpServiceMode;
  allowedOrigins?: string[];
};

function toMcpConfig(options: ShabaasMcpServerOptions): Config {
  const environment = options.environment ?? 'sandbox';
  return {
    environment,
    readOnly: options.readOnly || options.mode === 'read',
    allowUnverifiedWrites: options.allowUnverifiedWrites,
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

/**
 * Isolated Read-Only MCP Server.
 * Exposes only query, search, and bounded reporting tools.
 * Ideal for public registry discovery and unprivileged agent interactions.
 */
export class ShabaasReadMcpServer {
  private readonly server: Server;
  private readonly tools: ReturnType<typeof createReadTools>;
  private readonly apiKey: string;

  constructor(options: ShabaasAgentToolkitOptions) {
    if (!options.apiKey) {
      throw new Error('ShabaasReadMcpServer requires apiKey');
    }
    this.apiKey = options.apiKey;
    const config = toMcpConfig({ ...options, readOnly: true, mode: 'read' });
    const apiClient = new ShabaasApiClient(config);
    this.tools = createReadTools(apiClient, config);

    this.server = new Server(
      { name: 'shabaas-read-mcp', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = Object.values(this.tools).map((tool) => ({
        name: tool.name,
        description: `[Read-Only] ${tool.description}`,
        inputSchema: zodToJsonSchema(tool.inputSchema as any)
      }));
      return { tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const tool = (this.tools as any)[name];
      if (!tool) {
        throw new Error(`Tool not found or unsupported in Read MCP service: ${name}`);
      }

      const result = await tool.execute((args ?? {}) as Record<string, unknown>, { requestUuid: this.apiKey });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    });
  }

  async connect(transport: any): Promise<void> {
    await this.server.connect(transport);
  }
}

/**
 * Isolated Write-Capable MCP Server.
 * Exposes payment initiation and agreement creation tools.
 * Must be deployed with isolated IAM identity and gated by Ed25519 Intent Tokens.
 */
export class ShabaasWriteMcpServer {
  private readonly server: Server;
  private readonly tools: ReturnType<typeof createWriteTools>;
  private readonly apiKey: string;

  constructor(options: ShabaasAgentToolkitOptions) {
    if (!options.apiKey) {
      throw new Error('ShabaasWriteMcpServer requires apiKey');
    }
    this.apiKey = options.apiKey;
    const config = toMcpConfig({ ...options, mode: 'write' });
    const apiClient = new ShabaasApiClient(config);
    this.tools = createWriteTools(apiClient, config);

    this.server = new Server(
      { name: 'shabaas-write-mcp', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = Object.values(this.tools).map((tool) => ({
        name: tool.name,
        description: `[Gated Write Tool - Requires Signed Intent Token] ${tool.description}`,
        inputSchema: zodToJsonSchema(tool.inputSchema as any)
      }));
      return { tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const tool = (this.tools as any)[name];
      if (!tool) {
        throw new Error(`Tool not found or unsupported in Write MCP service: ${name}`);
      }

      const result = await tool.execute((args ?? {}) as Record<string, unknown>, { requestUuid: this.apiKey });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    });
  }

  async connect(transport: any): Promise<void> {
    await this.server.connect(transport);
  }
}

/**
 * Composite MCP Server for single-service deployments or local development.
 * Supports configurable mode ('read' | 'write' | 'full').
 */
export class ShabaasMcpServer {
  private readonly server: Server;
  private readonly toolkit: ShabaasAgentToolkit;
  private readonly mode: McpServiceMode;

  constructor(options: ShabaasMcpServerOptions) {
    this.mode = options.mode ?? (options.readOnly ? 'read' : 'full');
    this.toolkit = new ShabaasAgentToolkit({
      ...options,
      readOnly: this.mode === 'read' || options.readOnly
    });

    this.server = new Server(
      { name: `shabaas-mcp-${this.mode}`, version: '0.1.0' },
      { capabilities: { tools: {} } }
    );
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const isReadOnly = this.mode === 'read';
      const tools = this.toolkit.getTools({ readOnlyOnly: isReadOnly }).map((tool) => ({
        name: tool.name,
        description: isReadOnly ? `[Read-Only] ${tool.description}` : tool.description,
        inputSchema: zodToJsonSchema(tool.inputSchema as any)
      }));
      return { tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const isReadOnly = this.mode === 'read';
      const tools = this.toolkit.getTools({ readOnlyOnly: isReadOnly });
      const tool = tools.find((t) => t.name === name);

      if (!tool) {
        throw new Error(`Unknown or restricted tool for ${this.mode} mode: ${name}`);
      }

      const result = await tool.execute((args ?? {}) as Record<string, unknown>);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    });
  }

  async connect(transport: any): Promise<void> {
    await this.server.connect(transport);
  }
}

// Backward-compatible aliases
export const StdioMcpServer = ShabaasMcpServer;
export const HttpMcpServer = ShabaasMcpServer;
