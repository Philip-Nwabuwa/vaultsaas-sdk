# Paystack Integration Guide

This guide covers Paystack-specific setup and operational details for `@vaultsaas/core`.

## Credentials

Required adapter config:

- `secretKey`
- `webhookSecret` (optional, falls back to `secretKey`)

```ts
import { PaystackAdapter, VaultClient } from '@vaultsaas/core';

const vault = new VaultClient({
  providers: {
    paystack: {
      adapter: PaystackAdapter,
      config: {
        secretKey: process.env.PAYSTACK_SECRET_KEY!,
        webhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET,
      },
    },
  },
  routing: {
    rules: [{ match: { default: true }, provider: 'paystack' }],
  },
});
```

## Supported Capabilities

- Methods: `card`, `bank_transfer`, `wallet`
- Currencies: `NGN`, `GHS`, `ZAR`, `KES`, `USD`
- Countries: `NG`, `GH`, `ZA`, `KE`

## Webhooks

Paystack webhook verification checks HMAC-SHA512 of the raw payload against:

- `x-paystack-signature`

## Common Pitfalls

- `customer.email` is required for charge and authorize requests.
- For tokenized card charges, `paymentMethod.token` must be a real Paystack `authorization_code` from a prior successful transaction.
- The `customer.email` in the request should match the customer tied to that `authorization_code`.
- Capture requires a previously stored authorization code and customer email from verify response.
- Missing or malformed signature headers fail webhook handling.

## Test Mode Notes

- Use test secret keys and sandbox events for staging.
- Do not use placeholder values such as `AUTH_test_123` in live adapter calls. Use an actual `authorization.authorization_code` returned by Paystack.
- Validate both verify and charge authorization steps when testing capture.
