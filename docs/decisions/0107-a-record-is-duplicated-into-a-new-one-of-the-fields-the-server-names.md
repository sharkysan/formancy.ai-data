# 0107 — A record is duplicated into a new one, of the fields the server names, without its key

- **Status:** accepted; extends [0047](0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md): the record's header gains Duplicate record, which the unsaved-changes guard asks about as it asks about New record
- **Date:** 2026-10-29
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/records/copy.test.ts` -- the
  fields a copy carries for each person: an identity, a key a person types
  and every column of a unique key left out, a lookup over a pinned tenant
  carried, a computed total, a pinned tenant, a field the policy lets this
  person read and not write, and one the account may not INSERT left out,
  and nothing for a person who may not read or may not create.
  `packages/data-server/src/e2e.integration.test.ts`, on both engines -- a
  create of exactly the answers `copied` names, as read, accepted as a
  second order holding them. `packages/data-client/src/transport.test.ts`
  -- `copied` null exactly when a form offers no create, field keys when it
  does, and any other reply `unexpected`. `apps/host/src/duplicate.test.ts`
  -- a copy has no token and no version, holds exactly the named answers,
  and its line names the fields that held a value and were not copied.
  `apps/host/src/duplicate.test.tsx`, on both engines -- the record read
  again and copied into both renderers, without its key, the keyboard on
  the new record's heading, axe clean, and a save creating a second
  record; the guard asking first and the copy being of what is stored, not
  the draft; a refused read opening nothing; no Duplicate record on a new
  record or on a form the person may only read. `drill.test.tsx` -- the
  levels below the record asked about and dropped. `leave.test.ts` -- what
  the guard's notice says of it. The browser gate's journey, `Copied`.

## Context

A person who enters records that differ in a field or two -- an order
like last week's, a customer's second address -- types every field again:
the workspace opens a saved record or an empty form, nothing between
(0047). The backlog asked for "duplicate a record (no key, generated fields
or version)".

What a create accepts is not the page's to know. The runtime route removes
the empty echo of a field a person may not write and refuses any other
value in one as over-posting (0022): an identity, a computed column, a
rowversion, a key the database fills by default (0056), a pinned tenant, a
column the account may not INSERT (0027), and a field the policy grants
this person to read and not to write. The published form draws the first
of those disabled and says nothing of the rest. A page that copied every
answer it holds would make a create the server refuses after the person
had typed into it.

## Decision

**The server names the fields a copy carries.** `GET /v1/forms/:id` adds
`copied`: `copiedFields` (`packages/data-core/src/records/copy.ts`), the
fields this person may read whose answer a create would accept from them,
in the bindings' order, less every field over a column of one of the
root's keys, primary or unique -- or `null` exactly when the form offers
this person no create. Whether a create accepts a field is the over-posting
check's own answer, asked one field at a time as the route asks it of an
echo, so no second list of what may be written exists to disagree with it.
A key is left out because a copy of it names the record copied from: the
create would be refused as a second one, or -- a key the database numbers
or fills -- is not the person's to give. The version is never a field, so
it never travels.

**The host copies the record as stored.** Duplicate record, in the open
record's header beside Delete record, where the form offers create and
names a field to copy, asks the unsaved-changes guard as New record does
-- "Copying `<token>` into a new record closes these forms:" -- then reads
the record again and opens every pane on a new record holding the named
answers as read, with no token and no version (`apps/host/src/duplicate.ts`,
through `opening.ts`'s read). The detail is a new record from then on: its
heading, its crumb in Drill down, its child sections waiting for a save,
and the levels below it dropped. The line says what happened and what
stayed behind: "Copied `<token>` into the form, for a new record. Not
copied: Id." -- every field that held a value and is not in the copy, by
label. The keyboard goes to the new record's heading. Nothing is written
until the person saves, and a save is a create like any other.

## Consequences

A person duplicates a record in one press, changes what differs, and
saves; the server decides what a copy may hold with the rule that decides
the create.

The costs:

A copy is of the record alone: its child rows are not copied, and a child
section's row and a level of Drill down below the record offer no
Duplicate record. An order's lines are entered again.

Every column of a key is left out, so a key with a part a person would
keep -- an order line's order beside its number -- is cleared whole when
the line's own form is duplicated, and that part is chosen again.

A copy holds what a read returns: an instant cut to the second and a time
to the minute (0040) are copied as shown and stored so, and a value a read
spells that no write accepts -- PostgreSQL's `infinity`, a `24:00` time --
makes the create refused on that field until the person changes it.

The copy is of the record as stored when Duplicate record was pressed: a
draft typed into the record is discarded first, after asking, not carried
into the copy. Duplicating costs a read.

`GET /v1/forms/:id` has one more key, so this release's `data-client`
answers `unexpected` to a form from a server older than it, as it did for
`deleting` (0050): a host upgrades its server first.

Duplicate record adds a Tab stop to the record's header.

## Alternatives considered

- **The page copies every answer but the fields its form draws disabled.**
  Rejected: the form says nothing of a field the policy keeps from this
  person, a pinned tenant, a column the account may not INSERT or a key a
  person types, so such a copy is refused on save, or names the record it
  came from.
- **A copy route, `POST /v1/forms/:id/records/copy`, answering the new
  record's answers.** Rejected for now: the list is the same for every
  record of the form and person, so it travels with the form, and the read
  the copy starts from is the read route's, with its policy, its drift
  check and its audit. A copy that carried child rows would need a route
  of its own, and a decision of its own.
- **Copy what is on screen, draft included.** Rejected: the record's
  draft would be gone from the record while living on in the copy, and the
  two would hold one person's edit with nothing to say which.
- **Leave out only the key the form addresses records by.** Rejected: a
  unique key copied -- a country's ISO code -- is refused as a second
  record just the same.
