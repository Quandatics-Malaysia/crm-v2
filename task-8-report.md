# Task 8 verification report

## Scope

- Worktree: `feat/operator-signing-workspace`
- `task-8-brief.md` was not present in the accessible SDD/user workspace; this
  implementation follows the supplied task requirements.
- Inspected `docs/operations/release-log.md` before editing. It contained only
  its header, so no signed release was recorded.
- No deployment, release tag, live-environment action, or release-log entry was
  created.

## Documentation changed

- `apps/control-plane/README.md`: replaced stale install-token guidance with
  the operator UI workflow.
- `OPERATIONS.md`: added client onboarding, one-time token, signing/re-signing,
  heartbeat, renewal/change control, and unsigned/stale/grace/read-only
  diagnosis.
- `README.md`: added concise operator-workspace entry point and release-log
  boundary.
- `docs-site/pages/operations.mdx`: added the public operator workflow and
  recovery summary.
- `docs-site/pages/external-developers/overview.mdx`: documents the vendor-only
  boundary for deployment tokens, signing, and agent state.
- `docs/operations/release-log.md`: clarifies that docs preparation is not a
  release or live-deployment record.
- `docs-site/pages/overview.md`: regenerated from `README.md` by the documented
  docs sync command.

## Commands and results

| Command | Result |
| --- | --- |
| `rtk git status --short --branch` | Clean branch before edits. |
| `rtk sed -n '1,260p' docs/operations/release-log.md` | Inspected active version log before edits; no release entries. |
| `rtk pnpm --filter control-plane test` | Passed: 6 files, 180 tests. |
| `rtk proxy pnpm --filter control-plane typecheck` | Passed: `tsc --noEmit`. Proxy used because `rtk` does not preserve a leading pnpm `--filter` for this command. |
| `rtk pnpm run lint` | Passed. |
| `rtk pnpm run test` | Passed: 42 files, 416 tests; 4 files and 36 tests skipped. |
| `rtk pnpm run build` | Passed after protocol build prerequisite. |
| `rtk pnpm --dir docs-site run verify` | Passed: lint, 2 unit tests, docs coverage check, production build, and Mermaid E2E on 23 routes. |
| `rtk git diff --check` | Passed. |

## Local verification prerequisites

- `rtk pnpm install --frozen-lockfile` completed successfully.
- `rtk pnpm --filter @crm/control-protocol run build` completed successfully. The
  web production build needs the package's local `dist` node export.
- `rtk proxy npm --prefix docs-site install --no-package-lock` completed successfully.
  `docs-site` is intentionally outside `pnpm-workspace.yaml`, so it had no
  local `node_modules` and `eslint` was initially unavailable.

Initial build/docs-verify failures were local dependency setup only and were not
caused by this documentation branch. After the documented prerequisites, every
requested gate passed. Non-blocking build warnings concerned the local Better
Auth development secret; docs build warned about shallow Git history and SQL
syntax highlighting. No unrelated blocker remains.
