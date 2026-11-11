# 0150 — An administrator gives a field another starting value

- **Status:** accepted; extends [0030](0030-presentation-is-a-patch-over-the-generated-base.md): a field's presentation may set its starting value, and a rebase carries it by what the field stands for; amends [0149](0149-a-new-record-starts-with-its-columns-constant-default.md): a text constant with a control character is read, and the field's box refuses it as it refuses a starting value, one reading
- **Date:** 2026-11-11
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/presentation/starting-value.test.ts` -- a value
  replacing the column's default and one added where there is none (text,
  unbounded text, a whole number, a yes or no, an exact decimal) each
  derive exactly their entry, applying it gives the edited form back, and
  the released engine starts a fresh form there (watched failing with the
  starting value refused as before: "only a field's label, help text ...
  are presentation"); taking the column's default away is refused on
  derive and on apply, saying why (watched failing with removals taken as
  help text's are: status derived `default: null`); a value equal to the
  base's, one over a spec 3 base and one of no starting value's shape are
  refused (watched failing with the base's value unasked: "placed" was
  taken); a lookup, a field the create does not write and a date are
  refused each with its reason (watched failing with the kind unasked:
  order_date took 2026-01-01); a value the field does not take is refused
  in its column's codec's words or its box's -- a control character a
  one-line box draws otherwise among them -- and one spelled otherwise
  than it reads back with the spelling to give, a number named as one
  (watched failing with the spelling unasked: amount took 9.5; with the
  values printed alike: "reads “7” back as “7”"); every value
  `applyPresentation` takes over a battery of candidates, control
  characters among them, is one the released validator and
  `acceptsDefault` take, and a fresh form starts at it (watched failing
  with the box's length unasked: the engine refused ab😀; with the control
  check left to the constant's reader: a tab was taken for a one-line
  box); every field the generator starts at its column's constant, of every
  kind, takes that start (watched failing with 0149's reader taught a
  float alone: its starting value was refused as a floating-point number);
  `startingValue` gives the canonical answer (watched failing with the
  value handed back as given); a regeneration keeps a value, keeps the
  person's over a changed column default and says so, drops one the
  column's default now agrees with, and reports a value whose column is
  gone (watched failing with the value left out of the carried
  overrides); a value follows its column to a renumbered key (watched
  failing with it carried only where the key stayed); one whose stored
  value the new field takes is carried in its new spelling and said --
  7 for a bigint, true for a nullable yes or no, a scale grown -- and one
  it refuses is dropped and said (watched failing with every new spelling
  dropped: "now reads it back as “7”"; with every value carried: the
  rebase threw); on a state field a value no create starts a record in is
  refused, naming the states one does (watched failing with the moves
  unasked); and a publish takes exactly the starting states the form
  route serves (watched failing with the two readings apart: the publish
  took the boolean true for a state spelled “true”).
  `packages/data-core/src/generate/defaults.test.ts` -- a constant a
  one-line box draws otherwise is no default, and a note says why, and a
  line feed starts a multi-line field (watched failing with the reading
  left to the constant's reader: no default and no note).
  `packages/data-server/src/routes/admin.test.ts` -- a bundle carrying a
  starting value publishes and is served with it; one whose form starts
  elsewhere than its presentation says, one whose value the field does
  not take, one starting the state field where no create starts and one
  taking a default away are refused, and nothing is written (watched
  failing with the value left out of `applyPresentation`: 201 characters
  were refused only as a form that is not its base with its presentation
  applied; with the state's fit left out of `storable`: lost was stored;
  and with a removal taken as help text's: refused only as "the base has
  no starting value to remove").
  `apps/studio/src/starting-value.test.tsx`, against the real server
  behind a fake fetch -- each field says what the generator started it
  with, a box takes another value, set as it reads back (9.5000 for 9.5),
  and the preview and the publish start there (watched failing with the box
  left out of the step); emptied, a box whose column has a default keeps
  it and says why, and Use the column's default gives the column's back by
  keyboard, the keyboard then on the box (watched failing with an emptied
  box taking the default away: nothing was refused; without the focus: it
  fell to the page); a value the field does not take is said in the step's
  live status and under its box, the box marked invalid, and set nowhere
  (watched failing with the value handed to the session unread: "Must be
  a number." alone; with the refusal said under the box only: the status
  said nothing); a yes or no with a default offers its two answers and no
  None (watched failing with the choice handed on as its option's text:
  Not ticked set nothing; with None still offered: it was listed first);
  and a state field takes only a state a create starts in (watched failing
  with the moves unasked).
  `apps/studio/src/presentation.test.tsx` -- every control of the step is
  still one that cannot break a binding, a starting value's among them
  (watched failing before it counted them: six Starting value boxes).
  `apps/studio/src/regenerate.test.tsx` -- a value kept over a changed
  column default offers the generator's, which chosen publishes no
  override (watched failing with the default's both-changed offered as a
  label is).
  `apps/host/src/defaults.test.tsx`, on both engines against the real
  server, in both renderers -- New record starts at the values chosen over
  the base, Status at placed over its column's draft and Group at Online,
  and a save sends and stores both (to be watched failing in CI with
  `applyPresentation` leaving a value unset, in data-core's dist the
  server and the plane both apply: Status should be drawn at draft and
  Group empty).

## Context

Since 0149 a field a create writes starts at its column's constant
default, and the generator says so in a note. What that default means to
the people filling the form in was the database's to say: a column that
defaults to `draft` for the application that inserts rows may be one an
administrator wants a new order to start elsewhere, and a column with no
default one most people answer alike. 0149 named it as a cost, and as an
alternative not taken: a control to change a default belongs to
presentation, a patch over the generated base (0030), and is the
administrator's to decide once the column's is shown.

Spec 5's `default` is the answer a fresh form starts with -- a new form, a
new row, a field shown again after its hiding cleared it -- and never a
draft, a prefill or the server's replay, which start as handed in
(formancy.ai 0197). The engine refuses to open a document whose default its
field would refuse. `@formancy/core`, where that check lives, is a
development dependency of data-core and no dependency of the server. A
create leaves out a field its person left empty (`planCreate`), and the
database stores the column's default.

## Decision

**A field's starting value is presentation.** `FieldPresentation` gains
`default`: a value that replaces the column's default or adds one where the
base has none, present only where it differs from the base's. It is a
value only: a field left empty is left out of a create, which stores the
column's default, so a starting value that took the column's away would
show nothing where the record will hold the default -- what 0149 ends.
`null` is refused on apply, and a default removed in the edited form on
derive, each saying why. `PRESENTATION_VERSION` stays 1: a presentation
without it reads as before.

**One reading decides which value a field takes**
(`packages/data-core/src/presentation/starting-value.ts`), the one 0149's
generator reads a column's constant by (`givenStart` and `storedStart`,
beside `startingAnswer` in `generate/defaults.ts`): the value as the column
stores it, through the codec of the binding's type and nullability
(`codecForType`, the column itself not being at hand where a presentation
is applied) and `formValue`, and only where the field's box draws it as the
column holds it -- no control character in a one-line box, none but a line
feed or a tab in a multi-line one -- and holds it, in UTF-16 code units. A
value spelled otherwise than a record holding it reads back -- `9.5` in a
numeric(18,4) -- is refused with the spelling to give, so a presentation
has one; the studio sets that spelling. `applyPresentation` refuses by it,
a rebase carries by it, and the studio reads every value by it before the
session sees one. It does not ask the engine: a test holds every value it
takes to formancy's validator and `acceptsDefault`. Nor does it ask the
database: a CHECK constraint, a trigger, a foreign key, and a character a
SQL Server code page lacks are the save's to refuse, as they are for any
answer.

**A starting value is offered for the kinds 0149 reads a column's constant
of** -- text, a whole or exact number, yes or no -- one list
(`startsAtConstant`, the generator's readers), whose starting answers
0149's cases create, store and read back on both engines. A lookup takes
none -- its answer is a record, and the record a value names may be one the
person may not choose -- nor does a field the create does not write, nor a
date, a time, an instant, a float or a uuid, for which no case here creates
and reads back a starting answer. Each is refused with its reason, and the
studio says that reason in the field's row.

**On the policy's state field a starting value is a state a create starts a
record in** (0112's move from nothing), refused at publish beside the
state labels (`startingStateProblems`, asked in `storable`), since only the
policy knows the states, by `startsAt`, the reading the form route serves
a default by (`startingDefaults`); the studio asks the same function. A
column's own default on the state field is not asked about, as 0149 left
it.

**A rebase carries it by the column**, as help text: it stands while the
generator starts the field otherwise; kept over a column default that
changed too it is said (`both-changed`, `property: 'default'`); one whose
field is gone is dropped and said (`field-gone`). A value whose stored
value the new field takes, held in another spelling -- the number 7 as the
text “7” once the column is a bigint, true as “true” once it is nullable, a
scale grown -- is carried so and said (`default-respelled`). One the new
field refuses -- its column holds less or another kind, a create no longer
writes it -- is dropped and said (`default-dropped`) in the words a
publish would refuse it in.

**The studio edits it** in the Presentation step, under each field's help
text: "Starting value of status", with what the generator noted --
"Generated: Starts with the column's default, “draft”." -- a box for text
and numbers and, for a yes or no, its two answers. Empty or None is
offered only where the column has no default, meaning none chosen over it;
emptied where it has one, the box keeps what it had and says why. Use the
column's default gives the column's back. A refused value is said in the
step's live status and under its control, which is marked invalid, and
nothing is set. The state field takes a box too, its states named in the
refusal. A value kept over a changed default offers the generator's in the
carried panel, as help text does.

**The fit is asked again on every read.** `applyPresentation` is what a
read checks a stored form against (0019, 0030), and it asks the codec and
the box; the fit is not moved to the write alone, which would take a
second way of applying a presentation, nor stripped at serve time, which
would put a decision in the runtime.

**Nothing else changes.** The server holds every write to its base with
its presentation applied (0030), so a bundle carrying a starting value
publishes and one whose form disagrees is refused; the host page draws
spec 5's `default` already; and `startingDefaults` still keeps a default,
the administrator's as the column's, only where this person's create takes
it (0149). A published form gains nothing until an administrator edits it.

## Consequences

**What it buys.** The administrator decides what a new record starts with,
in the step where they decide what it reads, from what the column says,
and a regeneration after the database's default changes keeps their
choice and tells them.

**What it costs.**
- A column's default is never taken away: a field whose column has one
  starts at it or at another value, never empty, and a yes or no with a
  default offers no None.
- A date, a time, an instant, a float, a uuid and a lookup take no
  starting value, though spec 5 would hold one: none has a case here that
  stores a starting answer and reads it back.
- A starting value is a constant, as spec 5's `default` is: nothing starts
  at today, at the signed-in person's attribute or at another field's
  answer.
- A starting value is in one language and not translated, as a label's
  words are.
- It is sent as the person's answer, as 0149's default is: a trigger that
  tells a column left out from one given sees one given.
- The database is not asked: a value a CHECK constraint refuses, or text
  with a character a SQL Server code page lacks, is taken, and refused or
  stored otherwise by the save that sends it.
- A value is spelled as a record holding it reads back: one typed `9.5`
  starts the field at `9.5000`, which the studio says.
- On the state field a value must be a state a create starts in: a policy
  that no longer moves from nothing to it is refused at publish until the
  starting value is changed, and the studio names the states only when it
  refuses one, the box offering no list of them.
- A value the regenerated field refuses is dropped, and said; one it
  stores the same is carried in its new spelling, and said.
- The fit is asked on every read of a stored version, so a later release
  whose codec or box refuses more stops serving a version holding a value
  it now refuses until that version is published again; a base's own
  default has no such check on read (0030).
- A server of a release before this one refuses a version whose
  presentation sets a starting value, as `/fields/N/default is not a
  property of a field presentation`, so a deployment rolled back serves
  such a version only once an earlier one is restored there.
- A version published before gains nothing: the presentation it was
  published with is the one it keeps.
- A text constant with a control character is now read (0149's amendment):
  a one-line field refuses it with a note, and a multi-line one starts at
  a line feed or a tab.

**What it forecloses.** Nothing.

## Alternatives considered

**Taking the column's default away.** A presentation's `null` over the
base's default, so a new record starts the field empty, was the first
shape of this, as help text is removed (0119). A field left empty is left
out of a create, and the database stores the column's default: the field
would be drawn empty and the record hold `draft`, which the person never
saw -- on every kind, and on a NOT NULL yes or no drawn unticked and
stored true. A default that should not be the database's is changed in the
database, or replaced here by another value.

**A policy setting per role.** A starting value per role would put what a
field shows in the policy, which says who may do what; the form route
already serves each person only the defaults their create takes, and a
second set of values keyed by role would be a second presentation the
studio, the rebase and the drafts' review would all have to carry.

**A default in the request the generator reads.** The generation request
is what a regeneration asks for again and what every write checks the base
against (0030); a value in it would make the base say something the
database does not, and a regeneration could no longer tell the column's
default from the administrator's, which is the difference the carried
panel shows.

**A control for every kind spec 5 takes a default on.** A date's box, an
instant's and a float's would each be a value no case here creates and
reads back, and a lookup's would be a record token chosen for every person
whatever they may choose. Offered later, each comes with its case.

**The engine's own check, `acceptsDefault`, in data-core.** It would be
formancy's decision rather than a reading of the codec, but `@formancy/core`
would become a run-time dependency of data-core, the server and every
page installing `@formancy/data-client`, for one check; and it does not
know the column, which refuses more than the box (0008's direction). The
test that holds the reading to the engine is what says when the two
disagree.

**Dropping a value the regenerated field holds in another spelling.** It
kept the person's spelling, at the price of a value lost for a bigint or a
nullable column that stores it the same, with a message nobody could act
on.

**The fit asked at the write alone.** `storable` could ask it and a read
apply a starting value unasked, or the form route strip one that no longer
fits; either is a second way of applying a presentation, which a read and
a write would then disagree on. The cost is said above instead.

**A select of the states for the state field.** It would offer only states
a create starts in, but a column default no move reaches would be a value
the select cannot show, and the policy can change after the step is left;
the box and the refusal that names the states say both.
