import { NonceStore } from './intentValidator.js';

export type SqlQueryRunner = (
  sql: string,
  params: any[]
) => Promise<{ rowCount?: number; rows?: any[] }>;

export interface PostgresNonceStoreOptions {
  tableName?: string;
  queryRunner: SqlQueryRunner;
}

/**
 * Production PostgreSQL NonceStore implementing ShaBaas Pay Security Implementation Plan Section 2:
 * 
 * Executes atomic conditional update:
 * ```sql
 * UPDATE mcp_intent_nonces
 * SET status = 'CONSUMED', consumed_at = NOW()
 * WHERE nonce_id = $1 AND status = 'UNUSED' AND expires_at > NOW();
 * ```
 */
export class PostgresNonceStore implements NonceStore {
  private readonly queryRunner: SqlQueryRunner;
  private readonly tableName: string;

  constructor(options: PostgresNonceStoreOptions) {
    this.queryRunner = options.queryRunner;
    this.tableName = options.tableName ?? 'mcp_intent_nonces';
  }

  async consumeNonce(
    nonce: string,
    _intentHash: string,
    _merchantId: string,
    _expiresAt: Date
  ): Promise<{ consumed: boolean; reason?: string }> {
    const sql = `
      UPDATE ${this.tableName}
      SET status = 'CONSUMED', consumed_at = NOW()
      WHERE nonce_id = $1 AND status = 'UNUSED' AND expires_at > NOW();
    `.trim();

    try {
      const result = await this.queryRunner(sql, [nonce]);
      const rowsAffected = result.rowCount ?? (result.rows ? result.rows.length : 0);

      if (rowsAffected > 0) {
        return { consumed: true };
      }

      return {
        consumed: false,
        reason: `Nonce "${nonce}" could not be consumed: either already consumed, expired, or non-existent in ${this.tableName}.`
      };
    } catch (error: any) {
      return {
        consumed: false,
        reason: `Database error during nonce consumption: ${error?.message || String(error)}`
      };
    }
  }

  /**
   * Helper to register a newly issued unused nonce into the PostgreSQL table.
   */
  async recordNewNonce(
    nonce: string,
    intentHash: string,
    merchantId: string,
    expiresAt: Date
  ): Promise<void> {
    const sql = `
      INSERT INTO ${this.tableName} (nonce_id, intent_hash, merchant_id, status, expires_at, created_at)
      VALUES ($1, $2, $3, 'UNUSED', $4, NOW())
      ON CONFLICT (nonce_id) DO NOTHING;
    `.trim();

    await this.queryRunner(sql, [nonce, intentHash, merchantId, expiresAt]);
  }
}
