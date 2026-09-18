import { ShabaasApiClient } from '../api/client.js';
import { Config } from '../config/index.js';
import { createPaymentAgreementTools } from './payment-agreements.js';
import { createPaymentInitiationTools } from './payment-initiations.js';

/**
 * Creates and returns all Write-capable MCP tools (payment execution, state mutation).
 * This module is intended to be loaded exclusively by the isolated Write MCP service
 * with separate IAM credentials, audit logging, and Ed25519 intent gating.
 */
export function createWriteTools(apiClient: ShabaasApiClient, config: Config) {
  const agreementTools = createPaymentAgreementTools(apiClient, config);
  const initiationTools = createPaymentInitiationTools(apiClient, config);

  return {
    create_payment_agreement: agreementTools.create_payment_agreement,
    initiate_payment: initiationTools.initiate_payment
  };
}

export type WriteTools = ReturnType<typeof createWriteTools>;
