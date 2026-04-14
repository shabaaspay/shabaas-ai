# REST API specification

This directory contains the public REST API specification.

- [`Shabaaspay Public API YAML`](./shabaaspay-public-api.yaml) — OpenAPI spec for API reference import.

Use this file for ReadMe-facing REST documentation updates.

## Covered endpoint groups

- Authorization
- Payment Agreements (create, get, resend, bilateral amend, cancel, one-time)
- Payment Initiations (create, get, direct-debit)
- Webhooks (upsert, get)
- PayID Collections (create, status)
- Invoice generation

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

## Example request (resend payment agreement)

```bash
curl -X PATCH "https://api.shabaas.com/api/public/payment_agreement/resend" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "payment_agreement": {
      "id": "3652PA20260408123221550"
    }
  }'
```

## Example request (bilateral amend payment agreement)

```bash
curl -X PATCH "https://api.shabaas.com/api/public/payment_agreement/bilateral" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "payment_agreement": {
      "id": "3652PA20260408123221550",
      "maximum_amount": "750",
      "frequency": "WEEK",
      "number_of_transactions_permitted": "8",
      "agreement_type": "VARI"
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

## Example request (direct debit initiation)

```bash
curl -X POST "https://api.shabaas.com/api/public/payment_initiation/direct_debit" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "direct_debit": {
      "name": "Jon Doe",
      "phone_number": "6141000000",
      "bsb": "484-799",
      "account_number": "079425071",
      "amount": "100",
      "notes": "Testing",
      "consent_received": "true"
    }
  }'
```

## Example request (webhooks upsert)

```bash
curl -X POST "https://api.shabaas.com/api/public/webhooks" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "auth_key": "ABC123",
    "payment_agreement": "https://example.com/payment_agreement",
    "payment_initiation": "https://example.com/payment_initiation",
    "direct_debit_accepted": "https://example.com/direct_debit_accepted",
    "direct_debit_rejected": "https://example.com/direct_debit_rejected"
  }'
```

## Example request (PayID create)

```bash
curl -X POST "https://api.shabaas.com/api/v1/collections/payid" \
  -H "Authorization: sbp_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100,
    "merchant_display_name": "JOE",
    "merchant_country": "AU",
    "merchant_category": "ECOM"
  }'
```

## Example error response (422)

```json
{
  "message": "Amount exceeds allowed limit",
  "error_code": "R101",
  "data": {
    "response_time": "2026-04-10T12:00:00.000Z"
  }
}
```
