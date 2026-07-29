# Quandatics CRM — Docs site

A [Zudoku](https://zudoku.dev) static docs site for the Quandatics CRM
developer/operator documentation. Built with npm (isolated from the app's pnpm
workspace).

## Run locally

```bash
cd docs-site
npm install
npm run dev        # local preview with hot reload
npm run build      # static build → dist/
npm run check:docs # verify every route/plugin has a registered product page
```

## Single source of truth

**Overview**, **Contributing**, and **Modules** are copied from the repository
root at build time by `scripts/sync-root-docs.mjs` (wired as `predev`/`prebuild`).
Edit the **root** files — `README.md`, `CONTRIBUTING.md`, `MODULES.md` — not
`pages/overview.md`, `pages/contributing.md`, and
`pages/extensibility/plugin-system.md` (those are regenerated copies).

`pages/operations.mdx` and `pages/architecture.mdx` are authored here directly.
The Operations page is deliberately **public-safe** — the full operator runbook
(server access, backups, hardening) stays in the repo's `OPERATIONS.md` and is
never published.

## Adding a product capability

1. Add one canonical page under
   `pages/product/<domain>/<capability>.mdx`.
2. Register its route, schema, permissions, plugin flag, and page in
   `catalog/modules.json`.
3. Add the page to `zudoku.config.tsx`.
4. Run `npm run check:docs`.

The build fails if a plugin flag is undocumented, a catalog page or route is
missing, or a catalog page is absent from navigation.

## Deploy to Vercel

The documentation site uses Vercel's Git integration as its only production
deployment mechanism. Do not run manual production deployments for routine
releases.

1. Create a new Vercel project from this repository.
2. Set **Root Directory** = `docs-site`.
3. Framework preset **Vite** (or "Other"); build command `npm run build`; output
   directory `dist`.
4. Connect the production branch to `main`.
5. Enable pull-request preview deployments.

Pull requests must pass the `docs-quality` workflow before merge. Vercel creates
preview deployments for pull requests and exactly one production deployment
after the change reaches `main`.
