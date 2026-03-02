export const DEFAULT_IDEMPOTENCY_TTL_MS = 86_400_000;

export interface IdempotencyRecord<T = unknown> {
  key: string;
  payloadHash: string;
  result: T;
  expiresAt: number;
}

export interface IdempotencyStore<T = unknown> {
  get(
    key: string,
  ): Promise<IdempotencyRecord<T> | null> | IdempotencyRecord<T> | null;
  set(record: IdempotencyRecord<T>): Promise<void> | void;
  delete(key: string): Promise<void> | void;
  clearExpired(now?: number): Promise<void> | void;
}
