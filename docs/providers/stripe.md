# Stripe Integration Guide

This guide covers Stripe-specific setup and operational details for `@vaultsaas/core`.

## Credentials

Required adapter config:

- `apiKey`: Stripe secret key (`sk_test_...` or `sk_live_...`)
- `webhookSecret` (recommended): Stripe webhook signing secret (`whsec_...`)

```ts
import { StripeAdapter, VaultClient } from '@vaultsaas/core';

const vault = new VaultClient({
  providers: {
    stripe: {
      adapter: StripeAdapter,
      config: {
        apiKey: process.env.STRIPE_API_KEY!,
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
      },
    },
  },
  routing: {
    rules: [{ match: { default: true }, provider: 'stripe' }],
  },
});
```

## Supported Capabilities

- Methods: `card`, `bank_transfer`, `wallet`
- Currencies: major global currencies including `USD`, `EUR`, `GBP`, `CAD`, `AUD`, `JPY`, `BRL`, `MXN`
- Countries: broad global availability (see adapter static metadata)

## Webhooks

Pass the raw request body and original headers:

```ts
await vault.handleWebhook('stripe', rawBodyBuffer, req.headers as Record<string, string>);
```

Stripe verification enforces:

- signature header presence (`Stripe-Signature`)
- valid timestamp value
- 5-minute replay tolerance
- HMAC match on `${timestamp}.${rawPayload}`

## Common Pitfalls

- Using parsed JSON instead of raw webhook body breaks signature verification.
- Mixing test keys with live mode endpoints causes auth failures.
- Omitting `webhookSecret` prevents webhook signature verification.
- If you send customer shipping details, send a complete `address` object (line1, city, postalCode, country). Sending only a shipping name can be rejected by Stripe as an invalid request.

## Test Mode Notes

- Use `sk_test_...` keys for development.
- Prefer Stripe test payment method tokens such as `pm_card_visa` (success) and `pm_card_chargeDeclined` (decline simulation).
- Raw card numbers are rejected on most Stripe accounts unless Stripe has explicitly enabled raw card data APIs.
