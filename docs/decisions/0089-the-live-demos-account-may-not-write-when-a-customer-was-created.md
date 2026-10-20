# 0089 — The live demo's account may not write when a customer was created

- **Status:** accepted
- **Date:** 2026-10-20
- **Deciders:** Daniel Bacher
- **Verified by:**
  `apps/live-demo/src/image/publish.integration.test.ts`, "stamps a new
  customer's creation in the database, and refuses one a clerk sends", in
  CI's `test (@formancy/data-live-demo)` job: over the demo account as
  `deploy/demo/accounts.sql` grants it, the customer form draws
  `created_at` disabled, a create of a customer that sends
  `created_at` is refused 403 `over-posting`, and one that does not is
  read back created within a minute of the request (watched failing on
  2026-10-20 before the grant: the backdated create answered 201 with
  `created_at` 2016-10-01).

## Context

A visitor of the live demo at formancy.ai/data/demo/ who opened the
customer form to add a customer was offered "Created at", and could type
any instant into it. The fixture's `sales.customer.created_at` is
`timestamptz not null default now()`: the column says when the row was
written, and only the database knows that.

The form offered it because the demo account was granted `INSERT` on the
whole table. What the generator offers is what the account may do
([0027](0027-a-snapshot-says-what-its-account-may-do.md)): a column the
account may `INSERT` is written on create, and nothing in the generator
asks whether the column has a default that a person should not override.
`accounts.sql` already says the grants are the forms' capabilities, and
grants the order's `UPDATE` column by column for the same reason.

## Decision

**The demo account may `INSERT` every column of `sales.customer` but
`created_at`**, by a column grant, and `SELECT` all of them. The
generator then draws "Created at" read-only, the server refuses a create
that sends it as over-posting, and the database's default writes it.

The generator is not changed. A column with a default may be one a
person is meant to set — a customer's `active`, an order's `status` —
and which it is, is the deployment's to say; the account's grant is
where this module already reads it.

## Consequences

**What it buys.** The demo shows when each customer was created, and no
visitor can backdate one, through the form or by a request of their own.

**What it costs.** Nothing a visitor or an operator meets. A deployment
that wants the same for its own table writes the same column grant; this
record changes no package, and the generator still offers any column the
account may insert, a default or not.

## Alternatives considered

- **The generator leaves out a column with a default on create.** It
  would take away `active` and `status`, which a person sets, as well as
  `created_at`; the default is a fallback, not a statement that nobody may
  write the column.
- **The demo's policy grants `created_at` to no role.** The field would be
  read-only for every persona in the demo's policy and still writable by
  the account. The grant is the one place that holds for every request,
  and the one `accounts.sql` already uses.
