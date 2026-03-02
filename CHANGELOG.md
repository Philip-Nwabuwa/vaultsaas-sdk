# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog,
and this project follows Semantic Versioning.

## [Unreleased]

## [0.1.0] - 2026-03-02

### Added

- Added adapter capability metadata contract (`supportedMethods`, `supportedCurrencies`, `supportedCountries`) on built-in adapters.
- Added router capability filtering to skip providers that do not support the request context.
- Added provider-specific integration guides:
  - `docs/providers/stripe.md`
  - `docs/providers/dlocal.md`
  - `docs/providers/paystack.md`
- Added a security review report for release hardening: `docs/security-review-v0.1.0.md`.
- Added runnable provider examples under `examples/`.
- Added `CODE_OF_CONDUCT.md` and `.env.example`.
- Added architecture documentation with a Mermaid diagram in `docs/architecture.md`.

### Changed

- Upgraded package version from `0.0.0` to `0.1.0`.
- Expanded dLocal and Paystack adapter test coverage to include capture/refund edge cases, webhook validation paths, and status normalization.
- Expanded provider error-classification tests for auth, rate-limit, network, fraud, invalid request, and authentication-required signals.
- Tightened config validation to require static adapter metadata declarations.
- Wired adapter metadata from `VaultClient` into `Router` for runtime routing validation.

### Security

- Audited webhook signature verification behavior across Stripe, dLocal, and Paystack.
- Audited runtime config validation safeguards for provider setup and routing constraints.
- Added targeted negative-path tests for malformed signatures, missing headers, invalid payloads, and provider error mapping.

### Documentation

- Added CI badge and expanded docs links in README.
- Added troubleshooting and provider guide links from README.

