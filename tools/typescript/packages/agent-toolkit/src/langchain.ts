import { z } from 'zod';
import { ShabaasAgentToolkit, type ShabaasAgentToolkitOptions } from './index.js';

export class ShabaasAgentToolkitLangChain extends ShabaasAgentToolkit {
  constructor(options: ShabaasAgentToolkitOptions) {
    super(options);
  }

  async getLangChainTools(): Promise<any[]> {
    let DynamicStructuredTool: any;
    try {
      const langchainToolsModule = '@langchain/core/tools';
      ({ DynamicStructuredTool } = await import(langchainToolsModule));
    } catch {
      throw new Error(
        'LangChain adapter requires @langchain/core. Install it with: npm install @langchain/core'
      );
    }

    return this.getTools().map((tool) => new DynamicStructuredTool({
      name: tool.name,
      description: tool.description,
      schema: (tool.inputSchema as z.ZodTypeAny) ?? z.object({}),
      func: async (args: Record<string, unknown>) => {
        const result = await tool.execute(args);
        return JSON.stringify(result);
      }
    }));
  }
}

