# 0137 — Two lookups into one table are told apart by their columns

- **Status:** accepted; extends [0009](0009-generation-is-deterministic-and-says-what-it-chose.md): a lookup into a table another lookup of the form refers to is labelled from its own column
- **Date:** 2026-11-05
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/generate/generate.test.ts` --
  an order generated with its customer lookup and both its employee
  lookups labels them "Customer", "Created by" and "Approved by", each
  employee lookup's note saying its label is from its column since
  another lookup refers to employee too, and a trailing `_id` is left out
  of such a label (watched failing with every lookup labelled from its
  table); a lookup alone into its table keeps the table's name, as every
  other case there holds.

## Context

The generator labels a lookup from the table it refers to: an order's
`fk_order_customer` reads "Customer". An order refers to employees twice,
by `created_by` and by `approved_by`, and both lookups read "Employee":
a person cannot tell who created an order from who approved it, two
controls share one accessible name, and the filter line names neither
by what it is. The studio is about to offer every lookup by default, so
a form generated without a change in the Choose step would carry both.

## Decision

**A lookup into a table another lookup of the form refers to is
labelled from its own column** (`packages/data-core/src/generate/names.ts`'s
`labelOfLookup`): `approved_by` reads "Approved by", and a trailing id,
which names no more than the table, is left out -- `manager_id` reads
"Manager". A key of several columns is labelled from its foreign key's
name, less a leading `fk_`. A lookup alone into its table keeps the
table's name. Its note says which, and why. The field's key is the
table's as before, so no binding, policy or view moves.

## Consequences

**What it buys.** Two lookups into one table say what each is, in the
form, the grid, the chips and the filter line.

**What it costs.**
- A form regenerated with two lookups into one table changes those two
  labels in its base: a presentation that renamed them keeps its names,
  one that did not shows the new ones.
- A column named for its table alone (`employee_id`) and another into the
  same table read "Employee" and their other name: the first still says
  only the table.

**What it forecloses.** Nothing: an administrator renames any field in
the studio's Presentation step, as before.

## Alternatives considered

**Key the fields by their columns too.** `created_by` rather than
`employee`: clearer, but a key moved by a regeneration reassigns grants
and views (0039) on every form generated before.

**Offer only one lookup per table by default.** Which one would be
arbitrary, and the other key would stay a bare number.
