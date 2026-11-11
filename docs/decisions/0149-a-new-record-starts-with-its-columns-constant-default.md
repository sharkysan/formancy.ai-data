# 0149 — A new record starts with its column's constant default

- **Status:** accepted; amends [0118](0118-generated-forms-move-to-spec-5-for-help-text-from-column-comments.md): a generated field carries spec 5's `default`, its column's constant one; extends [0127](0127-a-host-page-draws-a-state-field-as-the-moves-its-person-may-make.md): a state field's choice keeps the default where a create may start the record there; amended by [0150](0150-an-administrator-gives-a-field-another-starting-value.md): a text constant with a control character is read, and the field's box refuses it -- any in a one-line field, with a note, and any but a line feed or a tab in a multi-line one -- in the one reading an administrator's starting value goes through
- **Date:** 2026-11-11
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/generate/defaults.test.ts` -- `readConstant`
  reads each spelling each engine's catalog writes for a constant and no
  other: the other engine's, a function, a sequence, NULL, an expression,
  another type's literal, a PostgreSQL literal with a backslash and one
  with a control character (watched failing with every spelling read
  alike: `('draft')` was read on PostgreSQL; with the text pattern
  unanchored: `'a'::text || 'b'::text` was read as `a`; with the
  backslash and the control character read). A form over a table of
  every column kind a default is read for starts each field at the same
  answer on both engines, of the field's own type, and says so, nothing
  for `now()` and no field for the version column (watched failing with
  the codec skipped: the price started at 9.5, which its record reads
  back as 9.50; with `formValue` skipped: the text `'1'` in a number
  field); the released validator and engine take every default, and a
  fresh engine starts with each while one given a record's answers
  starts as handed in (watched failing with `formValue` skipped: the
  validator refused). A constant the codec refuses -- too long, out of
  range, a fraction for a whole number, past the decimal's scale or its
  precision -- is no default and a note in the codec's words (watched
  failing with the refusal ignored); text the column holds and the
  field's box does not is refused by the field (watched failing with the
  codec alone asked: the field started with two emoji, which `@formancy/core`'s
  `acceptsDefault` refuses); SQL Server's text past ASCII is read only as
  an N literal on an nvarchar (watched failing with the N ignored); a
  constant of another kind than its column's, an empty string, a date, a
  float and a uuid start empty and say nothing (watched failing with a
  number taken on a varchar, every number taken on a bit, the empty string
  taken, and every kind asked); `((007))` starts at 7 (watched failing
  with the digits handed on as spelled); only a field the create writes
  starts with one -- not a pinned tenant, a key the database fills, a
  column the account may not insert, a view's (watched failing with every
  field given its default); and a lookup starts empty with a note (watched
  failing with the lookup unasked). Every form the file generates is held
  to the released validator and opened by the engine; a char(1) whose
  default is a blank starts empty on both engines, since it reads back
  without its padding as an empty answer (watched failing with the empty
  answer looked for only before the codec: "Must not be empty."); a
  decimal's canonical answer at its scale's edges, a fixed-length
  column's without its padding and a varchar's blanks are each taken
  (watched failing with the codec skipped); and a note quotes its value
  (watched failing with it printed bare).
  `packages/data-core/src/policy/starting.test.ts` -- `startingDefaults`
  keeps a default only on a field the person's create takes, none where
  they may not create, and on the state field only where one of their
  moves from nothing starts a record there, a whole number by its digits
  (watched failing with the form served as published, with the moves
  unasked, and with every move asked, not only a create's).
  `packages/data-server/src/routes/runtime-defaults.test.ts`, over fake
  ports on each engine's spelling -- `GET /v1/forms/:id` serves the clerk
  both defaults, and the auditor, whose create takes no note and starts a
  ticket elsewhere, and the viewer, who may not create, none (watched
  failing with the form served as published).
  `apps/studio/src/defaults.test.ts`, over the captured snapshots on both
  engines -- the owners' order starts at draft and customer with Active
  ticked, each said, and nothing for `created_at`, the delivery's key or
  the shipment's; the order form's own account starts at draft too; the
  PostgreSQL reader, who may not INSERT the status, and the SQL Server
  reader, who cannot see its definition, start it empty (watched failing
  with the generator's defaults left out, and with every field given its
  default: the PostgreSQL reader's status started at draft).
  `apps/studio/src/preview.test.tsx` -- the Generate step says it and the
  preview draws Status at draft (watched failing with the defaults left
  out: no note; and, the note's check set aside, an empty box).
  `apps/examples/src/previews.test.tsx` -- both renderers draw Status at
  draft and Active ticked (watched failing with the defaults left out).
  `apps/host/src/session-work.test.ts`, without a server -- New record
  starts at each default and holds no work; a record read and a copy
  start as handed in, and a child's new row at each default under its
  parent (watched failing with a record's answers merged over the
  defaults, and with the parent opened as a record's answers); a new
  record's state choice starts at the served default and a saved record's
  carries none (watched failing with the choice carrying it on every
  record -- the engine refused to open the closed ticket -- and on none).
  The host's own copy of the create's decision, a field disabled starting
  empty, is gone: the served form already says it.
  `packages/data-postgres/src/parity.integration.test.ts` and
  `packages/data-sqlserver/src/parity.integration.test.ts`, against real
  servers -- `DEFAULT_PARITY`'s `spelled`, `started` and `stored`,
  declared with `covers()`: each engine's spelling of the same DDL, one
  starting answer per field on both, and a create of those answers stored
  and read back as them, as is a row the database fills itself (to be
  watched failing in CI with discovery spelling `'it''s'` in one more pair
  of parentheses on each engine, which is not read, and with a whole
  number read without its sign: -1 should start, and be stored, as 1).
  `apps/host/src/defaults.test.tsx` and `moves.test.tsx`, on both engines
  against the real server, in both renderers -- New record draws Status at
  draft and a save that leaves it sends it and stores it; a record read
  and its Duplicate draw what is stored; a person who may not read the
  status sees neither its default nor a record's; and the state choice
  starts at draft (to be watched failing in CI with the copy for a create
  dropping the defaults of the fields this person gives: New record should
  draw Status empty; with the form route serving every default to whoever
  may create: the unread status should be drawn at draft; and with the
  defaults written over a record's answers: a placed order should be drawn
  as draft).

## Context

A field whose column has a constant default -- an order's status
`'draft'`, a customer's `active` true -- started empty on a new record.
Left empty, the field was left out of the create and the database stored
its default; cleared, it was sent as NULL and stored or refused. The person
could not see which, and the form showed nothing where the record would
hold `draft`.

Spec 5 has the place for it: a field's `default`, "the answer a fresh form
starts with: a new form, a new row, a field shown again after its hiding
cleared it -- never a draft, a prefill or the server's replay, which start
as handed in", of the field's own answer type, and the engine refuses to
open a document with one its field would refuse (formancy.ai 0197).
0118 kept every spec 5 construct but `description` out of a generated form,
`default` among them.

The snapshot already holds each default as discovery spells it --
PostgreSQL's `pg_get_expr`, SQL Server's `object_definition` (0006, 0007)
-- and `generate/offers.ts` already reads one spelling of each engine's to
decide a key the database fills (0057). The captured snapshots the studio
and the examples page are built from cannot be captured again without
Docker, and hold those spellings.

## Decision

**The generator starts a field at its column's constant default**
(`startWithDefaults`, `packages/data-core/src/generate/defaults.ts`), a
field a create writes and only that: never a pinned column, a key the
database fills (0056), a column the account may not insert, a view's, a
version column (no field) or a lookup.

**A constant is read per engine, from the spelling the snapshot holds**
(`readConstant`), and nothing is added to the snapshot. PostgreSQL: `true`
and `false`; an integer or a decimal bare; one quoted and cast to
`integer`, `bigint`, `smallint` or `numeric`, as a negative or a bigint is;
text quoted, its quotes doubled, cast to `text`, `character varying` or
`bpchar`, without a backslash, whose meaning hangs on
`standard_conforming_strings`. SQL Server: a number in two pairs of
parentheses, `((-1))`; text in one, `('draft')`, N before a national
literal; a bit's `((1))` and `((0))` on a yes/no column. Text with a
control character is not read on either. Anything else -- a function, a
sequence, NULL, an expression, a date, an instant, a time, a float, a
uuid, a cast with a modifier -- is no default: no default beats a wrong
one.

**Through the column's codec, as a record holding it is read back**: the
constant is handed to `codecFor(column).parse` as the stored value, and
`formValue` makes it the generated control's answer, so a decimal starts
at `9.50`, a whole number as a number, a nullable yes/no as its option. A
constant the codec refuses -- too long, out of range, a fraction for a
whole number, past the scale -- is no default, and so is text the column
holds and the field's box, which counts UTF-16 code units, does not. SQL
Server's text past ASCII is read only as an N literal on an nvarchar:
another is read or written in a code page the snapshot does not record.

**Each default taken or refused is a note**, its value quoted so blanks
are seen: "Starts with the column's default, “draft”."; "Starts empty:
the column's default, “toolong”, is not an answer the field takes (at most
3 characters), so the database fills it when a create leaves the field
out."; and a lookup's: "the default of country_id, “CH”, is left to the
database ... the one a default names may be one this person may not
choose". An answer that reads back empty -- `''`, or a char(1)'s blank
without its padding -- is no default and no note: it is the field as it
starts, and spec 5 refuses an empty default.

**Each person is served the defaults their create takes, and no other**
(`startingDefaults`, `packages/data-core/src/policy/starting.ts`, which
`GET /v1/forms/:id` serves the form through): a default on a field
`writable.create` names (0117), none where the person may not create,
and on the state field (0127) only where one of their moves from nothing
starts a record in it. A renderer submits a field it draws disabled, so a
page that leaves out only the fields neither write accepts would send any
other default untouched, and the create would be refused (0122). Decided
once, for every page on `@formancy/data-client`.

**The host page starts New record and a child's new row as a fresh form**
(`apps/host/src/session.ts`): New record with no answers, so the engine
fills each served default; a child's new row through `@formancy/core`'s
`withDefaults`, its parent over the defaults (`start`). A record read, a
Duplicate, a next version and a form discarded back to are opened with
their answers and start as handed in. A new record's state choice starts
at the served default; a saved record's carries none, since the record
opens at the state it holds and a default the choice does not offer would
stop the engine opening it (`apps/host/src/moves.ts`).

**A stored form is not changed.** A bundle's base is compared with the
generator at every write and never on read (0030): a form published before
gains its defaults when it is generated again or published again; a spec 3
version never has one.

## Consequences

**What it buys.** A new record shows what a save of it stores, and the
administrator reads in the Generate step what each field starts with and
what was left to the database, before anything is published.

**What it costs.**
- A studio session, a draft or an import holding a base generated before
  this release is refused at publish, at a draft's submit and approval and
  at import, until it is generated again, as every generator change has
  been (0030). A form published before starts as it did until then.
- A default is sent. A create from this release writes the column with
  its default where it left it out, so a trigger or a rule that tells "left
  out" from "given" sees "given"; and a default changed in the database
  after publication is still the old one on the form, sent and stored,
  until the form is generated again. Drift review names it, as "its default
  changed"; the runtime does not refuse a create for it.
- Clearing a field that started at its default sends it empty: NULL on a
  nullable column, "A value is required." on one that is not, where before
  an untouched field was left to the database.
- The spellings read are those the record names. A PostgreSQL default with
  a backslash, a SQL Server literal past ASCII but an N literal on an
  nvarchar, a date, an instant, a time, a float and a uuid start empty, as
  before. A SQL Server default spelled as text on a whole-number column,
  `('5')`, is not read, though the database stores 5; what PostgreSQL's
  catalog writes for the same DDL is not measured -- `5`, by how it
  deparses a constant, which would be read -- so one DDL may start
  differently on the two engines.
- A lookup never starts at its column's default, and a field this person
  does not give on create, or a state a create may not start the record
  in, starts empty: the database fills it.
- The form `GET /v1/forms/:id` serves differs from person to person in
  its defaults, and a page that draws its own choice for a saved record's
  state leaves the field's default out, or the engine refuses to open it.
- Nothing in the studio changes or clears a default. Presentation could
  carry one later, over the generated base (0030); until then a default is
  changed in the database and the form generated again.
- A host page's renderer must read spec 5's `default`: `@formancy/*`
  0.13.0's do, and which earlier release first did is not read here; one
  that does not refuses a form carrying one.
- Each engine's spelling is held on the images the adapters' suites run,
  through `DEFAULT_PARITY`, and on no other release.

**What it forecloses.** Nothing.

## Alternatives considered

**A constant in the snapshot, read by each adapter.** A `defaultValue` the
adapter parses from its own catalog would put the reading where the
engines differ. It changes the snapshot's contract and its fingerprint, so
every captured snapshot -- the studio's, the examples page's -- would have
to be captured again, which needs Docker, and every stored bundle's
snapshot would lack it. `offers.ts` already reads the spelling per engine
in data-core (0057), and two readings of one decision in two adapters are
what the core exists to prevent.

**Take every default, a function's too.** `now()` and `newid()` are
evaluated at the insert; a form that showed a value for them would show a
time or a key the record does not get, and an expression's value is not
known without the database. A field the generator cannot read starts
empty, which is what it did.

**A studio control to change or clear a default.** It belongs to
presentation, a patch over the generated base (0030), and is a change of
its own: what a default means to a person filling the form in is the
administrator's to decide once the column's is shown.
