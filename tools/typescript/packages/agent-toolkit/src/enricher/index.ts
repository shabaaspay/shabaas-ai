import { PaymentAgreement, StandardResponse } from '../types/index.js';
import { analyzeStatus } from './status-analyzer.js';
import { suggestActions } from './action-suggester.js';
import { generateSummary } from './summary-generator.js';

type StatusAnalysis = {
  displayStatus: string;
  canInitiatePayment: boolean;
  warnings?: string[];
};

type BusinessInsights = NonNullable<StandardResponse['insights']['business']>;

export function enrichPaymentAgreement(
  data: PaymentAgreement,
  includeRaw: boolean,
  rawResponse: any,
  environment: 'sandbox' | 'production'
): StandardResponse<PaymentAgreement> {
  const startTime = Date.now();
  const statusAnalysis = analyzeStatus(data.status, data.extented_status) as StatusAnalysis;
  const business = buildBusinessInsights(data, statusAnalysis);
  const summary = generateSummary(data, statusAnalysis, business);

  return {
    success: true,
    timestamp: new Date().toISOString(),
    data,
    metadata: {
      requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      processingTime: Date.now() - startTime,
      environment
    },
    insights: {
      status: statusAnalysis.displayStatus,
      canProceed: statusAnalysis.canInitiatePayment,
      nextActions: suggestActions(data),
      warnings: statusAnalysis.warnings,
      business
    },
    summary,
    ...(includeRaw ? { raw: rawResponse } : {})
  };
}

function buildBusinessInsights(agreement: PaymentAgreement, statusAnalysis: StatusAnalysis): BusinessInsights {
  const max = agreement.maximum_amount && !Number.isNaN(Number(agreement.maximum_amount))
    ? Number(agreement.maximum_amount)
    : undefined;

  return {
    product: 'PayTo',
    meaning: statusAnalysis.canInitiatePayment
      ? 'Agreement is active and ready for real time payment initiation'
      : 'Agreement requires payer action or review before payment initiation',
    readiness: {
      canInitiatePayment: statusAnalysis.canInitiatePayment,
      reason: statusAnalysis.canInitiatePayment
        ? 'Agreement is active so payment initiation can proceed within the agreed limit'
        : 'Agreement is not in an active state'
    },
    limits: { maximumAmount: max, currency: 'AUD' },
    cadence: {},
    timing: { createdAt: agreement.created_at, endDate: agreement.end_date },
    payerControls: ['Payer can manage PayTo agreements in online banking'],
    reconciliationNotes: ['Use agreement and initiation IDs for reconciliation'],
    operationalChecks: ['Check agreement status before initiating payment'],
    riskFlags: [],
    references: [{ title: 'PayTo overview', url: 'https://www.auspayplus.com.au/solutions/payto' }]
  };
}

export function enrichPaymentInitiation(
  data: any,
  raw: any,
  processingTime: number,
  environment: 'sandbox' | 'production',
  mode: 'initiate' | 'retrieve'
): StandardResponse<any> {
  const status = data?.status || 'submitted';
  return {
    success: true,
    timestamp: new Date().toISOString(),
    data,
    metadata: {
      requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      processingTime,
      environment
    },
    insights: {
      status,
      canProceed: true,
      nextActions: ['get_payment_initiation'],
      warnings: mode === 'initiate' ? ['Verify payment initiation status before assuming settlement'] : [],
      business: {
        product: 'PayTo',
        meaning: 'Payment initiation against a PayTo agreement',
        readiness: { canInitiatePayment: true, reason: 'Track status until settled.' },
        limits: { currency: 'AUD' },
        cadence: {},
        timing: {},
        payerControls: ['Payer can manage agreement state in banking app'],
        reconciliationNotes: ['Use payment_agreement_id to correlate settlement events'],
        operationalChecks: ['Check status via get_payment_initiation'],
        riskFlags: [],
        references: [{ title: 'PayTo overview', url: 'https://www.auspayplus.com.au/solutions/payto' }]
      }
    },
    summary: mode === 'initiate'
      ? 'Payment initiation submitted. Track status with get_payment_initiation.'
      : `Payment initiation ${data?.payment_initiation_id || ''} retrieved.`,
    ...(raw ? { raw } : {})
  };
}

