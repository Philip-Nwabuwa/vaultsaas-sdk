import { StripeAdapter, VaultClient } from '@vaultsaas/core';

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

const client = new VaultClient({
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
});

const result = await client.charge({
  amount: 2500,
  currency: 'USD',
  paymentMethod: {
    type: 'card',
    token: 'pm_card_visa',
  },
  customer: {
    email: 'buyer@example.com',
  },
  metadata: {
    source: 'example_stripe_basic',
  },
});

console.log(result);
