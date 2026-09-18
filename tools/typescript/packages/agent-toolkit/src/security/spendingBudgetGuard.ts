/**
 * Agent Spending Limits & Velocity Guard
 * Enforces per-transaction limits and rolling 24-hour budgets per merchant principal.
 */

export interface MerchantSpendingPolicy {
  maxSingleTransactionAmount: number; // Max amount per single payment instruction (default: 10,000 AUD)
  dailyRollingBudget: number;         // Max aggregate spend allowed within a 24-hour window (default: 50,000 AUD)
}

export type SpendCheckResult = {
  allowed: boolean;
  remainingDailyBudget?: number;
  reason?: string;
  errorCode?: 'EXCEEDS_SINGLE_TRANSACTION_LIMIT' | 'EXCEEDS_DAILY_BUDGET' | 'INVALID_AMOUNT';
};

export interface SpendingLimitStore {
  checkAndRecordSpend(
    merchantId: string,
    amount: number,
    currency?: string
  ): Promise<SpendCheckResult>;
  getRemainingDailyBudget(merchantId: string): Promise<number>;
}

export const DEFAULT_SPENDING_POLICY: MerchantSpendingPolicy = {
  maxSingleTransactionAmount: 10_000,
  dailyRollingBudget: 50_000
};

/**
 * In-memory reference implementation of SpendingLimitStore with rolling 24-hour window.
 */
export class InMemorySpendingLimitStore implements SpendingLimitStore {
  private readonly spendRecords = new Map<string, Array<{ amount: number; timestamp: number }>>();
  private readonly policies = new Map<string, MerchantSpendingPolicy>();
  private readonly defaultPolicy: MerchantSpendingPolicy;

  constructor(defaultPolicy: MerchantSpendingPolicy = DEFAULT_SPENDING_POLICY) {
    this.defaultPolicy = defaultPolicy;
  }

  setMerchantPolicy(merchantId: string, policy: Partial<MerchantSpendingPolicy>): void {
    const current = this.policies.get(merchantId) ?? { ...this.defaultPolicy };
    this.policies.set(merchantId, { ...current, ...policy });
  }

  private getPolicy(merchantId: string): MerchantSpendingPolicy {
    return this.policies.get(merchantId) ?? this.defaultPolicy;
  }

  private purgeOldRecords(records: Array<{ amount: number; timestamp: number }>, now: number): Array<{ amount: number; timestamp: number }> {
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
    return records.filter((r) => r.timestamp > twentyFourHoursAgo);
  }

  async getRemainingDailyBudget(merchantId: string): Promise<number> {
    const now = Date.now();
    const policy = this.getPolicy(merchantId);
    const existing = this.spendRecords.get(merchantId) ?? [];
    const activeRecords = this.purgeOldRecords(existing, now);
    this.spendRecords.set(merchantId, activeRecords);

    const currentTotal = activeRecords.reduce((sum, r) => sum + r.amount, 0);
    return Math.max(0, policy.dailyRollingBudget - currentTotal);
  }

  async checkAndRecordSpend(
    merchantId: string,
    amount: number,
    _currency = 'AUD'
  ): Promise<SpendCheckResult> {
    if (isNaN(amount) || amount <= 0) {
      return {
        allowed: false,
        errorCode: 'INVALID_AMOUNT',
        reason: `Invalid transaction amount: ${amount}`
      };
    }

    const policy = this.getPolicy(merchantId);
    const now = Date.now();

    // 1. Single transaction threshold check
    if (amount > policy.maxSingleTransactionAmount) {
      return {
        allowed: false,
        errorCode: 'EXCEEDS_SINGLE_TRANSACTION_LIMIT',
        reason: `Payment amount of $${amount.toFixed(2)} exceeds maximum single transaction limit of $${policy.maxSingleTransactionAmount.toFixed(2)}.`
      };
    }

    // 2. Rolling 24-hour aggregate budget check
    const existing = this.spendRecords.get(merchantId) ?? [];
    const activeRecords = this.purgeOldRecords(existing, now);
    const currentTotal = activeRecords.reduce((sum, r) => sum + r.amount, 0);
    const remainingBefore = Math.max(0, policy.dailyRollingBudget - currentTotal);

    if (currentTotal + amount > policy.dailyRollingBudget) {
      return {
        allowed: false,
        errorCode: 'EXCEEDS_DAILY_BUDGET',
        remainingDailyBudget: remainingBefore,
        reason: `Payment amount of $${amount.toFixed(2)} exceeds remaining 24-hour rolling budget of $${remainingBefore.toFixed(2)} (daily cap: $${policy.dailyRollingBudget.toFixed(2)}).`
      };
    }

    // Record verified transaction
    activeRecords.push({ amount, timestamp: now });
    this.spendRecords.set(merchantId, activeRecords);

    const remainingAfter = policy.dailyRollingBudget - (currentTotal + amount);
    return {
      allowed: true,
      remainingDailyBudget: remainingAfter
    };
  }

  clear(): void {
    this.spendRecords.clear();
  }
}

/**
 * Global singleton spending limit store
 */
export const defaultSpendingLimitStore = new InMemorySpendingLimitStore();
