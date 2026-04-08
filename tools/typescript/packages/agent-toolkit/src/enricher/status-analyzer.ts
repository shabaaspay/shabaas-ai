export interface StatusAnalysis {
  displayStatus: string;
  canInitiatePayment: boolean;
  warnings?: string[];
}

function parseExtendedStatusStatus(extendedStatus?: string): string | undefined {
  if (!extendedStatus) return undefined;
  const parts = extendedStatus.split('-').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 4) return undefined;
  return parts[3]?.toLowerCase();
}

export function analyzeStatus(status: string, extendedStatus?: string): StatusAnalysis {
  const warnings: string[] = [];
  const normalizedStatus = (status || '').toLowerCase().trim();
  const extStatus = parseExtendedStatusStatus(extendedStatus);
  const effectiveStatus = normalizedStatus || extStatus || 'unknown';

  if (extStatus && normalizedStatus && extStatus !== normalizedStatus) {
    warnings.push('Status differs from extended status. Treat as requiring manual verification');
  }

  switch (effectiveStatus) {
    case 'active':
      return { displayStatus: 'Active', canInitiatePayment: true, warnings: warnings.length ? warnings : undefined };
    case 'created':
    case 'pending':
      warnings.push('Payer must authorise the PayTo agreement in their banking app before any debit can occur');
      return { displayStatus: effectiveStatus === 'created' ? 'Created' : 'Pending authorisation', canInitiatePayment: false, warnings };
    case 'suspended':
      warnings.push('Agreement is suspended. Do not initiate payments until it returns to active');
      return { displayStatus: 'Suspended', canInitiatePayment: false, warnings };
    case 'cancelled':
    case 'canceled':
      warnings.push('Agreement is cancelled. A new agreement is required to take payments');
      return { displayStatus: 'Cancelled', canInitiatePayment: false, warnings };
    case 'expired':
      warnings.push('Agreement is expired. A new agreement is required to take payments');
      return { displayStatus: 'Expired', canInitiatePayment: false, warnings };
    default:
      warnings.push(`Unknown status: ${effectiveStatus}. Please verify before proceeding`);
      return { displayStatus: effectiveStatus, canInitiatePayment: false, warnings };
  }
}

