# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | Yes                |

Security patches will be applied to the latest release in the supported range. Users are encouraged to stay on the latest version.

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

If you discover a security vulnerability in `@vaultsaas/core`, please report it responsibly by emailing:

**security@vaultsaas.io**

### What to Include

Your report should include as much of the following as possible:

- A clear description of the vulnerability
- Steps to reproduce the issue
- Affected versions
- Impact assessment (e.g., data exposure severity, authentication bypass scope)
- Any proof-of-concept code or logs, if available
- Suggested fix, if you have one

### Response Timeline

- **Acknowledgment**: within 48 hours of your report
- **Initial assessment**: within 5 business days
- **Critical fixes**: released within 7 days of confirmation
- **Non-critical fixes**: released within 14 days of confirmation

We will keep you informed of our progress throughout the process and credit you in the release notes (unless you prefer to remain anonymous).

## Scope

The following are considered in-scope security issues for this project:

- Authentication or authorization bypass (e.g., API key handling flaws)
- Sensitive data leaks (e.g., payment credentials, API keys exposed in logs or errors)
- Injection vulnerabilities (e.g., request parameter injection, header injection)
- Webhook signature verification bypass
- Insecure default configurations that could lead to data exposure
- Dependency vulnerabilities that are directly exploitable through the SDK
- Cryptographic weaknesses in signature verification or token handling

## Out of Scope

The following are considered out of scope:

- Social engineering attacks against VaultSaaS maintainers or users
- Denial-of-service attacks against a user's own infrastructure
- Vulnerabilities in third-party payment providers (e.g., Stripe, PayPal) -- report those directly to the provider
- Issues that require physical access to a user's machine
- Attacks that require the attacker to already have valid API credentials
- Vulnerabilities in applications built with the SDK that are caused by the application's own code (e.g., improper secret storage)
- Best-practice recommendations that do not represent an exploitable vulnerability

## Disclosure Policy

We follow a coordinated disclosure process:

1. The reporter submits the vulnerability privately.
2. We confirm and assess the issue.
3. We develop and test a fix.
4. We release the fix and publish a security advisory.
5. The reporter is free to publish details after the fix is released.

We ask that you allow us a reasonable amount of time to address the issue before public disclosure.

## Recognition

We value the security research community and are happy to acknowledge your contribution. With your permission, we will credit you by name (or handle) in:

- The relevant release notes in CHANGELOG.md
- The GitHub security advisory

If you prefer to remain anonymous, we will respect that preference.

## Contact

For any security-related questions or concerns, reach out to **security@vaultsaas.io**.

## Latest Review

- Release `0.1.0` included a focused security hardening review on:
  - webhook signature verification paths (Stripe, dLocal, Paystack)
  - configuration validation and fail-fast checks
  - provider error mapping for security-relevant failure classification
- See `docs/security-review-v0.1.0.md` for details.
