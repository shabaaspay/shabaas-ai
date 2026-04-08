import { z } from 'zod';

export interface StandardResponse<T = any> {
  success: boolean;
  timestamp: string;
  data: T;
  metadata: {
    requestId: string;
    processingTime: number;
    environment: 'sandbox' | 'production';
  };
  insights: {
    status: string;
    canProceed: boolean;
    nextActions: string[];
    warnings?: string[];
    business?: {
      product: 'PayTo';
      meaning: string;
      readiness: {
        canInitiatePayment: boolean;
        reason: string;
      };
      limits: {
        maximumAmount?: number;
        currency: 'AUD';
      };
      cadence: {
        frequency?: string;
        numberOfTransactionsPermitted?: number;
      };
      timing: {
        createdAt?: string;
        endDate?: string;
        createdDaysAgo?: number;
        expiresInDays?: number;
        isExpiringSoon?: boolean;
      };
      payerControls: string[];
      reconciliationNotes: string[];
      operationalChecks: string[];
      recommendedCustomerCopy?: string;
      riskFlags: string[];
      references: Array<{ title: string; url: string }>;
    };
  };
  summary: string;
  raw?: any;
}

export const PaymentAgreementSchema = z.object({
  payment_agreement_id: z.string(),
  status: z.string(),
  end_date: z.string().optional(),
  created_at: z.string().optional(),
  maximum_amount: z.string().optional(),
  extented_status: z.string().optional()
});

export type PaymentAgreement = z.infer<typeof PaymentAgreementSchema>;

export const PaymentInitiationSchema = z.object({
  payment_initiation_id: z.string().optional(),
  status: z.string().optional(),
  amount: z.string().optional(),
  created_at: z.string().optional(),
  payment_agreement_id: z.string().optional()
}).passthrough();

export type PaymentInitiation = z.infer<typeof PaymentInitiationSchema>;

export interface ApiResponse<T = any> {
  message: string;
  data: T;
  error_code?: string;
}

const authorizationParam = z.string()
  .optional()
  .describe(
    'Stdio MCP only: API key when the client cannot send Authorization headers. Omit for remote HTTP MCP (session is already authenticated).'
  );

export const GetPaymentAgreementInputSchema = z.object({
  authorization: authorizationParam,
  payment_agreement_id: z.string().describe('The payment agreement ID to retrieve'),
  enrich: z.boolean().optional().default(true),
  include_raw: z.boolean().optional().default(false)
});

export const CreatePaymentAgreementInputSchema = z.object({
  authorization: authorizationParam,
  name: z.string(),
  type: z.string(),
  maximum_amount: z.string(),
  frequency: z.string(),
  number_of_transactions_permitted: z.number(),
  pay_id: z.string(),
  phone_number: z.string().optional(),
  bsb: z.number().optional(),
  account_number: z.number().optional(),
  agreement_type: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  enrich: z.boolean().optional().default(true),
  include_raw: z.boolean().optional().default(false)
});

export const InitiatePaymentInputSchema = z.object({
  authorization: authorizationParam,
  payment_agreement_id: z.string(),
  amount: z.union([z.string(), z.number()]).refine((val) => Number(val) > 0, 'Amount must be greater than zero'),
  description: z.string().optional(),
  enrich: z.boolean().optional().default(true),
  include_raw: z.boolean().optional().default(false)
});

export const GetPaymentInitiationInputSchema = z.object({
  authorization: authorizationParam,
  payment_initiation_id: z.string(),
  enrich: z.boolean().optional().default(true),
  include_raw: z.boolean().optional().default(false)
});

export const GetAuthTokenInputSchema = z.object({
  authorization: authorizationParam,
  include_token_in_response: z.boolean().optional().default(false)
});

