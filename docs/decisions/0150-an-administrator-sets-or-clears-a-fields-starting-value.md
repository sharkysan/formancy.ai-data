# 0150 — An administrator sets or clears a field's starting value

- **Status:** accepted; extends [0030](0030-presentation-is-a-patch-over-the-generated-base.md): a field's presentation may set or remove its starting value, and a rebase carries it by what the field stands for; answers a cost of [0149](0149-a-new-record-starts-with-its-columns-constant-default.md): the studio changes or clears a column's default
- **Date:** 2026-11-11
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/presentation/starting-value.test.ts` -- a value
  replacing the column's default, one added where there is none (text,
  unbounded text, a whole number, a yes or no, an exact decimal) and a
  removal each derive exactly their entry, applying it gives the edited
  form back, and the released engine starts a fresh form there (watched
  failing with the starting value refused as before: "only a field's
  label, help text ... are presentation"); a value equal to the base's, a
  removal of none, a value over a spec 3 base and one of no starting
  value's shape are refused (watched failing with the base's value
  unasked: "placed" was taken); a lookup, a field the create does not
  write and a date are refused each with its reason (watched failing with
  the kind unasked: order_date took 2026-01-01); a value the field does not
  take is refused in its column's codec's words or its box's, and one
  spelled otherwise than it reads back with the spelling to give (watched
  failing with the spelling unasked: amount took 9.5); every value
  `applyPresentation` takes over a battery of candidates is one the
  released validator and `acceptsDefault` take, and a fresh form starts
  at it (watched failing with the box's length unasked: the engine refused
  ab😀, three characters the column holds and four UTF-16 code units its
  box does not); `startingValue` gives the canonical answer (watched
  failing with the value handed back as given); a regeneration keeps a
  value, keeps the person's over a changed column default and says so, a
  removal too, drops one the column's default now agrees with and a
  removal of one that is gone, and reports a value whose column is gone
  (watched failing with the value left out of the carried overrides); a
  value follows its column to a renumbered key (watched failing with it
  carried only where the key stayed); one the regenerated field no longer
  takes, or reads back otherwise, is dropped and said (watched failing with
  every value carried: the rebase threw); and on a state field a value no
  create starts a record in is refused, naming the states one does
  (watched failing with the moves unasked).
  `packages/data-server/src/routes/admin.test.ts` -- a bundle carrying a
  starting value publishes and is served with it; one whose form starts
  elsewhere than its presentation says, one whose value the field does
  not take and one starting the state field where no create starts are
  refused, and nothing is written (watched failing with the value left out
  of `applyPresentation`: 201 characters were refused only as a form that
  is not its base with its presentation applied; and with the state's fit
  left out of `storable`: lost was stored).
  `apps/studio/src/starting-value.test.tsx`, against the real server
  behind a fake fetch -- each field says what the generator started it
  with, a box takes another value, set as it reads back (9.5000 for 9.5),
  and the preview and the publish start there (watched failing with the box
  left out of the step); emptied, the column's default is taken away and
  the preview starts empty, and Use the column's default gives it back by
  keyboard, the keyboard then on the box (watched failing without the
  focus: it fell to the page); a value the field does not take is said
  under its box and set nowhere (watched failing with the value handed to
  the session unread: "Must be a number." alone); a yes or no offers None,
  Ticked and Not ticked (watched failing with the choice handed on as its
  option's text: Not ticked set nothing); and a state field takes only a
  state a create starts in (watched failing with the moves unasked).
  `apps/studio/src/presentation.test.tsx` -- every control of the step is
  still one that cannot break a binding, a starting value's among them
  (watched failing before it counted them: six Starting value boxes).
  `apps/studio/src/regenerate.test.tsx` -- a value kept over a changed
  column default offers the generator's, which chosen publishes no
  override (watched failing with the default's both-changed offered as a
  label is).
  `apps/host/src/defaults.test.tsx`, on both engines against the real
  server, in both renderers -- New record starts at the values chosen over
  the base, Group at Online and the Status whose default was taken away
  empty, and a save sends Online, leaves the status out and stores draft
  (to be watched failing in CI with `applyPresentation` leaving a value
  unset and a removal undone, in data-core's dist the server and the plane
  both apply: Group should be drawn empty and Status at draft).

## Context

Since 0149 a field a create writes starts at its column's constant
default, and the generator says so in a note. What that default means to
the people filling the form in was the database's to say: a column that
defaults to `draft` for the application that inserts rows may be one an
administrator wants a new order to start empty, so the person chooses; or
a column with no default may be one most people answer alike. 0149 named
it as a cost, and as an alternative not taken: a control to change or
clear a default belongs to presentation, a patch over the generated base
(0030), and is the administrator's to decide once the column's is shown.

Spec 5's `default` is the answer a fresh form starts with -- a new form, a
new row, a field shown again after its hiding cleared it -- and never a
draft, a prefill or the server's replay, which start as handed in
(formancy.ai 0197). The engine refuses to open a document whose default its
field would refuse. `@formancy/core`, where that check lives, is a
development dependency of data-core and no dependency of the server.

## Decision

**A field's starting value is presentation.** `FieldPresentation` gains
`default`: a value that replaces the column's default or adds one where the
base has none, or `null` that removes the base's, shaped as `description`
is (0119) and present only where it differs from the base's.
`PRESENTATION_VERSION` stays 1: a presentation without it reads as before.

**One reading decides which value a field takes**
(`packages/data-core/src/presentation/starting-value.ts`), the one 0149's
generator reads a column's constant by (`givenStart`, beside
`startingAnswer` in `generate/defaults.ts`): the value as the column stores
it, through the codec of the binding's type and nullability
(`codecForType`, the column itself not being at hand where a presentation
is applied) and `formValue`, and only where the field's box holds it,
counting UTF-16 code units. A value spelled otherwise than a record holding
it reads back -- `9.5` in a numeric(18,4) -- is refused with the spelling
to give, so a presentation has one; the studio sets that spelling.
`applyPresentation` refuses by it, a rebase drops by it, and the studio
reads every value by it before the session sees one. It does not ask the
engine: a test holds every value it takes to formancy's validator and
`acceptsDefault`.

**A starting value is offered for text, a whole or exact number and yes or
no**, the kinds 0149 starts a field at a constant of and whose starting
answers its cases create, store and read back on both engines. A lookup
takes none -- its answer is a record, and the record a value names may be
one the person may not choose -- nor does a field the create does not
write, nor a date, a time, an instant, a float or a uuid, for which no case
here creates and reads back a starting answer. Each is refused with its
reason, and the studio says that reason in the field's row.

**On the policy's state field a starting value is a state a create starts a
record in** (0112's move from nothing), refused at publish beside the
state labels (`startingStateProblems`, asked in `storable`), since only the
policy knows the states; the studio asks the same function. A column's own
default on the state field is not asked about, as 0149 left it: the form
route serves it only where such a move reaches it.

**A rebase carries it by the column**, as help text: a value stands while
the generator starts the field otherwise, a removal while there is a
default to remove; either kept over a column default that changed too is
said (`both-changed`, `property: 'default'`); one whose field is gone is
dropped and said (`field-gone`). A value the regenerated field no longer
takes -- its column holds less or another kind, a create no longer writes
it, or it reads the value back otherwise -- is dropped and said
(`default-dropped`) in the words a publish would refuse it in, rather than
carried into a presentation no publish accepts, or respelled for the
person.

**The studio edits it** in the Presentation step, under each field's help
text: "Starting value of status", with what the generator noted --
"Generated: Starts with the column's default, “draft”." -- a box for text
and numbers, where empty takes the column's away, and for a yes or no a
choice of None, Ticked and Not ticked, or the select's own Yes and No. Use
the column's default gives it back where it was replaced or taken away. A
refused value is said under the box, by its name, and nothing is set. The
state field takes a box too, its states named in the refusal. A starting
value kept over a changed default offers the generator's in the carried
panel, as help text does.

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
- A value is spelled as a record holding it reads back: one typed `9.5`
  starts the field at `9.5000`, which the studio says.
- On the state field a value must be a state a create starts in: a policy
  that no longer moves from nothing to it is refused at publish until the
  starting value is changed, and the studio names the states only when it
  refuses one, the box offering no list of them.
- A value the regenerated field no longer takes is dropped, and said, and
  so is one it reads back otherwise: `9.50` once the column's scale is 4,
  rather than carried as `9.5000`.
- A server of a release before this one refuses a version whose
  presentation sets a starting value, as `/fields/N/default is not a
  property of a field presentation`, so a deployment rolled back serves
  such a version only once an earlier one is restored there.
- A version published before gains nothing: the presentation it was
  published with is the one it keeps.

**What it forecloses.** Nothing.

## Alternatives considered

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

**A select of the states for the state field.** It would offer only states
a create starts in, but a column default no move reaches would be a value
the select cannot show, and the policy can change after the step is left;
the box and the refusal that names the states say both.
