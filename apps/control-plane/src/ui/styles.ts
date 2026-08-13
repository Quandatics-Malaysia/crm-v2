export const OPERATOR_STYLES = `
.operator-shell {
  --operator-space-1: 0.25rem;
  --operator-space-2: 0.5rem;
  --operator-space-3: 0.75rem;
  --operator-space-4: 1rem;
  --operator-space-6: 1.5rem;
  --operator-space-8: 2rem;
  --operator-space-12: 3rem;
  --operator-colour-canvas: #f6f8fb;
  --operator-colour-surface: #ffffff;
  --operator-colour-ink: #172033;
  --operator-colour-muted: #5d6b82;
  --operator-colour-line: #ccd5e1;
  --operator-colour-accent: #155eef;
  --operator-colour-accent-strong: #004eeb;
  --operator-colour-positive: #067647;
  --operator-colour-warning: #b54708;
  --operator-colour-danger: #b42318;
  --operator-font: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --operator-border: 1px solid var(--operator-colour-line);
  --operator-radius: 0.625rem;
  --operator-content-width: 72rem;
  color: var(--operator-colour-ink);
  background: var(--operator-colour-canvas);
  font-family: var(--operator-font);
  line-height: 1.5;
  min-block-size: 100vh;
}

.operator-shell *, .operator-shell *::before, .operator-shell *::after { box-sizing: border-box; }
.operator-shell :is(h1, h2, h3, p, ol, ul, dl) { margin-block: 0; }
.operator-shell a { color: var(--operator-colour-accent); text-underline-offset: 0.16em; }
.operator-shell a:hover { color: var(--operator-colour-accent-strong); }
.operator-shell :is(button, input:not([type="checkbox"]):not([type="radio"]), select, textarea) { min-block-size: 2.75rem; }
.operator-shell :is(a, button, input, select, textarea):focus-visible { outline: 0.1875rem solid var(--operator-colour-accent); outline-offset: 0.1875rem; }
.operator-shell button { border: 0; border-radius: var(--operator-radius); background: var(--operator-colour-accent); color: #fff; cursor: pointer; font: inherit; font-weight: 700; padding-inline: var(--operator-space-4); }
.operator-shell input, .operator-shell select, .operator-shell textarea { border: var(--operator-border); border-radius: 0.375rem; color: inherit; font: inherit; padding: var(--operator-space-2) var(--operator-space-3); width: 100%; }
.operator-shell textarea { min-block-size: 6rem; }
.operator-shell :is(input[type="checkbox"], input[type="radio"]) { block-size: 1.25rem; inline-size: 1.25rem; margin: 0; width: auto; }
.operator-shell label:has(:is(input[type="checkbox"], input[type="radio"])) { align-items: center; display: inline-flex; gap: var(--operator-space-2); min-block-size: 2.75rem; padding-inline: var(--operator-space-2); }
.operator-shell-header { border-block-end: var(--operator-border); background: var(--operator-colour-surface); }
.operator-shell-bar, .operator-content { inline-size: min(100% - 2rem, var(--operator-content-width)); margin-inline: auto; }
.operator-shell-bar { align-items: center; display: flex; flex-wrap: wrap; gap: var(--operator-space-3) var(--operator-space-6); justify-content: space-between; padding-block: var(--operator-space-3); }
.operator-brand { color: var(--operator-colour-ink); font-weight: 800; text-decoration: none; }
.operator-navigation ul, .operator-breadcrumbs ol { align-items: center; display: flex; flex-wrap: wrap; gap: var(--operator-space-2); list-style: none; padding: 0; }
.operator-shell :is(.operator-navigation a, .operator-breadcrumbs a, nav[aria-label$="pagination"] a, .button-link) { align-items: center; display: inline-flex; min-block-size: 2.75rem; padding-inline: var(--operator-space-2); }
.operator-navigation a { border-radius: 0.375rem; text-decoration: none; }
.operator-navigation [aria-current="page"] { background: #e8efff; color: #00359e; font-weight: 700; }
.operator-identity { color: var(--operator-colour-muted); font-size: 0.875rem; }
.operator-breadcrumbs { border-block-end: var(--operator-border); background: var(--operator-colour-surface); color: var(--operator-colour-muted); font-size: 0.875rem; }
.operator-breadcrumbs ol { inline-size: min(100% - 2rem, var(--operator-content-width)); margin-inline: auto; padding-block: var(--operator-space-2); }
.operator-breadcrumbs li + li::before { content: "/"; margin-inline-end: var(--operator-space-2); }
.operator-content { padding-block: var(--operator-space-8); }
.operator-shell .skip-link { background: var(--operator-colour-ink); color: #fff !important; inset-block-start: var(--operator-space-2); inset-inline-start: var(--operator-space-2); padding: var(--operator-space-3) var(--operator-space-4); position: fixed; transform: translateY(-150%); z-index: 2; }
.operator-shell .skip-link:focus { transform: translateY(0); }
.page-header { border-block-end: var(--operator-border); display: grid; gap: var(--operator-space-2); margin-block-end: var(--operator-space-8); padding-block-end: var(--operator-space-6); }
.page-header-content { align-items: end; display: flex; flex-wrap: wrap; gap: var(--operator-space-4); justify-content: space-between; }
.page-header h1, .card h2, .empty-state h2, .notice h2 { font-size: clamp(1.25rem, 2vw, 2rem); line-height: 1.2; }
.page-header-eyebrow { color: var(--operator-colour-accent); font-size: 0.875rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; }
.page-header-description, .field-hint { color: var(--operator-colour-muted); }
.page-header-actions { display: flex; flex-wrap: wrap; gap: var(--operator-space-2); }
.status-badge { border-radius: 999px; display: inline-flex; font-size: 0.8125rem; font-weight: 800; line-height: 1.25; padding: var(--operator-space-1) var(--operator-space-2); }
.status-badge-neutral { background: #e9edf3; color: #344054; }
.status-badge-success { background: #dcfae6; color: var(--operator-colour-positive); }
.status-badge-warning { background: #fef0c7; color: var(--operator-colour-warning); }
.status-badge-error { background: #fee4e2; color: var(--operator-colour-danger); }
.progress-steps ol { display: flex; flex-wrap: wrap; gap: var(--operator-space-2); list-style: none; padding: 0; }
.progress-step { align-items: center; display: flex; font-size: 0.875rem; gap: var(--operator-space-2); }
.progress-step::before { align-items: center; background: #e9edf3; border-radius: 999px; color: var(--operator-colour-muted); content: counter(list-item); display: inline-flex; font-size: 0.75rem; font-weight: 800; justify-content: center; min-block-size: 1.5rem; min-inline-size: 1.5rem; }
.progress-step-complete::before { background: #dcfae6; color: var(--operator-colour-positive); content: "✓"; }
.progress-step-current { color: var(--operator-colour-accent); font-weight: 800; }
.progress-step-current::before { background: var(--operator-colour-accent); color: #fff; }
.field { display: grid; gap: var(--operator-space-2); }
.field label { font-weight: 700; }
.field-error { color: var(--operator-colour-danger); font-size: 0.875rem; }
.card, .empty-state, .notice { border: var(--operator-border); border-radius: var(--operator-radius); background: var(--operator-colour-surface); padding: var(--operator-space-6); }
.card { display: grid; gap: var(--operator-space-4); }
.card-content, .card-footer { display: grid; gap: var(--operator-space-4); }
.card-footer { border-block-start: var(--operator-border); padding-block-start: var(--operator-space-4); }
.empty-state { align-items: start; display: grid; gap: var(--operator-space-3); justify-items: start; text-align: left; }
.button-link { background: var(--operator-colour-accent); border-radius: var(--operator-radius); color: #fff !important; font-weight: 700; padding-inline: var(--operator-space-4); text-decoration: none; }
.notice { border-inline-start-width: 0.375rem; display: grid; gap: var(--operator-space-2); }
.notice-info { border-inline-start-color: var(--operator-colour-accent); }
.notice-success { border-inline-start-color: var(--operator-colour-positive); }
.notice-warning { border-inline-start-color: var(--operator-colour-warning); }
.notice-error { border-inline-start-color: var(--operator-colour-danger); }
.data-list { border-block-start: var(--operator-border); }
.data-list-row { display: grid; gap: var(--operator-space-2); grid-template-columns: minmax(10rem, 1fr) minmax(0, 2fr); border-block-end: var(--operator-border); padding-block: var(--operator-space-3); }
.data-list dt { color: var(--operator-colour-muted); font-weight: 700; }

@media (max-width: 42rem) {
  .operator-shell-bar { align-items: flex-start; flex-direction: column; }
  .operator-navigation ul { inline-size: 100%; }
  .operator-navigation li { flex: 1; }
  .operator-navigation a { justify-content: center; }
  .operator-content { padding-block: var(--operator-space-6); }
  .data-list-row { grid-template-columns: 1fr; }
}
`
