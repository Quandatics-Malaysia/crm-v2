# Zudoku docs site — Phase A (developer/repo docs) design

**Date:** 2026-07-18
**Status:** Approved (design), pending implementation plan
**Scope:** Stand up a Zudoku documentation site for the **developer/repo docs**
(README, CONTRIBUTING, MODULES, a lean Operations overview, curated
Architecture), hosted on the user's **personal Vercel account** at its default
`*.vercel.app` URL (no custom domain — the link doesn't matter). Phase B
(migrating the in-app product-docs module) is a **separate follow-on project**,
out of scope here.

---

## 1. Problem & scope

The repo docs are good but scattered across root Markdown files; there's no
polished, searchable, hosted home for contributors/operators. We want a Zudoku
site — themeable MDX docs with nav + search + dark mode.

**Two doc sets exist** (sized during brainstorming): dev/repo docs (~768 lines
of Markdown) and a shipped in-app product-docs module (`app/documentation/`,
~5,000 lines of React/TS incl. a generated schema reference). They differ hugely
in size, audience, and risk, so they are **decomposed**:

- **Phase A (this spec):** dev/repo docs → Zudoku on Vercel. Small, safe, ships
  a working site and proves the Zudoku + hosting setup end-to-end.
- **Phase B (later, separate spec):** migrate the in-app product docs into the
  same Zudoku site — a product change (module fate, user access, regenerating
  the schema reference). NOT covered here.

## 2. Architecture

```
repo/
└─ docs-site/               # NEW: a Zudoku (Vite/React) app, own package.json
   ├─ zudoku.config.tsx     # nav, theme, site config
   ├─ pages/                # authored MDX
   └─ (imports root *.md as canonical pages — see §4)

Vercel (personal account) ── git-connected to the repo, root = docs-site/
   push to main → Vercel builds Zudoku → https://<project>.vercel.app
   (default Vercel URL — no custom domain, no DNS)
```

- Zudoku is a **standalone static build**, independent of the Next.js app, the
  prod box, the Cloudflare tunnel, and the GitHub-Actions deploy. It cannot
  affect production.
- Vercel builds only the `docs-site/` subdirectory (Vercel "Root Directory"
  setting). Per-PR Vercel preview deployments come free — a bonus preview for
  docs changes.
- In the coming workspace restructure, `docs-site/` becomes `apps/docs`.

## 3. Information architecture

Curated sections — **not** a dump of every `.md`:

| Section | Source |
|---|---|
| **Overview** | `README.md` (what the product is, quickstart) |
| **Contributing** | `CONTRIBUTING.md` (the five rules, PR flow, ownership) |
| **Modules** | `MODULES.md` (the plugin system + recipe) |
| **Operations** | a **lean, public-safe overview** authored in the site (deploy flow, staging, environments) — NOT the full `OPERATIONS.md` (see §5) |
| **Architecture** | curated highlights from `docs/superpowers/specs/` (monorepo direction, settings IA, staging) — summarized, not raw specs |

**Excluded from the public site:** `AGENTS.md` (AI-agent rules), `AUDIT.md`
(security findings), the `docs/superpowers/plans/` (internal working artifacts),
and the sensitive parts of `OPERATIONS.md` (§5).

## 4. Single source of truth (no drift)

`README.md` and `CONTRIBUTING.md` MUST stay in the repo root (GitHub renders
them; CONTRIBUTING is surfaced in the PR flow). To avoid maintaining two copies:

- The Zudoku site **imports the root Markdown files** as pages (Vite/MDX can
  import `.md`), so `README.md` / `CONTRIBUTING.md` / `MODULES.md` have exactly
  ONE canonical copy — the root file — surfaced on the site.
- Only genuinely new docs (the Operations overview, Architecture summaries) are
  authored directly under `docs-site/pages/`.

This keeps GitHub and the docs site showing the same content with no manual sync.

## 5. Security — Operations docs

`OPERATIONS.md` contains internal ops detail (the server's LAN IP, backup and
restore procedures, hardening). Vercel hobby serves the site **publicly**
(password protection needs Pro). Decision:

- **Publish a lean, public-safe "Operations overview"** authored in the site:
  what staging is, the deploy flow, environment layout — no IPs, no backup/restore
  specifics, no hardening internals.
- **The full `OPERATIONS.md` stays in the repo only** (operators read it there).

Net: nothing sensitive lands on the public internet; operators lose nothing.

## 6. Components

- `docs-site/package.json` — Zudoku + its deps, `dev` / `build` scripts. Kept as
  its own package (not wired into the app's pnpm workspace in Phase A, to avoid
  coupling the docs build to the app build; revisit in the workspace restructure).
- `docs-site/zudoku.config.tsx` — site metadata, the §3 nav, theme (Zudoku's
  shadcn-compatible theming; match Quandatics brand colors), dark mode.
- `docs-site/pages/*.mdx` — the authored pages (Operations overview, Architecture).
- Root-Markdown imports for Overview / Contributing / Modules.
- `.gitignore` — ignore `docs-site/node_modules`, `docs-site/dist`, Zudoku's
  `.zudoku`/build caches.

## 7. Manual steps (one-time, USER)

Can't be automated (personal Vercel account):
1. **Vercel:** create a project from the repo on your personal account, set Root
   Directory = `docs-site/`, framework/preset per Zudoku's Vercel guide, deploy.
   Use the default `*.vercel.app` URL — no custom domain, no DNS.
2. (Auth for the CLI if we script any of this: `vercel login` on your account.)

## 8. Verification

- `cd docs-site && pnpm install && pnpm run build` produces a static site with no
  errors; `pnpm run dev` serves it locally and all §3 sections render.
- Overview/Contributing/Modules render the SAME content as the root Markdown
  (import works, no drift).
- The public site contains **no** server IP, backup, or hardening detail
  (grep the built output).
- After the manual steps: the Vercel `*.vercel.app` URL serves the site; nav +
  search + dark mode work.

## 9. Out of scope

- **Phase B:** the in-app product-docs module (`app/documentation/`) and its
  generated schema reference — separate spec.
- OpenAPI/API-playground features (the CRM has no OpenAPI spec).
- Gating the site (chosen: lean public site; no Vercel Pro).
- Wiring `docs-site` into the app's pnpm workspace (deferred to the restructure).

## 10. Risks / trade-offs

- **Vercel account dependency:** docs hosting now depends on a personal Vercel
  account. Low-stakes (docs only; source stays in the repo, portable to
  Cloudflare Pages / self-host later).
- **Zudoku is API-doc-first:** used here purely as an MDX docs site; some
  API-centric features go unused. Acceptable — it still delivers a polished docs
  experience.
- **Import-vs-author split:** imported root Markdown must render acceptably in
  Zudoku (relative links, front-matter). Mitigated by keeping imported files as
  plain Markdown and fixing any link rewrites in config.
