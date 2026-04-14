# OpenAPI Specifications

This directory contains the MCP-related OpenAPI specification.

- [`Shabaas AI Open API YAML`](./openapi.yaml) — canonical spec for the MCP tools.

## Example (operation mapping)

```yaml
paths:
  /api/public/payment_initiation:
    get:
      x-mcp-tool: get_payment_initiation
```

## Example (tool mapping by operation)

### Authorization

```yaml
/api/public/authorization:
  post:
    x-mcp-tool: get_auth_token
```

### Payment Agreement (get)

```yaml
/api/public/payment_agreement:
  get:
    x-mcp-tool: get_payment_agreement
```

### Payment Agreement (create)

```yaml
/api/public/payment_agreement:
  post:
    x-mcp-tool: create_payment_agreement
```

### Payment Initiation (create)

```yaml
/api/public/payment_initiation:
  post:
    x-mcp-tool: initiate_payment
```

### Payment Initiation (get)

```yaml
/api/public/payment_initiation:
  get:
    x-mcp-tool: get_payment_initiation
```

## Example (request wrapper)

```yaml
requestBody:
  content:
    application/json:
      schema:
        type: object
        required: [payment_initiation]
        properties:
          payment_initiation:
            $ref: '#/components/schemas/CreatePaymentInitiationRequest'
```

## Example (invalid frequency case)

```yaml
responses:
  '422':
    content:
      application/json:
        examples:
          invalid_frequency:
            value:
              message: Invalid frequency value
              error_code: VALIDATION_ERROR
```
