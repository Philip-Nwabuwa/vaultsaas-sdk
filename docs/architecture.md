# Architecture Overview

`@vaultsaas/core` normalizes provider adapters behind a single orchestration client.

```mermaid
flowchart LR
  A[Application] --> B[VaultClient]
  B --> C[Config Validation]
  B --> D[Router]
  B --> E[Idempotency Store]
  B --> F[Platform Connector]

  D --> G[Provider Adapter: Stripe]
  D --> H[Provider Adapter: dLocal]
  D --> I[Provider Adapter: Paystack]

  G --> J[(Provider API)]
  H --> J
  I --> J

  K[Incoming Webhooks] --> B
  B --> L[Webhook Normalization]
  L --> M[(App/Event Consumer)]

  B --> N[Error Mapper]
  N --> O[VaultError Types]
```

## Core Components

- `VaultClient`: entry point for charge/auth/capture/refund/void/status/webhooks.
- `Router`: evaluates routing rules and provider capabilities.
- `Adapters`: implement provider-specific API calls and webhook verification.
- `Error Mapper`: normalizes provider/network failures into canonical `VaultError` codes.
- `Idempotency`: prevents duplicate operation execution for repeated keys.
- `Platform Connector`: optional telemetry and remote routing integration.
