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
