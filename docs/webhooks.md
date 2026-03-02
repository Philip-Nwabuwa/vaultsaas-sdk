# Webhooks

Use `vault.handleWebhook(provider, payload, headers)` to:

- verify provider signature (when adapter supports verification)
- normalize provider-specific event payloads into `VaultEvent`
- keep a canonical event shape across providers

## Provider support

- Stripe: verifies `stripe-signature` with `webhookSecret`
- dLocal: verifies `x-dlocal-signature` (or `x-signature`) with `webhookSecret` or `secretKey`
- Paystack: verifies `x-paystack-signature` with `webhookSecret` or `secretKey`

## Important

- Pass the raw body exactly as received (string or `Buffer`).
- Do not parse and re-serialize before verification.

## Copy-paste TypeScript example (Node `http`)

```ts
import { createServer } from 'node:http';
import { StripeAdapter, VaultClient, WebhookVerificationError } from '@vaultsaas/core';

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
        webhookSecret: mustEnv('STRIPE_WEBHOOK_SECRET'),
      },
    },
  },
  routing: {
    rules: [{ match: { default: true }, provider: 'stripe' }],
  },
});

const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhooks/stripe') {
    res.statusCode = 404;
    res.end('not found');
    return;
  }

  const chunks: Buffer[] = [];
  req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));

  req.on('end', async () => {
    try {
      const payload = Buffer.concat(chunks);
      const headers = Object.fromEntries(
        Object.entries(req.headers)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      );

      const event = await vault.handleWebhook('stripe', payload, headers);
      console.log('Normalized event:', event.type, event.providerEventId);
      res.statusCode = 200;
      res.end('ok');
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        res.statusCode = 400;
        res.end(`${error.code}: ${error.message}`);
        return;
      }
      res.statusCode = 500;
      res.end('internal_error');
    }
  });
});

server.listen(3000, () => {
  console.log('Listening on http://localhost:3000/webhooks/stripe');
});
```

## Normalized event shape

`VaultEvent` includes:

- `id`
- `type` (canonical `VaultEventType`)
- `provider`
- `transactionId` (optional)
- `providerEventId`
- `data`
- `rawPayload`
- `timestamp`
