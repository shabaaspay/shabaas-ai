import { ShabaasApiClient } from '../api/client.js';
import { enrichPaymentAgreement } from '../enricher/index.js';
import { GetPaymentAgreementInputSchema, CreatePaymentAgreementInputSchema, PaymentAgreementSchema } from '../types/index.js';
import { validateInput } from '../security/validator.js';
import { Config } from '../config/index.js';
import { validationErrorResponse, toolErrorResponse, type ToolContext } from './response-helpers.js';

export function createPaymentAgreementTools(apiClient: ShabaasApiClient, config: Config) {
  return {
    get_payment_agreement: {
      name: 'get_payment_agreement',
      description: 'Retrieve a payment agreement with optional enrichment.',
      inputSchema: GetPaymentAgreementInputSchema,
      execute: async (args: unknown, context?: ToolContext) => {
        const startTime = Date.now();
        const validation = validateInput(GetPaymentAgreementInputSchema, args);
        if (!validation.success) return validationErrorResponse(validation.errors ?? [], config.environment);
        try {
          const { payment_agreement_id, enrich, include_raw } = validation.data!;
          const response = await apiClient.getPaymentAgreement(payment_agreement_id, { requestUuid: context?.requestUuid });
          if (!response.data) return toolErrorResponse('Payment agreement not found', config.environment, response);
          const agreementData = PaymentAgreementSchema.parse(response.data);
          if (!enrich) {
            return {
              success: true,
              timestamp: new Date().toISOString(),
              data: agreementData,
              metadata: { requestId: `req_${Date.now()}`, processingTime: Date.now() - startTime, environment: config.environment },
              insights: { status: agreementData.status, canProceed: agreementData.status?.toLowerCase?.() === 'active', nextActions: ['get_payment_agreement'] },
              summary: 'Enrichment disabled. Returning agreement data only.',
              ...(include_raw ? { raw: response } : {})
            };
          }
          return enrichPaymentAgreement(agreementData, !!include_raw, response, config.environment);
        } catch (error: any) {
          return toolErrorResponse(error.message || 'Failed to get payment agreement', config.environment);
        }
      }
    },
    create_payment_agreement: {
      name: 'create_payment_agreement',
      description: 'Create a new payment agreement.',
      inputSchema: CreatePaymentAgreementInputSchema,
      execute: async (args: unknown, context?: ToolContext) => {
        const startTime = Date.now();
        const validation = validateInput(CreatePaymentAgreementInputSchema, args);
        if (!validation.success) return validationErrorResponse(validation.errors ?? [], config.environment);
        try {
          const { enrich: _enrich = true, include_raw = false, ...payload } = validation.data as any;
          const response = await apiClient.createPaymentAgreement(payload, { requestUuid: context?.requestUuid });
          return {
            success: true,
            timestamp: new Date().toISOString(),
            data: response.data,
            metadata: { requestId: `req_${Date.now()}`, processingTime: Date.now() - startTime, environment: config.environment },
            insights: {
              status: response.data?.status || 'created',
              canProceed: false,
              nextActions: ['get_payment_agreement'],
              warnings: ['Customer must authorise this payment agreement in their banking app']
            },
            summary: `Payment agreement created. ID ${response.data?.payment_agreement_id}. Awaiting customer authorisation.`,
            ...(include_raw ? { raw: response } : {})
          };
        } catch {
          return toolErrorResponse('Failed to create payment agreement', config.environment);
        }
      }
    }
  };
}

