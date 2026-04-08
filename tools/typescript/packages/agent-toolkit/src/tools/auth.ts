import { z } from 'zod';
import { ShabaasApiClient } from '../api/client.js';
import { Config } from '../config/index.js';
import { toolErrorResponse, type ToolContext } from './response-helpers.js';

export function createAuthTools(apiClient: ShabaasApiClient, config: Config) {
  return {
    get_auth_token: {
      name: 'get_auth_token',
      description: 'Fetch and cache authorization token for debugging.',
      inputSchema: z.object({
        include_token_in_response: z.boolean().optional().default(false)
      }),
      execute: async (args: any, context?: ToolContext) => {
        try {
          const includeToken = !!args?.include_token_in_response;
          const auth = await apiClient.getAuthToken({ requestUuid: context?.requestUuid });
          return {
            success: true,
            timestamp: new Date().toISOString(),
            data: includeToken ? auth : { fetchedAt: auth.fetchedAt },
            metadata: { requestId: `req_${Date.now()}`, processingTime: 0, environment: config.environment },
            insights: {
              status: 'success',
              canProceed: true,
              nextActions: ['create_payment_agreement', 'get_payment_agreement', 'initiate_payment', 'get_payment_initiation']
            },
            summary: includeToken
              ? 'Authorization token fetched successfully. Token is included in response data.'
              : 'Authorization token fetched successfully and cached inside the toolkit.'
          };
        } catch (error: any) {
          return toolErrorResponse(
            error?.response?.data?.message || error.message || 'Failed to fetch auth token',
            config.environment,
            error?.response?.data
          );
        }
      }
    }
  };
}

