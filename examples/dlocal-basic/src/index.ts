import { DLocalAdapter, VaultClient } from '@vaultsaas/core';

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

const client = new VaultClient({
  providers: {
    dlocal: {
      adapter: DLocalAdapter,
      config: {
        xLogin: mustEnv('DLOCAL_X_LOGIN'),
        xTransKey: mustEnv('DLOCAL_X_TRANS_KEY'),
        secretKey: mustEnv('DLOCAL_SECRET_KEY'),
        webhookSecret: process.env.DLOCAL_WEBHOOK_SECRET,
      },
    },
  },
  routing: {
    rules: [{ match: { default: true }, provider: 'dlocal' }],
  },
});

const result = await client.charge({
  amount: 1500,
  currency: 'BRL',
  paymentMethod: {
    type: 'pix',
  },
  customer: {
    email: 'buyer@example.com',
    address: {
      line1: 'Avenida Paulista 1000',
      city: 'Sao Paulo',
      postalCode: '01310-100',
      country: 'BR',
    },
  },
  metadata: {
    source: 'example_dlocal_basic',
  },
});

console.log(result);
