# Release Pipeline Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce release wall-clock time without weakening signed-image, provenance, scanning, or deployment gates.

**Architecture:** Measure the existing release stages first, then remove only duplicate work. The first optimization skips the standalone application build during the release preflight because the release image build performs the same build afterward. Architecture changes are deferred until the production CPU architecture is confirmed.

**Tech Stack:** GitHub Actions reusable workflows, Docker Buildx, Next.js 16, pnpm, Cosign, Trivy, SPDX SBOM.

## Global Constraints

- Keep Cosign signing and verification mandatory.
- Keep BuildKit provenance and vulnerability scanning mandatory unless a later audit decision explicitly changes this.
- Do not remove AMD64 or ARM64 support until the production host architecture is verified.
- Keep pull requests and normal `main` pushes running the full application build.
- Each optimization must have a workflow regression test and local YAML/test verification.

---

### Task 1: Establish timing baseline

**Files:**
- Read: `.github/workflows/quality.yml`
- Read: `.github/workflows/release-images.yml`
- Read: `OPERATIONS.md`

- [x] Record available historical workflow timing from GitHub run metadata. If the API is rate-limited, report that limitation and use the last observed run evidence instead of inventing percentages.
- [x] Map each stage to its dependency chain: quality, tag validation, four image builds, manifest, bundle signing, and deployment.
- [x] Identify confirmed versus inferred bottlenecks before editing code.

Observed v1.2.30 run usage: 50m06s across the failed attempt and rerun. Web builds used 33m46s (67.4%), migrator 5m02s (8.0%), agent 4m12s (8.4%), backup 2m44s (5.5%), quality 5m02s (10.0%), validation 12s (0.4%), and manifest 9s (0.3%). The successful rerun's critical path was about 21m11s, with the 18m26s web job controlling about 87% of wall-clock time.

Within the successful web job, Docker Buildx build/push took 17m06s of 18m26s (92.8%); Trivy took 15s, SPDX generation 16s, Cosign 7s, and tagging 4s. The QEMU setup itself took 6s, so the evidence points to the multi-platform image build, not Cosign or scanner overhead.

### Task 2: Skip duplicate release-only application build

**Files:**
- Modify: `.github/workflows/quality.yml`
- Modify: `.github/workflows/release-images.yml`
- Test: `.github/workflows/tests/quality.test.mjs` or the existing workflow test file covering `quality.yml`

**Interface:**
- Add reusable-workflow input `run_build` with default `true`.
- The release caller passes `run_build: false`.
- Pull requests and `main` pushes retain the default full build.

- [x] Add a failing workflow test proving normal quality runs include `pnpm run build` and release quality calls can disable it.
- [x] Run the targeted workflow test and confirm it fails before implementation.
- [x] Add the boolean input and condition the build step on it.
- [x] Pass `run_build: false` from `release-images.yml`.
- [x] Run the targeted workflow test, YAML parse tests, and local quality checks.
- [x] Commit the isolated optimization.

### Task 3: Add bounded failure time

**Files:**
- Modify: `.github/workflows/quality.yml`
- Modify: `.github/workflows/release-images.yml`
- Test: `.github/workflows/tests/*.test.mjs`

- [x] Add failing assertions that quality, image builds, and manifest jobs have explicit time limits.
- [x] Add conservative timeouts that fail stuck jobs without affecting normal builds.
- [x] Run workflow tests and verify no release permissions or signing steps changed.
- [x] Commit the timeout-only change.

### Task 4: Verify production architecture before changing platforms

**Files:**
- Read: `deploy/client/compose.yaml`
- Read: `deploy/client/README.md`
- Read: `OPERATIONS.md`

- [ ] Inspect the production host architecture through the approved internal-ops path. Current local SSH config has no `internalops` alias, so this remains pending.
- [ ] If production is AMD64-only, prepare a separate change to build only AMD64.
- [ ] If ARM64 is required, keep both platforms and evaluate a native ARM64 builder instead of QEMU.
- [ ] Do not change platform coverage in this task until evidence is recorded.

### Task 5: Reduce repeated Docker dependency work

**Files:**
- Modify: `Dockerfile`
- Modify: `.github/workflows/release-images.yml`
- Test: `.github/workflows/tests/release-images.test.mjs`

- [ ] Measure cache-hit behavior for web and migrator builds.
- [ ] Add a shared, deterministic pnpm BuildKit cache only if it improves both targets without cache races.
- [ ] Keep source-free runtime stripping and image provenance unchanged.
- [ ] Run Docker/build workflow validation before committing.

### Task 6: Review duplicated SBOM work

**Files:**
- Read: `.github/workflows/release-images.yml`
- Read: `OPERATIONS.md`
- Read: `deploy/client/verify-images.sh`

- [ ] Confirm whether downloadable SPDX files are required for audit evidence.
- [ ] If not required, remove only the redundant SBOM generation path after preserving registry attestations.
- [ ] If required, keep both and document why the extra time is intentional.
