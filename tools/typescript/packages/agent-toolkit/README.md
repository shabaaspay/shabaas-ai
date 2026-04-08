# ShaBaas Agent Toolkit - TypeScript

The ShaBaas Agent Toolkit enables popular agent frameworks, including LangChain and Vercel's AI SDK, to integrate with ShaBaasPay APIs through function calling.

## Installation

You don't need this source code unless you want to modify the package. If you just want to use the package run:

```bash
npm install @shabaaspay/agent-toolkit
```

### Requirements

- Node 22+

## Usage

The library needs to be configured with your account's API key, available in the [ShaBaas Developer Dashboard](https://docs.shabaas.com/dashboard). We strongly recommend using a restricted API key for better security and granular permissions. Tool availability is determined by the permissions configured for that key.

```ts
import { ShabaasAgentToolkit } from '@shabaaspay/agent-toolkit';

const toolkit = new ShabaasAgentToolkit({
  apiKey: process.env.SHABAAS_API_KEY!,
  environment: 'sandbox'
});
```

## Tools

Get toolkit tools and execute one directly:

```ts
const tools = toolkit.getTools();
const getAuthTokenTool = tools.find((t) => t.name === 'get_auth_token');

const result = await getAuthTokenTool?.execute({
  include_token_in_response: false
});
```

## LangChain

```ts
import { ShabaasAgentToolkitLangChain } from '@shabaaspay/agent-toolkit/langchain';

const toolkit = new ShabaasAgentToolkitLangChain({
  apiKey: process.env.SHABAAS_API_KEY!,
  environment: 'sandbox'
});

const tools = await toolkit.getLangChainTools();
```

## Vercel AI SDK

```ts
import { ShabaasAgentToolkitAiSdk } from '@shabaaspay/agent-toolkit/ai-sdk';
import { generateText } from 'ai';

const toolkit = new ShabaasAgentToolkitAiSdk({
  apiKey: process.env.SHABAAS_API_KEY!,
  environment: 'sandbox'
});

const tools = await toolkit.getAiSdkTools();

const response = await generateText({
  model: yourModel,
  tools,
  prompt: 'Retrieve details for payment agreement pa_123'
});
```

## Model Context Protocol

```ts
import { StdioMcpServer, HttpMcpServer } from '@shabaaspay/agent-toolkit/modelcontextprotocol';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new StdioMcpServer({
  apiKey: process.env.SHABAAS_API_KEY!,
  environment: 'sandbox'
});

await server.connect(new StdioServerTransport());
```

## Troubleshooting

- `Missing SHABAAS_API_KEY`: set your API key before running examples.
  - `export SHABAAS_API_KEY=your_key`
- `LangChain adapter requires @langchain/core`:
  - `npm install @langchain/core`
- `AI SDK adapter requires the "ai" package`:
  - `npm install ai`
- `Cannot find module '@shabaaspay/agent-toolkit/*'` in local development:
  - run `npm install` and `npm run build` from `tools/typescript`.

