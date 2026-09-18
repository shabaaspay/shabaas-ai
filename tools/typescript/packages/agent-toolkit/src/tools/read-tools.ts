import { ShaBaasApiClient } from '../api/client.js';
import { Config } from '../config/index.js';
import { createAuthTools } from './auth.js';
import { createPaymentAgreementTools } from './payment-agreements.js';
import { createPaymentInitiationTools } from './payment-initiations.js';
import { type ToolContext } from './response-helpers.js';
import { redactSensitiveData, enforceResponseSizeLimits } from '../utils/redactor.js';

/**
 * Creates and returns all Read-only MCP tools (queries, search, bounded reporting).
 * 
 * Security Controls Enforced:
 * 1. Tenant-Bound Authorization (BOLA Prevention): Derives merchant identity strictly from the
 *    authenticated session context. Rejects any tool parameter attempting cross-merchant access.
 * 2. Sensitive Data Redaction: Masks BSBs, account numbers, PayIDs, and tokens before sending to LLM.
 * 3. Strict Export & Size Limits: Caps responses at 50KB with pagination notices.
 */
export function createReadTools(apiClient: ShaBaasApiClient, config: Config) {
  const authTools = createAuthTools(apiClient, config);
  const agreementTools = createPaymentAgreementTools(apiClient, config);
  const initiationTools = createPaymentInitiationTools(apiClient, config);

  /**
   * Helper that wraps read tool execution with BOLA authorization validation,
   * sensitive identifier redaction, and strict response size limiting.
   */
  function wrapReadTool(tool: { name: string; description: string; inputSchema: any; execute: (args: any, context?: ToolContext) => Promise<any> }) {
    return {
      name: tool.name,
      description: `[Read-Only] ${tool.description}`,
      inputSchema: tool.inputSchema,
      execute: async (args: any, context?: ToolContext) => {
        const authenticatedMerchantId = apiClient.getAuthenticatedMerchantId(context?.requestUuid);

        // BOLA Prevention: Verify that model-supplied merchant_id matches authenticated tenant
        if (args?.merchant_id && typeof args.merchant_id === 'string') {
          const requestedMerchantId = args.merchant_id.trim();
          if (requestedMerchantId && requestedMerchantId !== authenticatedMerchantId) {
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
                status: 'unauthorized_tenant_access',
                canProceed: false,
                nextActions: ['use_authenticated_merchant_context'],
                warnings: ['BOLA_VIOLATION_PREVENTED']
              },
              summary: `Cross-tenant access forbidden: Cannot query records for merchant "${requestedMerchantId}" using credentials bound to "${authenticatedMerchantId}".`
            };
          }
        }

        // Execute query
        const rawResponse = await tool.execute(args, context);

        // Sensitive Data Redaction (APP 11 compliance)
        const redactedResponse = redactSensitiveData(rawResponse);

        // Strict 50KB MCP payload boundary
        return enforceResponseSizeLimits(redactedResponse);
      }
    };
  }

  return {
    get_auth_token: wrapReadTool(authTools.get_auth_token),
    get_payment_agreement: wrapReadTool(agreementTools.get_payment_agreement),
    get_payment_initiation: wrapReadTool(initiationTools.get_payment_initiation)
  };
}

export type ReadTools = ReturnType<typeof createReadTools>;
