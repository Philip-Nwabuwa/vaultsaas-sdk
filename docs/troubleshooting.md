# Troubleshooting FAQ

This guide covers common issues encountered when integrating `@vaultsaas/core` and how to resolve them.

---

## 1. Provider Authentication Failures

### Wrong or missing API key

**Symptom:** `VaultProviderError` with code `PROVIDER_AUTH_FAILED`, or `VaultConfigError` with code `INVALID_CONFIGURATION` at startup.

**Cause:** The API key passed to the provider adapter is empty, malformed, or does not match the provider environment.

**Solution:** Verify that the correct environment variable is set and that it is not empty or whitespace-only.

```ts
// Each adapter validates its credentials at construction time.
// Stripe requires `apiKey`:
const vault = new VaultClient({
  providers: {
    stripe: {
      adapter: StripeAdapter,
      config: {
        apiKey: process.env.STRIPE_API_KEY!, // must be non-empty
      },
    },
  },
  routing: {
    rules: [{ match: { default: true }, provider: 'stripe' }],
  },
});

// dLocal requires three credentials:
// config.xLogin, config.xTransKey, config.secretKey

// Paystack requires:
// config.secretKey
```

If you see `VaultConfigError: Stripe adapter requires config.apiKey.` the key is missing or blank. Double-check that your `.env` file is loaded before the `VaultClient` constructor runs.

### Expired or rotated keys

**Symptom:** `VaultProviderError` with code `PROVIDER_AUTH_FAILED` at charge time (not at construction). The error context will include `httpStatus: 401` or `httpStatus: 403`.

**Cause:** The key was valid when the client was created but has since been revoked or rotated on the provider dashboard.

**Solution:** Rotate the key in your environment and restart the application. The SDK does not cache provider sessions -- a fresh key takes effect on the next API call.

### Environment mismatch (test vs live)

**Symptom:** Charges succeed in development but fail with `PROVIDER_AUTH_FAILED` in production (or vice versa).

**Cause:** Stripe test keys (`sk_test_...`) only work against test mode. Live keys (`sk_live_...`) only work against live mode. Similarly, dLocal sandbox credentials do not work against the production endpoint.

**Solution:**
- Ensure you are loading the correct key for the target environment.
- For dLocal, also set `baseUrl` to `https://sandbox.dlocal.com` when using sandbox credentials:

```ts
dlocal: {
  adapter: DLocalAdapter,
  config: {
    xLogin: process.env.DLOCAL_X_LOGIN!,
    xTransKey: process.env.DLOCAL_X_TRANS_KEY!,
    secretKey: process.env.DLOCAL_SECRET_KEY!,
    baseUrl: process.env.DLOCAL_BASE_URL, // 'https://sandbox.dlocal.com' for test
  },
},
```

---

## 1.5 Stripe raw card data rejected in test mode

**Symptom:** `VaultError` with `code: INVALID_REQUEST` and Stripe message:
`Sending credit card numbers directly to the Stripe API is generally unsafe...`

**Cause:** The request includes raw card fields (`number`, `expMonth`, `expYear`, `cvc`). Stripe blocks raw card data APIs by default for most accounts.

**Solution:** Use Stripe test payment method tokens for SDK examples:

```ts
paymentMethod: {
  type: 'card',
  token: 'pm_card_visa',
},
```

Use `pm_card_chargeDeclined` when you want to simulate a decline path. Only send raw card numbers if Stripe has explicitly enabled raw card data APIs for your account.

---

## 1.6 Paystack `unprocessed_transaction` / "Charge attempted"

**Symptom:** `VaultError` with `code: INVALID_REQUEST` and Paystack context containing `providerCode: 'unprocessed_transaction'` and message `"Charge attempted"`.

**Cause:** The charge request used a non-reusable or placeholder authorization token, or the token/email pair does not match Paystack's stored authorization.

**Solution:**
- Pass a real Paystack `authorization.authorization_code` as `paymentMethod.token`.
- Ensure `customer.email` matches the customer linked to that authorization code.
- For test mode, avoid tiny first amounts and use at least NGN 50.00 (`amount: 5000` kobo) when validating the flow.

```ts
await vault.charge({
  amount: 5000,
  currency: 'NGN',
  paymentMethod: { type: 'card', token: process.env.PAYSTACK_AUTHORIZATION_CODE! },
  customer: { email: process.env.PAYSTACK_CUSTOMER_EMAIL! },
});
```

---

## 2. Webhook Signature Verification Failures

### Wrong webhook secret

**Symptom:** `WebhookVerificationError` with message ending in "signature verification failed."

**Cause:** The `webhookSecret` in the adapter config does not match the secret configured on the provider dashboard.

**Solution:** Copy the webhook signing secret from the provider dashboard and pass it in config.

```ts
stripe: {
  adapter: StripeAdapter,
  config: {
    apiKey: process.env.STRIPE_API_KEY!,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!, // whsec_...
  },
},
```

For dLocal, the adapter falls back to `secretKey` if `webhookSecret` is not set. Make sure whichever value you use matches what dLocal sends.

For Paystack, the adapter falls back to `secretKey` if `webhookSecret` is not set.

### Missing webhook secret in config

**Symptom:** `WebhookVerificationError: Stripe webhook secret is not configured.`

**Cause:** The `webhookSecret` field was not provided in the Stripe adapter config. Stripe verification requires this value.

**Solution:** Add the `webhookSecret` field to your Stripe provider config:

```ts
config: {
  apiKey: process.env.STRIPE_API_KEY!,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
},
```

### Raw body parsing issues (Express body-parser gotcha)

**Symptom:** `WebhookVerificationError` -- signature verification fails even though the secret is correct.

**Cause:** Express's `express.json()` middleware parses the request body into a JavaScript object. When the SDK re-serializes it, the result differs from the original raw bytes, which breaks the HMAC signature.

**Solution:** Capture the raw body before Express parses it. Use the `verify` callback to stash the raw buffer:

```ts
import express from 'express';
import { VaultClient, WebhookVerificationError } from '@vaultsaas/core';

const app = express();

// Capture raw body for webhook routes
app.use(
  '/webhooks',
  express.json({
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  }),
);

app.post('/webhooks/stripe', async (req, res) => {
  try {
    const rawBody = (req as any).rawBody as Buffer;
    const headers = req.headers as Record<string, string>;
    const event = await vault.handleWebhook('stripe', rawBody, headers);
    console.log('Event:', event.type, event.providerEventId);
    res.sendStatus(200);
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      return res.status(400).send(error.message);
    }
    res.sendStatus(500);
  }
});
```

Alternatively, use Node's built-in `http` module and read the raw body directly from the request stream, as shown in the [webhooks documentation](./webhooks.md).

### Clock skew (Stripe timestamp tolerance)

**Symptom:** `WebhookVerificationError: Stripe webhook timestamp is too old (exceeds 5-minute tolerance). Possible replay attack.`

**Cause:** The Stripe adapter enforces a 5-minute tolerance between the webhook timestamp and the server's current time. If the server clock is skewed, legitimate webhooks will be rejected.

**Solution:**
- Synchronize the server clock with NTP.
- If running in Docker or a VM, ensure the host clock is accurate.
- In CI/testing, make sure the test generates a recent timestamp.

---

## 3. Routing Mismatches

### No matching rule

**Symptom:** `VaultRoutingError` with code `NO_ROUTING_MATCH` or a charge that falls through to an unexpected default provider.

**Cause:** The request's currency, country, payment method, or amount did not match any specific routing rule, and the request was either handled by the default rule or no rule matched at all.

**Solution:** Review your routing rules. Rules are evaluated top-to-bottom and the first match wins. Add more specific rules above the default:

```ts
routing: {
  rules: [
    // Specific rules first
    {
      provider: 'dlocal',
      match: { country: 'BR', paymentMethod: ['pix', 'boleto'] },
    },
    {
      provider: 'paystack',
      match: { currency: 'NGN' },
    },
    // Default fallback last (required)
    {
      provider: 'stripe',
      match: { default: true },
    },
  ],
},
```

Check `result.routing.reason` on a successful charge to see which rule was selected and at which index.

### Missing default rule

**Symptom:** `VaultConfigError: Routing configuration must include a default fallback rule.` at construction time, or `VaultRoutingError: Routing rules must include a default fallback rule.` from the Router.

**Cause:** The SDK requires at least one routing rule with `match: { default: true }`. This ensures every request can be routed even if no specific rule matches.

**Solution:** Add a default rule at the end of your rules array:

```ts
routing: {
  rules: [
    // ... your specific rules ...
    { provider: 'stripe', match: { default: true } },
  ],
},
```

### Provider does not support the currency or payment method

**Symptom:** The charge is routed to a provider that rejects it with `INVALID_REQUEST` because the currency or payment method is unsupported.

**Cause:** Routing matched a rule, but the target provider does not support the request's currency or method. For example, routing a `pix` payment to Stripe, or an `NGN` charge to dLocal.

**Solution:** Add match constraints so rules only fire for supported combinations. Each adapter exposes a `metadata` object with supported currencies, countries, and methods. Use them as a reference:

```ts
// Stripe supports: card, bank_transfer, wallet
// Stripe currencies: USD, EUR, GBP, CAD, AUD, JPY, etc.

// dLocal supports: card, pix, boleto, bank_transfer
// dLocal currencies: BRL, MXN, ARS, CLP, COP, PEN, UYU, etc.

// Paystack supports: card, bank_transfer, wallet
// Paystack currencies: NGN, GHS, ZAR, KES, USD
```

### Forced provider is excluded

**Symptom:** `VaultRoutingError` with code `ROUTING_PROVIDER_EXCLUDED`.

**Cause:** The request specifies both `routing.provider` and `routing.exclude`, and the forced provider appears in the exclude list.

**Solution:** Do not exclude a provider that you are explicitly forcing:

```ts
// This will throw ROUTING_PROVIDER_EXCLUDED:
await vault.charge({
  // ...
  routing: {
    provider: 'stripe',
    exclude: ['stripe'], // conflict
  },
});

// Fix: remove the exclusion or remove the override
```

---

## 4. Idempotency Conflicts

### Same key with different payload

**Symptom:** `VaultIdempotencyConflictError` with code `IDEMPOTENCY_CONFLICT` and message "Idempotency key was reused with a different payload."

**Cause:** A previous request with the same `idempotencyKey` was recorded with a different payload hash. The SDK hashes the operation type and the full request object to detect mismatches.

**Solution:** Either reuse the exact same request payload for that key, or generate a new idempotency key:

```ts
// First call stores the result
await vault.charge({
  amount: 2500,
  currency: 'USD',
  paymentMethod: { type: 'card', token: 'tok_visa' },
  idempotencyKey: 'order-1001-v1',
});

// Same key, same payload -> returns cached result (OK)
await vault.charge({
  amount: 2500,
  currency: 'USD',
  paymentMethod: { type: 'card', token: 'tok_visa' },
  idempotencyKey: 'order-1001-v1',
});

// Same key, different amount -> throws IDEMPOTENCY_CONFLICT
await vault.charge({
  amount: 3000, // changed
  currency: 'USD',
  paymentMethod: { type: 'card', token: 'tok_visa' },
  idempotencyKey: 'order-1001-v1', // reused
});

// Fix: use a new key when the payload changes
await vault.charge({
  amount: 3000,
  currency: 'USD',
  paymentMethod: { type: 'card', token: 'tok_visa' },
  idempotencyKey: 'order-1001-v2', // new key
});
```

### TTL expiration

**Symptom:** A replayed request does not return the cached result and instead creates a new charge.

**Cause:** The idempotency record expired. The default TTL is 24 hours. After expiration, the SDK treats the key as new.

**Solution:** If you need a longer window, increase `idempotency.ttlMs`:

```ts
idempotency: {
  ttlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
},
```

For production, implement a persistent `IdempotencyStore` (backed by Redis or a database) so that records survive process restarts. The default `MemoryIdempotencyStore` loses all records when the process exits.

### Custom store missing required methods

**Symptom:** `VaultConfigError: Idempotency store is missing required methods.`

**Cause:** A custom idempotency store was provided but does not implement all four required methods: `get`, `set`, `delete`, `clearExpired`.

**Solution:** Ensure your store implements the full `IdempotencyStore` interface:

```ts
import type { IdempotencyRecord, IdempotencyStore } from '@vaultsaas/core';

class RedisIdempotencyStore implements IdempotencyStore {
  async get(key: string): Promise<IdempotencyRecord | null> { /* ... */ }
  async set(record: IdempotencyRecord): Promise<void> { /* ... */ }
  async delete(key: string): Promise<void> { /* ... */ }
  async clearExpired(): Promise<void> { /* ... */ }
}
```

---

## 5. Platform Connector Issues

### Connection refused or DNS resolution failure

**Symptom:** Warning log: "Platform routing unavailable. Falling back to local routing." with cause `ECONNREFUSED` or `ENOTFOUND`.

**Cause:** The platform API at `platform.baseUrl` is unreachable, or the URL is incorrect.

**Solution:**
- Verify the `platformApiKey` and `platform.baseUrl` values.
- Check network connectivity and firewall rules from the application host.
- The SDK gracefully falls back to local routing rules when the platform is unreachable, so charges will continue to work.

### Timeouts

**Symptom:** Charges complete successfully but `routing.source` is `"local"` instead of `"platform"`, and you see timeout warnings in logs.

**Cause:** The platform routing request exceeded `platform.timeoutMs` (default varies). The SDK falls back to local routing silently.

**Solution:** Tune `platform.timeoutMs` based on network latency to the platform API. Keep it low (e.g., 100-300 ms) to avoid adding latency to the payment critical path:

```ts
platform: {
  timeoutMs: 150,    // low timeout for routing decisions
  batchSize: 100,    // report batch size
  flushIntervalMs: 2000,
  maxRetries: 2,
  initialBackoffMs: 100,
},
```

### Fallback behavior

**Symptom:** Charges continue to process after the platform goes down, but routing decisions differ from expectations.

**Cause:** This is expected behavior. When the platform connector is unavailable or times out, the SDK falls back to evaluating local routing rules defined in your config.

**Solution:** Always maintain a complete set of local routing rules as a fallback. Check `result.routing.source` to monitor whether charges are being routed by the platform (`"platform"`) or locally (`"local"`):

```ts
const result = await vault.charge(request);
if (result.routing.source === 'local') {
  console.warn('Charge was routed locally (platform may be unavailable)');
}
```

### Empty platform API key

**Symptom:** `VaultConfigError: platformApiKey cannot be empty when provided.`

**Cause:** `platformApiKey` was set to an empty or whitespace-only string.

**Solution:** Either provide a valid API key or omit `platformApiKey` entirely to disable the connector.

---

## 6. Common TypeScript Errors

### PaymentMethodInput type mismatch

**Symptom:** TypeScript error: "Property 'number' does not exist on type '{ type: "card"; token: string; }'" (or similar).

**Cause:** `PaymentMethodInput` is a discriminated union. When `type` is `"card"`, the payload must be either `{ type: 'card', token: string }` or `{ type: 'card', number: string, expMonth: number, expYear: number, cvc: string }`. Mixing fields from both variants causes a type error.

**Solution:** Use exactly one variant:

```ts
// Token-based card
const tokenCard: PaymentMethodInput = {
  type: 'card',
  token: 'pm_card_visa',
};

// Raw card details
const rawCard: PaymentMethodInput = {
  type: 'card',
  number: '4242424242424242',
  expMonth: 12,
  expYear: 2030,
  cvc: '123',
};
```

### Missing required config fields

**Symptom:** TypeScript error on `VaultConfig` or `VaultClient` constructor, such as "Property 'providers' is missing in type..."

**Cause:** The `VaultConfig` type requires `providers` with at least one entry, and each provider requires `adapter` and `config`.

**Solution:** Provide all required fields:

```ts
import type { VaultConfig } from '@vaultsaas/core';

const config: VaultConfig = {
  providers: {
    stripe: {
      adapter: StripeAdapter,       // required: constructor function
      config: {                     // required: plain object
        apiKey: 'sk_test_...',
      },
      // optional fields:
      // priority: 1,
      // enabled: true,
    },
  },
  // routing is optional but recommended:
  routing: {
    rules: [{ match: { default: true }, provider: 'stripe' }],
  },
};
```

### LoggerInterface type mismatch

**Symptom:** TypeScript error when passing a custom logger: "Type '...' is not assignable to type 'LoggerInterface'."

**Cause:** The logger must implement four methods: `error`, `warn`, `info`, `debug`, each accepting `(message: string, context?: Record<string, unknown>)`.

**Solution:** `console` satisfies the interface. For custom loggers, ensure all four methods are present:

```ts
const logger: LoggerInterface = {
  error: (msg, ctx) => { /* ... */ },
  warn:  (msg, ctx) => { /* ... */ },
  info:  (msg, ctx) => { /* ... */ },
  debug: (msg, ctx) => { /* ... */ },
};
```

### Amount type confusion

**Symptom:** Charges create payments with unexpected amounts (e.g., $25.00 becomes $2500.00).

**Cause:** The `amount` field uses the **smallest currency unit** (cents for USD, kobo for NGN). This is an `number` type in the SDK, not a float.

**Solution:** Always convert to the smallest unit before calling the SDK:

```ts
// $25.00 USD = 2500 cents
await vault.charge({ amount: 2500, currency: 'USD', /* ... */ });

// 500 NGN = 50000 kobo
await vault.charge({ amount: 50000, currency: 'NGN', /* ... */ });

// 1000 JPY = 1000 (JPY is zero-decimal)
await vault.charge({ amount: 1000, currency: 'JPY', /* ... */ });
```

---

## 7. Build and Import Issues

### ESM vs CJS

**Symptom:** `ERR_REQUIRE_ESM`, `SyntaxError: Cannot use import statement in a module`, or `ReferenceError: exports is not defined`.

**Cause:** `@vaultsaas/core` ships both ESM (`.js`) and CJS (`.cjs`) builds via the `exports` field in `package.json`. The wrong format can be loaded if your project's module system configuration conflicts.

**Solution:**

- **ESM project** (`"type": "module"` in your `package.json`): imports resolve to `dist/index.js` automatically. No changes needed.
- **CJS project** (no `"type": "module"`): imports resolve to `dist/index.cjs` automatically via the `require` condition.
- **Mixed project**: ensure your bundler respects the `exports` map. For TypeScript, set `"moduleResolution": "Bundler"` or `"NodeNext"` in `tsconfig.json`.

If you are using `ts-node`, set `"esm": true` in `tsconfig.json` or use `tsx` instead:

```bash
# Instead of ts-node
npx tsx quickstart.ts
```

### Node version requirements

**Symptom:** `SyntaxError` on optional chaining, nullish coalescing, or other ES2022+ syntax. Or `fetch is not defined`.

**Cause:** The SDK targets ES2022 and requires Node.js 20 or later. Node 18 is missing native `fetch` support in some builds; Node 16 and earlier lack required syntax support.

**Solution:** Upgrade to Node.js 20+:

```bash
node --version
# Must be v20.0.0 or higher

# If using nvm:
nvm install 20
nvm use 20
```

The SDK relies on the built-in `fetch` API available in Node.js 18+ (experimental) and Node.js 20+ (stable).

### TypeScript version

**Symptom:** Type errors on SDK types that work on other machines, or "cannot find module" errors.

**Cause:** The SDK uses TypeScript 5.x features. Older TypeScript versions may fail to resolve the `exports` map or parse newer type syntax.

**Solution:** Use TypeScript 5.0 or later and set appropriate `tsconfig.json` options:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

---

## 8. Payment-Specific Issues

### Card declines

**Symptom:** `VaultProviderError` with code `CARD_DECLINED`. The `context` object includes `declineCode` and `providerMessage`.

**Cause:** The issuing bank declined the card. Common reasons include insufficient funds, incorrect card details, or fraud prevention.

**Solution:** Present a user-friendly error based on the decline code, and ask the customer to try a different card:

```ts
try {
  await vault.charge(request);
} catch (error) {
  if (error instanceof VaultError && error.code === 'CARD_DECLINED') {
    console.log('Decline code:', error.context.declineCode);
    console.log('Provider message:', error.context.providerMessage);
    // Show: "Your card was declined. Please try another payment method."
  }
}
```

Common Stripe test cards for simulating declines:
- `4000000000000002` -- generic decline
- `4000000000009995` -- insufficient funds
- `4000000000009987` -- do not honor

### 3DS / authentication required

**Symptom:** `VaultProviderError` with code `AUTHENTICATION_REQUIRED`, or the `PaymentResult` has `status: 'requires_action'`.

**Cause:** The card issuer requires Strong Customer Authentication (SCA / 3D Secure). This is common in Europe and increasingly elsewhere.

**Solution:** When you receive `status: 'requires_action'`, redirect the customer to complete authentication. The exact flow depends on your frontend integration:

```ts
const result = await vault.charge(request);

if (result.status === 'requires_action') {
  // The provider metadata may include a redirect URL or client secret
  // Use it to trigger 3DS on the frontend
  console.log('3DS required:', result.providerMetadata);
}
```

For Stripe, handle `requires_action` by using `stripe.confirmCardPayment()` on the client side with the PaymentIntent client secret.

### Fraud suspected

**Symptom:** `VaultProviderError` with code `FRAUD_SUSPECTED`.

**Cause:** The provider's fraud detection system flagged the transaction.

**Solution:** Do not retry automatically. Route the payment through manual review, or ask the customer to verify their identity:

```ts
if (error instanceof VaultError && error.code === 'FRAUD_SUSPECTED') {
  // Do NOT retry -- flag for manual review
  await flagForFraudReview(request, error.context);
}
```

### Currency formatting

**Symptom:** Provider rejects the request with an invalid currency error, or the amount is interpreted incorrectly.

**Cause:** The SDK expects ISO 4217 currency codes in uppercase (e.g., `"USD"`, `"BRL"`, `"NGN"`). Lowercase values are normalized internally by some adapters, but passing non-ISO codes will fail.

**Solution:** Always use uppercase ISO 4217 codes:

```ts
// Correct
await vault.charge({ amount: 2500, currency: 'USD', /* ... */ });

// Also correct (adapters normalize case internally)
await vault.charge({ amount: 2500, currency: 'usd', /* ... */ });

// Wrong -- not a valid ISO 4217 code
await vault.charge({ amount: 2500, currency: 'dollars', /* ... */ });
```

Remember that `amount` is always in the smallest currency unit:
- USD: cents (100 = $1.00)
- BRL: centavos (100 = R$1.00)
- JPY: yen (1 = 1 yen, zero-decimal currency)
- NGN: kobo (100 = 1 NGN)

### Rate limiting

**Symptom:** `VaultProviderError` with code `RATE_LIMITED`. The error has `retriable: true`.

**Cause:** The provider returned HTTP 429 or a rate-limit message. Too many requests were sent in a short period.

**Solution:** Implement exponential backoff. The SDK marks this error as retriable:

```ts
if (error instanceof VaultError && error.retriable) {
  // Queue for retry with exponential backoff
  await retryWithBackoff(() => vault.charge(request));
}
```

### Provider timeouts

**Symptom:** `VaultNetworkError` with code `PROVIDER_TIMEOUT`. The error has `retriable: true`.

**Cause:** The provider did not respond within the adapter's timeout window (default: 15 seconds).

**Solution:**
- Retry the request (the SDK marks this as retriable).
- If timeouts are frequent, increase the adapter's `timeoutMs`:

```ts
config: {
  apiKey: process.env.STRIPE_API_KEY!,
  timeoutMs: 30_000, // increase from default 15s
},
```

- Investigate if the provider is experiencing an outage.

---

## Error Code Quick Reference

| Code | Category | Retriable | Common Cause |
|------|----------|-----------|--------------|
| `INVALID_CONFIGURATION` | `configuration_error` | No | Missing or invalid config values |
| `PROVIDER_NOT_CONFIGURED` | `configuration_error` | No | Provider referenced but not in config |
| `PROVIDER_AUTH_FAILED` | `configuration_error` | No | Wrong API key or expired credentials |
| `NO_ROUTING_MATCH` | `routing_error` | No | No rule matched the request |
| `ROUTING_PROVIDER_EXCLUDED` | `routing_error` | No | Forced provider is in exclude list |
| `ROUTING_PROVIDER_UNAVAILABLE` | `routing_error` | No | Provider not configured or disabled |
| `INVALID_REQUEST` | `invalid_request` | No | Bad request fields or provider validation failure |
| `IDEMPOTENCY_CONFLICT` | `invalid_request` | No | Same key, different payload |
| `WEBHOOK_SIGNATURE_INVALID` | `invalid_request` | No | Wrong secret or tampered body |
| `CARD_DECLINED` | `card_declined` | No | Issuer declined the card |
| `AUTHENTICATION_REQUIRED` | `authentication_required` | No | 3DS or SCA challenge needed |
| `FRAUD_SUSPECTED` | `fraud_suspected` | No | Provider fraud check flagged transaction |
| `RATE_LIMITED` | `rate_limited` | Yes | Too many requests to provider |
| `NETWORK_ERROR` | `network_error` | Yes | Connection refused, DNS failure, etc. |
| `PROVIDER_TIMEOUT` | `network_error` | Yes | Provider did not respond in time |
| `PLATFORM_UNREACHABLE` | `network_error` | Yes | VaultSaaS platform API unreachable |
| `PROVIDER_ERROR` | `provider_error` | Yes | Provider 5xx or transient failure |
| `PROVIDER_UNKNOWN` | `unknown` | No | Unmapped provider error |

---

## General Debugging Tips

1. **Enable debug logging** to see routing decisions, provider calls, and platform connector activity:

   ```ts
   const vault = new VaultClient({
     // ...
     logging: {
       level: 'debug',
       logger: console,
     },
   });
   ```

2. **Inspect the full error object.** Every `VaultError` includes `code`, `category`, `suggestion`, `docsUrl`, `retriable`, and `context`. Log all of them:

   ```ts
   catch (error) {
     if (error instanceof VaultError) {
       console.error({
         code: error.code,
         category: error.category,
         retriable: error.retriable,
         suggestion: error.suggestion,
         docsUrl: error.docsUrl,
         context: error.context,
       });
     }
   }
   ```

3. **Check `result.routing.reason`** on successful charges to verify the correct rule matched and the expected provider was selected.

4. **Use idempotency keys** for all charge and authorize requests to prevent duplicate payments during retries.

5. **Test webhooks locally** with tools like the Stripe CLI (`stripe listen --forward-to localhost:3000/webhooks/stripe`) or ngrok.
