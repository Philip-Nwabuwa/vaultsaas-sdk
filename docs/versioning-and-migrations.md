# Versioning And Migrations

This SDK follows Semantic Versioning and ships release notes through Changesets.

## SemVer policy

- `MAJOR`: breaking API or behavior changes
- `MINOR`: backward-compatible features
- `PATCH`: backward-compatible fixes

Public contract includes:

- exported TypeScript types
- `VaultClient` methods and request/response shapes
- canonical error structure (`VaultError`)
- webhook normalization output (`VaultEvent`)

## Deprecation policy

When deprecating a public API:

1. Add a clear note in README/docs and release notes.
2. Keep the deprecated API working through at least one full minor release.
3. Provide a direct migration path with before/after snippets.
4. Remove only in the next major release.

## Migration note template

Use this format in changelog/docs:

```md
### Migration: <old API> -> <new API>

- Deprecated in: vX.Y.0
- Removal target: v(X+1).0.0
- Why: <reason>
- Action required: <specific code change>
```

## Example migration (TypeScript)

```ts
// Before (deprecated):
await vault.charge({
  amount: 1000,
  currency: 'USD',
  paymentMethod: { type: 'card', token: 'tok_visa' },
});

// After:
await vault.charge({
  amount: 1000,
  currency: 'USD',
  paymentMethod: { type: 'card', token: 'pm_card_visa' },
  metadata: { migration: 'v2-routing' },
});
```

## Release process guidance

- Add a changeset for user-facing changes: `bunx changeset`.
- Keep changelog entries actionable and migration-focused.
- Do not publish breaking removals without:
  - a prior deprecation cycle
  - migration docs
  - major version bump
