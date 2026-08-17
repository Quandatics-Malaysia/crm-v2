# PPVVC Lost-Update Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve untouched PPVVC fields during partial edits and make Funnel and Opportunity synchronization acquire database locks in one deterministic order.

**Architecture:** Normalize submitted PPVVC patches as sparse field maps, then merge them with the row locked by the synchronization service. Funnel entry first validates its tenant/live child lookup without locking, and the shared service locks the Opportunity followed by live children for both entry points. PostgreSQL boundary tests will exercise the cross-entry race and assert both updates commit without deadlock or lost fields.

**Tech Stack:** TypeScript, Next.js server actions, Drizzle ORM, PostgreSQL, Vitest.

## Global Constraints

- Follow strict TDD: each regression must fail for the intended reason before production code changes.
- Run shell commands through `rtk`; use `apply_patch` for file edits.
- Read the installed Next.js 16.2.11 guide before writing code.
- Complete full web tests, typecheck, lint, migration checks, diff checks, and leave a clean committed worktree.

---

### Task 1: Sparse PPVVC patch normalization

**Files:**
- Modify: `apps/web/lib/ppvvc.ts`
- Test: `apps/web/tests/ppvvc-sync.test.ts`

**Interfaces:**
- Produces `normalizePpvvcPatch(values): PpvvcPatch`, retaining only submitted PPVVC keys and trimming values without converting omitted keys to `null`.

- [x] Write a failing unit test proving `undefined` keys are omitted and explicit blank/null values clear only submitted keys.
- [x] Run the focused unit test and confirm it fails because the sparse normalizer is absent.
- [x] Implement the smallest sparse normalizer.
- [x] Run the focused unit test and confirm it passes.

### Task 2: Actions pass sparse submitted keys

**Files:**
- Modify: `apps/web/app/(app)/funnel/actions.ts`
- Modify: `apps/web/app/(app)/opportunities/actions.ts`
- Modify: `apps/web/server/services/ppvvc.ts`
- Test: `apps/web/tests/ppvvc-sync.test.ts`

**Interfaces:**
- Both actions use `normalizePpvvcPatch` before deciding whether a PPVVC sync is needed.
- `updateOpportunityPpvvc` normalizes the submitted sparse patch, locks the current Opportunity, and merges only those keys into the current authoritative values.

- [x] Add a failing sparse-submitted-key regression proving omitted action fields are not forwarded.
- [x] Run the focused regression and confirm it fails before the sparse normalizer exists.
- [x] Implement sparse action payloads and lock-time patch merge/persistence.
- [x] Run focused synchronization tests and confirm they pass.

### Task 3: Deterministic lock order and database concurrency coverage

**Files:**
- Modify: `apps/web/server/services/ppvvc.ts`
- Modify: `apps/web/tests/ppvvc-sync-db.test.ts`

**Interfaces:**
- `updateFunnelPpvvc` validates the live, tenant-scoped Funnel, then delegates without taking a child lock first.
- Both entry points lock Opportunity first and live child Funnels second; Funnel validation remains enforced after the ordered lock boundary.

- [x] Add a failing PostgreSQL boundary test racing Funnel and Opportunity edits, with a timeout and final source/child assertions for both fields.
- [x] Run the database regression; this workspace skipped it because both database URLs are unset.
- [x] Implement the ordered locking change and post-lock live-child validation.
- [x] Run the boundary regression; the test is present and the configured-less run reports it skipped.

### Task 4: Verification and handoff

**Files:**
- Modify: `.superpowers/sdd/2026-08-17-crm-sales-lifecycle-customization/task-5-report.md`

- [x] Run focused tests, full web suite, typecheck, lint, migration checks, and `git diff --check`.
- [x] Review the final diff and report the exact database-test skip/configuration status if applicable.
- [x] Update the report with Fix round 2/5 TDD and verification evidence.
- [x] Commit as `fix: prevent PPVVC lost updates`.
- [x] Verify clean status and final commit contents.
