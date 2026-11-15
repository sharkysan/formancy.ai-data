# 0156 — A trigger can refuse a write in words the person reads

- **Status:** accepted; narrows [0022](0022-the-runtime-plane-asks-the-policy-every-time.md): a database's refusal still reaches the person in the server's own words, but for one: a write a trigger refuses with a message that starts with exactly `formancy: refused: ` is 422 `declined`, its message the rest of the trigger's, beside the field bound to the column `formancy: refused [column]: ` names; narrows [0028](0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md): such a write is `declined`, not `refused`, alike on both engines -- PostgreSQL's P0001 on a write, SQL Server's user error from 50000 at severity 16 under none of the adapter's own numbers, each read through one reading in data-core -- and a PostgreSQL error in class 42 without an entry of its own that arose inside a function is `refused`, no longer thrown as the adapter's own SQL at fault
- **Date:** 2026-11-15
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/records/refusal.test.ts` -- the reason after the
  exact prefix, and nothing that only resembles it (watched failing with
  the prefix matched without regard to case or spacing: `Formancy:
  refused: closed` was a reason); the reason as written, its spaces
  included (watched failing with it trimmed); a column the brackets name
  and the reason after it (watched failing with the brackets unread: no
  reason); no message longer than `REFUSAL_LONGEST`, with a control
  character, with no reason, or with a column unclosed or empty (watched
  failing with the length unchecked, with the control characters
  unchecked, and with a blank reason passed on); a length in UTF-16 code
  units, as SQL Server's nvarchar counts (watched failing with code
  points counted).
  `packages/data-postgres/src/records-failures.integration.test.ts` and
  `packages/data-sqlserver/src/records-failures.integration.test.ts`,
  against postgres:17-alpine (17.11) and
  mcr.microsoft.com/mssql/server:2022-latest (16.0.4295.3) on 2026-11-15,
  each case of `DECLINE_PARITY` (`packages/data-fixtures/src/declines.ts`)
  declared with `covers()`: a create, an update, a change from a date and
  a delete a trigger refuses are `declined` with its reason exactly, and
  nothing is written, and the sentence for the log never holds the reason
  (watched failing on each engine with its adapter's reading taken out:
  `refused`, on every write, the bracketed and the longest one too); a
  column the message names (watched failing with the brackets unread:
  `refused`); the same reason without the prefix `refused` (watched
  failing with every message passed on: `declined`); a reason with a line
  break, one code unit past the bound and one far past it `refused`, and
  the longest passed on whole (watched failing with the control
  characters unchecked: the line break `declined`; with the length
  unchecked: one past the bound `declined`; and on SQL Server with the
  bound at 2,047, as first written from the documentation: the long one
  `declined` with a reason cut to end in `...`). On SQL Server alone: what
  a trigger's THROW and RAISERROR of each length arrive as through the
  write batch's shape -- whole up to 2,047 code units, and a longer one as
  its first 2,044 and `...`, 2,047 too -- which is what the bound rests
  on; the prefix under one of the adapter's own numbers `refused` (watched
  failing with those numbers unasked: `declined`); a RAISERROR with the
  prefix `declined` at severity 16 and `refused` at 11 (watched failing
  with the severity unasked: 11 `declined`); a trigger that commits the
  write and then THROWs the prefix `unknown-outcome`, its row stored
  (watched failing with the batch's own error for an ended transaction
  left out of its CATCH: `declined` over a stored row). On PostgreSQL
  alone: a read through a view whose function RAISEs the prefix `refused`
  (watched failing with the phase unasked: `declined`, which a browse
  answers with a 500); a trigger function's ambiguous column, 42702,
  `refused` and its missing column, 42703, still `schema-changed`
  (watched failing with the context field unread: 42702 thrown; and with
  every class-42 error inside a function `refused`: 42703 `refused`).
  Run on each engine's default image alone; the other images of the matrix
  (0067) are CI's.
  `packages/data-server/src/routes/runtime.test.ts` -- 422 `declined` with
  the reason as its message, with a field error where the column it names
  is bound and about the record where it is not, and `refused` in the
  server's words for a `declined` failure with no reason (watched failing
  with `declined` answered as `refused`, with the field error left out,
  and with no reason passed on as an empty one); the audit's outcome
  `declined` and one log line by the code and the form, neither holding
  the reason (watched failing with the line removed, and with the reason
  added to it). `packages/data-server/src/routes/runtime-deletes.test.ts`
  -- a delete's reason about the record whatever column it names (watched
  failing with it answered as `refused`).
  `apps/host/src/page.test.tsx` -- on both engines, a save and a delete a
  trigger declines say the reason as the trigger wrote it and then that
  it is the database's own, the keyboard on the save's notice, and both
  states pass axe and the name check. Not run here: both attempts on this
  machine failed in the suite's global setup before any test, SQL Server
  not ready in its 120 seconds and then a request timing out while
  another worktree's databases ran; the trigger the setup adds was run
  alone against the SQL Server fixture and refused an update with the
  reason. It is CI's to run, and to watch failing with `declined`
  answered as `refused`.

## Context

Deployments keep logic in the database: a trigger that refuses a change
in a closed period, an order kept on file, a customer over a credit
limit. Before this record its refusal reached nobody. A trigger's own
error was `refused`, PostgreSQL's P0 and SQL Server's numbers from 50000
alike (0028), and the person read the server's sentence: "The database
refused this request, and nothing was saved. Sending it again will be
refused the same way." That tells them nothing they can act on, and is
wrong when they can: an order outside the closed period would be saved.

0022 and 0028 kept the database's words from the person for a reason
that still holds: SQL Server's messages repeat what the person typed
(0017), PostgreSQL's detail quotes a key, and none of that is the
person's to read or a log's to keep. What a deployment writes for a
person is another thing, but nothing told the two apart.

And one refusal was not a refusal at all. On PostgreSQL an error in class
42 with no entry of its own was taken to be this adapter's own SQL at
fault and thrown: a 500. A trigger function with an ambiguous column,
42702, is the deployment's SQL, and its write was certainly rolled back;
but `data-client` reads a 500 after a write as an answer lost (0031), so
the person was told it may have been saved.

Administrator-named actions will call routines whose refusals need the
same way to the person; they come with their own record. This is the
first step, and works with the triggers deployments already have.

## Decision

**A write a trigger refuses with a message that starts with exactly
`formancy: refused: ` has the rest of that message shown to the person**:
422 `declined`, `message` the reason, for a create, an update, a change
from a date and a delete. `formancy: refused [column]: ` names a column:
the reason is then also a field error on the field bound to it, and about
the whole record for a column the form does not bind or a delete. The
prefix is matched exactly -- lower case, one space after each colon --
so a message that only resembles it is what it was.

**Which error can carry one is each engine's**, written in each adapter's
`records/errors.ts`:

| | PostgreSQL | SQL Server |
|---|---|---|
| The error | SQLSTATE P0001, `RAISE EXCEPTION` | a user error, 50000 or above, at severity 16: `THROW`, or `RAISERROR(…, 16, …)` |
| Never | another SQLSTATE, a RAISE with an ERRCODE of its own included | a number the adapter raises for itself (`statements.ts`), whatever follows it; another severity |
| Only on | a write: a read's RAISE, from a function a view calls, is `refused` | a write |

**What the message says is read once**, `deploymentRefusal` in
`packages/data-core/src/records/refusal.ts`, so the two engines cannot
pass on two different things. **Fail closed on shape**: a message with a
control character, with no reason after the prefix, with a column
unclosed or empty, or longer than `REFUSAL_LONGEST` is the engine's
ordinary refusal, `refused`, in the server's own words, as every trigger
error without the prefix still is.

**The bound is 2,046 UTF-16 code units, the prefix and the column
included, measured.** Microsoft's documentation gives THROW's message as
nvarchar(2048). What arrives through the write batch's shape -- a trigger
inside TRY, CATCH rolling back and THROWing again -- on SQL Server 2022
(16.0.4295.3), on 2026-11-15:

| A message of | THROW 50001 arrives as | RAISERROR at 16 arrives as |
|---|---|---|
| 2,045, 2,046 or 2,047 code units | the message, whole | the message, whole |
| 2,048, or 4,019 | its first 2,044 code units and `...`: 2,047 | the same |

So a message that arrives at 2,047 may be the start of a longer one, and
only a shorter one cannot be; and the bound holds on PostgreSQL too,
which carries longer messages whole, so a deployment's sentence reaches
a person alike on both engines.

**The reason goes to the person and nowhere else.** The adapter's
sentence for the log says only that the write was declined in words for
the person; the route logs one line by the code and the form; the
audit's outcome is `declined`, the body's code, and no event has a field
for it (0011, 0023). The deployment may have written a value into it.

**The host page says whose words they are.** A notice of a declined save
or delete says the reason, verbatim, under "Not saved" or "Not deleted",
then "This reason is the database's own." -- the one sentence there the
server did not write. A reason naming a bound field goes on that field,
as any field's refusal does.

**A reason never says "not saved" over a COMMIT.** A SQL Server trigger
that ends the write's transaction and then THROWs the prefix is answered
by the batch's own error, as before (0031): `unknown-outcome`.

**And a PostgreSQL error in class 42 that arose inside a function is the
deployment's, `refused`.** Inside is the engine's own report, the error's
context field, which postgres.js calls `where`: PostgreSQL fills it under
a function's error context and sends none for an error in the statement
sent. A class-42 code with an entry of its own keeps it wherever it arose
-- 42703 `schema-changed`, 42501 `permission-denied` -- so no other
trigger's answer changes. SQL Server throws on no server number, and has
nothing to fix.

## Consequences

**What it buys.** A trigger a deployment already has can tell the person
why, on both engines, by changing the start of its message, and nothing
else in it; and a PostgreSQL trigger whose own SQL is wrong is a refusal
the page says as one, not "it may have been saved".

**What it costs.**
- Text this module never vetted reaches a person. Only its shape is
  checked: a trigger runs as the connection's account and sees every
  column, so it can put into its reason a value the person's policy
  hides, or say something untrue. The host page says the words are the
  database's own; nothing else does.
- A trigger cannot know who saved: it runs as the connection's account,
  so its reason cannot depend on the person or their roles.
- A whole message of 2,047 code units is refused with the cut ones it
  cannot be told from, and so is any longer one. The bound counts the
  prefix and the column.
- A reason is one line. One with a line break, a tab or any other control
  character is refused rather than cleaned, and the person reads the
  server's sentence.
- The reason is in whatever language the trigger wrote it in; nothing
  translates it.
- On PostgreSQL only RAISE EXCEPTION's own SQLSTATE carries one: a RAISE
  with an ERRCODE of its own keeps that code's meaning -- a check
  violation is `check-violation` -- prefix or not. On SQL Server a
  RAISERROR at a severity other than 16, and a THROW or RAISERROR of one of
  the numbers the adapter raises for itself, is `refused`.
- A read is never declined: a function a view calls that RAISEs the
  prefix is `refused`.
- A trigger whose messages already start `formancy: refused: ` -- nothing
  in this repository writes one, and nobody could have meant it for
  anything else -- now has them shown to people.
- A PostgreSQL trigger function's own SQL error is a 422, which an
  operator sees as `refused` in the audit and in no log line, where the
  500 it was came with the error's text in the server's log.
- What THROW and RAISERROR carry is measured on one SQL Server release,
  2022 (16.0.4295.3), and every suite here was run for this change on each
  engine's default image alone; the matrix's other images hold it in CI.

**What it forecloses.** Nothing: a routine an action calls, and a check
routine that returns its refusal, can answer through the same code.

## Alternatives considered

**Only from routines an action or a check binds, never from a trigger.**
A refusal from a routine the module calls is one an administrator chose,
and would not reach a person from a trigger nobody reviewed. Rejected:
the triggers that already hold this logic would stay silent, and the
change here would shrink to the class-42 fix, leaving "a write refused
with a message" for a later record.

**Never: the server's own words, always.** 0022 and 0028 as they were.
Rejected: a person refused by a rule they could satisfy is told to give
up, and an action's refusal would read "The database refused this
request" too.

**Any user error's message, with no prefix.** SQL Server's own and many
deployments' messages repeat the values typed (0017), and an existing
trigger's error would change what it says. The prefix is the deployment's
opt-in, and nobody writes it by accident.

**A code of its own per engine** -- a SQLSTATE such as `FR001`, a number
on SQL Server. Two conventions for one thing, and a number on SQL Server
is anybody's (`statements.ts`): the prefix is one spelling for both.

**A prefix matched loosely, or a reason cleaned of what it may not
hold.** Either puts in front of a person words the deployment did not
write.

**The bound at 2,047, as Microsoft's documentation reads.** Measured, a
message cut by THROW arrives at exactly that length, and was shown cut.

**The reason in the log too, for an operator.** It may hold a value the
person's policy hides from everyone else (0011, 0023); the log says that
a write was declined and of which form.
