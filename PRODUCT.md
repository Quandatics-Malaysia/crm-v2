# Product

## Register

product

## Users

Quandatics CRM is used by internal sales, operations, delivery, finance, and
administration teams. Its documentation serves three overlapping audiences:
product and business stakeholders learning the customer lifecycle, developers
changing the application, and operators deploying or supporting it.

Readers need to understand a business capability first, then progressively
discover its workflow, permissions, data, API, and source-code boundaries
without having to reverse-engineer the repository.

## Product Purpose

Quandatics CRM provides one multitenant operating system for the services
business lifecycle, from lead capture through account management, selling,
delivery, billing, purchasing, reporting, and governance.

The documentation portal is the canonical map of that system. It explains what
exists, how the parts connect, where each part lives in code, and how to extend
the platform without breaking module, tenancy, security, or migration
invariants.

## Brand Personality

Precise, calm, and structured. The product should communicate expert confidence
without becoming cold, decorative, or difficult to scan.

## Anti-references

- Generic SaaS homepages made from repeated equal-sized icon cards.
- Raw CodeGraph or directory dumps presented without business explanation.
- Dense Salesforce-style help centers with weak hierarchy and duplicated pages.
- Decorative gradients, glass effects, and motion that compete with the task.
- Documentation that exposes sensitive staging, credential, backup, or server
  details on a public surface.

## Design Principles

1. **Lifecycle before folders.** Explain how work moves through the business
   before showing where its implementation lives.
2. **One truth, several depths.** Each concept has one canonical page that
   progresses from business meaning to technical detail.
3. **Structure is an interface.** Navigation, naming, status, ownership, and
   dependencies must make the platform predictable as it grows.
4. **Code-derived, human-explained.** Use the repository graph to verify facts,
   but write for people rather than publishing raw generated output.
5. **Public-safe by construction.** Publish architecture and operating models,
   while keeping secrets and sensitive runbooks inside the private repository.

## Accessibility & Inclusion

Target WCAG 2.2 AA. Preserve keyboard navigation and visible focus, support
light and dark themes, respect reduced-motion preferences, avoid color-only
meaning, and keep prose within a readable 65–75 character line length.
