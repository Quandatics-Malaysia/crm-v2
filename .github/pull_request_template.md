## What & why

<!-- One or two sentences. Link the issue if there is one. -->

## Checklist

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the reasoning behind each item.

- [ ] `pnpm run lint`, `pnpm run typecheck`, `pnpm test`, `pnpm run build` all pass
- [ ] If I touched a gated module, I built once with its flag `false` (no static core→module edge)
- [ ] No new migration chain — migrations are generated into `db/migrations/`, not hand-authored
- [ ] No tables gated on a module flag (flags gate access, not data)
- [ ] `server/services/*` still free of `next/*` imports
- [ ] Sample-seed rows wrapped in `isModuleEnabled(...)` if I added any

## Notes for reviewers

<!-- Anything cross-module, risky, or worth a closer look. Migrations/RLS need two core reviewers. -->
