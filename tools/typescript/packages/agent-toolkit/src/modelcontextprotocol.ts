import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ShabaasAgentToolkit, type ShabaasAgentToolkitOptions } from './index.js';

export class ShabaasMcpServer {
  private readonly server: Server;
  private readonly toolkit: ShabaasAgentToolkit;

  constructor(options: ShabaasAgentToolkitOptions) {
    this.toolkit = new ShabaasAgentToolkit(options);
    this.server = new Server(
      { name: 'shabaas-agent-toolkit', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = this.toolkit.getTools().map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: zodToJsonSchema(tool.inputSchema as any)
      }));
      return { tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const tool = this.toolkit.getTools().find((t) => t.name === name);
      if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
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

// Backward-compatible aliases for README examples.
export const StdioMcpServer = ShabaasMcpServer;
export const HttpMcpServer = ShabaasMcpServer;

