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
  // Amount in kobo; use >= 5000 (NGN 50.00) for stable test runs.
  amount: 5000,
  currency: 'NGN',
  paymentMethod: {
    type: 'card',
    // Must be a real Paystack authorization_code from a prior successful charge.
    token: mustEnv('PAYSTACK_AUTHORIZATION_CODE'),
  },
  customer: {
    // Must match the customer email associated with the authorization_code.
    email: mustEnv('PAYSTACK_CUSTOMER_EMAIL'),
  },
  metadata: {
    source: 'example_paystack_basic',
  },
});

console.log(result);
