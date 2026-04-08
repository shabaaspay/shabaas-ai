import { StandardResponse } from '../types/index.js';
import { Config } from '../config/index.js';

export type ToolContext = { requestUuid?: string };

function baseErrorResponse<T>(
  summary: string,
  environment: Config['environment'],
  warnings?: string[],
  raw?: any
): StandardResponse<T | null> {
  return {
    success: false,
    timestamp: new Date().toISOString(),
    data: null,
    metadata: { requestId: `req_${Date.now()}`, processingTime: 0, environment },
    insights: { status: 'error', canProceed: false, nextActions: [], warnings },
    summary,
    ...(raw ? { raw } : {})
  };
}

export function validationErrorResponse<T>(errors: string[], environment: Config['environment']) {
  return baseErrorResponse<T>(`Validation failed: ${errors.join(', ')}`, environment, ['validation_error']);
}

export function toolErrorResponse<T>(message: string, environment: Config['environment'], raw?: any) {
  return baseErrorResponse<T>(message, environment, undefined, raw);
}

