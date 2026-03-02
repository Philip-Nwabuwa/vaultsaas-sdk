import { describe, expect, it } from 'vitest';
import { MemoryIdempotencyStore } from '../../src/idempotency';

describe('MemoryIdempotencyStore', () => {
  it('stores and retrieves records by key', () => {
    const store = new MemoryIdempotencyStore<string>();

    store.set({
      key: 'idk_1',
      payloadHash: 'hash_1',
      result: 'ok',
      expiresAt: Date.now() + 10_000,
    });

    const record = store.get('idk_1');

    expect(record).not.toBeNull();
    expect(record?.result).toBe('ok');
    expect(record?.payloadHash).toBe('hash_1');
  });

  it('returns null for expired records and removes them', () => {
    const store = new MemoryIdempotencyStore<string>();

    store.set({
      key: 'idk_expired',
      payloadHash: 'hash_expired',
      result: 'old',
      expiresAt: Date.now() - 1,
    });

    expect(store.get('idk_expired')).toBeNull();
    expect(store.get('idk_expired')).toBeNull();
  });

  it('clears expired records with clearExpired', () => {
    const store = new MemoryIdempotencyStore<string>();
    const now = Date.now();

    store.set({
      key: 'idk_keep',
      payloadHash: 'hash_keep',
      result: 'keep',
      expiresAt: now + 2_000,
    });
    store.set({
      key: 'idk_drop',
      payloadHash: 'hash_drop',
      result: 'drop',
      expiresAt: now + 1_000,
    });

    store.clearExpired(now + 1_500);

    expect(store.get('idk_drop')).toBeNull();
    expect(store.get('idk_keep')).not.toBeNull();
  });
});
