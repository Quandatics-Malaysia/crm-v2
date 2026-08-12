# Contract Form Editing Design

## Goal

Make contract creation understandable and allow vendor operators to update complete contract terms, including a future start date such as 20 August 2026.

## Create Form

Separate existing contract records from a clearly titled `Create contract` form. Every input has a persistent visible label. Use a responsive field grid with short helper text for values whose units are not obvious.

Fields:

- Plan ID
- Status
- Start date
- End date
- Seat limit
- Monthly seat price in cents
- Tax in basis points, including examples that `800` means 8% and `0` means no tax
- Collection frequency
- Licensed modules

Use safe defaults of four seats, zero price, zero tax, and monthly collection. Rename the submit action to `Create contract`.

## Edit Form

The contract detail page exposes the same labelled commercial fields with current values prefilled. Vendor owners and billing operators may edit plan ID, status, start/end dates, seat limit, price, tax, collection frequency, and modules.

A future start date is valid. Before the start date, deployment entitlement evaluation must not grant active access. Existing suspension and cancellation confirmation remains mandatory for destructive commercial states.

## Mutation and Audit

Validate updates server-side using the same constraints as contract creation. Update all contract fields atomically, replace module assignments atomically, increment entitlement revision, and append an audit event containing before and after values. Any validation failure leaves the contract unchanged.

Existing deployments receive the revised signed entitlement through the current control-plane/agent flow. No client application UI controls these vendor contract values.

## Tests

- Creation form renders visible labels, units, defaults, and module controls.
- Contract edit form renders all current values.
- A contract beginning 20 August 2026 can be created and edited.
- Invalid date order, seat limit, price, tax, status, or module IDs are rejected without partial writes.
- Successful update changes all fields, replaces modules, increments revision, and writes audit history.
- Suspended/cancelled updates still require explicit confirmation.
- Operator role checks and CSRF protection remain enforced.
