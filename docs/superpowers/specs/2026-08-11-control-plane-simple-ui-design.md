# Control-plane simple UI design

## Goal

Make the vendor control plane readable and efficient without adding a CSS framework, JavaScript, fonts, icons, or external assets.

## Visual system

Use one embedded stylesheet in the shared operator layout. The page uses a warm off-white background, dark navy navigation, white content panels, neutral borders, and a clear blue action color. Typography uses a compact sans-serif stack with strong headings and restrained sizing.

## Layout

The shared page container is centered with a practical maximum width. Navigation becomes a simple branded header. Sections render as bordered white panels with consistent padding. Forms use wrapping grid rows on desktop and stack controls on narrow screens. Inputs, selects, textareas, fieldsets, links, and buttons receive consistent focus, spacing, and disabled states.

## Scope

Modify only `apps/control-plane/src/ui/layout.tsx` and semantic class hooks in `apps/control-plane/src/ui/dashboard.tsx`. Preserve all routes, field names, CSRF inputs, form behavior, accessibility labels, and control-plane logic.

## Validation

Run the control-plane test suite and production typecheck. Existing HTML escaping, CSRF, RBAC, and CRUD tests must remain green.
