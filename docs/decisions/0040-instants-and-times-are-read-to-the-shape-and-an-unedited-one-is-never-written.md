# 0040 — Instants and times are read to formancy's shape on both engines, and an unedited one is never written back

- **Status:** accepted
- **Date:** 2026-10-10
- **Deciders:** Daniel Bacher
- **Verified by:**
  `apps/host/src/temporal-round-trip.test.ts`, against `postgres:17-alpine`
  and `mcr.microsoft.com/mssql/server:2022-latest` through the real data
  server, `@formancy/data-client` and the page's own session over the
  headless engine both renderers run, the database's owner reading back each
  column's text and bytes — on both engines: a defaulted instant and a time
  with seconds, saved unedited, saved with the note edited, and sent back as
  read by a client of its own, stay byte-identical; columns the clerk may not
  write, saved through the session, too; a form whose only writable fields
  are the two, saved unedited, is answered "These answers change no column."
  and the row, version included, is unchanged; a record created with the
  instant left to its default saves again unedited and keeps it; and, alone,
  PostgreSQL's `time(6)` with a fraction and SQL Server's `datetimeoffset(7)`
  at +02:00, its offset included; and, on PostgreSQL alone, `infinity` and
  `24:00` are refused by the renderers' validation with nothing sent, and
  sent back unedited by a client of its own are saved and kept. Watched
  failing on main, 14 of its 23 cases: on SQL Server each save wrote the cut
  values over the stored fraction, seconds and offset; on PostgreSQL the
  engine refused the unedited values and nothing was sent, and a client of
  its own was refused `invalid-values`, `infinity` and `24:00` included. Its
  other cases hold what this record decides and passed on main as well: an
  instant and a time the person changes are written as entered, at +00:00
  on SQL Server; a field the clerk may write and not read, and every field
  of a clerk who may update and not read the record, is written as sent,
  the cut values stored on both engines; and 0022's comparison for a column
  the clerk may not write.
  `apps/host/src/temporal-round-trip-page.test.ts`, the host page itself in
  both renderers against both engines: Save pressed with nothing edited and
  with the note edited, and with the columns withheld by the account's
  privileges (the fields disabled) and by the policy alone, says "Saved." and
  leaves both columns byte-identical; a form whose only writable fields are
  the two says why it was not saved and writes nothing. Watched failing on
  main, 17 of its 24 cases: SQL Server "Saved." over cut values, PostgreSQL
  `aria-invalid` on the temporal fields with nothing sent; SQL Server's
  withheld columns, which 0022 already kept, passed. It also holds that an
  instant changed in React's datetime control is saved as the local minute
  the control holds — on main that passed on SQL Server and failed on
  PostgreSQL only for the refused time beside it — and that a zoneless
  timestamp's fraction survives a save on both engines, which passed on
  main.
  `packages/data-core/src/records/plan-update-echo.test.ts`, the planner:
  an update carrying an instant or a time the actor may read is refused
  `record-not-read` without the record as read, and one carrying neither
  needs none; against the read at the version named an unedited one is not
  set and a changed one is; at another version nothing is removed; another
  record's read, or one missing a field the actor may read, is refused; a
  field the actor may write and not read, and every field of an actor who
  may not read, are never compared and need no read; echoes alone are `nothing-to-update`; an
  unedited `infinity` and `24:00` are removed before any codec and the same
  spellings entered against a cut read are refused by it. Watched failing on
  main, 6 of its 8; the other version and the write-only field passed there,
  as they hold what was not to change, and failed with the version check and
  with the readability check removed.
  `packages/data-server/src/routes/runtime-temporal.test.ts`, the route over
  fake ports: an unedited writable instant and time are removed and the note
  written; a changed one is written; an echo of an older version is not
  removed and the update is stale; an update whose only change was an
  unedited instant and time is 400 `nothing-to-update` and sends nothing; a
  field the actor may write and not read, and an actor who may update and
  not read, have nothing removed; a read that failed, as each of six
  failures a read reports, refuses an update carrying a writable instant or
  time with that failure's own answer and sends nothing — the writable
  fields sent alone, so 0022's over-posting refusal cannot answer first —
  while an update of the note alone goes on; a read that comes back as
  another record's token is 409 `record-not-read` and sends nothing; a
  resend of a stored update, its own read failing, is answered with the
  first answer and asks the database nothing; a create writes a value
  entered and leaves one left out to the default. Watched failing on main,
  10 of its 15: the first, the fourth, all six read failures (200, the cut
  values sent), the other record's read (200), and the resend, answered
  rightly after a second read; with the refusal held to `unavailable`, the
  other five read failures answered 200 with the cut values sent and the
  resend 503 "Nothing was saved."; and the other record's read answered 200
  with the planner's record check removed. The stale
  echo, the read failures, the other record and the resend run over fake
  ports only: what each engine stores is the host suite's.
  `packages/data-core/src/codecs/codec.test.ts`, *an instant and a time are
  the kinds read cut to the shape, and nothing else* — watched failing with
  the time left out and with a zoneless timestamp put in.
  `packages/data-postgres/src/records.integration.test.ts`, *reads an
  instant to the second and a time to the minute, and what no shape names in
  a spelling the codec refuses* — `.789012` and `59.999999` cut, never
  carried, at 9999-12-31 too; a BC instant, `infinity`, a five-digit year,
  `24:00` and a NaN refused by the codec — and the planted-objects case,
  which now holds the planted `%` against a zoneless fraction; both watched
  failing on main's faithful read. The shared case `TEMPORAL_PARITY` in
  `@formancy/data-fixtures`, a time and an instant of
  `parity.display_kinds` with milliseconds, the instant at +02:00, asserted
  by both adapters' `parity.integration.test.ts` with `covers()`, on
  PostgreSQL under another TimeZone and DateStyle as well, which the session
  is asked for first (watched failing with the settings left out); watched
  failing on PostgreSQL on main. Run on 2026-10-10.

## Context

formancy's instant has whole seconds and its time has minutes, fixed regexes
in `TEMPORAL_SHAPES` (formancy.ai 0067, released in `@formancy/spec`
0.3.0). The engines store more: PostgreSQL's `now()` writes microseconds,
SQL Server's `sysdatetimeoffset()` seven digits and an offset, and a `time`
holds seconds on both. The fixture's own `customer.created_at` is such a
column on both engines, and the default scales are 6 and 7.

The two adapters read them differently, which
[0026](0026-name-every-column-fact-the-engines-disagree-on.md) left as "its
own record". [0016](0016-postgres-operations.md) read PostgreSQL's
faithfully, `2026-10-08T10:34:56.789012Z`, a spelling the codec refuses, so
that a truncated value could never be written over the real one.
[0017](0017-sqlserver-operations.md) read SQL Server's cut to the shape, and
said a host that writes back an unedited value writes the shorter one,
listing as not mechanically enforced "that a host updates only the fields a
person changed".

formancy's renderers submit every field, and the host page sends the whole
submission on update ([0029](0029-a-host-renders-a-published-form-through-one-client.md)).
Reproduced on 2026-10-10 on both engines, through the runtime plane and
through the host page in both renderers:

- **SQL Server**: every save where the person may write them, edited or
  not, wrote the cut values —
  `08:43:18.0607346` became `.0000000`, `10:34:56.1234567` became
  `10:34:00`, an instant stored at +02:00 came back at +00:00 — and the page
  said "Saved.". The point in time survived to the second; nothing else did.
- **PostgreSQL**: the engine refused the faithful value on `shape`, and "a
  submit the engine refused sends nothing", so the record could not be saved
  unedited through the page. That held also where the actor may not write the
  column: by policy, the field is enabled and the person could move the
  value past the refusal, which the server then refused as over-posting; by
  the account's privileges, the generator disables the field and the 0.3.0
  engine still validates it, so there was no way out. Moving the value away
  and back stored the minute in its place.

A column the actor may not write was safe on SQL Server only because
[0022](0022-the-runtime-plane-asks-the-policy-every-time.md) removes an
unchanged echo of it, compared with the record as read — read cut the same
way. The update already reads the record first for that, and every update
is guarded by a version (0015, 0018), so the read and the write are one
state or the write is stale.

## Decision

**Both adapters read an instant to the second, in UTC, and a time to the
minute, cut and never rounded.** SQL Server already did. PostgreSQL now
spells an instant with `to_char(… at time zone 'UTC',
'YYYY-MM-DD"T"HH24:MI:SS"Z"')` and a time as the first five characters of
its text. What no shape can name keeps a spelling the codec refuses, as
0016 had it: `infinity`, a BC instant with its fraction
(`0044-03-15T12:00:00.500000Z BC`), a five-digit year, PostgreSQL's `24:00`,
a NaN. A zoneless timestamp keeps its fraction on both engines (0026); no
form field writes one. `TEMPORAL_PARITY` holds both adapters to one answer.
`readsCutToShape` in `data-core` names the kinds read so — an instant and a
time — once, for the planner.

**On update, the planner removes an unchanged echo of an instant or a time
the actor may write and read**, as 0022 removes one of a field the actor
may not write: when it equals the record as read for this actor, and that
read is at the version the update names. Against another version it is the
person's older read, it is not removed, and the update's guard answers it
`stale`. A changed value is written as sent, to the second or the minute
the field holds. `planUpdate` takes the record as read, and refuses
`record-not-read` an update carrying such a field without it, or with
another record's, so a caller of the planner and an adapter outside the
data server is held to the rule as the server is: one decision, in the one
planner ([0018](0018-one-planner-turns-answers-into-requests.md)). The
data server reads the record and passes it.

**Three cases decided with it:**

- **Create** compares nothing, because nothing was read: a value entered is
  written, and a field left out — a renderer leaves an untouched one out — is
  left to the column's default, whose fraction is kept and read back cut.
- **A field the actor may write and not read**, and every field of an actor
  who may update and not read the record, has no value of theirs to echo:
  what they send is written. Compared with the stored value anyway, the
  save would tell them whether they had guessed a value the policy keeps
  from them — `nothing-to-update`, or a version that moved.
- **A form whose only change was an unedited instant and time** has nothing
  left to set, and is answered as every empty patch is: 400
  `nothing-to-update`, "These answers change no column.", nothing sent and
  the version unmoved. The host page shows it under "Not saved".

**A read that failed**, whatever its failure, cannot tell an unedited
instant or time from an edited one, so an update carrying one the actor may
write and read is refused with that read's own answer — 503 for
`unavailable`, 404 for `not-found`, 403 for `permission-denied` — and
nothing is sent. A read that comes back as another record's token, a key
spelled otherwise than the row holds it under a collation that matched it
anyway, is 409 `record-not-read`. An update carrying none goes on as 0022
has it.

**The read belongs to the sending**
([0031](0031-an-answer-lost-after-a-write-is-unknown.md)). The update route
reads, plans, checks memberships and writes inside the one sending a write
id names, so a write that arrives again is answered with the first
sending's answer before anything is asked, its read included, and a resend
whose own read would have failed is not told "Nothing was saved." about a
save that was.

## Consequences

**What it buys.** An instant or a time the actor may read is never written
over unless the person changed it, on either engine, whichever host sends
the update and whatever plans it: the renderers, the reference host page, a
client of its own that sends back what it read, or a caller of
`planUpdate` and an adapter outside the data server, which is refused
rather than left to write the cut value. A PostgreSQL record whose
`created_at` came from `now()` can be opened and saved, through the page,
in both renderers, also where the actor may not write the column. The two
engines answer one read alike. 0017's unenforced reliance on a host sending
only what changed is enforced by the planner for the two kinds that needed
it. A resend of an update asks the database nothing.

**What it costs.** On PostgreSQL an instant is now shown to the second and a
time to the minute, as SQL Server's already were: the fraction and the
seconds are in the database and nowhere in a form. A value that differs
from the stored one only below the shape cannot be written through a form:
setting `created_at` to the whole second it reads as, to drop its fraction,
is an unchanged echo and is removed. A field the actor may write and not
read, and an actor who may update and not read, get nothing removed, so a
client that sends a cut value there stores it; the host suite's write-only
case and the record-level one do, on both engines. A form whose only
writable fields are instants and times, saved unedited, is now "Not saved"
with "These answers change no column." where SQL Server said "Saved." over
the cut values. An update that carries a writable instant or time is
refused when the read before it failed, whatever the failure, though the
write itself might have succeeded. A caller of `planUpdate` that sends an
instant or a time the actor may read must pass the record as read, or is
refused `record-not-read`. An instant the person changes is written in UTC,
so SQL Server stores it at +00:00 whatever offset the row held. An instant
changed in `@formancy/react` 0.3.0's datetime control is saved as the local
minute the control holds, its seconds and fraction gone, because that
control edits a minute; measured in React, not in Angular. A value no shape
names still reaches the form as text its field refuses — `infinity`, a BC
date, `24:00` — so neither renderer submits the record until the person
changes it, as 0016 said; a client of its own that sends back such an
instant or time unedited saves and keeps it, because the echo is removed
before any codec sees it, and one that sends back such a date or number is
refused by the codec.

**What it does not do.** It does not widen formancy's shapes or its
controls: a field still holds whole seconds and minutes, which is
formancy.ai's to change and would arrive here as an exact-version bump
(0002). It does not change what a create writes, nor SQL Server's read. The
generator's notes still say "an instant, to the second" and "a time of day,
to the minute", not that an unedited save keeps what is stored. A row
filter on a time or an instant is still refused at publish (0028), so no
filter compares a cut value. It does not bring the rest of a write into its
sending: a resend is still answered with a refusal of its own when the form
cannot be loaded or the connection cannot be opened, on either write, and
on create when a lookup cannot vouch for a selection, as on main.

## Alternatives considered

**Read PostgreSQL to the shape alone.** Rejected: without the echo rule it
turns PostgreSQL's refusal into SQL Server's silent cut, which is worse,
because nobody is told.

**Keep the echo rule in the data server's update route.** Rejected, found
in review: a caller of the planner and an adapter outside that route, the
pattern `data-core`'s README shows, wrote the cut value silently where main
had refused it — the outcome the alternative above is rejected for.

**The echo rule alone.** Rejected: on PostgreSQL the renderer refuses the
faithful value before anything is sent, so the server never sees an echo to
remove.

**Show a column that can hold more than the shape as read-only text**, as
the generator already shows a zoneless timestamp. Rejected: every `time`
column and every `timestamptz` and `datetimeoffset` with a fractional scale
— the default scales are 6 and 7 — could no longer be written through a
form at all. A disabled datetime field is no substitute: the 0.3.0 engine
validates a disabled field, which is the PostgreSQL privilege case above.

**Have the host page send only the fields that changed.** Rejected as the
fix: it protects one host, and on PostgreSQL the engine refuses first.

**Widen the shapes upstream.** Not this repository's to do (0002), and the
datetime control would still edit a minute. If it happens, this record is
narrowed then.

**Compare inside the adapter's statement**, setting a column only where its
cut differs from the value sent. Rejected: one rule spelled twice, once per
engine, where the version guard already makes the read and the write one
state or a stale write.

**Prove the echo against whatever the read found.** Rejected: against a
newer version an unedited form would be answered "nothing to update" about
a record that had changed; the route test showed it.

**Compare a field the actor may not read with the stored value.** Rejected:
an oracle for a value the policy withholds.

**On a read that failed, write anyway, or refuse every update.** The first
stores the cut value whenever the read fails and the write does not. The
second refuses updates that need no comparison; a non-empty echo of a field
the actor may not write is already refused then, as over-posting (0022).
Refusing only `unavailable`, as this branch first did, was the first for
every other failure, found in review.

**Answer a resend before the read from the write-once store, and leave the
read outside the sending.** Rejected: a resend that arrives while the first
sending is still reading finds nothing to answer with and reads for itself.
Run inside the sending, the read comes after the id is claimed.

## Older records

Narrowed, not edited away: 0016's faithful spelling of a fractional instant
and of a time with seconds, and the reason it gave for rejecting a
truncated read — a save writing the truncated value over the real one —
which the echo rule now answers; 0017's cost that a host writing back an
unedited value writes the shorter one, and its "not mechanically enforced"
reliance on a host sending only what changed, now enforced by the planner
for instants and times; 0022's echo, which the planner now extends to an
instant or a time the actor may write, at the version named, and whose
update is refused when the read failed and one is carried; and 0026's
"Instants and times still differ between the engines", which they no
longer do. Extended: 0018's planner, whose `planUpdate` takes the record as
read; and 0031's write id, whose sending now holds the update's read, so a
resend asks the database nothing.
