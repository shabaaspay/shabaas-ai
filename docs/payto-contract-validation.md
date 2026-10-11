# PayTo contract and client validation fixes

Reviewed against smoke #884 and the [Create PayTo Agreement reference](https://shabaaspay-pay.readme.io/reference/post_api-public-payment-agreement).

- Create-agreement HTTP 400 missing-field/provider validation was absent from both YAML files. It is now documented separately from HTTP 422 business/frequency validation.
- The REST YAML and toolkit unconditionally required PayID, while the OpenAPI YAML described conditional BSB/account inputs. Both YAMLs now express the conditional identifier rule with OpenAPI 3.0-compatible `oneOf` rather than unsupported `if`/`then`.
- Tool and direct API client validate BSB/account or PayID inputs before any network request. Bank identifiers accept strings (preserving leading zeroes) and existing numeric inputs. The tool no longer forwards its authorization/presentation options inside the agreement payload.

Verification: `npm run test -w @shabaaspay/agent-toolkit` builds TypeScript and tests identifier validation, valid bank inputs, no-HTTP rejection and credential-field exclusion. Tests use stub clients; no real agreement or payment is created.

## API server issue still outstanding

A direct non-production request with `type: bsb` but neither `bsb` nor `account_number` has returned HTTP 200 and a created agreement in runs #882–#884. The current reference documents HTTP 400 rejection for missing bank details. This repository contains client tools/specifications, not the implementation of `dev-api.shabaas.com`. Client validation prevents SDK callers from sending malformed requests; direct HTTP callers remain exposed until the server is fixed.

Backend acceptance criteria: reject absent, blank or incomplete BSB/account inputs before agreement persistence/provider submission; return the documented error envelope and HTTP 400; ensure no agreement ID or record is created. The direct API regression test in `testplay` must remain failed until this is fixed. Do not change the schema to declare malformed bank requests valid.
