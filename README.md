# @vaultsaas/core

[![CI](https://img.shields.io/badge/CI-GitHub_Actions-2ea44f?logo=githubactions&logoColor=white)](./.github/workflows/ci.yml)

Open-source TypeScript SDK for VaultSaaS payment orchestration.

## Install

```bash
bun add @vaultsaas/core
```

```bash
npm install @vaultsaas/core
```

## Quickstart (<10 minutes to first successful payment)

Prerequisites:

- Node.js 20+ (or Bun 1.1+)
- A Stripe test secret key (`sk_test_...`)

Create `quickstart.ts`:

```ts
import { StripeAdapter, VaultClient, VaultError } from '@vaultsaas/core';

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
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
});

try {
  const result = await vault.charge({
    amount: 2500,
    currency: 'USD',
    paymentMethod: {
      type: 'card',
      token: 'pm_card_visa',
    },
    customer: {
      email: 'buyer@example.com',
      name: 'Taylor Buyer',
      address: {
        line1: '510 Townsend St',
        city: 'San Francisco',
        postalCode: '94103',
        country: 'US',
      },
    },
    metadata: {
      orderId: 'ord_demo_1001',
      source: 'quickstart',
    },
    idempotencyKey: 'charge-ord_demo_1001-v1',
  });

  console.log('Payment created:', {
    id: result.id,
    status: result.status,
    provider: result.provider,
  });
} catch (error) {
  if (error instanceof VaultError) {
    console.error('VaultError', {
      code: error.code,
      category: error.category,
      suggestion: error.suggestion,
      docsUrl: error.docsUrl,
      context: error.context,
    });
    process.exit(1);
  }

  throw error;
}
```

Run:

```bash
STRIPE_API_KEY=sk_test_xxx bun quickstart.ts
```

Note: if you include `customer.name` for Stripe shipping details, also include `customer.address` to avoid provider validation errors.
For Stripe test mode, use test tokens/payment methods (for example `pm_card_visa`) instead of raw card numbers unless Stripe has explicitly enabled raw card data APIs on your account.

## Documentation

- [Routing](./docs/routing.md)
- [Idempotency](./docs/idempotency.md)
- [Webhooks](./docs/webhooks.md)
- [Error Handling](./docs/error-handling.md)
- [Platform Connector](./docs/platform-connector.md)
- [Versioning and Migration Policy](./docs/versioning-and-migrations.md)
- [Troubleshooting FAQ](./docs/troubleshooting.md)
- Provider guides:
  - [Stripe](./docs/providers/stripe.md)
  - [dLocal](./docs/providers/dlocal.md)
  - [Paystack](./docs/providers/paystack.md)
- [Architecture](./docs/architecture.md)
- [Security Policy](./SECURITY.md)
- [Security Review (v0.1.0)](./docs/security-review-v0.1.0.md)

## Examples

- [Stripe Basic](./examples/stripe-basic/README.md)
- [dLocal Basic](./examples/dlocal-basic/README.md)
- [Paystack Basic](./examples/paystack-basic/README.md)

## Scripts

- `bun run lint`
- `bun run format`
- `bun run typecheck`
- `bun run test`
- `bun run build`
- `bun run release:dry-run`

## License

MIT
