# Production Recovery and External Developer Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the production CRM, make deployment evidence reliable, and publish a secure collaboration guide for developers who cannot read private source code.

**Architecture:** Keep source-code contribution private and route it through GitHub access plus reviewed pull requests. Give no-source external developers a public documentation/API/sandbox path; do not instruct them to fork private source. Production remains Docker Compose on the internal runner, with migrations completing before web startup.

**Tech Stack:** Next.js 16, pnpm, Vitest, PostgreSQL, Docker Compose, GitHub Actions, Zudoku, Vercel.

## Global Constraints

- Never expose production source, secrets, database credentials, or runtime access to external developers.
- `OPERATIONS.md` remains private; public docs contain no server access, backup, restore, or hardening secrets.
- Root `README.md`, `CONTRIBUTING.md`, and `MODULES.md` remain canonical; docs site copies them during build.
- Production deployment must pass quality checks and migration completion before serving traffic.

### Task 1: Capture deployment failure and add regression coverage

**Files:**
- Modify: `apps/web/tests/deployment-control-db.test.ts`
- Modify: `apps/web/tests/deployment-seats-db.test.ts`
- Inspect: `apps/web/server/services/deployment-control.ts`, deployment seat service, relevant migrations

- [ ] **Step 1: Reproduce the exact PostgreSQL failures**
- [ ] **Step 2: Trace the conflicting binding and nullable seat result to schema/service code**
- [ ] **Step 3: Add the smallest regression assertions**
- [ ] **Step 4: Run targeted tests and confirm red before implementation**

### Task 2: Fix production deployment blockers

**Files:**
- Modify: only service/schema/migration files identified by Task 1
- Test: targeted PostgreSQL suites, then full web test suite

- [ ] **Step 1: Implement one root-cause fix at a time**
- [ ] **Step 2: Run targeted tests after each fix**
- [ ] **Step 3: Run lint, typecheck, test, and build**
- [ ] **Step 4: Push and monitor the production workflow**

### Task 3: Replace source-access instructions for external developers

**Files:**
- Modify: `CONTRIBUTING.md`
- Modify: `docs-site/pages/api-guide.mdx`
- Create: `docs-site/pages/external-developers/overview.mdx`
- Create: `docs-site/pages/external-developers/collaboration.mdx`
- Create: `docs-site/pages/external-developers/development-guide.mdx`
- Modify: `docs-site/zudoku.config.tsx`
- Modify: `docs-site/README.md`

- [ ] **Step 1: Document three access lanes: private source contributor, no-source integration developer, and future plugin partner**
- [ ] **Step 2: Document API key, tenant scope, sandbox, support, and release process**
- [ ] **Step 3: Explicitly state current API is read-only and write integrations are not available**
- [ ] **Step 4: Verify docs routes and public-safe build**

### Task 4: Verify live systems

- [ ] **Step 1: Confirm docs-quality succeeds and Vercel returns HTTP 200**
- [ ] **Step 2: Confirm production health returns HTTP 200**
- [ ] **Step 3: Record current commit and deployment run links**
