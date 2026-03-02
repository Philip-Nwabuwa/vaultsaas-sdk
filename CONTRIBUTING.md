# Contributing

## Local setup

1. Install Bun 1.1+.
2. Run `bun install`.
3. Run checks before opening a PR:
   - `bun run lint`
   - `bun run typecheck`
   - `bun run test`
   - `bun run build`

## Release notes

Use Changesets for any user-facing change:

```bash
bunx changeset
```

## Release readiness

Before publishing:

1. Run `bun run release:verify` (lint, typecheck, tests, docs gate, build, package export/type checks).
2. Run `bun run release:dry-run` to validate packed artifacts.
3. Ensure changelog + migration notes are updated for user-facing changes.
