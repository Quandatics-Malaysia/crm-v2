# Control-plane CSRF Token Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace unreliable browser-origin mutation checks with a zero-maintenance double-submit CSRF token.

**Architecture:** Operator GET responses maintain one random token in a secure path-scoped cookie and pass it into rendered mutation forms. Operator POST middleware compares that cookie against the submitted form field or JSON header before RBAC and mutation execution; no database or secret configuration is added.

**Tech Stack:** Cloudflare Workers, Hono, Hono JSX, TypeScript, Vitest, D1.

## Global Constraints

- Cloudflare Access authentication and operator RBAC remain unchanged.
- No CSRF token, cookie value, or secret enters logs or audit metadata.
- Cookie uses `HttpOnly`, `Secure`, `SameSite=Strict`, and `Path=/operator`.
- Missing or mismatched tokens return `403` before mutation.
- No D1 schema, secret, environment variable, or maintenance process is added.

---

### Task 1: Stateless operator CSRF protection

**Files:**
- Modify: `apps/control-plane/src/routes/operator.tsx`
- Modify: `apps/control-plane/src/ui/dashboard.tsx`
- Modify: `apps/control-plane/src/ui/operator-pages.tsx`
- Test: `apps/control-plane/tests/operator-crud.test.ts`

**Interfaces:**
- Produces: `csrfToken(context): string`, which returns the current valid token or creates and sets one.
- Produces: `requireCsrfToken`, mutation middleware validating cookie plus `_csrf` form field or `X-CSRF-Token` JSON header.
- Consumes: UI props named `csrfToken: string`; every mutation form renders `<input type="hidden" name="_csrf" value={csrfToken} />`.

- [ ] **Step 1: Replace metadata tests with failing token tests**

Add request-helper cookie/token support and assertions for valid, absent, and mismatched tokens. Keep role-denial and audit assertions.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `pnpm --dir apps/control-plane test -- operator-crud.test.ts`

Expected: token-protected mutation tests fail because forms and middleware do not yet support `_csrf`.

- [ ] **Step 3: Implement cookie parsing, generation, and validation**

Use Hono cookie helpers. Generate `crypto.randomUUID()` when no syntactically valid token exists. Validate a strict UUID token from the cookie against `_csrf` for forms or `X-CSRF-Token` for JSON. Remove `Origin`, `Referer`, and `Sec-Fetch-Site` authorization checks.

- [ ] **Step 4: Inject token into all mutation forms**

Pass `csrfToken` from operator GET routes into `ClientList`, client detail, contract detail, and other operator pages containing POST forms. Add the hidden `_csrf` input to every form.

- [ ] **Step 5: Run control-plane validation**

Run: `pnpm --dir apps/control-plane test -- operator-crud.test.ts`

Expected: all control-plane test files and focused CRUD assertions pass.

- [ ] **Step 6: Commit and publish**

```bash
git add apps/control-plane/src/routes/operator.tsx apps/control-plane/src/ui/dashboard.tsx apps/control-plane/src/ui/operator-pages.tsx apps/control-plane/tests/operator-crud.test.ts
git commit -m "fix(control-plane): use stateless CSRF tokens"
git push -u origin fix/control-plane-csrf-token
```

- [ ] **Step 7: Merge and deploy production**

Create a PR, require the quality workflow, merge, dispatch `deploy-control-plane` with `environment=production`, and confirm the production job succeeds before asking the operator to retry client creation.
