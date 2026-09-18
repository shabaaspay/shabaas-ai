# ShaBaas Pay Security Policy

## Reporting Security Vulnerabilities

ShaBaas Pay takes the security of our payment integrations, Model Context Protocol (MCP) servers, and agent toolkits seriously. If you identify a security issue, vulnerability, or potential exploit, please report it immediately to our security response team.

### How to Report
- **Email**: `security@shabaas.com`
- Please encrypt sensitive details using our PGP key where appropriate.
- Include detailed reproduction steps, environment details, affected tool/API endpoints, and proof-of-concept payload if available.
- **Do not** file public GitHub issues for security vulnerabilities.

### Responsible Disclosure & Incident Response
- We commit to acknowledging receipt within 24 hours.
- We will coordinate patch verification and responsible disclosure timelines.
- For high-severity issues (unauthorized fund initiation, cross-tenant data leakage, secret exposure), mitigation commences immediately under our P0 incident protocol.

## MCP Security Architecture Notice
ShaBaas Pay MCP servers enforce cryptographic intent validation:
- Public registry discovery endpoints default to read-only toolsets.
- Money movement operations require out-of-band human authorization and single-use Ed25519 intent tokens with atomic replay protection.
