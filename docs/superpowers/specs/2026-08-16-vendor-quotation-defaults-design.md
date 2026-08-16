# Vendor Quotation Defaults and Superadmin Seat Authority

## Goal

Make the supplied Citrus Cloud (CC) and Q Armour (QAR) quotation layouts the production organization defaults while keeping their editable source in the public external customization repository. Repair membership activation when a platform superadmin manages an organization without holding a tenant membership.

## Scope

- Reproduce the supplied CC PDF and QAR Excel quotation references as closely as the CRM's safe HTML/CSS renderer allows.
- Keep CC/QAR HTML, CSS, definitions, validation, SDK, and operator guidance in `Super-ERP/external-platform-customizations`.
- Set `citruscloud` as the Citrus Cloud organization default and `qarmour` as the Q Armour organization default.
- Permit a verified platform superadmin to perform deployment-seat membership mutations without creating a tenant membership or consuming a seat.
- Release CRM core, publish the external package, inject both templates into `app.quandatics.com`, and verify production.

Invoices and other document modules remain outside this change.

## Architecture

### CRM core

The existing tenant-scoped quotation template registry and safe HTML/CSS renderer remain unchanged. A new migration updates the database seat-actor authority so an actor is accepted when either:

1. the actor is an active system Owner/Admin member of the target organization; or
2. the actor user is a platform superadmin and is not a vendor-support identity.

The active-organization check remains mandatory. Ordinary users with a null or cross-tenant actor member remain rejected. Audit rows retain the actor user ID and may contain a null actor member ID for platform-superadmin actions.

This preserves the database as the security boundary, avoids fake superadmin memberships, and prevents platform administration from consuming licensed seats.

### External customization repository

`external-platform-customizations` is the canonical, vendor-visible source for company-specific quotation layouts. The package contains:

- CC and QAR HTML/CSS templates;
- template definitions and tenant-default configuration;
- the API-only SDK and bootstrap/verification scripts;
- deterministic fixture data and local render verification;
- a concise production injection, rollback, and troubleshooting runbook;
- a reusable skeleton for future quotation templates.

External developers do not need CRM source access. They work against the documented token contract and tenant-scoped API.

## Template fidelity

### Citrus Cloud

The CC template follows the supplied one-page A4 PDF: logo and company header, centered quotation title, left customer/project block, right metadata block, eight-column item table, notes and SST totals, reference warning, prepared-by block, computer-generated disclaimer, and bottom footer/page number.

### Q Armour

The QAR template follows the supplied Excel print layout: compact logo/company header, centered quotation title, left customer/contact block, right metadata block, five-column item table, totals and notes, reference warning, and computer-generated disclaimer.

Both templates use the organization's uploaded logo through `{{logoUrl}}`. Business values remain CRM data tokens; no customer data, hard-coded API credential, JavaScript, external stylesheet, or remote CSS asset is committed.

Fidelity is measured against rendered A4 output. Dynamic content may change row height and pagination, but fixed geometry, typography, borders, alignment, labels, and footer placement must match the references at representative data lengths.

## Data flow

1. Vendor edits and validates HTML/CSS in the external repository.
2. The bootstrap script authenticates with a tenant-scoped API key and upserts the tenant's HTML template.
3. The script sets `tenant_settings.quotation_template_code` through a dedicated tenant-default API operation.
4. The CRM resolves account override first, then the organization default, then the existing legacy/default fallback.
5. Preview and print render sanitized HTML/CSS with escaped CRM values and the tenant logo endpoint.

Q Armour and Citrus Cloud are injected independently with separate tenant credentials. A failure in one tenant must not alter the other.

## Vendor contract

The vendor receives everything required to maintain templates without core access:

- supported scalar and line-item tokens;
- source layout and template skeleton;
- validation and render commands;
- tenant-default apply and verify commands;
- environment-variable contract (`CRM_API_BASE_URL`, tenant-scoped `CRM_API_KEY`);
- API error guidance and rollback instructions;
- rules prohibiting committed credentials and unsafe HTML/CSS.

Production keys stay in an operator secret manager or ephemeral shell environment. They are never committed. Template publication and organization-default activation are separate operations so a template can be staged and verified before activation.

## Error handling and rollback

- Validation stops on unknown tokens, unsafe HTML/CSS, oversized payloads, missing files, or unbalanced line loops.
- API failures identify tenant, operation, status, and template code without printing credentials.
- Apply is idempotent: existing templates are updated and missing templates are created.
- Verification reads the stored template and organization default back from the API and compares normalized source hashes.
- Rollback restores the previously recorded template payload and previous organization default.
- CRM deployment retains the existing signed-image, backup-evidence, migration, health-check, and rollback gates.

## Testing

### CRM

- Database test: active tenant Owner/Admin remains accepted.
- Database test: platform superadmin with null member ID is accepted.
- Database test: ordinary user and vendor-support user with null member ID are rejected.
- Database test: archived organization and cross-tenant member remain rejected.
- Route/unit tests cover the tenant-default template API and existing account-overrides-first resolution.
- Full tests, workflow tests, lint, and production build must pass.

### External package

- Template token and safety validation passes.
- SDK/bootstrap tests cover template upsert, tenant-default update, verification, partial failure, and rollback.
- Representative CC and QAR fixture output is rendered to A4 PDF.
- Every rendered page is inspected for clipping, overlap, broken lines, missing logo, footer displacement, and pagination defects.
- Reference and generated pages are compared side by side before production injection.

## Delivery

1. Land the CRM migration/API support through a reviewed PR and release it from `main`.
2. Land the reference-faithful templates and vendor tooling through a reviewed external-repository PR.
3. Create a fresh verified production backup and deploy the signed CRM release.
4. Apply CC and QAR templates with tenant-scoped credentials.
5. Set the organization defaults and verify them through the API and database.
6. Generate representative production previews, inspect the PDFs, and confirm application, entitlement, and container health.

Completion requires both repositories on `main`, passing CI, production on the new signed release, both organization defaults active, and no new production errors.
