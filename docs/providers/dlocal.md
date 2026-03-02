# dLocal Integration Guide

This guide covers dLocal-specific setup and operational details for `@vaultsaas/core`.

## Credentials

Required adapter config:

- `xLogin`
- `xTransKey`
- `secretKey`
- `webhookSecret` (optional, falls back to `secretKey`)

```ts
import { DLocalAdapter, VaultClient } from '@vaultsaas/core';

const vault = new VaultClient({
  providers: {
    dlocal: {
      adapter: DLocalAdapter,
      config: {
        xLogin: process.env.DLOCAL_X_LOGIN!,
        xTransKey: process.env.DLOCAL_X_TRANS_KEY!,
        secretKey: process.env.DLOCAL_SECRET_KEY!,
        webhookSecret: process.env.DLOCAL_WEBHOOK_SECRET,
        baseUrl: process.env.DLOCAL_BASE_URL,
      },
    },
  },
  routing: {
    rules: [{ match: { default: true }, provider: 'dlocal' }],
  },
});
```

## Supported Capabilities

- Methods: `card`, `pix`, `boleto`, `bank_transfer`
- Currencies: LATAM-focused set including `BRL`, `MXN`, `ARS`, `CLP`, `COP`, `PEN`, `USD`
- Countries: LATAM-focused set including `BR`, `MX`, `AR`, `CL`, `CO`, `PE`

## Webhooks

dLocal webhook verification checks HMAC-SHA256 against the raw payload.
Accepted signature headers:

- `x-dlocal-signature`
- `x-signature`

## Common Pitfalls

- Missing one of `xLogin`, `xTransKey`, or `secretKey` fails adapter initialization.
- Sending lowercase currencies can cause downstream mismatches in external systems.
- Not preserving raw webhook body causes verification failure.

## Sandbox Notes

- Configure sandbox base URL through `baseUrl`.
- Keep sandbox credentials isolated from production credentials.
