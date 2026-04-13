# Public API

This directory contains the public REST API specification.

- [`Shabaaspay Public API YAML`](./shabaaspay-public-api.yaml) — OpenAPI spec for API reference import.

Use this file for ReadMe-facing REST documentation updates.

## Example request (token)

```bash
curl -X POST "https://api.shabaas.com/api/public/authorization" \
  -H "Authorization: sbp_live_xxx"
```

## Example request (create payment agreement)

```bash
curl -X POST "https://api.shabaas.com/api/public/payment_agreement" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "payment_agreement": {
      "name": "John Smith",
      "type": "email",
      "maximum_amount": "500",
      "frequency": "ADHO",
      "number_of_transactions_permitted": 10,
      "pay_id": "sample@shabaas.com"
    }
  }'
```

## Example request (get payment agreement)

```bash
curl -X GET "https://api.shabaas.com/api/public/payment_agreement?id=3652PA20260408123221550" \
  -H "Authorization: Bearer <token>"
```

## Example request (initiate payment)

```bash
curl -X POST "https://api.shabaas.com/api/public/payment_initiation" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "payment_initiation": {
      "payment_agreement_id": "3652PA20260308123221550",
      "amount": "10.00",
      "notes": "Invoice 1042"
    }
  }'
```

## Example error response (422)

```json
{
  "message": "Invalid frequency value",
  "error_code": "VALIDATION_ERROR",
  "data": {
    "field": "frequency"
  }
}
```
