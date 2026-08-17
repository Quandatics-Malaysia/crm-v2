# CRM Sales Lifecycle Customization Design

## Objective

Deliver tenant-safe CRM list views, simplified lead handling, structured PPVVC editing, deterministic opportunity and project codes, settings-backed product taxonomy, and controlled quotation and payment-milestone lifecycles.

The work ships in four independently deployable batches. Existing production records remain readable throughout every migration.

## Confirmed business rules

### List views and filters

- Every list backed by the shared `DataTable` supports per-user named saved views.
- A saved view stores typed filters, sorting, column visibility, page size, and whether it is the user's default for that list.
- Supported filter types are text, number, money, date, boolean, enum, and relation.
- Text operators are contains, equals, and starts with.
- Number and money operators are equals, greater than, less than, and between.
- Date operators are on, before, after, and between.
- Boolean filters use yes or no.
- Enum filters use multi-select.
- Relation filters use a searchable selector.
- Saved views are private to their owner. Organization-shared views are out of scope.

### Accounts, leads, and the sales funnel

- Account currency is a required ISO currency selected from currencies configured in Settings. It is never free text.
- New opportunities and quotations default to the account currency. Users may change them afterward, but only to another configured currency.
- Lead creation does not show or accept Funnel or Stage fields.
- Lead conversion automatically selects the single default `Sales Funnel` and its first open stage, `0E`.
- New pipelines cannot be created or edited. Legacy pipeline rows remain readable for historical records.
- Every new funnel uses the default `Sales Funnel`.

### Opportunity and project codes

- Opportunity code and name are identical and system-generated.
- Format is `ORGCODEOPP-YYYY-NNNN`, for example `QMOPP-2026-0001`.
- `ORGCODE` comes from the active organization code and is normalized to uppercase alphanumeric characters.
- Existing opportunities are migrated so `name = code`. New codes use the new format without renumbering historical codes.
- Opportunity `projectCode` remains null until a child funnel first reaches `4A`.
- First entry into `4A` generates the Opportunity project code once. Later rollback and re-entry do not generate a second code.
- No Project module record is created or updated by this workflow.

### PPVVC

- Opportunity is the authoritative owner of PPVVC data.
- Existing funnel PPVVC columns remain as compatibility caches.
- A PPVVC update from either Opportunity or Funnel updates the Opportunity and all live child Funnels in one transaction.
- Frontend ordering and labels are:
  1. Pain
  2. Power
  3. Vision
  4. Value
  5. Control
- Opportunity details, Funnel details, stage requirement dialogs, and Funnel cards use this grouping.
- Funnel cards show compact complete or missing badges for all five categories.
- Clicking a PPVVC badge opens the grouped inline editor.
- Stage dialogs show required PPVVC fields, current values, and inline editors. Users do not leave the Funnel page to complete a stage gate.

### Funnel stages

- Forward movement validates every required field and approval rule for every stage entered, including skipped stages.
- Rollback to any nonterminal stage requires no field or approval gate.
- Moving forward after rollback validates requirements again.
- KIV is reversible and may move to an open stage.
- Closed Won and Closed Lost are permanent terminal stages and cannot be reopened or changed.
- Quotation acceptance never changes Funnel stage.

### Products

- Settings stores product categories as `{ code, name, subcategories }`.
- Each subcategory is `{ code, name }` and belongs to exactly one category.
- Product Category and Subcategory are dependent dropdowns.
- Subcategory is never free text.
- Selecting a product on a quotation line copies its description into the line. The copied description remains editable and is stored as a quotation snapshot. This behavior already exists and receives regression coverage.

### Quotation content

- Settings defines default quotation Notes, Delivery, and Payment Term.
- A new quotation copies these defaults. Each copied value is editable independently on the quotation.
- Delivery and Payment Term are free-text quotation fields and are available to built-in and external quotation templates.
- Attention is a quotation-level contact selected from the selected quotation recipient account only.
- Attention defaults to that account's primary contact.

### Quotation lifecycle

- Internal statuses are `draft`, `pending_approval`, `approved`, `sent`, `accepted`, `rejected`, `expired`, and `void`.
- Lifecycle is Draft to Pending Approval to Approved to Sent.
- A user with quotation approval permission may approve or reject a pending quotation.
- Rejection records a reason and returns the quotation to Draft.
- Approved quotations are read-only.
- Editing an approved quotation explicitly returns it to Draft, clears approval metadata, and requires approval again.
- Customer Accept or Reject is allowed only from Sent.
- Accepting a quotation does not move the Funnel.
- Any non-draft or soft-deleted quotation may create a revision.
- A revision copies recipient, Attention, currency, tax snapshot inputs, dates, Notes, Delivery, Payment Term, header discount, and all line items.
- The revision reuses the Funnel quote running number, increments the version, stores `revisionOfId`, and starts in Draft.
- Source quotation remains unchanged and auditable.

### Payment Milestones

- Payment Milestones remain planning records attached to a Funnel.
- Only statuses are `won` and `invoiced`.
- Milestones may be prepared before a Funnel closes.
- Moving a Funnel to Closed Won changes its live milestones to Won.
- A user manually changes Won to Invoiced.
- Payment Milestones have no invoice document link, invoice number, invoice date, Finance Docs tab, automatic billing transition, or Project completion side effect.
- Existing invoice-linked history remains readable during migration, but new milestone behavior does not create or mutate finance documents.

## Architecture

### Typed filter engine

`DataTable` receives column filter metadata rather than inferring behavior from rendered values. Each filter definition identifies a column, label, datatype, allowed operators, and optional enum or relation options. Filter state uses a discriminated JSON structure validated on both client and server.

Saved views use a tenant-scoped table with organization ID, member ID, list key, name, filter JSON, sorting JSON, visibility JSON, page size, and default flag. A unique constraint prevents duplicate names for one member and list. A partial unique index permits one default view per member and list. Server actions always derive organization and member from session context; clients never supply ownership fields.

### Sales configuration

The existing default pipeline remains the compatibility anchor. New creation paths call one shared resolver that returns the active default `Sales Funnel` and first open stage. Pipeline-management UI becomes read-only historical information. No destructive pipeline deletion occurs.

Account currency and nested product taxonomy are validated against tenant Settings before persistence. Settings remain the source of allowed values; business records store snapshots so later Settings changes do not rewrite history.

### PPVVC service

A shared server service accepts an Opportunity ID and the five PPVVC values. It locks and updates the Opportunity, then updates every non-deleted child Funnel inside the same transaction. Funnel-facing actions resolve their parent Opportunity before invoking this service. Stage gates continue reading the authoritative Opportunity row.

PPVVC presentation uses one shared field-definition array to keep ordering, labels, completion rules, forms, cards, and stage dialogs consistent.

### State machines

Funnel and quotation transitions are pure functions shared by UI and server validation. Server services remain authoritative and recheck current database state inside transactions. Terminal and approval invariants are backed by database constraints where practical.

Quotation approval metadata includes approver member ID, approval timestamp, rejection reason, and revision parent. Status changes and approval decisions write audit events.

### Number generation

Opportunity number allocation remains atomic per tenant and year. Formatting adds normalized organization code before `OPP`. Opportunity name is assigned from the generated code and is not independently editable.

Project code allocation moves out of Opportunity creation. The stage-transition transaction generates it only when entering `4A` and only when the Opportunity project code is null.

## Data migration

Batch migrations are additive before they become restrictive:

1. Create saved views and add Account currency. Backfill Account currency from tenant default currency.
2. Backfill Opportunity names from codes, stop early project-code allocation, and preserve existing non-null project codes.
3. Extend Settings product taxonomy, map existing product subcategory strings into generated nested entries, and add quotation content/contact fields.
4. Add quotation approval/revision fields and statuses. Convert existing milestone `pending` values to `won`; convert `invoiced` and `paid` values to `invoiced`. Detach new milestone behavior from finance actions without deleting historical finance documents.

Every migration is tenant-safe, idempotent where supported, and tested against a database containing legacy records.

## UI behavior

Saved-view controls sit beside search and filters. Users can save current state, rename, duplicate, set default, delete, or reset to the unsaved base view. Invalid or stale filter fields are ignored with a visible warning rather than breaking the page.

Lead forms contain only lead data. Conversion screens collect a descriptive Funnel name where required; Opportunity code and name are generated. They never ask users to choose a pipeline or initial stage.

PPVVC editors use five clearly numbered sections. Funnel cards show badge state without rendering long text. Stage dialogs expose only fields relevant to entered stages while preserving the five-category order.

Quotation forms show approval status and allowed actions prominently. Send is unavailable until Approved. Revision is available from every eligible read-only or deleted source through its detail or history view.

## Permissions and errors

- Saved-view operations require an authenticated member and enforce owner-only access.
- Settings changes require existing settings-management permission.
- Quotation approval uses a dedicated quotation approval permission.
- Revision creation requires quotation-create permission and source visibility.
- Stage movement uses existing Funnel update permission.
- Validation failures return field-level messages.
- Transition conflicts return current status and allowed actions.
- Concurrent approval, revision, numbering, and stage operations use transactions and uniqueness constraints to fail safely.
- Deleted or cross-tenant contacts, categories, currencies, and source quotations are rejected server-side.

## Verification

Each batch includes:

- Unit tests for typed filter operators and state machines.
- Database tests for tenant isolation, saved-view ownership, default uniqueness, currency validation, numbering, PPVVC synchronization, and migration backfills.
- Server-action tests for Lead creation, stage movement, quotation approval/revision, and milestone status changes.
- Component tests for view controls, dependent taxonomy dropdowns, PPVVC groups, quotation fields, and permission-driven actions.
- Regression tests for editable product-description snapshots.
- `pnpm build` and existing repository quality gates.
- Production smoke tests for Account, Lead, Opportunity, Funnel, Product, Quotation, and Payment Milestone pages.

## Delivery order

1. Typed filters, per-user saved views, Account currency, and Lead simplification.
2. PPVVC editing/synchronization, reversible stages, terminal locks, and code timing.
3. Product hierarchy, quotation defaults, Delivery, Payment Term, and Attention.
4. Quotation approval/revisions and Payment Milestone decoupling.

Each batch is independently reviewable, migratable, deployable, and reversible at the application layer.

## Out of scope

- Organization-shared list views.
- Additional sales pipelines.
- Project record creation or Project module integration.
- Invoice creation from Payment Milestones.
- Automatic Funnel movement caused by quotation acceptance.
- Destructive deletion of legacy pipeline or finance history.
