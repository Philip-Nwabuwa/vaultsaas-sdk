# Security Review - v0.1.0

Date: 2026-03-02
Scope: webhook signature verification and config validation hardening.

## Reviewed Areas

- Shared signature utilities (`createHmacDigest`, `secureCompareHex`, raw payload handling).
- Stripe webhook verification (signature parsing, timestamp replay window, HMAC verification).
- dLocal webhook verification (signature header validation and HMAC verification).
- Paystack webhook verification (signature header validation and HMAC verification).
- `VaultClient` configuration validation for provider, routing, logging, idempotency, and platform config.

## Findings

- Timing-safe comparison is used for signature validation.
- Stripe replay protection is enforced with a 5-minute timestamp tolerance.
- Missing/malformed signature headers fail closed.
- Invalid JSON webhook payloads fail closed after signature checks.
- Provider config now requires static capability declarations (`supportedMethods`, `supportedCurrencies`, `supportedCountries`) for routing validation.

## Residual Risk Notes

- dLocal and Paystack webhook verification do not include provider timestamp replay checks in current adapter implementations.
- Integrators should terminate TLS at trusted edges and enforce ingress protections (IP allowlists/WAF) for webhook endpoints.

## Test Evidence Added

- Expanded negative-path webhook tests for Stripe, dLocal, and Paystack.
- Expanded config-validation tests for missing static adapter metadata.
- Expanded provider error-classification tests for network/auth/rate-limit/invalid-request/fraud/auth-required cases.
