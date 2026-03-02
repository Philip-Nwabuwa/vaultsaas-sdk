# @vaultsaas/core

Open-source core SDK for VaultSaaS payments orchestration.

## Quickstart

```bash
bun install
bun run build
```

## Scripts

- `bun run lint`
- `bun run format`
- `bun run typecheck`
- `bun run test`
- `bun run build`
- `bun run release:dry-run`

## Error Handling

All SDK failures are thrown as `VaultError` instances with:

- `code`
- `category`
- `suggestion`
- `docsUrl`
- `retriable`
- `context`

```ts
import { VaultError } from '@vaultsaas/core';

try {
  await vault.charge({
    amount: 2500,
    currency: 'USD',
    paymentMethod: { type: 'card' },
  });
} catch (error) {
  if (error instanceof VaultError) {
    console.log(error.code, error.category);
    console.log(error.suggestion);
    console.log(error.docsUrl);
  }
}
```

## License

MIT
