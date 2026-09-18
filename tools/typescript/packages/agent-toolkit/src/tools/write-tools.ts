import { ShaBaasApiClient } from '../api/client.js';
import { Config } from '../config/index.js';
import { createPaymentAgreementTools } from './payment-agreements.js';
import { createPaymentInitiationTools } from './payment-initiations.js';
import { type ToolContext, toolErrorResponse, validationErrorResponse } from './response-helpers.js';
import { validateInput } from '../security/validator.js';
import { verifyWriteIntentAsync } from '../security/intent-guard.js';
import {
  CancelPaymentAgreementInputSchema,
  InitiateDirectDebitInputSchema,
  CreatePayIdInputSchema
} from '../types/index.js';
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
  apiClient: ShaBaasApiClient,
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

  const cancelAgreementTool = {
    name: 'cancel_payment_agreement',
    description: 'Cancel an active payment agreement mandate.',
    inputSchema: CancelPaymentAgreementInputSchema,
    execute: async (args: any, context?: ToolContext) => {
      const validation = validateInput(CancelPaymentAgreementInputSchema, args);
      if (!validation.success) return validationErrorResponse(validation.errors ?? [], config.environment);

      const writeCheck = await verifyWriteIntentAsync(config, 'cancel_payment_agreement', validation.data as any);
      if (!writeCheck.allowed) {
        return {
          success: false,
          timestamp: new Date().toISOString(),
          data: null,
          metadata: { requestId: `req_${Date.now()}`, processingTime: 0, environment: config.environment },
          insights: {
            status: 'write_restricted',
            canProceed: false,
            nextActions: ['request_human_approval', 'obtain_intent_token'],
            warnings: [writeCheck.reason || 'Write execution restricted']
          },
          summary: writeCheck.reason || 'Cancel payment agreement write restricted'
        };
      }

      try {
        const { payment_agreement_id } = validation.data!;
        const response = await apiClient.cancelPaymentAgreement(payment_agreement_id, { requestUuid: context?.requestUuid });
        return {
          success: true,
          timestamp: new Date().toISOString(),
          data: response,
          metadata: { requestId: `req_${Date.now()}`, processingTime: 0, environment: config.environment },
          insights: { status: 'cancelled', canProceed: false, nextActions: [] },
          summary: `Payment agreement ${payment_agreement_id} successfully cancelled.`
        };
      } catch (error: any) {
        return toolErrorResponse(error.message || 'Failed to cancel payment agreement', config.environment);
      }
    }
  };

  const directDebitTool = {
    name: 'initiate_direct_debit',
    description: 'Initiate a direct debit payment against customer bank account (BECS).',
    inputSchema: InitiateDirectDebitInputSchema,
    execute: async (args: any, context?: ToolContext) => {
      const validation = validateInput(InitiateDirectDebitInputSchema, args);
      if (!validation.success) return validationErrorResponse(validation.errors ?? [], config.environment);

      const merchantId = apiClient.getAuthenticatedMerchantId(context?.requestUuid);
      const amount = Number(validation.data?.amount);

      if (!isNaN(amount) && amount > 0) {
        const budgetCheck = await spendingStore.checkAndRecordSpend(merchantId, amount);
        if (!budgetCheck.allowed) {
          return {
            success: false,
            timestamp: new Date().toISOString(),
            data: null,
            metadata: { requestId: `req_${Date.now()}`, processingTime: 0, environment: config.environment },
            insights: {
              status: 'spending_limit_exceeded',
              canProceed: false,
              nextActions: ['request_budget_increase'],
              warnings: [budgetCheck.reason || 'Spending limit exceeded']
            },
            summary: `Direct debit blocked by Agent Spending Limit: ${budgetCheck.reason}`
          };
        }
      }

      const writeCheck = await verifyWriteIntentAsync(config, 'initiate_direct_debit', validation.data as any);
      if (!writeCheck.allowed) {
        return {
          success: false,
          timestamp: new Date().toISOString(),
          data: null,
          metadata: { requestId: `req_${Date.now()}`, processingTime: 0, environment: config.environment },
          insights: {
            status: 'write_restricted',
            canProceed: false,
            nextActions: ['request_human_approval', 'obtain_intent_token'],
            warnings: [writeCheck.reason || 'Write execution restricted']
          },
          summary: writeCheck.reason || 'Direct debit initiation write restricted'
        };
      }

      try {
        const response = await apiClient.initiateDirectDebit(validation.data, { requestUuid: context?.requestUuid });
        return {
          success: true,
          timestamp: new Date().toISOString(),
          data: response.data,
          metadata: { requestId: `req_${Date.now()}`, processingTime: 0, environment: config.environment },
          insights: { status: response.data?.status || 'submitted', canProceed: true, nextActions: [] },
          summary: `Direct debit payment of $${amount} submitted successfully.`
        };
      } catch (error: any) {
        return toolErrorResponse(error.message || 'Failed to initiate direct debit', config.environment);
      }
    }
  };

  const createPayIdTool = {
    name: 'create_payid',
    description: 'Create an inbound PayID for merchant payment collection.',
    inputSchema: CreatePayIdInputSchema,
    execute: async (args: any, context?: ToolContext) => {
      const validation = validateInput(CreatePayIdInputSchema, args);
      if (!validation.success) return validationErrorResponse(validation.errors ?? [], config.environment);

      const writeCheck = await verifyWriteIntentAsync(config, 'create_payid', validation.data as any);
      if (!writeCheck.allowed) {
        return {
          success: false,
          timestamp: new Date().toISOString(),
          data: null,
          metadata: { requestId: `req_${Date.now()}`, processingTime: 0, environment: config.environment },
          insights: {
            status: 'write_restricted',
            canProceed: false,
            nextActions: ['request_human_approval'],
            warnings: [writeCheck.reason || 'Write execution restricted']
          },
          summary: writeCheck.reason || 'PayID creation write restricted'
        };
      }

      try {
        const response = await apiClient.createPayId(validation.data, { requestUuid: context?.requestUuid });
        return {
          success: true,
          timestamp: new Date().toISOString(),
          data: response.data,
          metadata: { requestId: `req_${Date.now()}`, processingTime: 0, environment: config.environment },
          insights: { status: response.data?.status || 'created', canProceed: true, nextActions: [] },
          summary: `PayID collection successfully created.`
        };
      } catch (error: any) {
        return toolErrorResponse(error.message || 'Failed to create PayID', config.environment);
      }
    }
  };

  return {
    create_payment_agreement: agreementTools.create_payment_agreement,
    initiate_payment: guardedInitiate,
    cancel_payment_agreement: cancelAgreementTool,
    initiate_direct_debit: directDebitTool,
    create_payid: createPayIdTool
  };
}

export type WriteTools = ReturnType<typeof createWriteTools>;
