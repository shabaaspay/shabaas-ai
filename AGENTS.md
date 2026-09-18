# AGENTS.md

## Repository Rules & Style Guidelines

### Brand & Code Case Consistency
- **Rule**: Always use the casing **`ShaBaas`** (capital `S`, lowercase `ha`, capital `B`, lowercase `aas`) — never "Shabaas".
- **Brand Names**:
  - `ShaBaas`
  - `ShaBaasPay`
  - `ShaBaas AI`
- **Code Identifiers & Classes**:
  - `ShaBaasAgentToolkit`
  - `ShaBaasAgentToolkitLangChain`
  - `ShaBaasAgentToolkitAiSdk`
  - `ShaBaasApiClient`
  - `ShaBaasReadMcpServer`
  - `ShaBaasWriteMcpServer`
  - `ShaBaasMcpServer`
  - `ShaBaasFunctionTool`
  - `ShaBaasAgentToolkitOptions`
  - `ShaBaasMcpServerOptions`
- **HTTP Headers**:
  - Primary: `X-ShaBaas-Client` (accept legacy `X-Shabaas-Client` for backward compatibility).
- **Exceptions (Protocols, URLs & Package Names)**:
  - npm scope: `@shabaaspay/...`
  - Hostnames: `mcp.shabaas.com`, `mcp-staging.shabaas.com`, `api.shabaas.com`, `dev-api.shabaas.com`
  - GitHub repo URLs: `https://github.com/shabaaspay/shabaas-ai`
