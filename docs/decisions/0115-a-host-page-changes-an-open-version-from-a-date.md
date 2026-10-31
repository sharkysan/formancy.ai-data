# 0115 — A host page changes an open version from a date, its next version opened in every pane

- **Status:** accepted; extends [0113](0113-a-form-over-versions-changes-the-open-one-from-a-date.md): `versions` also names the chain's key fields, which a next version takes from the one it follows; extends [0047](0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md): the record's header offers Change from a date on an open version, and the detail holds a next version as it holds a new record; extended by [0117](0117-a-form-names-what-each-write-accepts-and-a-host-page-sends-nothing-none-accepts.md): the plane test's journey changes a price from a date on the page's own origin, its tenant in no body, and sends no change through the demo's door alone
- **Date:** 2026-10-30
- **Deciders:** Daniel Bacher
- **Verified by:**
  `apps/host/src/change.test.tsx`, against the real server on both
  engines -- on an open version, Change from a date opens the next one
  under the heading "Next version of …", its start empty, the chain's key
  and the end drawn unwritable, every control named and axe clean; saved,
  the version it followed ends on the start given and the next is the
  record the detail shows, open; an ended version is drawn read-only and
  offers no change, and the open one after it does. Each watched failing,
  in CI while Docker was down on the workstation: with the next version
  drawn as a new record its product was writable; saved as a create,
  nothing was created; with the button on every version the ended one had
  it; and with no version taken for ended its amount was writable.
  `leave.test.ts` -- the
  request drops the record and every child section, as Duplicate record
  does, and says what it starts. `apps/host/src/plane.test.tsx` -- every
  runtime route the page sends is the server's, and the journey sends
  every one but a change from a date, which it names and says why.
  `packages/data-client/src/transport.test.ts` -- `versions` without its
  key fields is no form the server sent.

## Context

0113 lets a form over a table of versions change its open version from a
date through the runtime plane, and 0114 lets the studio name the chain.
A person on the host page could still only update the open version in
place, or create a version by hand, which the server refuses where the
chain has one (`chain-exists`).

## Decision

**The record's header offers Change from a date** beside Duplicate record,
on a record the form's `versions` names and whose end, as stored, is empty:
an open version this person may change. It asks the guard as Duplicate
does (`{ kind: 'change' }`, which drops the record and every child
section), reads the version again, and opens every pane on its next
version (`next-version.ts`): its answers, but its start, left empty for
the person to give, and its end, which the server keeps open. The detail's
heading says "Next version of …"; the line says to give the date it starts
and that saving ends this version on that date.

**The next version is drawn as the server will take it.** `versions` names
the chain's key fields too (`versions.key`, from `versionFields`), and the
session draws them and the end unwritable in a next version: the server
copies the key from the version it ends, and keeps the end open.

**The session saves it with `supersede`.** A session opened on a next
version keeps the version it follows (`SessionState.follows`), and its save
sends `supersede` with that token and version and the answers, instead of
a create. The answer is the next version, created: the detail opens it as
it opens a record a pane created. An unknown answer is reconciled as an
update's, by the version it followed, and Discard opens the next version
again.

**An ended version is drawn read-only**, as a record this person may not
update is: the server refuses its update (`version-ended`), and the page
says so before anyone types.

## Consequences

**What it buys.** A person changes a price from a date where they read
it, in one save, and the chain stays whole.

**What it costs.**
- The next version holds the open one's answers but its start and end;
  nothing is computed for it, and its child sections wait until it is
  saved, as a new record's do.
- Whether a version has ended is read from its end as this person reads
  it: one whose end they may not read is drawn writable, and its update
  is refused by the server.
- The save says "Created record …", as a create's does.
- The plane test's journey sends no change from a date: its forms carry
  the tenant in a lookup's token, and a price's tenant is a column a
  renderer echoes, which its rule refuses in every body. `change.test.tsx`
  sends it through the page. The live demo has no form over versions.
- `@formancy/data-client` reads `versions` without `key` as unexpected.

**What it forecloses.** Nothing.

## Alternatives considered

**A dialog asking for the date alone.** A change is usually more than a
date -- a new price -- so the next version is a form, where the person
changes what changes.

**Leaving the chain's key writable, refused by the server when changed.**
The page would offer an edit the server refuses after Save.
