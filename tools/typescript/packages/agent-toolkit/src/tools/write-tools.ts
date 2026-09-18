import { ShabaasApiClient } from '../api/client.js';
import { Config } from '../config/index.js';
import { createPaymentAgreementTools } from './payment-agreements.js';
import { createPaymentInitiationTools } from './payment-initiations.js';
import { type ToolContext } from './response-helpers.js';
import {
  type SpendingLimitStore,
  defaultSpendingLimitStore
} from '../security/spendingBudgetGuard.js';

export interface WriteToolsOptions {
  spendingLimitStore?: SpendingLimitStore;
}

/**
 * Creates and returns all Write-capable MCP tools (payment execution, state mutation).
 * This module is intended to be loaded exclusively by the isolated Write MCP service
 * with separate IAM credentials, audit logging, Ed25519 intent gating, and velocity spending limits.
 */
export function createWriteTools(
  apiClient: ShabaasApiClient,
  config: Config,
  options?: WriteToolsOptions
) {
  const agreementTools = createPaymentAgreementTools(apiClient, config);
  const initiationTools = createPaymentInitiationTools(apiClient, config);
  const spendingStore = options?.spendingLimitStore ?? defaultSpendingLimitStore;

  const rawInitiate = initiationTools.initiate_payment;
  const guardedInitiate = {
    ...rawInitiate,
    execute: async (args: any, context?: ToolContext) => {
      const merchantId = apiClient.getAuthenticatedMerchantId(context?.requestUuid);
      const amount = Number(args?.amount);

      // Velocity & Budgeting Guard: Check merchant spending limit before dispatch
      if (!isNaN(amount) && amount > 0) {
        const budgetCheck = await spendingStore.checkAndRecordSpend(merchantId, amount);
        if (!budgetCheck.allowed) {
          return {
            success: false,
            timestamp: new Date().toISOString(),
            data: null,
            metadata: {
              requestId: `req_${Date.now()}`,
              processingTime: 0,
              environment: config.environment
            },
            insights: {
              status: 'spending_limit_exceeded',
              canProceed: false,
              nextActions: ['request_budget_increase', 'contact_merchant_admin'],
              warnings: [budgetCheck.reason || 'Transaction exceeds configured spending limit']
            },
            summary: `Payment execution blocked by Agent Spending Limit: ${budgetCheck.reason}`
          };
        }
      }

      return rawInitiate.execute(args, context);
    }
  };

  return {
    create_payment_agreement: agreementTools.create_payment_agreement,
    initiate_payment: guardedInitiate
  };
}

export type WriteTools = ReturnType<typeof createWriteTools>;
