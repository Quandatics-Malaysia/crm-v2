# Task 2: Operator Visual Foundation Report

## Outcome

Implemented server-rendered operator UI foundation: local scoped CSS, semantic layout shell, and reusable Hono JSX primitives. Existing Cloudflare Access, RBAC, CSRF, same-origin mutation checks, and `no-store` handling remain unchanged.

## RED evidence

1. Added the operator-shell route test before production edits.
   - Command: `pnpm --dir apps/control-plane exec vitest run tests/operator-crud.test.ts -t "serves an accessible no-store operator shell and local stylesheet"`
   - Result: failed at `operator-crud.test.ts:137`; rendered HTML lacked `/operator/styles.css`.
2. Added primitive rendering tests before creating the component module.
   - Command: `pnpm --dir apps/control-plane exec vitest run tests/operator-crud.test.ts -t "renders (escaped semantic headers|labelled fields|empty, notice)"`
   - Result: failed because `../src/ui/components` did not exist.
3. Added authenticated header-identity expectation before threading the operator email into every legacy page layout.
   - Command: focused shell test above.
   - Result: failed; header rendered `Operator session` instead of `owner@example.com`.

## GREEN evidence

1. Shell regression test passed after adding route, CSS, layout, and identity propagation.
   - Result: `1 passed | 28 skipped`.
2. Primitive rendering tests passed after adding components.
   - Result: `3 passed | 26 skipped`.
3. Final focused/full verification after final CSS-scoping adjustment:
   - `pnpm --dir apps/control-plane typecheck`: exit 0.
   - `pnpm --dir apps/control-plane test`: migration compatibility test passed; 6 Vitest files, 127 tests passed.
   - `git diff --check`: exit 0.

## Changed files

- `apps/control-plane/src/ui/styles.ts`: local tokenized responsive stylesheet, scoped to `.operator-shell`; includes spacing, colours, type, borders, focus treatment, 44px control targets, and component styles.
- `apps/control-plane/src/ui/components.tsx`: `PageHeader`, `StatusBadge`, `ProgressSteps`, `Field`, `Card`, `EmptyState`, `Notice`, and `DataList` primitives.
- `apps/control-plane/src/ui/layout.tsx`: stylesheet link, skip link, header identity, active navigation, breadcrumbs, and bounded main-content landmark.
- `apps/control-plane/src/routes/operator.tsx`: authenticated `GET /operator/styles.css` with CSS content type; threads the verified operator email into rendered pages.
- `apps/control-plane/src/ui/dashboard.tsx`: accepts and passes operator email to layout across existing server-rendered pages.
- `apps/control-plane/tests/operator-crud.test.ts`: route and real JSX rendering coverage for landmarks, skip link, active navigation, escaping, badge, progress, field/error association, card, empty state, notice/error panel, data list, CSS, and `no-store`.

## Decisions

- Kept CSS as a TypeScript string served from the authenticated operator route. This uses no external assets, no client runtime, and no inline `style` block, so it remains CSP-compatible.
- Used native landmarks and accessible relationships: skip target, `main`, labelled navigation, breadcrumb navigation, `aria-current`, field `label`/`for`, descriptions, and `role="alert"` for error notices.
- Passed identity from the authenticated Hono context rather than trusting request content or adding client-side state.
- Kept existing dashboard forms unchanged. Later onboarding screens can adopt the primitives incrementally without changing mutation contracts.

## Concerns / residual risks

- This task establishes primitives and shell only; legacy dashboard pages do not yet use every new primitive. That is intentional to preserve current CRUD markup and behavior for follow-on onboarding work.
- Rendering tests cover server HTML contracts. No browser visual-regression harness exists in this control-plane package, so visual appearance is verified through scoped CSS and semantic output rather than screenshots.
