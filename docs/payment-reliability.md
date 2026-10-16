# Consolidated payment reliability implementation

Source: ShaBaas Pay Consolidated Platform Review v1.2, T01–T40 and C01–C16.
Status: **foundation implemented for review; full Stripe parity and production cutover BLOCKED**.
No production deployment, merchant setting, provider configuration, payment, or main-branch merge is part of this change.

## Repository assessment

| Repository | Required work |
|---|---|
| shabaasBE | Durable initiation identity, payment events, delivery, polling and card-result correctness |
| shabaaspay-mcp-server | Stable caller-persisted identity in Node and Cloudflare paths; recovery; tests |
| shabaas-ai | Matching TypeScript toolkit, signature verification and API contract |
| testplay | Retain all 56 acceptance requirements and fail closed without reviewed evidence |
| developerDashboard | No UI change in this foundation; future webhook/profile/operator UI still needs assessment |
| sbpwebui / web | Marketing sites; not the active hosted-checkout implementation |
| shabaasFE | Archived mobile frontend; not the Jovarna storefront |
| Jovarna storefront / active hosted-checkout frontend | Not available in connected repositories; required before parity can be implemented/validated |

## Unresolved release blockers

1. Obtain the actual beta.jovarna.com storefront and hosted/embedded-checkout source repositories. Implement server-owned cart/quote/session binding, all baseline Stripe methods, return-URL allowlists, order/stock/fulfilment idempotency, abandoned/expired/late-payment journeys, refunds/disputes, accessibility and browser/device parity. These are not established by this backend work.
2. Complete authoritative provider callback authenticity, amount/reference matching and monotonic state transitions. Merchant-facing HMAC does not authenticate provider ingestion. Existing callback code remains a critical release dependency.
3. Implement and prove automated resolution of uncertain provider outcomes (including crash before/after dispatch) without re-debit. The new operation lookup/replay preserves uncertainty; it is not an automatic bank-reconciliation engine.
4. Complete bounded legacy fingerprint/ambiguity handling, pending-exposure accounting across every payment entry point, request/poll/replay rate limits, explicit failed-attempt resolution, and risk reservations/release under concurrency. Legacy R804 cooldowns remain for no-key callers; no heuristic retry is declared proven identical.
5. Extend the signed immutable outbox contract to agreement/direct-debit event types if enabled. The new signed_v2/polling profile applies to payment-initiation state events; other legacy webhook types still use Authorization. Validate the affected client's actual gateway and event subscriptions before enabling a profile.
6. Complete operator-authorised event replay, exhaustion alerts, secret revocation/emergency rotation, event retention/cursor expiry, metrics, backup/restore and recovery drills. Current rows are retained without automatic pruning; no safe-to-delete retention is asserted.
7. Configure isolated sandbox/live databases, queue, credentials, encryption keys and workers; review existing checked-in credentials and rotate them through the approved secret-management process. Provision EWAY_API_KEY, EWAY_API_PASSWORD, EWAY_ENVIRONMENT explicitly before enabling cards. Production rejects the sandbox environment.
8. Execute all applicable acceptance tests against pinned deployed commits/configuration and provider sandboxes. Local contract tests are not live-provider, gateway, load, financial reconciliation or storefront evidence.
9. Enforce reviewed required checks and deployment protections in repository/environment administration. Read access to shabaasBE branch protection/rulesets returned 403; this change cannot claim those policies are enforced. Existing dependency-audit/OAuth PRs were not merged or incorporated automatically; their current findings remain release gates.

The design scores in the source document are not implementation-completion scores. No acceptance item is marked passed solely because code or a unit test exists.

## Client behaviour

`initiate_payment` now requires caller-persisted `idempotency_key` and `merchant_reference`. This is an intentional tool-schema change; deploy backend support first and version/release the tool update deliberately. The caller must persist identity before invocation and reuse it across process restarts, authentication refresh, timeout and manual retries. This SDK does not provide a durable agent-intent database. Never generate a fresh key simply because an outcome is uncertain.

The key goes in the HTTP Idempotency-Key header; the business reference goes inside payment_initiation. Amounts must be positive decimal values with at most two decimal places; they are not silently rounded. Existing notes/description precedence remains notes first.

Use `get_payment_operation` after uncertain creation and `get_payment_events` for authenticated reconciliation; SDK methods `getPaymentOperation` and `getPaymentEvents` expose the same read paths. These operations remain subject to tool permissions and merchant authentication.

`verifyPaymentWebhook` is a Node helper (raw Buffer, signature/timestamp/event headers, accepted key-ID→secret map, expected merchant/environment). It rejects body tampering, old/future timestamps, unknown keys and scope mismatches without relying on Authorization. It deliberately does not acknowledge, deduplicate, fulfil orders or store cursors: the receiving application must commit its event ledger and business effects transactionally before acknowledgement. Do not use JSON middleware ahead of raw-body capture. Accept only configured key IDs and retire revoked secrets through trusted configuration.

Run `npm test` in the MCP root, or `npm test -w @shabaaspay/agent-toolkit` from shabaas-ai/tools/typescript. Tests use synthetic data and local mock adapters; they do not call a bank. Match all enabled entry points, including Cloudflare, in sandbox integration tests before release.
