# Developer & Agent Review Guide: Security Baseline & MCP Gating

> **Target Audience**: This document is specifically formatted for software engineers and AI coding agents conducting a 4-eye architectural and code review of branch [`feature/security-baseline-and-mcp-gating`](https://github.com/shabaaspay/shabaas-ai/tree/feature/security-baseline-and-mcp-gating).

---

## 1. Executive Summary & Context

This feature branch delivers the comprehensive application-level security baseline for `shabaas-ai` in strict compliance with:
1. **ShaBaas Pay Security Implementation Plan** (`ShaBaas_Pay_Security_Implementation_Plan.docx`).
2. **Canonical ShaBaasPay OpenAPI Specification** ([shabaaspay/openapi](https://github.com/shabaaspay/openapi)).

### Strict Invariants & Boundaries
- **Cloudflare Rule #2 Unchanged**: Cloudflare WAF Rule #2 (`FIRST RULE IMP BLOCK ALL PROD MCP` on `mcp.shabaas.com`) remains **strictly intact**. Production MCP access remains blocked until human authorization gates and exact-intent binding are active in production.
- **Testing Target**: All agent integration tests, tool fuzzing, and staging runs target `mcp-staging.shabaas.com` (which proxies to `dev-api.shabaas.com`).
- **Transport Topology**: The remote MCP server uses Server-Sent Events (SSE). It requires an initial `GET` handshake expecting `Accept: text/event-stream`, followed by `POST` requests for JSON-RPC messages.

---

## 2. Directory & Component Architecture Map

```
shabaas-ai/
├── .github/
│   ├── CODEOWNERS                           # Security & toolkit code ownership
│   ├── dependabot.yml                       # Weekly automated updates for npm & GitHub Actions
│   ├── semgrep/
│   │   └── payment-security.yml             # Custom static analysis (SSRF bypass, BOLA, credential logs)
│   └── workflows/
│       └── security-scans.yml               # Hardened CI: CodeQL, TruffleHog, Trivy FS, Semgrep (commit-pinned)
├── .husky/pre-commit                        # Developer pre-commit secret scanning hook (TruffleHog)
├── .pre-commit-config.yaml                  # Pre-commit framework configuration
├── SECURITY.md                              # Vulnerability reporting & security policy
├── openapi/
│   └── openapi.yaml                         # MCP OpenAPI spec (canonical parity, Idempotency-Key, intent_token)
├── restapi/
│   └── shabaaspay-public-api.yaml           # Public REST OpenAPI spec (canonical parity, Monoova error shapes)
└── tools/typescript/packages/agent-toolkit/
    ├── src/
    │   ├── api/
    │   │   └── client.ts                    # Auto-idempotency (UUIDv4), IdempotencyConflictError (409), BOLA tenant ID
    │   ├── security/
    │   │   ├── circuitBreaker.ts            # 15-min sliding window failure rate monitor per rail (PayTo vs BECS)
    │   │   ├── intent-guard.ts              # Write tool registry & permission checks (production Ed25519 gate)
    │   │   ├── intentValidator.ts           # Ed25519 signature validation, SHA-256 intent hashing, NonceStore
    │   │   ├── postgresNonceStore.ts        # Atomic PostgreSQL conditional update query for multi-instance Cloud Run
    │   │   ├── spendingBudgetGuard.ts       # Per-tx and 24h rolling velocity budget limits
    │   │   └── validator.ts                 # Zod runtime input validation
    │   ├── tools/
    │   │   ├── payment-agreements.ts        # PayTo agreement tool implementations
    │   │   ├── payment-initiations.ts       # PayTo payment initiation tool implementations
    │   │   ├── read-tools.ts                # Read-only MCP service tools (BOLA checks, 50KB limits, PII redaction)
    │   │   └── write-tools.ts               # Isolated Write MCP tools (spending limit & intent gated)
    │   ├── types/
    │   │   └── index.ts                     # Zod schemas (PayTo, BECS direct debit, cancel, PayID, intent_token)
    │   ├── utils/
    │   │   ├── redactor.ts                  # PII & banking masking (BSB, account numbers, PayIDs, bearer tokens)
    │   │   ├── securityHeaders.ts           # Strict CORS, CSP, X-Frame-Options, SSE non-buffering headers
    │   │   └── ssrfSafeClient.ts            # Dial-time DNS SSRF protection (blocks RFC 1918, loopback, AWS metadata)
    │   └── modelcontextprotocol.ts          # Read-MCP vs Write-MCP service separation
    └── test/
        ├── promptfooconfig.yaml             # Promptfoo LLM safety & prompt injection evaluation suite
        └── security-baseline.test.ts        # Automated unit test suite (22 tests across 10 suites)
```

---

## 3. Core Security Controls Implemented

### A. Egress SSRF Defense (`src/utils/ssrfSafeClient.ts`)
- Implements custom `http.Agent` and `https.Agent` using dial-time `lookup` resolution.
- Evaluates the resolved IP address before socket connection:
  - **Blocks**: IPv4 Loopback (`127.0.0.0/8`), Link-Local (`169.254.0.0/16` / Cloud Metadata `169.254.169.254`), Private RFC 1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), Carrier-Grade NAT (`100.64.0.0/10`), IPv6 Loopback (`::1`), Link-Local (`fe80::/10`), Unique Local (`fc00::/7`), and IPv4-mapped IPv6 addresses.
- Enforces `maxRedirects: 0` to prevent DNS rebinding and redirect smuggling attacks.
- Wired as the sole transport mechanism inside `ShaBaasApiClient`.

### B. Out-of-Band Intent Binding & Replay Protection (`src/security/`)
- **Ed25519 Cryptographic Signatures**: In production (`environment: 'production'`), all write tools fail closed unless accompanied by an `intent_token` signed by an authorized human approval service.
- **Exact Intent Digest Binding**: Computes a canonicalized SHA-256 hash over mutating arguments (`payment_agreement_id`, `amount`, `destination`, etc.). Rejects any payload tampering or prompt injection alterations.
- **5-Minute Validity & Skew Windows**: Rejects expired tokens or tokens with clock skew exceeding 60 seconds.
- **Single-Use Atomic Nonces**:
  - `InMemoryNonceStore`: Reference atomic store with periodic expired nonce purging for development/testing.
  - `PostgresNonceStore`: Production database-backed atomic store executing:
    ```sql
    UPDATE mcp_intent_nonces
    SET status = 'CONSUMED', consumed_at = NOW()
    WHERE nonce_id = $1 AND status = 'UNUSED' AND expires_at > NOW();
    ```
    Guarantees at-most-once execution across distributed Cloud Run instances.

### C. Client Auto-Idempotency (`src/api/client.ts`)
- Automatically generates and attaches an `Idempotency-Key` header (`UUIDv4`) on all mutation operations (`POST`, `PATCH`, `DELETE`) if not supplied by the caller.
- Preserves the generated idempotency key across retry attempts to guarantee upstream banking idempotency.
- Intercepts HTTP 409 responses and throws strongly typed `IdempotencyConflictError` containing canonical error codes (`GN-0409`).

### D. Per-Rail Circuit Breaker Telemetry (`src/security/circuitBreaker.ts`)
- Implements Section 1, Proposal 12 of the Security Implementation Plan.
- Maintains rolling 15-minute failure rate metrics independently for `PayTo` and `BECS` payment rails.
- If failure rate exceeds 15% across $\ge 20$ transactions, the rail trips to `TRIPPED` status, allowing agents to route around degraded payment infrastructure.

### E. MCP Service Separation (Read vs Write)
- **`ShaBaasReadMcpServer`**: Mounts only read tools (`get_payment_agreement`, `get_payment_initiation`, `get_payid_status`). Deployed with read-only IAM service account credentials.
- **`ShaBaasWriteMcpServer`**: Mounts only write tools (`initiate_payment`, `create_payment_agreement`, `initiate_direct_debit`, `cancel_payment_agreement`, `create_payid`). Enforces intent token checks and spending limits.
- **`ShaBaasMcpServer`**: Unified server supporting both read and write tools for local development.

### F. Broken Object Level Authorization (BOLA) Defense (`src/tools/read-tools.ts`)
- Resolves tenant identity from verified session/key claims via `apiClient.getAuthenticatedMerchantId()`.
- Explicitly validates that model-supplied arguments matching `merchant_id` align with the authenticated merchant context. Cross-tenant access queries are rejected immediately.

### G. Banking Data Minimization & Redaction (`src/utils/redactor.ts`)
- Recursively inspects all MCP responses and log payloads:
  - Masks Australian BSBs (`***-***`).
  - Masks Australian bank account numbers (`****${last3}`).
  - Masks PayIDs (RFC 5322 emails and E.164 phone numbers).
  - Masks Bearer tokens and API keys (`Bearer [REDACTED]`).
- Enforces a 50KB payload boundary, truncating oversized arrays with explicit pagination notices to prevent context poisoning and model denial-of-service.

### H. Agent Spending Limits & Velocity Guard (`src/security/spendingBudgetGuard.ts`)
- Enforces per-transaction caps ($10,000 AUD default) and 24-hour rolling budget caps ($50,000 AUD default) per merchant.
- Gated inside `write-tools.ts` for all money-movement operations.

### I. Cloudflare Edge API Shield & OpenAPI Synchronization
- Synchronized `openapi/openapi.yaml` and `restapi/shabaaspay-public-api.yaml` with the canonical [shabaaspay/openapi](https://github.com/shabaaspay/openapi) schema.
- Added `Idempotency-Key` (UUIDv4) header parameters and `intent_token` properties to prevent edge drops when Cloudflare API Shield switches from Log to Block mode.
- Declared `403 Forbidden` (`GN-0403`), `409 Conflict` (`GN-0409`), and `429 Too Many Requests` (`GN-0429`) error responses conforming to Monoova's standard envelope (`{ message, error_code, data }`).

### J. CI/CD Hardening & Static Analysis
- **GitHub Actions Least Privilege**: Enforces top-level `permissions: read-all` in `.github/workflows/security-scans.yml`.
- **Commit SHA Pinning**: All GitHub Actions pinned to immutable 40-character commit hashes.
- **Multi-Engine Scanning**:
  - CodeQL (JavaScript/TypeScript security-extended).
  - TruffleHog (secret detection across full git history).
  - Trivy (filesystem & dependency vulnerability scanning).
  - Semgrep OSS (custom payment security ruleset in `.github/semgrep/payment-security.yml`).
  - Dependabot (weekly automated npm & actions updates).

---

## 4. Verification Guide for Reviewing Agents

To verify the integrity and correctness of this feature branch locally, execute the following commands:

### Step 1: Install & Build TypeScript Package
```bash
cd tools/typescript
npm install
npm run build
```
*Expected result: Clean compilation via `tsc` with zero errors.*

### Step 2: Run Unit Test Suite
```bash
npm test
```
*Expected result: 22 tests passing across 10 test suites (0 failures, 0 skipped).*

```
# Subtest: SSRF Protection (Egress Guardrails)
# Subtest: Write-MCP Ed25519 Intent Gate & Atomic Nonces
# Subtest: Read-MCP: Redaction & Export Size Limits
# Subtest: Read-MCP: Tenant-Bound Authorization (BOLA Prevention)
# Subtest: Write-MCP: Agent Spending Limits & Velocity Guard
# Subtest: HTTP/SSE Edge Hardening & CORS
# Subtest: Client Auto-Idempotency & Canonical Monoova Errors
# Subtest: Circuit Breaker per Rail Telemetry
# Subtest: PostgreSQL Atomic Nonce Store (Multi-Instance Replay Protection)
# Subtest: Expanded Write Tools Gating (PayTo + BECS Direct Debit + Cancellation)
# tests 22
# suites 10
# pass 22
```

### Step 3: Validate OpenAPI YAML Schemas
```bash
npx js-yaml ../../openapi/openapi.yaml > /dev/null
npx js-yaml ../../restapi/shabaaspay-public-api.yaml > /dev/null
```
*Expected result: Both OpenAPI specifications parse cleanly with exit code 0.*

---

## 5. Summary of Commits on this Branch

| Commit Hash | Message Summary |
|---|---|
| `537b89d` | Initial security baseline: TruffleHog pre-commit, SSRF guardrails, Ed25519 intent gate, read/write service split, spending limits, security headers, Promptfoo eval |
| `10cefb6` | GitHub Actions hardening (pinned SHAs, least privilege), Trivy FS scanner, Dependabot weekly updates, PII redaction & 50KB limits, BOLA defense |
| `74fd7e2` | Canonical OpenAPI parity (`shabaaspay/openapi`), auto-idempotency (`UUIDv4`), `IdempotencyConflictError`, per-rail circuit breaker, PostgreSQL atomic nonce store, expanded write gating, Semgrep CI |
