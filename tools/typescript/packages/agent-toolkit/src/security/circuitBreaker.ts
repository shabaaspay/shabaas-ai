export type PaymentRail = 'PayTo' | 'BECS';

export interface CircuitBreakerOptions {
  /** Rolling window in milliseconds. Default: 15 minutes (900,000ms) */
  windowMs?: number;
  /** Minimum transaction volume before circuit evaluation trips. Default: 20 */
  minTransactions?: number;
  /** Maximum acceptable failure rate as a fraction (0.0 - 1.0). Default: 0.15 (15%) */
  failureThresholdPct?: number;
}

export type CircuitBreakerStatus = 'HEALTHY' | 'DEGRADED' | 'TRIPPED';

export interface RailHealthStats {
  rail: PaymentRail;
  windowMs: number;
  totalTransactions: number;
  failureCount: number;
  failureRate: number;
  isTripped: boolean;
  status: CircuitBreakerStatus;
  lastEvaluatedAt: string;
}

interface TransactionRecord {
  timestamp: number;
  success: boolean;
  errorCode?: string;
}

/**
 * Payment rail circuit breaker implementing ShaBaas Pay Security Implementation Plan Section 1, Proposal 12:
 * "Monitor per-rail failure rates over a 15-minute sliding window; flag/trip if failure rate >15% on >= 20 txns."
 */
export class PaymentRailCircuitBreaker {
  private windowMs: number;
  private minTransactions: number;
  private failureThresholdPct: number;
  private transactions: Map<PaymentRail, TransactionRecord[]>;

  constructor(options?: CircuitBreakerOptions) {
    this.windowMs = options?.windowMs ?? 15 * 60 * 1000;
    this.minTransactions = options?.minTransactions ?? 20;
    this.failureThresholdPct = options?.failureThresholdPct ?? 0.15;
    this.transactions = new Map([
      ['PayTo', []],
      ['BECS', []]
    ]);
  }

  /**
   * Records transaction outcome for the given payment rail.
   */
  recordTransaction(rail: PaymentRail, success: boolean, errorCode?: string, timestamp = Date.now()): void {
    const list = this.transactions.get(rail) ?? [];
    list.push({ timestamp, success, errorCode });
    this.transactions.set(rail, list);
    this.pruneOld(rail, timestamp);
  }

  private pruneOld(rail: PaymentRail, now = Date.now()): void {
    const cutoff = now - this.windowMs;
    const list = this.transactions.get(rail) ?? [];
    const filtered = list.filter((tx) => tx.timestamp >= cutoff);
    this.transactions.set(rail, filtered);
  }

  /**
   * Evaluates current health stats for a given rail over the sliding window.
   */
  getRailStats(rail: PaymentRail, now = Date.now()): RailHealthStats {
    this.pruneOld(rail, now);
    const list = this.transactions.get(rail) ?? [];
    const totalTransactions = list.length;
    const failureCount = list.filter((tx) => !tx.success).length;
    const failureRate = totalTransactions > 0 ? failureCount / totalTransactions : 0;

    let status: CircuitBreakerStatus = 'HEALTHY';
    let isTripped = false;

    if (totalTransactions >= this.minTransactions) {
      if (failureRate >= this.failureThresholdPct) {
        status = 'TRIPPED';
        isTripped = true;
      } else if (failureRate >= this.failureThresholdPct * 0.7) {
        status = 'DEGRADED';
      }
    }

    return {
      rail,
      windowMs: this.windowMs,
      totalTransactions,
      failureCount,
      failureRate: Math.round(failureRate * 1000) / 1000,
      isTripped,
      status,
      lastEvaluatedAt: new Date(now).toISOString()
    };
  }

  /**
   * Checks whether the payment rail is healthy and accepting new payments.
   */
  isRailAvailable(rail: PaymentRail, now = Date.now()): boolean {
    const stats = this.getRailStats(rail, now);
    return !stats.isTripped;
  }

  /**
   * Resets transaction history for one or all rails (e.g. after maintenance or provider recovery).
   */
  reset(rail?: PaymentRail): void {
    if (rail) {
      this.transactions.set(rail, []);
    } else {
      this.transactions.set('PayTo', []);
      this.transactions.set('BECS', []);
    }
  }
}

export const defaultRailCircuitBreaker = new PaymentRailCircuitBreaker();
