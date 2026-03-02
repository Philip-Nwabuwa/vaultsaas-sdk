# Error Handling

All SDK failures are thrown as `VaultError` (or subclasses).

## Error shape

Every `VaultError` includes:

- `code`
- `category`
- `suggestion`
- `docsUrl`
- `retriable`
- `context`

## Common subclasses

- `VaultConfigError`
- `VaultRoutingError`
- `VaultProviderError`
- `VaultNetworkError`
- `WebhookVerificationError`
- `VaultIdempotencyConflictError`

## Copy-paste TypeScript example

```ts
import { StripeAdapter, VaultClient, VaultError } from '@vaultsaas/core';

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

const vault = new VaultClient({
  providers: {
    stripe: {
      adapter: StripeAdapter,
      config: { apiKey: mustEnv('STRIPE_API_KEY') },
    },
  },
  routing: {
    rules: [{ match: { default: true }, provider: 'stripe' }],
  },
});

try {
  await vault.charge({
    amount: 2500,
    currency: 'USD',
    paymentMethod: {
      type: 'card',
      number: '4000000000000002', // common Stripe decline test card
      expMonth: 12,
      expYear: 2030,
      cvc: '123',
    },
    customer: {
      email: 'buyer@example.com',
    },
  });
} catch (error) {
  if (error instanceof VaultError) {
    console.error('Vault error', {
      code: error.code,
      category: error.category,
      retriable: error.retriable,
      suggestion: error.suggestion,
      docsUrl: error.docsUrl,
      context: error.context,
    });

    if (error.retriable) {
      // queue retry with exponential backoff
    } else {
      // show actionable failure to caller
    }
  } else {
    throw error;
  }
}
```

## Recommended handling strategy

- Log `code`, `category`, and `context.provider`.
- Retry only when `retriable === true`.
- Return safe user messaging for non-retriable failures.
- Track high-frequency error codes and add route/provider fallbacks where possible.
