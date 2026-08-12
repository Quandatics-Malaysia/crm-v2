# Contract Form Editing Implementation Plan

**Goal:** Add clearly labelled contract creation and complete audited contract editing.

**Architecture:** Reuse contract repository validation for create/update. D1 batch performs contract, module, revision, and audit changes atomically. Hono forms remain lightweight server-rendered HTML.

## Task 1: Contract repository update

- Add shared contract input validation.
- Add `updateContract` with plan/date/status/seat/price/tax/frequency/module validation.
- Recalculate total, replace modules, increment entitlement revision, and audit in one D1 batch.
- Return complete commercial fields from `getContractDetail`.

## Task 2: Labelled create/edit UI and route

- Render persistent labels, helper text, safe defaults, responsive form grouping, and `Create contract` action.
- Render prefilled edit form on contract detail.
- Add CSRF/role-protected update route with suspension/cancellation confirmation.

## Task 3: Tests and deploy

- Cover labels/defaults, future dates, complete update, invalid atomic rejection, audit/revision, roles, CSRF, and destructive-state confirmation.
- Run control-plane tests/typecheck and deploy Worker after success.
