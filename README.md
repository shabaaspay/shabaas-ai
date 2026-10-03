<p align="center">
  <img src="./assets/shabaas-ai-hero.svg" alt="ShaBaas AI hero" width="100%" />
</p>

# ShaBaas AI

This repo is the one-stop shop for building AI-powered products and workflows on top of ShaBaasPay.

It contains SDKs and integration assets to connect ShaBaasPay with LLMs and agent frameworks, including:

- [`@shabaaspay/agent-toolkit`](https://github.com/shabaaspay/shabaas-ai/tree/main/tools/typescript/packages/agent-toolkit) - for integrating ShaBaasPay APIs with popular agent frameworks through function calling (TypeScript).
- API artifacts: MCP contract under `openapi/`, public REST spec for ReadMe under `restapi/`.

## Start in the self-serve staging environment

1. [Create an account](https://www.shabaas.com/signup) with email and password, Google or GitHub. Your account opens in the staging dashboard.
2. For a dashboard trial, select **Create Invoice**, enter the details and share the resulting payment-page link. The optional email flow sends the link to the customer.
3. For an API trial, create an API key in the dashboard and [exchange it for a bearer token](https://shabaaspay-pay.readme.io/reference/post_api-public-authorization). Keep the key and token server-side.

```bash
# Set SHABAAS_API_KEY securely in your shell first.
curl -X POST 'https://dev-api.shabaas.com/api/public/authorization' \
  -H "Authorization: ${SHABAAS_API_KEY}"
```

Use the resulting bearer token for supported endpoints, following the [REST OpenAPI specification](./restapi/shabaaspay-public-api.yaml) and [API reference](https://shabaaspay-pay.readme.io/reference). An API response is not proof of payment settlement. Production access requires onboarding and approval for the intended use case.

**Implementation references:** [payment initiation statuses](https://shabaaspay-pay.readme.io/reference/payment-initiation-status-values) · [PayTo payment errors](https://shabaaspay-pay.readme.io/reference/payto-payment-error-codes) · [PayTo agreement errors](https://shabaaspay-pay.readme.io/reference/payto-agreement-error-codes) · [webhook notification examples](https://shabaaspay-pay.readme.io/reference/webhook-notification-management).

## Model Context Protocol (MCP)

ShaBaasPay supports MCP integrations for agent clients.

Remote MCP endpoints:

- Staging (sandbox evaluation): `https://mcp-staging.shabaas.com/mcp`
- Production (approved access): `https://mcp.shabaas.com/mcp`

See the [MCP connection guide](https://docs.shabaas.com/developer) for client setup and the currently advertised hosted tool list. The local toolkit, OpenAPI contract and deployed endpoint may expose different inventories; verify the tool list for the environment and credentials in use.

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
- The MCP contract maps eight operations: authorization; PayTo agreement create/get/amend; payment initiation create/get; direct debit initiation; and invoice generation. The published connection guide may list additional hosted tools. Confirm deployed availability before describing any tool as supported.


## REST API 

- [`RestAPI`](./restapi/README.md)
- Includes REST OpenAPI coverage for auth, agreements, initiations, webhooks, PayID collections, and invoice endpoints.
