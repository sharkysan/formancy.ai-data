# 0119 — A field's help text is presentation the studio edits, carried by its column through a regeneration

- **Status:** accepted; extends [0030](0030-presentation-is-a-patch-over-the-generated-base.md): a field's presentation may set or remove its help text, and a rebase carries it by what the field stands for, as it carries a label; extends [0118](0118-generated-forms-move-to-spec-5-for-help-text-from-column-comments.md): help text from a column's comment is replaced or removed in the studio, not only in the database
- **Date:** 2026-11-01
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/presentation/help-text.test.ts` -- help text
  added, replaced and removed each derives exactly its entry, and applying
  it gives the edited form back (watched failing with help text refused as
  before: "only a field's label is presentation"); help text equal to the
  base's, a removal where the base has none, and help text that is not
  text are refused; help text over a spec 3 base is refused with what to do
  (watched failing with the spec left unasked: the form came back spec 3
  holding a description); a regeneration carries help text by its column,
  keeps the person's over a comment that changed too and says so, drops
  the override the comment now agrees with and a removal of a comment that
  is gone, and reports help text whose column is gone (watched failing with
  help text left out of the carried overrides).
  `apps/studio/src/presentation.test.tsx` -- help text typed in the
  Presentation step is what the preview reads out with the field's
  control, past 300 characters the box says so, emptied the field has
  none, and what the step edits publishes, help text included (watched
  failing with the box left out of the step).
  `apps/studio/src/regenerate.test.tsx` -- help text kept over a changed
  comment offers the generator's, which chosen publishes no override
  (watched failing with every both-changed offered as a label: pressed, it
  relabelled the field with the comment).

## Context

Since 0118 a field's help text is its column's comment, and the comment
was written for whoever reads the catalog: a note meant for developers
becomes the help text every person filling the form in reads. The studio's
presentation step edits labels, order, a field's section and its width
(0030, 0075), and refused help text as anything outside those edits, so
the only way to change a comment-derived help text was to change the
comment in the database and generate again.

## Decision

**A field's help text is presentation.** `FieldPresentation` gains
`description`: text that replaces the base's help text or adds one where
the base has none, or `null` that removes the base's. Present only where it
differs from the base's, so a presentation keeps one spelling: help text
equal to the base's, and a removal where the base has none, are refused.
Help text over a base older than spec 5 -- a version stored before 0118 --
is refused with what to do: generate the form again.

**A regeneration carries it by the column**, as a label (0030): help text
stands while the generator writes other help text, a removal while there
is help text to remove; either kept over help text the generator changed
too -- the comment edited in the database -- is said (`both-changed`,
`property: 'description'`); help text whose field is gone is dropped and
said (`field-gone`).

**The studio edits it** in the Presentation step: a Help text box under
each field's label, committed through builder-core's session on every
change. Empty removes the field's help text; past the 300 characters
formancy's `Text` holds, the box says so and the field keeps what it had.
A help text kept over a changed comment offers the generator's in the
carried panel, as a label does.

## Consequences

**What it buys.** An administrator replaces a comment written for
developers, or removes it, in the step where they already label the form,
and a regeneration after the comment changes keeps their choice and tells
them.

**What it costs.**
- Help text is one language, as a label is; translations stay outside the
  presentation.
- A version stored before 0118 takes help text only once it is generated
  again.
- A server of a release before this one refuses a version whose
  presentation sets help text, as `/fields/N/description is not a property
  of a field presentation` -- and refuses every spec 5 version already
  (0118) -- so a deployment rolled back serves such a version only once an
  earlier one is restored there.

**What it forecloses.** Nothing.

## Alternatives considered

**Change the comment in the database.** The comment is the catalog's, and
often its owner's; the person publishing a form may not be the one who may
comment on its columns, and the developers reading the catalog keep their
note.

**A generation option to take no comments.** Help text a person chooses
belongs in the presentation, per field, where a regeneration carries it;
an option would take every comment or none.
