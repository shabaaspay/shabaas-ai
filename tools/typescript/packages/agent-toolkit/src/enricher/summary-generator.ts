import { PaymentAgreement } from '../types/index.js';

type StatusAnalysis = {
  displayStatus: string;
  canInitiatePayment: boolean;
  warnings?: string[];
};

export function generateSummary(
  agreement: PaymentAgreement,
  statusAnalysis: StatusAnalysis,
  business?: any
): string {
  const parts: string[] = [];
  parts.push(business?.meaning || `Payment agreement status is ${statusAnalysis.displayStatus || agreement.status}`);

  const maxAmount = agreement.maximum_amount ? Number(agreement.maximum_amount) : undefined;
  if (typeof maxAmount === 'number' && !Number.isNaN(maxAmount)) {
    const freq = business?.cadence?.frequency ? String(business.cadence.frequency).toLowerCase() : undefined;
    parts.push(freq ? `Maximum debit is AUD ${maxAmount} per ${freq}` : `Maximum debit is AUD ${maxAmount}`);
  }

  if (statusAnalysis.warnings?.length) {
    parts.push(`Warnings: ${statusAnalysis.warnings.join('; ')}`);
  }
  return `${parts.join('. ')}.`;
}

