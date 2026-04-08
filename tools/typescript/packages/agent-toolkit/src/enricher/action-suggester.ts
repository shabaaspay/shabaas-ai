import { PaymentAgreement } from '../types/index.js';

export function suggestActions(agreement: PaymentAgreement): string[] {
  const actions: string[] = [];
  const status = (agreement.status || '').toLowerCase().trim();
  actions.push('get_payment_agreement');

  if (status === 'active') {
    actions.push('initiate_payment');
    actions.push('initiate_direct_debit');
    actions.push('cancel_payment_agreement');
    return actions;
  }
  if (status === 'created' || status === 'pending') {
    actions.push('resend_payment_agreement');
    actions.push('cancel_payment_agreement');
    actions.push('request_payer_authorisation');
    return actions;
  }
  if (status === 'cancelled' || status === 'canceled' || status === 'expired') {
    actions.push('create_payment_agreement');
    return actions;
  }
  actions.push('manual_review_required');
  return actions;
}

