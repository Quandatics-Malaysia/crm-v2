# Zudoku Docs Site — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working Zudoku docs site under `docs-site/` covering the developer/repo docs (Overview, Contributing, Modules, a public-safe Operations overview, Architecture), buildable locally and ready for the user to connect to their personal Vercel account.

**Architecture:** A standalone Zudoku (Vite/React) app in `docs-site/`, isolated from the Next.js app. Root `README.md`/`CONTRIBUTING.md`/`MODULES.md` stay canonical and are copied into `docs-site/pages/` by a prebuild script (single source of truth). New pages (Operations overview, Architecture) are authored as MDX. Vercel builds `docs-site/` on push; the app, prod box, tunnel, and Actions are untouched.

**Tech Stack:** Zudoku (config `zudoku.config.ts`; content in `pages/**/*.{md,mdx}`; `navigation` array; `zudoku dev` / `zudoku build`), pnpm, Vercel (user-connected).

## Global Constraints

- **Zero impact on the app / prod / CI.** Everything lives in `docs-site/`. No change to `app/`, `docker-compose*.yaml`, `.github/workflows/deploy*.yml`, or the app's `package.json`. The one allowed root change is adding `docs-site/` build artifacts to `.gitignore`.
- **Single source of truth:** `README.md`, `CONTRIBUTING.md`, `MODULES.md` remain the canonical root files. `docs-site/` must NOT contain hand-edited duplicates — it copies them at build time. The copied files under `docs-site/pages/` are git-ignored build artifacts.
- **No sensitive ops detail on the public site.** The site must NOT contain the server LAN IP (`10.1.10.26`), backup/restore procedures, or hardening internals. Verified by grepping the built output.
- **`docs-site/` is NOT wired into the app's pnpm workspace** in Phase A (its own isolated `package.json` + lockfile). Deferred to the workspace restructure.
- Commit co-author trailer exactly: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Config file is `zudoku.config.ts`; content files are `docs-site/pages/**/*.{md,mdx}` referenced from `navigation` by filename without extension.

---

## File map

```
docs-site/
├─ package.json           # Task 1 — zudoku dep + dev/build/prebuild scripts
├─ zudoku.config.ts       # Task 2 — site, theme, navigation, docs.files
├─ scripts/sync-root-docs.mjs   # Task 3 — copy + link-rewrite root Markdown → pages/
├─ pages/
│  ├─ overview.md         # Task 3 — copied from ../README.md (git-ignored)
│  ├─ contributing.md     # Task 3 — copied from ../CONTRIBUTING.md (git-ignored)
│  ├─ modules.md          # Task 3 — copied from ../MODULES.md (git-ignored)
│  ├─ operations.mdx      # Task 4 — authored, public-safe overview
│  └─ architecture.mdx    # Task 4 — authored, curated from specs
├─ README.md              # Task 5 — how to run + Vercel connect settings
└─ .gitignore             # Task 1 — node_modules, dist, .zudoku, copied pages
.gitignore (root)         # Task 1 — ignore docs-site build artifacts
```

---

### Task 1: Scaffold the Zudoku app in `docs-site/`

**Files:**
- Create: `docs-site/` (via the Zudoku scaffold), `docs-site/.gitignore`
- Modify: root `.gitignore`

**Interfaces:**
- Produces: a `docs-site/` where `pnpm install && pnpm run build` succeeds and emits a static site to `docs-site/dist/`.

- [ ] **Step 1: Scaffold**

From the repo root, scaffold into `docs-site/`:
```bash
npm create zudoku@latest docs-site
```
Answer the prompts for a **documentation** site (not API-only). If the CLI is fully interactive and can't run unattended, hand-create the minimum instead: a `docs-site/package.json` with `zudoku` as a dependency and scripts `"dev": "zudoku dev"`, `"build": "zudoku build"`; a minimal `zudoku.config.ts` (`export default { navigation: [], docs: { files: "/pages/**/*.{md,mdx}" } }`); and `docs-site/pages/introduction.md` with a heading. Either path is fine — the gate is Step 4.

- [ ] **Step 2: Install with pnpm**

```bash
cd docs-site && pnpm install
```
(Zudoku's own isolated lockfile — do NOT run this at the repo root or it'll pollute the app workspace.)

- [ ] **Step 3: Gitignore build artifacts**

Create `docs-site/.gitignore`:
```
node_modules
dist
.zudoku
# copied root docs (single source of truth — see scripts/sync-root-docs.mjs)
pages/overview.md
pages/contributing.md
pages/modules.md
```
And append to the ROOT `.gitignore` (so the repo never tracks docs-site build output even if run from root):
```
# Zudoku docs site build artifacts
docs-site/node_modules/
docs-site/dist/
docs-site/.zudoku/
```

- [ ] **Step 4: Verify build**

```bash
cd docs-site && pnpm run build
```
Expected: build succeeds, `docs-site/dist/` is produced with an `index.html`.

- [ ] **Step 5: Commit**

```bash
git add docs-site .gitignore
git commit -m "docs(site): scaffold Zudoku docs app in docs-site/

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Site config, theme, and navigation skeleton

**Files:**
- Modify: `docs-site/zudoku.config.ts`

**Interfaces:**
- Consumes: the scaffolded config from Task 1.
- Produces: a `navigation` covering the five sections; `docs.files` pointing at `pages/`.

- [ ] **Step 1: Write the config**

Set `docs-site/zudoku.config.ts` to (adapt the import/type to whatever the scaffold uses; the shape below matches Zudoku's documented config):
```ts
import type { ZudokuConfig } from "zudoku"

const config: ZudokuConfig = {
  site: {
    title: "Quandatics CRM — Docs",
  },
  metadata: {
    title: "Quandatics CRM Docs",
    description: "Developer & operator documentation for the Quandatics CRM.",
  },
  docs: { files: "/pages/**/*.{md,mdx}" },
  navigation: [
    { type: "doc", file: "overview", label: "Overview" },
    { type: "doc", file: "contributing", label: "Contributing" },
    { type: "doc", file: "modules", label: "Modules" },
    { type: "doc", file: "operations", label: "Operations" },
    { type: "doc", file: "architecture", label: "Architecture" },
  ],
}

export default config
```
(The `overview`/`contributing`/`modules` files are produced by Task 3; `operations`/`architecture` by Task 4. Until then the build may warn about missing files — that's fine within this task; the full green build is Task 4's gate.)

- [ ] **Step 2: Verify config parses / dev boots**

```bash
cd docs-site && timeout 25 pnpm run dev >/tmp/zudoku-dev.log 2>&1 & sleep 20; grep -iE "localhost|ready|error" /tmp/zudoku-dev.log | head; kill %1 2>/dev/null
```
Expected: a local URL line appears, no fatal config error. (Missing-page warnings for not-yet-created pages are acceptable here.)

- [ ] **Step 3: Commit**

```bash
git add docs-site/zudoku.config.ts
git commit -m "docs(site): site config, metadata, and five-section navigation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Single-source the root Markdown (Overview / Contributing / Modules)

**Files:**
- Create: `docs-site/scripts/sync-root-docs.mjs`
- Modify: `docs-site/package.json` (add `predev` + `prebuild` hooks)

**Interfaces:**
- Consumes: root `README.md`, `CONTRIBUTING.md`, `MODULES.md`.
- Produces: `docs-site/pages/{overview,contributing,modules}.md` at build time (git-ignored), referenced by the Task 2 nav.

- [ ] **Step 1: Write the sync script**

Create `docs-site/scripts/sync-root-docs.mjs`:
```js
// Copies the canonical root Markdown into pages/ so the docs site and GitHub
// show ONE source. Runs on predev/prebuild. Copied files are git-ignored.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "../..")
const pagesDir = resolve(here, "../pages")
mkdirSync(pagesDir, { recursive: true })

const map = [
  ["README.md", "overview.md"],
  ["CONTRIBUTING.md", "contributing.md"],
  ["MODULES.md", "modules.md"],
]

// Rewrite the common cross-doc relative links to site routes so they don't 404.
const rewrite = (s) =>
  s
    .replace(/\]\(\.\/CONTRIBUTING\.md\)/g, "](/contributing)")
    .replace(/\]\(\.\/MODULES\.md\)/g, "](/modules)")
    .replace(/\]\(\.\/README\.md\)/g, "](/overview)")

for (const [src, dst] of map) {
  const body = readFileSync(resolve(repoRoot, src), "utf8")
  writeFileSync(resolve(pagesDir, dst), rewrite(body))
  console.log(`synced ${src} -> pages/${dst}`)
}
```

- [ ] **Step 2: Wire the hooks**

In `docs-site/package.json`, add to `scripts`:
```json
    "sync-docs": "node scripts/sync-root-docs.mjs",
    "predev": "node scripts/sync-root-docs.mjs",
    "prebuild": "node scripts/sync-root-docs.mjs"
```
(Keep the existing `dev`/`build`.)

- [ ] **Step 3: Run the sync + verify the pages exist**

```bash
cd docs-site && pnpm run sync-docs && ls pages/overview.md pages/contributing.md pages/modules.md
```
Expected: three files listed; console prints three `synced …` lines.

- [ ] **Step 4: Verify build renders them**

```bash
cd docs-site && pnpm run build 2>&1 | tail -5 && grep -rl "Quandatics" dist/ | head -1
```
Expected: build succeeds; the built output contains README content (e.g. "Quandatics").

- [ ] **Step 5: Commit**

```bash
git add docs-site/scripts docs-site/package.json
git commit -m "docs(site): sync root README/CONTRIBUTING/MODULES into pages at build time

Single source of truth — the root Markdown stays canonical; the copies under
pages/ are git-ignored build artifacts.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Author the Operations overview + Architecture pages

**Files:**
- Create: `docs-site/pages/operations.mdx`, `docs-site/pages/architecture.mdx`

**Interfaces:**
- Consumes: the nav entries from Task 2.
- Produces: the two authored pages; the full green build.

- [ ] **Step 1: Write the public-safe Operations overview**

Create `docs-site/pages/operations.mdx` — **no server IP, no backup/restore specifics, no hardening internals** (those stay in the repo's `OPERATIONS.md`). Cover only: the deploy model (push to `main` → GitHub Actions quality gate → self-hosted rebuild), the environments (production + the `staging` preview branch → staging stack), and a pointer that the full operator runbook lives in `OPERATIONS.md` in the repo. Keep it to ~30-50 lines of MDX headings + prose.

- [ ] **Step 2: Write the Architecture page**

Create `docs-site/pages/architecture.mdx` — curated *summaries* (not raw specs) of: the monorepo direction (one repo, module system), the settings IA (nested routes + Billing/Taxonomy sub-nav), and the staging environment. Link to the in-repo `docs/superpowers/specs/` for full detail. ~40-60 lines.

- [ ] **Step 3: Full green build**

```bash
cd docs-site && pnpm run build 2>&1 | tail -8
```
Expected: build succeeds with **no missing-file warnings** for any of the five nav entries.

- [ ] **Step 4: Verify NO sensitive ops detail leaked into the built site**

```bash
cd docs-site && grep -rniE "10\.1\.10\.26|pg_dump|restore|BACKUP_RSYNC|hardening|id_ed25519" dist/ || echo "CLEAN — no sensitive ops detail in the built output"
```
Expected: `CLEAN …`. (If anything matches, it came from a copied/authored page — remove it before committing.)

- [ ] **Step 5: Commit**

```bash
git add docs-site/pages/operations.mdx docs-site/pages/architecture.mdx
git commit -m "docs(site): authored Operations overview + Architecture pages

Operations page is public-safe (no server IP, backups, or hardening — those
stay in the repo OPERATIONS.md).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `docs-site/README.md` + Vercel connect notes

**Files:**
- Create: `docs-site/README.md`

**Interfaces:**
- Produces: the operator/contributor instructions for running the site and connecting it to Vercel.

- [ ] **Step 1: Write it**

Create `docs-site/README.md` documenting:
- **Run locally:** `cd docs-site && pnpm install && pnpm run dev` (localhost).
- **Build:** `pnpm run build` → `dist/`.
- **Single source of truth:** Overview/Contributing/Modules are copied from the repo root at build time by `scripts/sync-root-docs.mjs`; edit the ROOT files, not `pages/*.md`.
- **Deploy to Vercel (one-time, USER):** create a project from this repo on your personal Vercel account; set **Root Directory = `docs-site`**; framework preset **Vite** (or Other), build command `pnpm run build`, output directory `dist`; deploy and use the default `*.vercel.app` URL. Push to `main` auto-builds; PRs get preview URLs.

- [ ] **Step 2: Verify + commit**

```bash
cd docs-site && pnpm run build >/dev/null 2>&1 && echo "final build OK"
git add docs-site/README.md
git commit -m "docs(site): README with local-run + Vercel connect instructions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review notes

- **Spec coverage:** §2 architecture (isolated `docs-site/`, Vercel) → Tasks 1 + 5; §3 IA (five sections) → Task 2 nav + Tasks 3/4 pages; §4 single-source → Task 3 sync script; §5 ops security → Task 4 (public-safe page + the grep gate in Step 4); §6 components → Tasks 1-4; §7 manual Vercel steps → Task 5 README; §8 verification → each task's build + Task 4 Step 4 leak-grep. No spec section unmapped.
- **Adaptivity flagged, not hand-waved:** Task 1 allows the official scaffold OR a hand-minimum because Zudoku's interactive CLI output can vary; the gate is a successful `pnpm build`, and Task 2 pins the config to Zudoku's documented shape regardless.
- **Security gate is concrete:** Task 4 Step 4 greps the built `dist/` for the exact sensitive tokens (server IP, backup/restore, hardening) — the load-bearing check that the public site is safe.
- **No placeholders:** every task has exact paths, real config/script code, and exact verify commands. The two authored pages (Task 4) specify exact content boundaries (what to include, what to exclude) rather than TODOs.
- **Isolation invariant:** no task touches `app/`, compose, or CI — only `docs-site/` + two root `.gitignore` lines.
