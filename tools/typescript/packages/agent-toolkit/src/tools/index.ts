import { ShaBaasApiClient } from '../api/client.js';
import { Config } from '../config/index.js';
import { createReadTools, type ReadTools } from './read-tools.js';
import { createWriteTools, type WriteTools } from './write-tools.js';

export { createReadTools, type ReadTools } from './read-tools.js';
export { createWriteTools, type WriteTools } from './write-tools.js';
export type { ToolContext } from './response-helpers.js';

/**
 * Composite helper creating both Read and Write tools.
 * For production deployment, prefer using createReadTools or createWriteTools
 * based on the service identity.
 */
export function createAllTools(apiClient: ShaBaasApiClient, config: Config) {
  return {
    ...createReadTools(apiClient, config),
    ...createWriteTools(apiClient, config)
  };
}

