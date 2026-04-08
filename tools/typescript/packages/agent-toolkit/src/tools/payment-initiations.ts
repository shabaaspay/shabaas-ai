import { ShabaasApiClient } from '../api/client.js';
import { Config } from '../config/index.js';
import { GetPaymentInitiationInputSchema, InitiatePaymentInputSchema, PaymentInitiationSchema } from '../types/index.js';
import { validateInput } from '../security/validator.js';
import { validationErrorResponse, toolErrorResponse, type ToolContext } from './response-helpers.js';
import { enrichPaymentInitiation } from '../enricher/index.js';

export function createPaymentInitiationTools(apiClient: ShabaasApiClient, config: Config) {
  return {
    initiate_payment: {
      name: 'initiate_payment',
      description: 'Initiate a payment against an existing payment agreement.',
      inputSchema: InitiatePaymentInputSchema,
      execute: async (args: any, context?: ToolContext) => {
        const validation = validateInput(InitiatePaymentInputSchema, args);
        if (!validation.success) return validationErrorResponse(validation.errors ?? [], config.environment);
        try {
          const start = Date.now();
          const { enrich = true, include_raw = false, ...payload } = validation.data as any;
          const response = await apiClient.initiatePayment(payload, { requestUuid: context?.requestUuid });
          if (!enrich) {
            return {
              success: true,
              timestamp: new Date().toISOString(),
              data: response.data,
              metadata: { requestId: `req_${Date.now()}`, processingTime: Date.now() - start, environment: config.environment },
              insights: { status: response.data?.status || 'submitted', canProceed: true, nextActions: ['get_payment_initiation'] },
              summary: 'Payment initiation request submitted successfully.',
              ...(include_raw ? { raw: response } : {})
            };
          }
          return enrichPaymentInitiation(response.data, include_raw ? response : undefined, Date.now() - start, config.environment, 'initiate');
        } catch (error: any) {
          const message = error?.response?.data?.message || error?.message || 'Failed to initiate payment';
          return toolErrorResponse(message, config.environment, error?.response?.data);
        }
      }
    },
    get_payment_initiation: {
      name: 'get_payment_initiation',
      description: 'Retrieve a payment initiation by ID.',
      inputSchema: GetPaymentInitiationInputSchema,
      execute: async (args: any, context?: ToolContext) => {
        const validation = validateInput(GetPaymentInitiationInputSchema, args);
        if (!validation.success) return validationErrorResponse(validation.errors ?? [], config.environment);
        try {
          const start = Date.now();
          const { payment_initiation_id, enrich = true, include_raw = false } = validation.data as any;
          const response = await apiClient.getPaymentInitiation(payment_initiation_id, { requestUuid: context?.requestUuid });
          let parsed: any = response.data;
          const maybe = PaymentInitiationSchema.safeParse(response.data);
          if (maybe.success) parsed = maybe.data;
          if (!enrich) {
            return {
              success: true,
              timestamp: new Date().toISOString(),
              data: parsed,
              metadata: { requestId: `req_${Date.now()}`, processingTime: Date.now() - start, environment: config.environment },
              insights: { status: parsed?.status || 'unknown', canProceed: true, nextActions: ['get_payment_initiation'] },
              summary: `Payment initiation ${payment_initiation_id} retrieved successfully.`,
              ...(include_raw ? { raw: response } : {})
            };
          }
          return enrichPaymentInitiation(parsed, include_raw ? response : undefined, Date.now() - start, config.environment, 'retrieve');
        } catch (error: any) {
          return toolErrorResponse(error?.response?.data?.message || error.message || 'Failed to get payment initiation', config.environment, error?.response?.data);
        }
      }
    }
  };
}

