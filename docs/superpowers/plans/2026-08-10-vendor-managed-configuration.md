# Vendor-Managed Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the vendor customise Quandatics workflows and UI safely from the control plane without a source fork or client-editable workflow builder.

**Architecture:** Typed declarative configuration is drafted, validated, versioned, signed, and published by the control plane. The deployment agent delivers it to the CRM, which verifies it, retains last-known-good versions, materialises workflow records transactionally, and renders tenant UI from stable codes.

**Tech Stack:** Zod, Hono/D1, Next.js 16, PostgreSQL/Drizzle, React context, Tailwind design tokens, Vitest.

## Global Constraints

- Configuration accepts data only: no JavaScript, SQL, arbitrary HTML, arbitrary CSS, remote script URLs, or secrets.
- Stable IDs survive label changes; deleting a referenced status/field requires an explicit migration mapping.
- Only vendor control-plane roles draft/publish; client Owner/Admin can view effective configuration but cannot edit it.
- A rejected version leaves the prior version active and records diagnostics/audit history.

---

### Task 1: Define the Declarative Configuration Protocol

**Files:**
- Create: `packages/control-protocol/src/configuration.ts`
- Create: `packages/control-protocol/tests/configuration.test.ts`
- Modify: `packages/control-protocol/src/index.ts`

**Interfaces:**
- `DeploymentConfiguration` includes revision, deployment ID, theme tokens, navigation labels/order, module options, custom-field definitions, workflows/stages/transitions, approval rules, and template references.
- Validators enforce unique stable codes, known field types/operators, valid transition graphs, bounded text/collection sizes, and no executable content.

- [ ] Write failing schema, graph, injection, stable-code, and compatibility tests.
- [ ] Implement schemas and `validateConfigurationTransition(previous, next)`.
- [ ] Run protocol tests/typecheck and commit `feat: define signed deployment configuration`.

### Task 2: Add Control-Plane Draft and Publish Lifecycle

**Files:**
- Create: `apps/control-plane/migrations/0002_configuration.sql`
- Create: `apps/control-plane/src/services/configuration.ts`
- Create: `apps/control-plane/src/routes/operator/configuration.tsx`
- Create: `apps/control-plane/src/routes/api/configuration.ts`
- Create: `apps/control-plane/test/configuration.test.ts`

**Interfaces:**
- Statuses are `draft`, `validated`, `published`, `rejected`, `superseded`.
- Publish signs immutable canonical payloads, links the prior revision, and writes audit actor/reason.
- Deployment API returns only the latest compatible published revision.

- [ ] Write failing RBAC, lifecycle, optimistic-lock, validation, and signing tests.
- [ ] Add D1 migration, service, operator forms, and deployment fetch endpoint.
- [ ] Verify Worker tests/types and commit `feat: publish vendor managed configuration`.

### Task 3: Receive and Retain Last-Known-Good Configuration

**Files:**
- Modify: `apps/deployment-agent/src/runner.ts`
- Create: `apps/web/app/api/internal/deployment/configuration/route.ts`
- Create: `apps/web/lib/deployment-configuration.ts`
- Create: `apps/web/lib/deployment-configuration.test.ts`
- Modify: `apps/web/db/migrations/0063_deployment_control.sql`
- Modify: `apps/web/db/schema.ts`

**Interfaces:**
- CRM verifies signature, deployment ID, schema version, monotonic revision, and compatibility before one transaction activates it.
- Activation stores payload, signature, validation result, actor `deployment-agent`, and rollback pointer.
- `rollbackConfiguration(revision)` reactivates only a previously verified local revision and audits the action.

- [ ] Write failing apply/replay/incompatible/rollback tests.
- [ ] Implement internal route, service, schema, and agent delivery.
- [ ] Run focused/E2E tests and commit `feat: apply signed deployment configuration`.

### Task 4: Render Vendor Theme, Navigation, and Labels

**Files:**
- Create: `apps/web/lib/configuration-provider.tsx`
- Create: `apps/web/lib/configuration.server.ts`
- Modify: `apps/web/app/(app)/layout.tsx`
- Modify: `apps/web/components/**` files that own application shell/theme/navigation
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Server loads one effective configuration and passes a serialisable, sanitised view model.
- Theme values map only to an allowlisted set of CSS custom properties.
- Missing keys fall back to the product defaults, including default dark appearance requested for the deployment.

- [ ] Add failing fallback, allowlist, dark-default, navigation-order, and label tests.
- [ ] Implement provider and integrate shell components.
- [ ] Run component tests, visual smoke tests, typecheck, and build.
- [ ] Commit with `feat: render vendor managed ui configuration`.

### Task 5: Materialise Workflows and Lock Client Editing

**Files:**
- Create: `apps/web/lib/workflow-materializer.ts`
- Create: `apps/web/lib/workflow-materializer.test.ts`
- Modify: funnel/workflow settings actions and pages returned by `rg "funnel|workflow|stage" apps/web/app/\(app\)/settings`
- Modify: `apps/web/lib/permissions.ts`

**Interfaces:**
- Materialisation upserts stages/transitions by stable external code, never label, and refuses destructive changes with live references unless a mapping exists.
- When `configurationMode = "vendor_managed"`, client roles see a read-only effective workflow and support contact; platform-superadmin bypass is audit-only and not exposed to the client.

- [ ] Write failing idempotency, rename, referenced-delete, rollback, and permission tests.
- [ ] Implement transactional materialisation and remove client mutation capability in vendor-managed mode.
- [ ] Verify funnel/workflow regression tests and commit `feat: materialize vendor managed workflows`.

### Task 6: Connect Custom Fields to Supported Modules

**Files:**
- Create: `apps/web/lib/custom-fields.ts`
- Create: `apps/web/lib/custom-fields.test.ts`
- Modify: account, person, lead/opportunity, finance, and O2C forms/details/import/export paths discovered by `rg "customField|metadata" apps/web modules`

**Interfaces:**
- Definitions are scoped by entity type and stable code; values are validated server-side and stored in the existing supported JSON/custom-field storage.
- Import/export uses stable codes, while UI uses configured labels/help text.
- Removing a field hides it but preserves historical values until an explicit retention migration.

- [ ] Inventory supported entity storage and write failing validation/render/import/export tests.
- [ ] Integrate the common field service into each supported module without per-client components.
- [ ] Run module regressions, typecheck, lint, and build.
- [ ] Commit with `feat: apply configured custom fields across modules`.

### Task 7: Add Compatibility Preview and Promotion Gates

**Files:**
- Create: `apps/control-plane/src/services/configuration-compatibility.ts`
- Create: `apps/control-plane/src/routes/operator/configuration-preview.tsx`
- Modify: `.github/workflows/preview.yml`
- Create: `tests/e2e/configuration-promotion.spec.ts`

**Interfaces:**
- Control plane evaluates required app/protocol versions before publish.
- Preview deploy receives the candidate signed config, runs smoke tests, and records evidence before production promotion is enabled.

- [ ] Add failing compatibility and promotion tests.
- [ ] Implement preview status/evidence and protected promotion action.
- [ ] Run Worker/web/E2E suites and commit `ci: gate configuration promotion on preview evidence`.

