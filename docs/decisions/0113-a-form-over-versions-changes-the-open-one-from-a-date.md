# 0113 — A form over a table of versions changes the open version from a date, ending it and starting the next in one write

- **Status:** accepted
- **Date:** 2026-10-30
- **Deciders:** Daniel Bacher
- **Verified by:** VERIFIED

## Context

Many tables a deployment keeps hold versions of one thing rather than the
thing: a product's price, a contract's terms, an employee's rate, each row
valid from one date until the next row of the same thing starts. The rows
are a chain: one thing's versions, ordered by their start, each ending
where the next begins, the last one open.

A form over such a table today treats every row as a record of its own. A
person who changes a price either overwrites the current row -- and the
price it had is gone -- or creates a row by hand and edits the old one's
end in a second save, which may never happen, or happen wrong: a gap, an
overlap, two open versions of one product.

The backlog asked for history and validity chains, a decision record
first. The decision taken with the user on 2026-10-30: business validity
-- rows the deployment already keeps with valid-from and valid-to
columns, not SQL Server's system-versioned history -- and append only: a
person changes the open version from a date; a version that has ended is
not edited through the form.

## Decision

**A generation request may name a chain:** `validity: { from, to }`, two
columns of the root. The generator refuses it (`generate/validity.ts`)
unless:
- both are columns of the root it can read, neither generated;
- they are of one kind, a date or an instant (a timestamp with a time
  zone);
- `from` is NOT NULL and `to` is nullable: the open version holds NULL in
  `to`, the only spelling of "open" this release reads;
- a primary or unique key of the root holds `from` and not `to`, and at
  least one other column: that key less `from` is the chain's key, what
  one thing's versions share;
- the form has a proven concurrency token (0015), since a change names
  the version its person read.

A version is valid from `from` up to, and not including, `to`.

**The bindings say it** (`FormBindings.validity`: the two fields and the
chain key's columns), and the generated form follows from it:
- `to` is never written by the form; the server writes it, ending a
  version;
- `from` is written on create only;
- the chain key's columns are written on create only;
- delete is not offered: removing a version leaves a gap or reopens the
  one before, which is the database's to decide.

**A change from a date is its own operation:** `POST
/v1/forms/:id/records/supersede` with `{ record, version, answers }`. It
names the open version its person read, and answers the next version as a
create would, its start in `from`'s field. `planSupersede`
(`records/supersede.ts`) needs both update and create from the policy --
it ends one version and starts another -- and refuses before any
statement:
- a version that has ended, as read: 409 `version-ended`;
- a start not after the open version's start: a field error on `from`;
- an answer for the chain key or for `to`: over-posting, since the chain
  key comes from the version named and `to` is the server's;
- whatever a create of the answers would refuse (0018, 0022).

The adapter ends the open version and inserts the next in one write that
either does both or neither (`RecordAdapter.supersede`):
- **PostgreSQL:** one statement, a data-modifying CTE. The UPDATE sets
  `to` where the key, the row filters, the throughs, the version and `to`
  IS NULL hold, and the INSERT selects the next version's values from the
  row it ended, so nothing is inserted when nothing was ended.
- **SQL Server:** no statement both updates and inserts a table that a
  foreign key refers to, so the write is the one batch every SQL Server
  write already is (`writeBatch`): a transaction of the guarded UPDATE
  and, only when it ended exactly one row, the INSERT, rolled back
  together on any error.

Nothing ended is read once, as an update's zero rows are (0015): stale,
not found, or ended since it was read. The answer is the next version as
read back, with its own token and version. A lost answer is
`unknown-outcome` (0031) naming the version it ended.

**A create starts a chain only where there is none:** for a form with a
chain, the insert holds only when no row has its chain key -- one
statement on PostgreSQL, under a range lock on SQL Server -- and is
otherwise refused 409 `chain-exists`, saying to change the open version
from a date instead.

**An update of an ended version is refused**, from the record as read
(409 `version-ended`). The open version is updated in place as any record
is, its dates and its chain key excepted.

## Consequences

**What it buys.** A chain a person keeps through the form: a price
changed from the first of next month ends the current one there, in the
same write, with no gap, no overlap and no second open version made by
the form.

**What it costs.**
- One spelling of a chain: two columns of one kind, half-open, the open
  version NULL in `to`. A chain whose end is inclusive, or open at
  9999-12-31, is not read as one.
- Append only. An ended version is read-only through the form; a version
  in the middle is corrected, inserted or removed in the database, and
  delete is not offered at all.
- On PostgreSQL two creates of one chain at once may both pass the check
  that no version exists, and two open versions result, unless the table
  says otherwise -- a unique index over the chain key where `to` IS NULL
  holds it. SQL Server's range lock serialises them.
- A row written outside the form -- another application, SQL -- can
  break a chain; the form reads what is there.
- A change from a date takes create and update from the policy, and a
  state field's moves (0112) are asked of it as of a create.
- The list shows every version; which are open is a filter the person or
  a list view (0105) applies. There is no "as of a date".

**What it forecloses.** Nothing: a later record may add correction of a
past version, or read SQL Server's system-versioned history beside it.

## Alternatives considered

**Two saves, the end of the old version and the new one, from the page.**
Either can fail alone, and a chain with a gap or two open versions is the
result.

**SQL Server's system-versioned temporal tables.** They keep when a row
changed in the database, not when a price is valid; PostgreSQL has none.
The user chose business validity.

**Correcting any version, the neighbours' dates moved to keep the chain
whole.** More statements to prove on both engines, for an edit people make
rarely; the user chose append only.

**An inclusive end, or an open end spelled 9999-12-31.** Both are common.
Reading one spelling first keeps the guard a predicate on NULL; another is
a later record's.

**A MERGE on SQL Server.** A source of the open row, twice, can end it and
insert the next in one statement. But the version guard then sits in the
source's read, which holds only under locking hints until the update, and
MERGE's own caveats come with it. The batch every write already is says
the same thing plainly.
