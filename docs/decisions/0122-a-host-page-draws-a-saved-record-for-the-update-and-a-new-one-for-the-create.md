# 0122 — A host page draws a saved record for the update it may send, and a new one for the create

- **Status:** accepted; narrows [0117](0117-a-form-names-what-each-write-accepts-and-a-host-page-sends-nothing-none-accepts.md): a field written on create only is drawn disabled on a record opened for update, no longer writable on every record
- **Date:** 2026-11-01
- **Deciders:** Daniel Bacher
- **Verified by:** `apps/host/src/session-work.test.ts`, without a server --
  a field written on create only is drawn writable on a new record and
  disabled on a saved one, and a field neither write accepts is disabled on
  both (watched failing with one drawing for both writes, as 0117 drew
  them: the saved record's order was writable).
  `apps/host/src/change.test.tsx`, against the real server on both engines
  -- an open price draws its product and its start, written on create only,
  disabled and its amount writable, and a new price draws all three
  writable.

## Context

0117 has `GET /v1/forms/:id` name the fields each write accepts from a
person, and the host page draw disabled, and send in no body, a field no
write accepts. A field written on create only -- a key, a chain's start, a
column the account may INSERT and not UPDATE -- it left writable on every
record, so on a saved record a person could change it and was refused only
after Save. The README's pictures showed it: Customer, Order date, Amount
and Created by, which the order form's own account may not UPDATE, drawn
editable on the hero's loaded record, filed as what the pictures show that
is wrong.

## Decision

**A form is drawn for the write it may send.** The session
(`apps/host/src/session.ts`) keeps a copy of the published form for each
write, each with the fields that write does not accept from this person
disabled, beside the fields the page fills in: a saved record this person
may update opens on the update's, a new record and a next version (0115)
on the create's. A saved record this person may not update is drawn
read-only, as before.

**A record created in the form keeps the create's drawing** through the
updates after it, until it is opened again: the engine a create made is
kept for them (0029), so what the person typed while the save was out
stays, and Angular's pane needs no new application. A field written on
create only stays writable there, and a change to it is refused after
Save, as before 0122.

**What is sent is unchanged**: every answer but those no write accepts
(0117). A field drawn disabled for the update is sent as the record holds
it, and the server removes its unchanged echo (0022).

## Consequences

**What it buys.** An opened record offers exactly the edits its update
accepts, and the README's hero shows a loaded record as it can be edited.

**What it costs.**
- On a record just created, a field written on create only is drawn
  writable until the record is opened again.
- The README's host pictures of a loaded record change, retaken on CI's
  runner.

**What it forecloses.** Nothing.

## Alternatives considered

**Open the record again after its create.** The engine would be new: what
the person typed while the save was out would be lost or merged by hand,
and Angular's pane would start a new application, which 0029 keeps it
from.

**Send only what the drawn write accepts.** A record just created keeps
the create's drawing, so a change to a field it draws writable would be
dropped from the update without a word -- what 0022 forecloses.
