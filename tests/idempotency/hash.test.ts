import { describe, expect, it } from 'vitest';
import { hashIdempotencyPayload } from '../../src/idempotency';

describe('hashIdempotencyPayload', () => {
  it('treats null and undefined payload values consistently', () => {
    const nullHash = hashIdempotencyPayload({
      value: null,
    });
    const undefinedHash = hashIdempotencyPayload({
      value: undefined,
    });

    expect(nullHash).toBe(undefinedHash);
  });

  it('produces the same hash for objects with different key order', () => {
    const first = hashIdempotencyPayload({
      b: 2,
      a: 1,
      nested: { y: true, x: false },
    });
    const second = hashIdempotencyPayload({
      nested: { x: false, y: true },
      a: 1,
      b: 2,
    });

    expect(first).toBe(second);
  });

  it('produces deterministic hashes for array payloads', () => {
    const first = hashIdempotencyPayload({
      items: [{ id: '1' }, { id: '2' }],
    });
    const second = hashIdempotencyPayload({
      items: [{ id: '1' }, { id: '2' }],
    });
    const changed = hashIdempotencyPayload({
      items: [{ id: '2' }, { id: '1' }],
    });

    expect(first).toBe(second);
    expect(first).not.toBe(changed);
  });
});
