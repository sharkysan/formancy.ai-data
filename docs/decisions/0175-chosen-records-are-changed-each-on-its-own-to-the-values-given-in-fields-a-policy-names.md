# 0175 — Chosen records are changed each on its own to the values given, in fields a policy names

- **Status:** accepted
- **Date:** 2026-11-22
- **Deciders:** Daniel Bacher
- **Verified by:** the server's half of changing chosen records -- the
  policy's grant, data-core's reading of a request, the bundle's check of
  the form's rules, the route, its deadline, the audit and the client; the
  host page's controls and the studio's are a later record's. Written on a
  machine without Docker on 2026-11-22: the cases that need no database
  ran there, each watched failing with its rule taken out and the file put
  back byte for byte; the container suites have never run, and CI is their
  first run.
  Ran and watched failing:
  `packages/data-core/src/policy/validate.test.ts` -- a `bulk.update` role
  `operations.update` does not name, a field a listed role may not write,
  and a grant on a form that offers no update, are refused (watched failing
  with `updateFit` left out of `bulkFitProblems`); the key, a field written
  on create only, one the database writes, one the server stamps, a pinned
  one, a version chain's and the together field, each by name (watched
  failing with `unsettable` answering none); a `bulk` naming no operation
  fits a form that offers an update alone (watched failing with 0173's
  rule, which asked it of a delete); `bulk.update`'s own properties held
  (watched failing with them unchecked).
  `packages/data-core/src/policy/read-together.test.ts` -- the names an
  expression reads, and none in a literal or after a dot (watched failing
  with literals scanned as code); a rule's target read with what its
  expression names (watched failing with the target left out); a check,
  and a skip that names a field, read every field (watched failing with a
  check read by its target alone); the grant's fields refused in its order
  (watched failing in the rules' order).
  `packages/data-core/src/records/bulk-change.test.ts` -- `readChangeBody`
  takes `{ records, answers }` and nothing without answers (watched
  failing with them unchecked); `authorizeBulk` lets through
  `bulk.update`'s roles and no delete's (watched failing with
  `bulk.delete`'s asked); `bulkOffered` names the grant's fields in the
  form's order (watched failing in the grant's); `bulkAnswers` refuses a
  field outside the grant (watched failing with the grant unasked),
  decodes every answer once with every error (watched failing with the
  first error alone), returns one membership check per selection (watched
  failing with the selections dropped), and checks no move, each record's
  being `planUpdate`'s from its own state (watched failing with a move
  checked from nothing).
  `packages/data-server/src/routes/runtime-bulk-update.test.ts`, over fake
  ports -- each selection checked once and each record read and updated in
  the order sent (watched failing with nothing vouched for: the lookup was
  asked between every read and update); each record answered exactly as
  `POST …/records/update` answers it, both routes asked and compared
  (watched failing with the bulk route wording a refused move itself);
  answers no codec takes, a field outside the grant and a selection not
  among the options refused before any record is read (watched failing
  with the answers left to each record's plan); the records after a
  refusal still sent and the stop at the first `unknown-outcome` or
  `unavailable` (watched failing with the loop going on); the deadline
  (watched failing unchecked); 403 before any statement (watched failing
  with the delete's grant asked); a body without answers 400 (watched
  failing with the delete's reader); a form drift stops answered once at
  the first record (watched failing with it kept as the record's); a throw
  answered in a change's own words (watched failing with the delete's); a
  resend asking nothing (watched failing with the write id not handed to
  `sendOnce`); the trail's one event with no `moved` (watched failing with
  each record setting it); `GET /v1/forms/:id`'s `bulk.update` (watched
  failing with it read from the grant alone); and the bundle refused for a
  field a rule reads together with another (watched failing with
  `readTogetherProblems` left out of `validateBundle`).
  `packages/data-server/src/bulk-deadline.test.ts` -- four of mssql's
  timeouts reach nginx's 60 s by themselves (watched failing with the
  timeout at 14 s). `packages/data-client/src/chosen.test.ts` and
  `transport.test.ts`, run alone under a configuration without the
  package's database setup, since they ask no database -- `updateChosen`
  sends the records and the answers alone (watched failing with the
  answers left out), reads each record as an update of it alone (watched
  failing with each read as a delete), a lost request as an unknown change
  (watched failing with the delete's operation named), `reconcileChosen`
  reads each as an update (watched failing with each as a deletion), and
  `form()` takes `bulk.update` only as `null` or fields `writable.update`
  holds where update is offered (watched failing with any list taken).
  First run in CI, never run:
  `packages/data-server/src/e2e-bulk.integration.test.ts`, on both engines
  through the real server, `BULK_PARITY`'s change cases over the shared
  fixture's orders -- one request over five changes the clerk's order to
  every answer, its amount read back `12.5000`, answers one changed since
  `stale`, one shipped `transition-denied` from its own state, one this
  suite's trigger keeps `declined` in the trigger's words, and changes the
  last; one deleted since and another tenant's `not-found`, and the next
  changed; another tenant's customer and a customer that names no row each
  422 for the request, no order changed. The lost answer in
  `packages/data-server/src/e2e-lost-answer.integration.test.ts`, through
  its TCP hop on both engines -- the second record's answer swallowed
  after the database stored it: the first `stale`, the second 502 naming
  it with its version, the third `{ sent: false }`; the note sent twice and
  the third's code never, counted again after one more round trip, and a
  new request, counted afresh, answering the second stale and changing the
  third. `packages/data-server/src/bulk-sized.integration.test.ts` on the
  default images -- a page of changes timed beside the deletes, printed to
  the log, and changed whole within the default. `packages/data-client/src/deletes.integration.test.ts`
  on both engines -- each record read as an update of it alone, and `null`
  clearing the note.

## Context

0173 lets a person delete up to a page of chosen records in one request,
each a delete of its own, and left a change of them to values for later:
its policy reader refused `bulk.update` as every unread property is. A
person who wants twelve orders shipped, or a note cleared on each, opens
and saves each one. A change differs from a delete in three ways that
matter here: it carries answers, the same for every record, which can be
checked once; each record's answers meet that record's own state -- its
version, its state field's move (0112, 0127), a trigger's view of it; and
the form's rules (`logic.rules`) may read the field it sets together with
the record's other answers, which the page that sets one value for fifty
records cannot run over each, and which the server runs none of.

## Decision

1. **A grant.** `FormPolicy.bulk.update: { roles, fields }`, optional,
   absent nobody's. `validatePolicy` (`policy/bulk-fit.ts`) refuses a role
   `operations.update` does not grant; a field some listed role may not
   write; a field that is not the form's, the key, the field a together
   child's rows are saved with their record through (0155), a version
   chain's start, end or key (0113), a column a row filter pins, one the
   server stamps (0153), one the database writes and one written on create
   only (0027), each by name; and a grant on a form that offers no update
   alone. The state field may be listed: each record's move is checked
   from its own state. A `bulk` that names neither operation grants nobody
   and now fits a form that offers an update or a delete alone -- 0173
   refused it on any form that offers no delete -- and is refused on one
   that offers neither.
2. **What the form's rules read.** `validateBundle` refuses, on publish and
   on every read, a listed field a rule of the form reads together with
   another (`policy/read-together.ts`): a rule reads its target's field and
   every field key its expression names as a variable, read by a scan of
   its tokens that skips literals and members after a dot; a `check`,
   whose validator the deployment answers with the whole submission, and a
   `skip` that names a field, read every field. The code says more than the
   design did here: a generated form carries only `disabled` rules over
   `true` and a presentation adds none (0030), so the check refuses
   something only in a bundle whose form was written otherwise, format 1.
3. **What a form says.** `PublishedForm.bulk.update`, required: the grant's
   fields this person may write on update, in the bindings' order -- each
   one the over-posting check accepts alone, as `writable.update` names
   them -- where `operations` holds `update` and `authorizeBulk` lets them
   through (`bulkOffered`, `chosenOffered`); `null` otherwise, never empty.
4. **The route.** `POST /v1/forms/:id/records/update-chosen`
   (`routes/runtime-bulk.ts`) with `{ records, answers }`, each step
   answering alone: the shape, 400 (`readChangeBody`), before the write id;
   the write id; the form and its connection; `authorizeBulk`, 403 before
   any statement; `chosenTwice`, 400; then once for the request, since
   neither depends on the record, the answers (`bulkAnswers`) -- none sent
   `nothing-to-update` 400, a field outside the grant `over-posting` 403,
   every value through its column's codec by `planUpdate`'s own
   `decodeAnswers`, 422 with every error -- and each selection's
   membership check, 422 or 503. Then each record in the order sent, the
   deadline first, then **the code a single update runs**: `updateOne`, the
   body of `POST …/records/update` taken out into a function both routes
   call, its read, its echoes, its plan and its one guarded statement, a
   check the request has vouched for (`vouchedAs`) not asked again and any
   other asked. A record's outcome is that update's status and body. The
   loop, its stop at the first `unknown-outcome`, `unavailable` or throw,
   its first record refused for the form or its connection answered once,
   and its trail are 0173's, one function (`eachChosen`) for both routes.
   `null` clears a field where its column may be NULL and is refused
   `required` where it may not; an empty text is text. A record that could
   not be read -- deleted since, another tenant's -- while the change moves
   the state field is refused `transition-denied`, as its update alone is,
   since no move can be checked from where nobody read; a change that
   leaves the state field alone answers it `not-found`.
5. **The deadline.** `FORMANCY_DATA_BULK_DEADLINE_MS` covers a change too:
   one setting for a request over chosen records, counted from when its
   sending starts, so the request's membership checks are inside it, each
   bounded by the lookup deadline. 14 s still holds: a change's record on
   SQL Server is three statements, as a delete's is -- the read that
   carries the root's description, the update, and where it changed
   nothing the read that says why -- and 14 s and three of mssql's 15 s end
   before nginx's 60 s. Where a record's read fails, the root is described
   in a statement of its own before the update, as for an update alone: four
   statements, and four of mssql's timeouts reach the proxy's 60 s by
   themselves, so no deadline holds that record's answer from it.
   `bulk-sized.integration.test.ts` times a page of changes at 1, 10 and 50
   records beside the deletes, printing them to the log.
6. **Once per write id.** Operation `update-chosen` in write-once, its
   answer each record's update answer, the record as stored among them.
   Counted on 2026-11-22 as the JSON the built route answers over fake ports
   for the shared fixture's order form -- seven-digit keys, the fixture's
   edge amount, a short note -- 50 orders changed are 14,263 bytes and 50
   stale ones 7,413, so the 32 MiB cap holds about 2,350 and 4,500 such pages
   and a page of changes fills it before the count of 10,000 does.
7. **The trail.** One event per request, operation `update-chosen`, the
   shape of `delete-chosen`'s: `records`, `rows`, `record` `null`,
   `outcomes` each record's code; `moved` `null`, since a move is one
   record's, and a refused one is its `transition-denied`.
8. **The client.** `client.updateChosen(formId, { records, answers })`
   (`chosen.ts`, beside `deleteChosen`): each record read by
   `writeOutcome` as an update of it alone, one not sent `not-sent`, a lost
   request an `UnknownChosen` of `update-chosen` naming every record with
   its version. `reconcileChosen` reads each as `reconcile` reads one
   update: `unchanged`, `changed`, or the read's own refusal -- for a record
   gone, its `not-found`, as a single update's reconciliation answers it;
   the design's `absent` is a deletion's, and the code keeps one reading.
9. **The port is unchanged.** Each record is `RecordAdapter.update`, one
   guarded statement in its own transaction, never retried (0015); both
   adapters are untouched.

## Consequences

**What it buys.** A person changes up to a page of chosen records to the
same values in one request, each exactly as its update alone would be --
its policy, its version, its state's move, its trigger -- and is told what
became of each. The answers are refused once, before any record is read,
when no record could take them. No lock outlives one record's statement.

**What it costs.**

- **A set left half changed, by design.** A refused record leaves the
  others changed, and a stop leaves the rest unchanged; each is named in
  the answer, record by record, and nothing is undone.
- **One value for every record.** No value per record, no expression ("add
  10%"), and no preview of what a change does.
- **No field a rule reads with another can be granted.** A check, or a
  skip that names a field, makes every field of the form ungrantable; the
  scan errs towards a field read, so a function named like a field counts
  as one. It is this repository's reading of CEL's tokens, not upstream's
  parser: an expression upstream reads otherwise would be judged by this.
- **The state field's moves are each record's.** A change to a state some
  chosen records cannot reach refuses those, and a record deleted since is
  refused `transition-denied` rather than `not-found` where the change
  moves the state field.
- **A record whose read fails is four statements on SQL Server**, past
  what any deadline can keep inside nginx's 60 s; and on PostgreSQL nothing
  bounds a record's wait for a lock, as for an update alone.
- **The request's checks are inside the deadline**, so lookups slow
  enough to use it up leave every record not sent.
- **A page of changes is two statements a record, three for one not
  changed**, up to a hundred and fifty, timed by bulk-sized in CI and not
  yet on this record's date.
- **Write-once keeps fewer of them**: a page of changes is about four times
  a page of deletes, and a record's answer grows with what it holds.
- **An older server refuses the policy**, as a server before 0175 refuses
  `bulk.update`, and a client of this release answers `unexpected` to
  `form()` against a server before it, which sends no `bulk.update`.
- **The route's name shares `update`'s prefix**, which Fastify prints as
  `-chosen` under `/records/update` and the door generator reads as 0173's;
  an operator behind Cloudflare runs `tunnel-config` again before the
  runtime door forwards it.
- **Only a client of the deployment's own sends one**: the host page and
  the studio offer no change of chosen records, so an administrator writes
  `bulk.update` by hand, and `apps/host/src/plane.test.tsx` holds the route
  unsent on every door until the page has a control that sends it.
- **The shared expectation is held on the default images alone**, as
  0173's: `BULK_PARITY` is no family of shared cases, so the suite declares
  no `covers()`; each record's update is held on every image by the
  adapters' update cases.

**What it forecloses.** Nothing: an all-or-nothing change of a set stays
open as an action over a selection (0165), and a change of every row a
filter lists as a page at a time.

## Alternatives considered

**All or nothing, as 0165.** One transaction, every record locked in key
order, one refusal undoing them all. Lost for 0173's reasons -- a new port
method and new SQL on both engines, every lock held to the last statement,
a reversal of 0015's foreclosure -- and because one record's state or
version would refuse a page of others it does not concern.

**A value per record.** Each record its own answers in one request. Lost:
that is fifty updates, which the single route already is; the request
checks once only because the answers are one.

**Every field the role may update, no list.** Less to set up. Lost: no way
to keep a field out that should change one record at a time -- a price, an
assignee -- and no place to refuse the fields a rule reads together.

**Run the form's rules over each record on the server.** Lost: the server
runs no rule, the engine is the page's, and a second engine here would be
a second reading of every rule that nothing holds to the first.

**Every row a filter lists.** Lost for now, for 0173's reasons: an
unbounded write behind one press, no count before it, and a confirmation
over records the person never saw.
