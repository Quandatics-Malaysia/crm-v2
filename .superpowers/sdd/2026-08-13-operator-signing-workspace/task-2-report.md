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

## Fix round 1/5: touch targets and generated IDs

### Root cause

- `min-block-size` on ordinary inline anchors has no layout effect. The global selector also supplied no inline sizing, so pager and breadcrumb links had no usable touch target.
- `Field`, `Card`, and `Notice` derived IDs only from their names or titles. Repeated instances therefore emitted duplicate `id` values and ambiguous `for`/`aria-labelledby` references.

### RED evidence

Command:

```sh
pnpm --dir apps/control-plane exec vitest run tests/operator-crud.test.ts -t "(styles navigational links and selectable-control labels|assigns unique IDs when repeated primitives)"
```

Output: `2 failed | 29 skipped (31)`.

- `styles navigational links and selectable-control labels as touch targets` failed because the served CSS had only `.operator-shell :is(a, button, input, select, textarea) { min-block-size: 2.75rem; }`, with no display-capable navigation/pager/breadcrumb selector or checkbox/radio label target.
- `assigns unique IDs when repeated primitives share names and titles` failed with `expected 3 to be 6`; six generated IDs contained only three unique values.

### GREEN evidence

Focused command:

```sh
pnpm --dir apps/control-plane exec vitest run tests/operator-crud.test.ts -t "(styles navigational links and selectable-control labels|assigns unique IDs when repeated primitives|renders labelled fields and cards)"
```

Output: `3 passed | 28 skipped (31)`.

Operator CRUD command:

```sh
pnpm --dir apps/control-plane exec vitest run tests/operator-crud.test.ts
```

Output: `1 passed` test file; `31 passed (31)` tests.

Typecheck command:

```sh
pnpm --dir apps/control-plane typecheck
```

Output: `$ tsc --noEmit`; exit 0.

Diff command:

```sh
git diff --check
```

Output: exit 0; no whitespace errors.

Full suite command:

```sh
pnpm --dir apps/control-plane test
```

Output: migration compatibility test passed; `6 passed (6)` Vitest files; `129 passed (129)` tests.

### Fix decisions

- Added a 44px block target only to navigation, breadcrumb, pager, and button-like links. Prose links remain inline and keep their natural width.
- Sized checkbox/radio visuals normally and made their wrapping labels 44px click targets. Existing module checkboxes already use wrapping labels.
- Used Hono JSX `useId()` for per-instance field and heading IDs, retaining descriptive name/title prefixes while making repeated server-rendered instances unique.

## Fix round 2/5: brand touch target

### RED evidence

Extended `styles navigational links and selectable-control labels as touch targets` to require `.operator-brand` in the display-capable 44px target selector.

Command:

```sh
pnpm --dir apps/control-plane exec vitest run tests/operator-crud.test.ts -t "styles navigational links and selectable-control labels as touch targets"
```

Output: `1 failed | 30 skipped (31)`. The served CSS selector omitted `.operator-brand`.

### GREEN evidence

Command:

```sh
pnpm --dir apps/control-plane exec vitest run tests/operator-crud.test.ts -t "styles navigational links and selectable-control labels as touch targets"
```

Output: `1 passed | 30 skipped (31)`.

Additional verification:

```sh
pnpm --dir apps/control-plane typecheck
git diff --check
```

Output: `$ tsc --noEmit`; both commands exited 0, with no diff whitespace errors.

### Fix decision

- Added `.operator-brand` to the existing display-capable touch-target selector. The layout remains unchanged and the brand keeps natural inline width while receiving a 44px block target.
