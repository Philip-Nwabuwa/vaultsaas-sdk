import { PaystackAdapter, VaultClient } from '@vaultsaas/core';

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

const client = new VaultClient({
  providers: {
    paystack: {
      adapter: PaystackAdapter,
      config: {
        secretKey: mustEnv('PAYSTACK_SECRET_KEY'),
        webhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET,
      },
    },
  },
  routing: {
    rules: [{ match: { default: true }, provider: 'paystack' }],
  },
});

const result = await client.charge({
  amount: 2500,
  currency: 'NGN',
  paymentMethod: {
    type: 'card',
    token: 'AUTH_test_123',
  },
  customer: {
    email: 'buyer@example.com',
  },
  metadata: {
    source: 'example_paystack_basic',
  },
});

console.log(result);
