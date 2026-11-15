# 0152 — A column whose values a check lists is a select of them

- **Status:** accepted; extends [0009](0009-generation-is-deterministic-and-says-what-it-chose.md): a text or whole-number column one enforced, validated check lists the values of is a select of exactly them, and a list not drawn says why; extends [0010](0010-drift-is-classified-against-the-bindings.md): a published select is compared with the checks that list its column -- a value an enforced list leaves out tightens the column, and one every validated list names that the select does not, or the check gone, stopped, unvalidated or no longer a list it reads, is a field the column outgrew, for review; extends [0005](0005-one-fixture-written-twice.md): the comparator holds data-core's reading of each check, as each engine spells it, to the model's list; amends [0127](0127-a-host-page-draws-a-state-field-as-the-moves-its-person-may-make.md): a state field generated as such a select is drawn as its moves too; extends [0149](0149-a-new-record-starts-with-its-columns-constant-default.md): a default, or a starting value (0150), the list does not name is none
- **Date:** 2026-11-15
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/generate/check-lists.test.ts` -- `readCheckList`
  reads each spelling each engine writes for one column compared with
  literals and no other: the captured snapshots' ck_order_status on both,
  a text, char(n) and varchar list, a list of one, OR on PostgreSQL and
  nested OR on SQL Server, whole numbers bare, quoted and cast, and in
  parentheses, an integer in a bigint's list cast to bigint on PostgreSQL
  and one past int written with a point on SQL Server, a doubled quote, a
  comma, blanks and text past ASCII in a value, an empty one, a reserved
  word, a quoted name and a doubled bracket; and NOT IN, a range, a
  comparison, LIKE, a function, another column, NULL, two columns, an
  AND, a COLLATE, a cast with a modifier or not named, text or a decimal
  cast to a bigint, a decimal, a point with digits after it, an array
  literal, a backslash, the other engine's spelling, other spacing, a
  trailing word and an unclosed quote or bracket as no list (watched
  failing with the reading not held to the whole text: a trailing OR was
  read; with the backslash read; with an OR of one term read; with two
  columns joined as one; and with the bigint spellings unread, as the
  parity suites first measured them: no list).
  `packages/data-core/src/generate/listed.test.ts` -- ck_order_status as
  each engine spells it is one select of draft, placed and shipped, its
  binding naming the check, its note the values (watched failing with
  the values kept in catalog order: SQL Server's select offered shipped
  first); whole numbers by value as canonical text, a value read back
  alike once; a list not validated, not enforced, listed twice, with a
  value the column cannot hold or with an empty value is no select, and
  says why (watched failing with
  the check's state ignored: a NOT VALID list was a select); no other
  check of the table is consulted, readable or out of sight (watched
  failing with a check out of sight refused: the list was a box); a number on
  text, text on a whole number, a decimal, a yes or no, SQL Server text
  past ASCII but an N literal on an nvarchar, and a list over another
  column are none, said nowhere; a whole number's answer, a bigint past
  2^53 included, is its text through `formValue`, `canonicalValue`,
  `storedValue`, the planner's `columnAnswer` and the engine, which
  refuses the number (watched failing with the whole-number shape kept: the
  number 2); a nullable list is a select that is not required and takes
  NULL; a default the list names starts the field, and one it does not is
  none, said, as an administrator's starting value is refused (watched
  failing with the options left unasked: both were taken); two runs give
  the same bytes. `packages/data-core/src/drift/listed.test.ts` -- the
  same values respelled change nothing the field rests on (watched failing
  with the list compared as its expression); a value gone stops writes of
  the field in review and not in the runtime's verdict (watched failing
  with review not reading the list: nothing blocked); a value added is for
  review and stops nothing (watched failing with it read as tightened);
  both are two changes; the check gone, not enforced, not validated or no
  longer a list is a field the column outgrew, for review (watched failing
  with only the values compared: a dropped check said nothing about the
  field), and one replaced by an expression the reader does not take says
  that whether it takes every offered value is not known (watched failing
  with the message as it was); a second list that leaves out an offered
  value, NOT VALID included, stops writes (watched failing with it read as
  the column held to no list: review only); lists that between them leave
  values out are named together, a disabled one not; the rows are held to
  what every validated list names; a list in sight that leaves out an
  offered value stops writes beside a check out of sight (watched failing
  with every listed field left to the gap once any check was), and
  otherwise a check out of sight is left to the gap; a field the form only
  shows is noted; a field published as a text box rests on no list.
  `packages/data-fixtures/src/conformance.test.ts` -- a list read
  otherwise than the model says, a spelling the reader does not take, an
  expression out of sight and a list where the model says none are each a
  disagreement (watched failing with the list left uncompared).
  `apps/examples/src/snapshot.test.ts` and `apps/studio/src/fixtures.test.ts`
  -- the committed captures' ck_order_status, as PostgreSQL 17.11 and SQL
  Server 2022 wrote it, read as the model's list (watched failing with a
  varchar array's cast to text[] unread: PostgreSQL's read as no list).
  `packages/data-fixtures/src/check-lists.test.ts` -- CHECK_LIST_PARITY
  met by data-core from each engine's documented spelling of its DDL.
  `apps/examples/src/previews.test.tsx` -- both renderers draw Status as a
  choice of draft, placed and shipped (watched failing with the lists left
  unread: a text box in both). `apps/studio/src/preview.test.tsx` -- the
  preview draws Status at draft in its choice. `apps/host/src/session-work.test.ts`,
  run here under a copy of `apps/host/vitest.config.ts` without its
  `globalSetup`, which was not kept -- a state field generated as a select
  of listed values is drawn as its moves, a whole number's too (watched
  failing with only a text box drawn as the moves: every listed value was
  offered). `packages/data-postgres/src/parity.integration.test.ts` and
  `packages/data-sqlserver/src/parity.integration.test.ts`, against real
  servers -- CHECK_LIST_PARITY's `read`, `generated`, `stored` and
  `narrowed`, declared with `covers()`: each engine's spelling of the same
  DDL read alike, one form, a listed value of every select stored and read
  back as given, and a value gone from the list blocking writes in review
  while the runtime sends them and the database refuses it with a check
  violation (run on postgres:17-alpine, 17.11, and
  mssql/server:2022-latest, 16.0.4295.3, on 2026-11-15, where `read` and
  `generated` were watched failing on both with the bigint spellings
  unread: ck_listed_big no list; to be watched failing in CI with the
  array's cast left unread, status and the other varchar lists then no
  list on PostgreSQL, and with the options kept in catalog order, status
  then offering shipped first on SQL Server). `packages/data-server/src/e2e.integration.test.ts`
  -- the journey's compatible change, which adds cancelled to
  ck_order_status, is two things to review and stops nothing (computed
  here over the captured snapshots of both engines; to be run in CI).

## Context

A column constrained by a CHECK that lists its values -- the fixture's
`status in ('draft', 'placed', 'shipped')` -- was generated as a free text
field. A person typed a value, and the database refused anything else on
save, as a check violation the runtime translates. Plan section 8 maps an
enum or a simple finite-value check to a select only when the allowed
values are proven.

The snapshot already holds each check's expression as the catalog writes
it (0006, 0007), and neither engine writes it as it was typed. PostgreSQL's
`pg_get_expr` deparses `status in (…)` on a varchar as
`((status)::text = ANY ((ARRAY['draft'::character varying, …])::text[]))`;
SQL Server stores it as `([status]='shipped' OR [status]='placed' OR
[status]='draft')`, back to front. Both are in the captured snapshots the
studio and the examples page are built from, as their servers wrote them.

formancy's select refuses an answer no option offers, in the one function
the browser and the server's replay both run (formancy.ai 0076).

## Decision

**A text or whole-number column whose values one check lists is a select
of exactly them** (`listedFor`, `packages/data-core/src/generate/listed.ts`):
one check, enforced and validated, every value one the column's codec
reads back as itself and none empty. Anything else keeps the column's
own control, and a list not drawn for a reason a person would want says
so in a note: not validated -- a row from before it may hold another
value, which a select could not show --, not enforced, listed by two
checks, with a value the column cannot hold, with an empty value, which
a select cannot tell from no answer. Two lists are not intersected: the
field would rest on two checks for a schema that says one thing twice,
and it stays the box it was. No other check is evaluated, readable or
out of sight: one that refuses a listed value -- `status <> 'shipped'`
beside the list -- leaves the select offering it, and the database
refuses it on Save, as it refuses a typed value. A refusal for a check
out of sight alone would be a rule for a case neither engine produces:
PostgreSQL shows every check's expression to every role, and SQL Server
hides a table's checks together -- VIEW DEFINITION is granted on the
table and refused on a constraint, measured on 2022 (16.0.4295.3) on
2026-11-15 -- so the list is out of sight with it.

**The list is read per engine from the spelling the snapshot holds**
(`readCheckList`, `generate/check-lists.ts`), as 0149 reads a default, and
nothing is added to the snapshot. A cursor walks the text and takes one
column compared by `=` with literals, joined by OR, in the spelling each
server writes, and nothing else; it never evaluates, executes or builds
SQL from what it reads.

| | PostgreSQL (`pg_get_expr`) | SQL Server (definition) |
|---|---|---|
| A list | `(c = ANY (ARRAY[l, …]))`, a varchar's `((c)::text = ANY ((ARRAY[l, …])::text[]))` | `([c]=l OR [c]=l …)`, nested parentheses too |
| One value | `(c = l)`, a varchar's `((c)::text = l)` | `([c]=l)` |
| OR of those | `((t) OR (t) …)`, nested as written | as a list |
| A column | `name`, `"quoted ""name"""` | `[name]`, `[gr]]oup]` |
| Text | `'…'::text`, `::character varying`, `::bpchar`, quotes doubled, no backslash | `'…'`, `N'…'`, quotes doubled; past ASCII only N on an nvarchar |
| A whole number | `7` bare; `'-1'::integer`, `::bigint`, `::smallint`; in a list of bigint, an integer cast to it, `(0)::bigint`, `('-1'::integer)::bigint` | `(7)`, `(-1)`; past int, which T-SQL types as numeric, with a point, `(9007199254740993.)` |

**The options are the values as a record holding each reads back**,
through the column's codec -- a char(n)'s without its padding, a whole
number's canonical digits as text, a bigint past 2^53 among them -- each
its own label, in a stated order: a whole number's by its value, text by
codepoint. Not the catalog's: SQL Server writes an IN list back to front
and an OR as typed, so the order a person wrote is one neither engine can
say for both. A NOT NULL column without a default is required; a
nullable one is not, and the select's own empty choice is NULL, which a
CHECK passes.

**The binding says so** (`listed: { check, values }` on a column
binding), and a select's answer is the value itself, a whole number's
text too (`shapeOf`, `records/answers.ts`), so the planner, a record's
answers, the export and a starting value read it alike. A default the
list does not name, or a starting value (0150), is none, said in the
generator's words (`answerTaken`, `generate/defaults.ts`): the engine
refuses to open a form whose default no option offers.

**A state field over such a column keeps its moves** (0112, 0127): the
host draws a select of listed values as the moves its person may make, as
it draws a box (`apps/host/src/moves.ts`), so the clerk is offered where
the record may go, not every value the check lists.

**Drift review compares the published select with every check that
lists its column** (`drift/listed.ts`), each read as `listedFor` reads one
(`enforcedLists`), so review and generation cannot disagree about what a
list holds. The database refuses on a write what any enforced list leaves
out, a NOT VALID or WITH NOCHECK one included, and every row holds what
every validated list names:

| Against a published select | For the form |
|---|---|
| The same values, spelled otherwise | nothing; the check's own change is noted |
| A value an enforced list leaves out -- the check narrowed, or another list beside it | `column-tightened`: stops the writes the field gives, as a shorter length does |
| A value every validated list names that the select does not | `column-outgrew-field`, review: the select cannot offer it |
| The check gone, not enforced, not validated | `column-outgrew-field`, review |
| The check no longer a list the reader takes, a narrower expression included | `column-outgrew-field`, review, saying whether it takes every offered value is not known |
| A check out of sight | the gap's to say, as for every check; a list in sight that leaves out an offered value still stops writes |

A field the column outgrew stops nothing: 0010 stops writes where the
published control cannot hold the column because a save would write
back what the control made of a value, unseen, and the engine refuses an
answer the select does not list instead. A record holding such a value
is refused on Save until a listed one is chosen; generating the form
again offers it. A replacement the reader does not take may refuse an
offered value, or not, and the reader cannot say which: it is review's,
and the database refuses such a value with its own error, as it refuses
one any changed check refuses, which 0010 notes and stops nothing for.

**The runtime compares no check** (0041): a write it plans goes to the
database, which refuses a value its check no longer lists, with its own
error, as before.

**Both engines agree on the fixture.** The model gives each check the
list data-core must read out of its spelling, `null` where it is none,
and the comparator reads each engine's through `readCheckList`
(`packages/data-fixtures/src/conformance.ts`), so the adapter suites and
the committed captures are held to it; CHECK_LIST_PARITY holds the near
misses on both engines.

## Consequences

**What it buys.** A person picks a status the database takes rather than
typing one it refuses on save, on both engines, from the same DDL; the
Generate step says which check a select came from and why a list was not
drawn; and a change to the list is in drift review before a save meets
it.

**What it costs.**
- A check spelled otherwise than the table above stays a text box: a
  function of the column, a range, NOT IN, LIKE, a COLLATE, an array
  literal such as `= ANY ('{a,b}')`, a cast data-core does not name, a
  list holding NULL -- which admits every value --, a decimal, a date or a
  uuid list, a PostgreSQL value with a backslash, whose meaning hangs on
  `standard_conforming_strings`, and on SQL Server a value past ASCII but
  in an N literal on an nvarchar, which it reads in a code page the
  snapshot does not record.
- An unvalidated or disabled list, two lists on one column, one holding
  an empty value or a value the column cannot hold: the text box, with a
  note.
- No other check of the table is consulted: one that refuses a listed
  value, readable or out of sight, leaves the select offering it, and
  the database refuses it on Save as a check violation.
- A published list replaced by an expression the reader does not take is
  for review and stops nothing, even where the new check refuses a value
  the select offers: such a value is refused by the database on Save.
- Each value is labelled as the column holds it, `in_transit` and not
  "In transit"; an administrator relabels a state field's states (0129)
  and no other select's. A presentation could carry labels later.
- The options are in a stated order, not the one the check was written in.
- What a check admits is the database's comparison, not the text the
  reader reads: SQL Server compares under the column's collation and pads
  trailing blanks, so under a case-insensitive collation a row may hold
  `DRAFT`, or `draft ` with a blank, which `status in ('draft', …)`
  admits and the select does not list; PostgreSQL under a nondeterministic
  collation likewise. Such a record is refused on Save until a listed
  value is chosen. Read from each engine's comparison rules, not measured
  here.
- The server's planner does not check the list: an answer it does not
  name, from a client other than formancy's engine, reaches the database,
  which refuses it as a check violation.
- The policy's moves are not held to the list: a move to a state the
  check does not name is offered by the host, and refused by the
  database on Save.
- The studio's starting value of such a field is typed, not chosen, and
  refused when the list does not name it; the host's filter line takes a
  listed field's value as typed text.
- A form published before this release keeps its text box until it is
  generated again; a studio session, a draft or an import holding a base
  generated before it is refused at publish, at a draft's submit and
  approval and at import until it is, as every generator change has been
  (0030). Where its table's check names a value since added, review says
  so as a field the column outgrew, and a form generated again offers it.
- The spellings read are measured on one release of each engine,
  PostgreSQL 17.11 and SQL Server 2022 (16.0.4295.3), on 2026-11-15: the
  captured snapshots' ck_order_status, and each check of the parity
  suites' DDL, which those suites hold on the images they run and on no
  other release.

**What it forecloses.** Nothing: PostgreSQL's enums and domains over a
list are a later record, read the same way.

## Alternatives considered

**Each adapter reads its own engine's list and carries it on the check in
the snapshot.** The shape that keeps every spelling in its engine's
adapter: an adapter translates, data-core decides. Rejected for 0149's reasons, which apply unchanged: a
`listed` property changes the snapshot's contract and its fingerprint, so
every captured snapshot -- the studio's six, the examples page's -- would
have to be captured again, which needs Docker, and every stored bundle's
snapshot would lack it, so a form generated again from its stored
snapshot would differ from one generated from a new one. The reading is
one decision per engine either way; in data-core the committed captures
already hold each engine's real spelling, and the comparator reads them
through the same function the generator does. What it would have bought:
PostgreSQL's `conkey` would name the columns a check reads from the
catalog. The reader's column is only ever matched with the table's own
columns, so a name it misread lists nothing.

**The intersection of two lists on one column.** It is what the database
admits, and the field would rest on two checks a review would compare
apart, for a schema that says one thing twice.

**The order the catalog gives.** The same DDL would be two forms, one per
engine.

**A select for a NOT VALID or WITH NOCHECK list.** Its rows may hold a
value it does not list, which a select could not show.

**A value added stops writes, as 0010's rule for a field the column
outgrew reads.** Its reason is a save that writes back what the control
made of a value; a select refuses the value instead (formancy.ai 0076).

**The planner refuses an answer the list does not name.** The database
refuses it already, and an update that sends back a record's value added
after publication would be refused by the planner and taken by the
database.
