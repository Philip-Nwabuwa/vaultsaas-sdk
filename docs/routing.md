# Routing

Routing rules are evaluated top-to-bottom. The first matching rule wins unless that rule is in a weighted group.

## Match fields

Each rule can match on:

- `currency`
- `country`
- `paymentMethod`
- `amountMin` and `amountMax`
- `metadata` exact key/value pairs
- `default: true` for required fallback

`VaultClient` validates that routing contains at least one default fallback rule.

## Weighted selection

If a matching rule has `weight`, the router builds a contiguous weighted group starting at that rule. It then selects one provider proportionally by weight.

## Per-request controls

For each charge/authorize request you can:

- force a specific provider with `routing.provider`
- exclude providers with `routing.exclude`

If a forced provider is also excluded, the SDK throws `ROUTING_PROVIDER_EXCLUDED`.

## Copy-paste TypeScript example

```ts
import {
  DLocalAdapter,
  StripeAdapter,
  VaultClient,
  type ChargeRequest,
} from '@vaultsaas/core';

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

const vault = new VaultClient({
  providers: {
    dlocal: {
      adapter: DLocalAdapter,
      config: {
        xLogin: mustEnv('DLOCAL_X_LOGIN'),
        xTransKey: mustEnv('DLOCAL_X_TRANS_KEY'),
        secretKey: mustEnv('DLOCAL_SECRET_KEY'),
      },
      priority: 1,
    },
    stripe: {
      adapter: StripeAdapter,
      config: {
        apiKey: mustEnv('STRIPE_API_KEY'),
      },
      priority: 2,
    },
  },
  routing: {
    rules: [
      {
        provider: 'dlocal',
        match: {
          country: 'BR',
          paymentMethod: ['pix', 'boleto'],
        },
      },
      {
        provider: 'dlocal',
        weight: 30,
        match: {
          currency: 'USD',
          paymentMethod: 'card',
        },
      },
      {
        provider: 'stripe',
        weight: 70,
        match: {
          currency: 'USD',
          paymentMethod: 'card',
        },
      },
      {
        provider: 'stripe',
        match: { default: true },
      },
    ],
  },
});

const request: ChargeRequest = {
  amount: 4200,
  currency: 'USD',
  paymentMethod: {
    type: 'card',
    token: 'pm_card_visa',
  },
  customer: {
    email: 'buyer@example.com',
    address: {
      line1: '100 Market St',
      city: 'San Francisco',
      postalCode: '94105',
      country: 'US',
    },
  },
  metadata: {
    merchantSegment: 'enterprise',
  },
  routing: {
    exclude: ['dlocal'],
  },
};

const result = await vault.charge(request);
console.log(result.provider, result.routing.reason);
```
