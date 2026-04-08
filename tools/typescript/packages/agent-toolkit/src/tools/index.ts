import { ShabaasApiClient } from '../api/client.js';
import { Config } from '../config/index.js';
import { createPaymentAgreementTools } from './payment-agreements.js';
import { createPaymentInitiationTools } from './payment-initiations.js';
import { createAuthTools } from './auth.js';

export type { ToolContext } from './response-helpers.js';

export function createAllTools(apiClient: ShabaasApiClient, config: Config) {
  return {
    ...createAuthTools(apiClient, config),
    ...createPaymentAgreementTools(apiClient, config),
    ...createPaymentInitiationTools(apiClient, config)
  };
}

