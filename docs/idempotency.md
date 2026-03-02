# Idempotency

Idempotency is enabled per request by setting `idempotencyKey`.

Behavior:

- Same key + same payload: returns the original result.
- Same key + different payload: throws `VaultIdempotencyConflictError` (`IDEMPOTENCY_CONFLICT`).
- Records expire by TTL (`24h` default).

## Config

You can configure:

- `idempotency.ttlMs` (positive integer)
- `idempotency.store` (must implement `IdempotencyStore`)

By default, the SDK uses `MemoryIdempotencyStore`.

## Copy-paste TypeScript example

```ts
import {
  MemoryIdempotencyStore,
  StripeAdapter,
  VaultClient,
  VaultIdempotencyConflictError,
} from '@vaultsaas/core';

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

const vault = new VaultClient({
  providers: {
    stripe: {
      adapter: StripeAdapter,
      config: {
        apiKey: mustEnv('STRIPE_API_KEY'),
      },
    },
  },
  routing: {
    rules: [{ match: { default: true }, provider: 'stripe' }],
  },
  idempotency: {
    store: new MemoryIdempotencyStore(),
    ttlMs: 24 * 60 * 60 * 1000,
  },
});

const first = await vault.charge({
  amount: 2500,
  currency: 'USD',
  paymentMethod: {
    type: 'card',
    number: '4242424242424242',
    expMonth: 12,
    expYear: 2030,
    cvc: '123',
  },
  idempotencyKey: 'order-1001-charge-v1',
});

const replay = await vault.charge({
  amount: 2500,
  currency: 'USD',
  paymentMethod: {
    type: 'card',
    number: '4242424242424242',
    expMonth: 12,
    expYear: 2030,
    cvc: '123',
  },
  idempotencyKey: 'order-1001-charge-v1',
});

console.log(first.id === replay.id); // true

try {
  await vault.charge({
    amount: 3000,
    currency: 'USD',
    paymentMethod: {
      type: 'card',
      number: '4242424242424242',
      expMonth: 12,
      expYear: 2030,
      cvc: '123',
    },
    idempotencyKey: 'order-1001-charge-v1',
  });
} catch (error) {
  if (error instanceof VaultIdempotencyConflictError) {
    console.error(error.code, error.suggestion);
  }
}
```
