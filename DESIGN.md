---
name: Quandatics CRM Documentation
description: A lifecycle-first product and engineering map for the Quandatics CRM.
colors:
  quandatics-blue: "#1769aa"
  quandatics-blue-bright: "#2f87d4"
  ink: "#202124"
  paper: "#f7f8fa"
  surface: "#fcfcfd"
  border: "#dfe3e8"
  muted-ink: "#626971"
  night: "#151719"
  night-surface: "#202327"
  night-border: "#363b41"
  night-ink: "#f1f3f5"
typography:
  display:
    fontFamily: "Geist, Inter, system-ui, sans-serif"
    fontSize: "2.75rem"
    fontWeight: 650
    lineHeight: 1.05
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Geist, Inter, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Geist, Inter, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "Geist, Inter, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.04em"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.quandatics-blue}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  module-chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.muted-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "5px 9px"
---

# Design System: Quandatics CRM Documentation

## 1. Overview

**Creative North Star: "The Operating Manual"**

The documentation should feel like a well-kept operating manual for a serious
business system: direct enough for a new teammate, structured enough for an
operator under pressure, and precise enough for an engineer changing a shared
data model.

Its visual identity is restrained and product-like. Hierarchy comes from
typography, spacing, lifecycle position, status, and relationships rather than
decoration. It explicitly rejects generic SaaS card grids, raw CodeGraph dumps,
dense help-center sprawl, decorative gradients, glass effects, and unnecessary
motion.

**Key Characteristics:**

- Lifecycle-first orientation with predictable progressive detail.
- Tinted neutral surfaces with one disciplined blue accent.
- Compact metadata for status, dependencies, routes, and ownership.
- Readable prose paired with diagrams, tables, and code maps where useful.
- Consistent light and dark experiences with visible keyboard focus.

## 2. Colors

The palette uses quiet cool neutrals and a single confident blue to keep large
documentation trees legible.

### Primary

- **Quandatics Blue** (`#1769aa`): primary links, active navigation, focus, and
  the most important action on a page.
- **Quandatics Blue Bright** (`#2f87d4`): dark-theme links and active states.

### Neutral

- **Ink** (`#202124`): light-theme foreground and headings.
- **Paper** (`#f7f8fa`): light-theme page background.
- **Surface** (`#fcfcfd`): raised or bounded content surfaces.
- **Rule** (`#dfe3e8`): borders and separators.
- **Muted Ink** (`#626971`): metadata and supporting copy.
- **Night** (`#151719`): dark-theme page background.
- **Night Surface** (`#202327`): dark-theme bounded surfaces.
- **Night Rule** (`#363b41`): dark-theme borders.
- **Night Ink** (`#f1f3f5`): dark-theme foreground.

**The One Signal Rule.** Blue marks navigation, interaction, and focus. It is
not decorative filler.

## 3. Typography

**Display Font:** Geist (with Inter and system fallbacks)

**Body Font:** Geist (with Inter and system fallbacks)
**Label/Mono Font:** Geist Mono for code; Geist for interface labels

**Character:** Neutral, modern, and highly readable. One sans-serif family keeps
the interface coherent while weight and scale provide hierarchy.

### Hierarchy

- **Display** (650, `2.75rem`, 1.05): documentation home and major section
  introductions only.
- **Headline** (650, `1.75rem`, 1.2): page titles and lifecycle sections.
- **Title** (600, `1.125rem`, 1.3): module and workflow subsections.
- **Body** (400, `1rem`, 1.65): prose capped around 72 characters.
- **Label** (600, `0.75rem`, 0.04em): short status, type, and dependency labels.

**The Reading First Rule.** Typography supports scanning and sustained reading;
display styling never enters buttons, navigation labels, or dense reference
tables.

## 4. Elevation

The system is flat by default. Depth comes from tonal surface changes and
one-pixel borders. Shadows are reserved for transient overlays supplied by the
underlying Zudoku component system.

**The Flat Manual Rule.** Documentation content does not float for decoration.
Boundaries represent meaningful grouping.

## 5. Components

### Buttons

- **Shape:** compact rounded rectangle (`8px`).
- **Primary:** Quandatics Blue with light text and `10px 16px` padding.
- **Hover / Focus:** darken slightly on hover; use a visible offset blue focus
  ring; never move or bounce.
- **Secondary:** neutral surface with a one-pixel border.

### Chips

- **Style:** pill-shaped, compact, and neutral by default.
- **State:** color is paired with text for Core, Optional, Enabled, Disabled,
  Planned, or dependency information.

### Cards / Containers

- **Corner Style:** `12px` only for true grouped choices or module summaries.
- **Background:** Surface on Paper, Night Surface on Night.
- **Shadow Strategy:** none at rest.
- **Border:** one-pixel Rule or Night Rule.
- **Internal Padding:** `16px` to `24px`, based on information density.

### Inputs / Fields

- **Style:** existing Zudoku controls with neutral borders and `8px` radius.
- **Focus:** visible Quandatics Blue ring with offset.
- **Error / Disabled:** semantic color plus explicit text or icon meaning.

### Navigation

The left navigation follows audience and business lifecycle before technical
implementation. Active items use blue text and a quiet tinted background.
Nested groups stay collapsible, predictable, and no deeper than three levels.

### Lifecycle Map

A horizontal sequence on wide screens and vertical sequence on narrow screens.
It shows CRM, Sales, Delivery, and Finance progression, with governance and
insights represented as cross-cutting concerns rather than fake lifecycle
steps.

## 6. Do's and Don'ts

### Do:

- **Do** explain business purpose before routes, schemas, or source paths.
- **Do** use diagrams for lifecycle, dependencies, and state transitions.
- **Do** pair every status color with a readable text label.
- **Do** keep one canonical page for each module or capability.
- **Do** use CodeGraph and repository scans to verify documentation facts.

### Don't:

- **Don't** build generic SaaS homepages from repeated equal-sized icon cards.
- **Don't** publish raw CodeGraph or directory dumps without business explanation.
- **Don't** recreate dense Salesforce-style help-center sprawl.
- **Don't** use decorative gradients, glass effects, or motion that competes
  with the task.
- **Don't** expose sensitive staging, credential, backup, or server details on
  a public surface.
- **Don't** use colored side-stripe borders, gradient text, or nested cards.
