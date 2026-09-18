import { ShabaasApiClient } from '../api/client.js';
import { Config } from '../config/index.js';
import { createAuthTools } from './auth.js';
import { createPaymentAgreementTools } from './payment-agreements.js';
import { createPaymentInitiationTools } from './payment-initiations.js';

/**
 * Creates and returns all Read-only MCP tools (queries, search, bounded reporting).
 * Safe for deployment in public-facing discovery or Read-only MCP microservices.
 */
export function createReadTools(apiClient: ShabaasApiClient, config: Config) {
  const authTools = createAuthTools(apiClient, config);
  const agreementTools = createPaymentAgreementTools(apiClient, config);
  const initiationTools = createPaymentInitiationTools(apiClient, config);

  return {
    get_auth_token: authTools.get_auth_token,
    get_payment_agreement: agreementTools.get_payment_agreement,
    get_payment_initiation: initiationTools.get_payment_initiation
  };
}

export type ReadTools = ReturnType<typeof createReadTools>;
