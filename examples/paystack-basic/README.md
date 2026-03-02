# Paystack Basic Example

Minimal runnable Paystack recurring charge example using a saved Paystack `authorization_code`.

## Setup

1. Install dependencies:
   - `bun install`
2. Set environment variables:
   - `PAYSTACK_SECRET_KEY`
   - `PAYSTACK_AUTHORIZATION_CODE`
   - `PAYSTACK_CUSTOMER_EMAIL`

How to get `PAYSTACK_AUTHORIZATION_CODE`:

1. Run a first successful card payment in Paystack test mode for the same customer email.
2. Read `authorization.authorization_code` from Paystack verify response or webhook payload.
3. Reuse that code here for subsequent charges.

## Run

```bash
PAYSTACK_SECRET_KEY=sk_test_xxx \
PAYSTACK_AUTHORIZATION_CODE=AUTH_xxx \
PAYSTACK_CUSTOMER_EMAIL=buyer@example.com \
bun run start
```
