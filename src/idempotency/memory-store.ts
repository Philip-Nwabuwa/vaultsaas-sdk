import type { IdempotencyRecord, IdempotencyStore } from './store';

export class MemoryIdempotencyStore<T = unknown>
  implements IdempotencyStore<T>
{
  private readonly records = new Map<string, IdempotencyRecord<T>>();

  get(key: string): IdempotencyRecord<T> | null {
    const record = this.records.get(key);
    if (!record) {
      return null;
    }

    if (record.expiresAt <= Date.now()) {
      this.records.delete(key);
      return null;
    }

    return record;
  }

  set(record: IdempotencyRecord<T>): void {
    this.records.set(record.key, record);
  }

  delete(key: string): void {
    this.records.delete(key);
  }

  clearExpired(now = Date.now()): void {
    for (const [key, record] of this.records.entries()) {
      if (record.expiresAt <= now) {
        this.records.delete(key);
      }
    }
  }
}
