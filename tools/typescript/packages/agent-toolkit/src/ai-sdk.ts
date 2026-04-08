import { zodToJsonSchema } from 'zod-to-json-schema';
import { ShabaasAgentToolkit, type ShabaasAgentToolkitOptions } from './index.js';

export class ShabaasAgentToolkitAiSdk extends ShabaasAgentToolkit {
  constructor(options: ShabaasAgentToolkitOptions) {
    super(options);
  }

  async getAiSdkTools(): Promise<Record<string, any>> {
    let toolFactory: any;
    try {
      const aiModuleName = 'ai';
      const aiModule = await import(aiModuleName);
      toolFactory = aiModule.tool;
    } catch {
      throw new Error('AI SDK adapter requires the "ai" package. Install it with: npm install ai');
    }

    const entries = this.getTools().map((toolDef) => {
      const parameters = zodToJsonSchema(toolDef.inputSchema as any) as any;
      return [
        toolDef.name,
        toolFactory({
          description: toolDef.description,
          parameters,
          execute: async (args: Record<string, unknown>) => toolDef.execute(args ?? {})
        })
      ] as const;
    });

    return Object.fromEntries(entries);
  }
}

