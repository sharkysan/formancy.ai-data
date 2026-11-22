# 0173 — Chosen records are deleted each on its own, with one answer per record

- **Status:** accepted
- **Date:** 2026-11-22
- **Deciders:** Daniel Bacher
- **Verified by:** the server's half of deleting chosen records -- the
  policy's grant, data-core's reading of a request, the route, its
  deadline, the audit and the client; the host page's controls and the
  studio's are a later record's. Written on a machine without Docker on
  2026-11-22: the cases that need no database ran there, each watched
  failing with its rule taken out and the file put back byte for byte;
  the container suites have never run, and CI is their first run.
  Ran and watched failing:
  `packages/data-core/src/policy/validate.test.ts` -- a bulk grant to a
  role `operations.delete` does not name, and one on a form that offers
  no delete, are refused, each role named in codepoint order (watched
  failing with `bulkFitProblems` left out of `fitProblems`: every grant
  was accepted); `bulk.update`, `bulk.delete.purge` and a grant of the
  wrong shape are refused as properties this release does not read
  (watched failing with `bulk`'s properties unchecked); a grant on a
  together child, whose rows are deleted only in a save, is refused
  (watched failing with `offers()` asked in place of `offeredFor`: the
  grant was accepted).
  `packages/data-core/src/records/bulk.test.ts` -- `readBulkBody` takes
  one to a page of `{ record, version }` and refuses none and one more
  (watched failing with the bound taken out); `chosenTwice` names the
  first two positions of one key, whatever their versions (watched
  failing with it answering none); `authorizeBulk` is nobody's without a
  grant (watched failing with an absent grant read as every deleter's),
  a role the grant names and no other (watched failing with its roles
  unasked), and refuses a context that cannot scope a delete with the
  delete's reason (watched failing with the row filter unresolved).
  `packages/data-server/src/routes/runtime-bulk.test.ts`, over fake ports
  -- each record its own description and delete, one after another in the
  order sent (watched failing with every description asked before the
  first delete); each record answered exactly as `POST …/records/delete`
  answers it alone, both routes asked and compared (watched failing with
  a stale record worded by the bulk route itself); the records after a
  refusal still sent (watched failing with the loop stopping at the
  first); the stop at the first `unknown-outcome` or `unavailable`, every
  record after it `{ sent: false }` (watched failing with the loop going
  on past it); the deadline before each record (watched failing with it
  unchecked: all three deleted); 403 before any statement, the
  description included (watched failing with `authorizeBulk` left out:
  the sweeper's record was described and deleted); a body past a page, a
  write id that is not one and a record named twice 400, nothing sent
  (watched failing with the duplicate check left out); a form drift
  stops answered once, 409, at the first record, and drift found later
  that record's (watched failing with the first record's drift kept as
  its outcome); a first record refused `schema-changed` or
  `permission-denied` answered so once (watched failing with those codes
  kept as the record's: the vanished table's request answered 200); a
  record whose delete throws answered 500 in the server's words, the
  records before it kept and none after it sent (watched failing with
  the loop uncaught: a bare 500 with the error's words, the first
  record's deletion in neither the answer nor the trail); a resend answered as the first sending, asking nothing
  (watched failing with the loop outside `sendOnce`); the trail's one
  event, every record by its keyed hash and `outcomes` by code, a
  declined record's words in neither the trail nor the log (watched
  failing with `outcomes` left off, and with the record's decline not
  said in the log); `GET /v1/forms/:id`'s `bulk` where the grant and the
  delete both hold (watched failing with `bulk` read from the policy
  alone). `packages/data-server/src/bulk-deadline.test.ts` -- the
  setting by the lookup deadline's rule (watched failing with the
  digits-only rule taken out), the default's room before nginx's
  `proxy_read_timeout` for a last record of three statements on SQL
  Server (watched failing with a default of 40 s, and with the first
  default of 20 s: 20 s and three timeouts are 65 s), and
  `runtime.bulkDeadlineMs` held to the rule (watched failing with it
  unchecked). `scripts/server-start.test.mjs` -- the built server stops
  at start on a deadline that is not a whole number (watched failing with
  `main.ts` reading none). `scripts/cloudflare/doors.test.mjs` -- the
  door generator reads a route Fastify prints as `-chosen` under
  `/records/delete` (watched failing with the reader taking only children
  that start with a slash: the built server's routes could not be read),
  and doors.json forwards the route at the runtime door.
  `packages/data-fixtures/src/cases.test.ts` -- `BULK_PARITY` is an export
  with its reason for being no family of shared cases (watched failing
  without it). `packages/data-client/src/transport.test.ts`, run alone
  under a configuration without the package's database setup, since it
  asks no database -- `form()` takes `bulk` only as a yes or no, and a
  yes only where `operations` holds `delete` (watched failing with
  `isBulk` left out: a reply without `bulk` was taken).
  First run in CI, never run:
  `packages/data-server/src/e2e-bulk.integration.test.ts`, on both engines
  through the real server, `BULK_PARITY`'s cases -- one request over six
  records deletes the clerk's two, answers one changed since it was read
  `stale`, one deleted since and another tenant's `not-found`, one a NO
  ACTION key's row refers to `referenced`, and keeps those; two parents
  deleted with the rows that cascade from them two levels down and a SET
  NULL reference cleared; a record a cascade of another form's delete took
  `not-found`, and the next deleted. The lost answer in
  `packages/data-server/src/e2e-lost-answer.integration.test.ts`, through
  its TCP hop on both engines -- the second record's answer swallowed after
  the database deleted it: the first `done`, the second 502 naming it with
  its version, the third `{ sent: false }` and kept, the second's marker
  sent once and the third's never, counted again after one more round
  trip, and a new request sending the second a delete of its own,
  answered `not-found`. `packages/data-server/src/bulk-sized.integration.test.ts`
  on the default images -- the timings a default is set from, printed to
  the log, and a page deleted whole within the default. `packages/data-client/src/chosen.test.ts`
  over a fake `fetch`, and `deletes.integration.test.ts` on both engines --
  each record read as a delete of it alone, a lost request an unknown
  delete of every record with its version, and `reconcileChosen` reading
  each.

## Context

0166 gave the host page a column of boxes that chooses records of the page
shown and a bar that runs an action over them, all or nothing, in one
transaction (0165). A person who wants the chosen records gone has only a
delete of one record at a time (0050), from its detail or its row (0053),
fifty confirmations for a page. 0015 forecloses bulk writes in the record
port: one record operation is one guarded statement, never retried. Two
shapes were open: every record in one transaction, as 0165 runs a routine
over a selection; or every record a delete of its own, one after another,
as a person pressing Delete on each row would make them. And the policy
said nothing of who may do it.

## Decision

1. **A grant.** `FormPolicy.bulk`, optional, absent nobody's:
   `{ delete: { roles } }`, each role one `operations.delete` grants too,
   on a form that offers a delete alone (`validatePolicy`'s
   `bulkFitProblems`) -- not a together child, whose rows are deleted only
   in a save of their record (0155), and whose every delete alone is
   refused. It
   narrows the delete grant to the roles that may send a page of deletes at
   once, and widens nothing. `update` is not reserved: a property this
   release accepted and nothing enforced would be the rule 0011 refuses,
   so `bulk.update` is refused as every unread property is, until a change
   of chosen records to values is decided.
2. **What a form says.** `PublishedForm.bulk`, required: `{ delete }`,
   `true` exactly where `operations` holds `delete` and `authorizeBulk`
   lets the person through (`bulkOffered`) -- the grant names a role of
   theirs and the delete can be scoped.
3. **The route.** `POST /v1/forms/:id/records/delete-chosen`
   (`packages/data-server/src/routes/runtime-bulk.ts`) with
   `{ records: [{ record, version }] }`, in this order, each step
   answering alone: the shape, 400, one to `LIST_PAGE_SIZE` records
   (`readBulkBody`), before the write id is read; the write id, 400; the
   form and its connection; who may send one (`authorizeBulk`), 403 before
   any statement; no key named twice (`chosenTwice`), 400
   `duplicate-record` in 0165's words, naming the token. Then each record
   in the order sent: the deadline first, then **the code a single delete
   runs** -- `deleteOne`, the body of `POST …/records/delete` taken out
   into a function both routes call, so one record of a request is a
   single delete and the two cannot answer it apart. A record's outcome is
   that delete's status and body. A refusal about the record -- `stale`,
   `not-found`, `referenced`, `declined` and the rest -- and the request
   goes on. `unknown-outcome` or `unavailable`, and it stops: the
   connection is then in doubt, and every record after it is
   `{ sent: false }`. A delete that throws -- a programming error, nothing
   a delete is answered with -- stops it too, that record answered 500
   `internal` in the server's own words, never the error's, which a client
   reads as its delete unknown, and the error said in the log. A first
   record refused for what the form or its connection is -- drift or the
   table gone or changed (409 `drift`, `schema-changed`), a configuration
   the server cannot apply (500), a connection the database will not let
   delete (403 `permission-denied`) -- is the request's answer, once,
   nothing deleted: every other record would be refused the same way.
   Found at a later record, each is that record's. 200
   `{ records }` in the order sent, once per write id (0031), the
   authorisation inside the sending, as a single delete's is, so a resend
   is answered as the first sending was.
4. **A deadline.** `FORMANCY_DATA_BULK_DEADLINE_MS`, read in `main.ts` and
   parsed by the lookup deadline's rule (`bulk-deadline.ts`), held to it as
   `runtime.bulkDeadlineMs`, checked before each record and never during
   one. **The default is 14,000 ms, chosen by what bounds it**: a request
   answers within it and one record more, a record on SQL Server up to
   three statements -- the root's description, the delete, and where it
   deleted nothing the read that says why -- each bounded by mssql's 15 s
   request timeout, and 14 s and those 45 s end before nginx's default
   `proxy_read_timeout` of 60 s, which the composed stack leaves as it is.
   A page the deadline cuts short costs a second request for the records
   not sent; an answer the proxy cuts, a read of every record.
   `bulk-sized.integration.test.ts` measures a page on the default images
   -- 20 runs at 1, 10 and 50 records, as `save-limits.ts` was measured --
   and prints its timings to the log, one line per engine starting
   `bulk-sized`, which is what a CI run keeps of them, and holds a page
   done within the default. Its first run, CI run 45017277480 on
   2026-11-22 on GitHub's runner, deleted a page of 50 records in at most
   1,088 ms on PostgreSQL (p50 830 ms) and 296 ms on SQL Server (p50
   252 ms), and 10 in at most 220 and 75 ms: the default is about
   thirteen times the slowest page measured, so it is left where the
   proxy bounds it rather than set from those figures, and a slower
   deployment's page has that room.
5. **The trail.** One event per request, operation `delete-chosen`:
   `records`, each record by its keyed hash in the order sent, `rows` their
   count, `record` `null`, and `outcomes`, each record's code -- `done`, the
   code its delete was refused with, `unknown-outcome`, `not-sent` -- never
   a message; `null` where the request was answered as a whole or answered
   again. A declined record is said in the log by its code once, as a
   declined write alone is (0156).
6. **The client.** `client.deleteChosen(formId, { records })` and
   `reconcileChosen` (`packages/data-client/src/chosen.ts`): each record
   read by `writeOutcome` as a delete of it alone, a record not sent
   `not-sent`, the request by `heard`'s rules, a lost one an
   `UnknownChosen` naming every record with its version; `reconcileChosen`
   reads each, one at a time, as `reconcile` reads one deletion --
   `unchanged`, `changed` or `absent`.
7. **The port is unchanged.** Each record is `RecordAdapter.delete`, one
   guarded statement in its own transaction, never retried (0015, 0050);
   both adapters are untouched, and 0015's foreclosure of bulk writes in
   the port stands. The loop is the server's.

## Consequences

**What it buys.** A person deletes up to a page of chosen records in one
request, each exactly as its delete alone would be -- its policy, its
reach through the keys the policy names (0051), its version -- and is told
what became of each. No lock outlives one record's statement, so two such
requests never deadlock on each other; a lost answer is one record's, and
is checked by a read of each. Nothing new is asked of either engine.

**What it costs.**

- **A set left half deleted, by design.** A refused record leaves the
  others deleted, and a stop leaves the rest undone; each is named in the
  answer, record by record, and nothing is undone. A set that must go
  whole is an action's (0165).
- **A deadline chosen by the proxy, not by the timings**, which describe
  CI's runner and the default images and no deployment's. It bounds
  the request only between records: on PostgreSQL nothing bounds a
  record's wait for another's lock, as for a delete alone, so the proxy
  in front can still cut an answer there, and on SQL Server mssql's 15 s
  does, past which that record is `unknown-outcome` and the request stops.
  Held below 15 s for SQL Server's sake, it leaves a slow page more often
  half sent than a longer one would.
- **A page of deletes is two statements a record, three for one not
  deleted**: the root's description, the delete, and the read that says
  why nothing was deleted, one after another -- and on PostgreSQL a
  delete past its root is a locked transaction of several round trips.
  Up to a hundred and fifty statements for a page, which took at most
  1,088 ms on PostgreSQL and 296 ms on SQL Server on CI's runner
  (2026-11-22).
- **An older server refuses the policy.** A server before 0173 refuses a
  policy naming `bulk`, as it refuses every property it does not read, so
  a version published with the grant cannot be imported to one, and a
  client of this release answers `unexpected` to `form()` against a
  server before it, which sends no `bulk`.
- **A first record's 500 is the request's.** A form the server cannot
  apply refuses the request once with 500, which `heard` reads as an
  unknown delete of every record, though nothing was sent; a single
  delete's 500 is read the same. A record whose delete throws is that
  record's unknown delete, though nothing may have been sent for it, and
  every record after it is not sent.
- **A first record's refusal can be the request's for one row's
  reason.** `schema-changed` and `permission-denied` are about the table
  and the connection, and stand for every record; but a trigger can meet
  either for some rows alone -- a table it writes for closed tickets
  only -- and the first record refused so refuses the request, nothing
  deleted, where the others, each sent alone, would have been deleted.
- **A cascade onto another record of the same form is not tested.** SQL
  Server refuses a key that cascades onto its own table, and every cycle
  of cascading keys, so no shared fixture has one; on PostgreSQL such a
  record would be `not-found` once an earlier record's cascade took it,
  by reasoning alone.
- **The shared expectation is held on the default images alone.**
  `BULK_PARITY` is no family of shared cases: the server's suites run on
  the default images, and a case the report holds must pass on every
  image (0067). Each record's delete is held on every image by
  `DELETE_PARITY` and `CASCADE_PARITY`.
- **One audit event names many records**, under a key, `outcomes`, no
  other event has, which a collector that holds every event to one shape
  meets.
- **The route's name shares `delete`'s prefix**, so Fastify prints it as
  `-chosen` under `/records/delete`, which the door generator learned to
  read; and an operator behind Cloudflare runs `tunnel-config` again
  before the runtime door forwards it, failing closed until then.
- **Only a client of the deployment's own sends one**, through
  `@formancy/data-client` or requests of its own: the host page offers no
  delete of chosen records, and the studio grants none, so an
  administrator writes `bulk` into a policy by hand. The host page's
  `apps/host/src/plane.test.tsx` holds the route unsent on every door
  until the page has a control that sends it.

**What it forecloses.** Nothing: an all-or-nothing delete of a set stays
open as an action over a selection, and a change of chosen records to
values is a later record's.

## Alternatives considered

**All or nothing, as 0165.** One transaction, every record locked in key
order, one refusal undoing them all, one answer and one unknown for the
set. Lost: a new port method and new SQL on both engines with 0165's
differences -- SQL Server's adapter key order, a collation's duplicates
found after the lock -- every lock held to the last statement, a reversal
of 0015's foreclosure, and one stale or referenced record refusing a page
of others. A set that is one business act is what an action over a
selection is for.

**Every row a filter lists.** A request past the page, the server walking
the filter as an export does (0079), or the page sending a page at a time.
Lost for now: an unbounded write behind one press, no count before it, a
request outlasting every deadline here, and a confirmation over records
the person never saw. The page shown is 0166's choice, and a page at a
time stays open.

**One switch per form.** Anybody who may delete may delete chosen
records. Lost: nothing to choose, and no way to give it to supervisors
alone, while a page of deletes is fifty times what one press did.

**Roles alone, the grant on `operations`.** A role list beside
`operations.delete`, with no `bulk`. Lost: a change of chosen records to
values, which Decision 1 leaves to a later record, would need fields
beside its roles, and one property holding every grant over chosen
records is one place an administrator reads; an older server refuses
either the same way.
