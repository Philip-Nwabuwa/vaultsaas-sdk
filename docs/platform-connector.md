# Platform Connector

The platform connector is optional and enabled when `platformApiKey` is set.

When enabled:

- charge/authorize routing can call `POST /v1/routing/decide`
- transactions are batched to `POST /v1/transactions/report`
- webhook events are batched to `POST /v1/events/webhook`

If platform routing is unavailable or times out, SDK charge flow falls back to local routing rules.

## Config options

- `platformApiKey`: enables connector
- `platform.baseUrl`: defaults to `https://api.vaultsaas.com`
- `platform.timeoutMs`: routing request timeout
- `platform.batchSize`: report/webhook batch size
- `platform.flushIntervalMs`: periodic flush cadence
- `platform.maxRetries`: retries for batch POST requests
- `platform.initialBackoffMs`: retry backoff base

## Copy-paste TypeScript example

```ts
import { DLocalAdapter, StripeAdapter, VaultClient } from '@vaultsaas/core';

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
    dlocal: {
      adapter: DLocalAdapter,
      config: {
        xLogin: mustEnv('DLOCAL_X_LOGIN'),
        xTransKey: mustEnv('DLOCAL_X_TRANS_KEY'),
        secretKey: mustEnv('DLOCAL_SECRET_KEY'),
      },
    },
  },
  routing: {
    rules: [{ match: { default: true }, provider: 'stripe' }],
  },
  platformApiKey: mustEnv('VAULTSAAS_PLATFORM_API_KEY'),
  platform: {
    baseUrl: 'https://api.vaultsaas.com',
    timeoutMs: 100,
    batchSize: 100,
    flushIntervalMs: 2000,
    maxRetries: 2,
    initialBackoffMs: 100,
  },
  logging: {
    logger: console,
  },
});

const result = await vault.charge({
  amount: 1900,
  currency: 'USD',
  paymentMethod: {
    type: 'card',
    number: '4242424242424242',
    expMonth: 12,
    expYear: 2030,
    cvc: '123',
  },
  customer: {
    email: 'buyer@example.com',
    address: {
      line1: '5 Main St',
      city: 'Austin',
      postalCode: '73301',
      country: 'US',
    },
  },
});

console.log(result.provider, result.routing.source, result.routing.reason);
```

## Operational notes

- Keep `timeoutMs` low to preserve p95 payment latency.
- Route using local fallback rules for platform outages.
- Use structured logs in `logging.logger` for degraded-mode visibility.
