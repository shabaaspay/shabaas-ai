<p align="center">
  <img src="./assets/shabaas-ai-hero.svg" alt="ShaBaas AI hero" width="100%" />
</p>

# ShaBaas AI

This repo is the one-stop shop for building AI-powered products and workflows on top of ShaBaasPay.

It contains SDKs and integration assets to connect ShaBaasPay with LLMs and agent frameworks, including:

- [`@shabaaspay/agent-toolkit`](https://github.com/shabaaspay/shabaas-ai/tree/main/tools/typescript/packages/agent-toolkit) - for integrating ShaBaasPay APIs with popular agent frameworks through function calling (TypeScript).
- API artifacts: MCP contract under `openapi/`, public REST spec for ReadMe under `restapi/`.

## Model Context Protocol (MCP)

ShaBaasPay supports MCP integrations for agent clients.

Remote MCP endpoints:

- Staging: `https://mcp-staging.shabaas.com/mcp`
- Production: `https://mcp.shabaas.com/mcp`

Local toolkit and MCP examples are available below and in `tools/typescript/packages/agent-toolkit/README.md`.

## Agent Toolkit

ShaBaasPay's Agent Toolkit enables frameworks such as LangChain and Vercel's AI SDK to call ShaBaasPay APIs through function-calling tools.

### Installation

You don't need this source code unless you want to modify the package. If you just want to use the package run:

```bash
npm install @shabaaspay/agent-toolkit
```

### Requirements

- Node 22+

### Usage

The library needs to be configured with your account's API key, available in the [ShaBaas Developer Dashboard](https://docs.shabaas.com/dashboard). We strongly recommend using a restricted API key for better security and granular permissions. Tool availability is determined by the permissions configured for that key.

```ts
import { ShabaasAgentToolkit } from '@shabaaspay/agent-toolkit';

const toolkit = new ShabaasAgentToolkit({
  apiKey: process.env.SHABAAS_API_KEY!,
  environment: 'sandbox'
});
```

### Tools

The toolkit works with LangChain and Vercel's AI SDK and can be passed as a list/map of tools.

```ts
const tools = toolkit.getTools();
const getAuthTokenTool = tools.find((t) => t.name === 'get_auth_token');

const result = await getAuthTokenTool?.execute({
  include_token_in_response: false
});
```

### Context

In some cases you may want to set defaults shared across calls. Currently, the toolkit supports environment-level defaults through toolkit initialization.

```ts
const toolkit = new ShabaasAgentToolkit({
  apiKey: process.env.SHABAAS_API_KEY!,
  environment: 'sandbox'
});
```

### LangChain

```ts
import { ShabaasAgentToolkitLangChain } from '@shabaaspay/agent-toolkit/langchain';

const toolkit = new ShabaasAgentToolkitLangChain({
  apiKey: process.env.SHABAAS_API_KEY!,
  environment: 'sandbox'
});

const tools = await toolkit.getLangChainTools();
```

### Vercel AI SDK

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

### Model Context Protocol (Toolkit)

```ts
import { StdioMcpServer, HttpMcpServer } from '@shabaaspay/agent-toolkit/modelcontextprotocol';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new StdioMcpServer({
  apiKey: process.env.SHABAAS_API_KEY!,
  environment: 'sandbox'
});

await server.connect(new StdioServerTransport());
```

### Troubleshooting

- `Missing SHABAAS_API_KEY`: set your API key before running examples.
  - `export SHABAAS_API_KEY=your_key`
- `LangChain adapter requires @langchain/core`:
  - `npm install @langchain/core`
- `AI SDK adapter requires the "ai" package`:
  - `npm install ai`
- `Cannot find module '@shabaaspay/agent-toolkit/*'` in local development:
  - run `npm install` and `npm run build` from `tools/typescript`.

### Quick Start (Repository)

```bash
cd tools/typescript
npm install
npm run build
```

## OpenAPI

- [`OpenAPI`](./openapi/README.md)


## REST API 

- [`RestAPI`](./restapi/README.md)
- Includes REST OpenAPI coverage for auth, agreements, initiations, webhooks, PayID collections, and invoice endpoints.
