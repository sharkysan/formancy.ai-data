# 0118 — Generated forms move to spec 5 for a field's help text from its column's comment, and the server serves spec 3 beside it

- **Status:** accepted; supersedes [0042](0042-generated-forms-stay-on-spec-3-after-spec-4-is-released.md): generated documents say spec 5, and the server serves spec 3, which every version stored before says, beside the version it generates
- **Date:** 2026-10-31
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/generate/generate.test.ts` -- every fixture
  object on both engines, and the order form with its lookup, generates a
  document that says `specVersion: "5"` and that the released validator
  accepts (watched failing with the generator's version left at `"3"`); a
  column's comment is its field's `description`, trimmed, and its note says
  so, and a column without one gives none; a lookup over one column takes
  that column's comment and one over two takes none; a comment of
  whitespace is none, one past 300 characters is left out and said, and 300
  emoji, 600 UTF-16 units, still fit (watched failing with the comment left
  out of the field, and with the limit left out: the validator refused the
  long one). `packages/data-server/src/bundle.test.ts` -- a version stored
  at spec 3 is served as stored, a spec 5 one with its help text too, and
  help text in a spec 3 document is refused as a later spec's construct
  (watched failing with spec 3 left out of the versions served: the version
  stored before was refused as spec `"3"`); a spec 4 document, which no
  release generated, is refused, and a spec 4 construct in a spec 3
  document with this server's reason.

## Context

0042 kept generated documents on spec 3, because a host page whose renderer
is older than the spec refuses the document outright, and left the move to
a record of its own, "when what it buys is worth an integrator's renderer
having to be at" the release that speaks it.

Spec 5, frozen in `@formancy/*` 0.8.0 (formancy.ai 0194), brings a field's
`description`: help text under the question, read out with the control
through `aria-describedby` rather than as part of its name. This repository
is at 0.11.0 since #141. The snapshot already holds what a database says a
column is for: its comment, read by both adapters (PostgreSQL's
`pg_description`, SQL Server's `MS_Description` extended property). That is a fact of the
catalog, as a column's name is, and the generator already takes the name
for the label.

## Decision

**Generated documents say spec 5** (`GENERATED_SPEC_VERSION` in
`@formancy/data-core`).

**A field's help text is its column's comment** (`helpTextFor`,
`packages/data-core/src/generate/help.ts`): the comment of the one column
the field stands for -- a column field's own, a lookup's over a foreign key
of one column -- its surrounding whitespace trimmed. A lookup over several
columns takes none, since their comments say several things. A comment of
whitespace alone is none. One longer than help text holds, formancy's
`Text` of 300 code points, is left out and said in a note, never cut: a cut
sentence can say the opposite of the whole one. The field's note says where
its help text came from, beside its label's.

**Nothing else of spec 4 or 5 reaches a generated form**: no `step`, mask,
placeholder, autofill hint or default. With no default in a document, an
engine opened without answers fills none (formancy.ai 0197), so a new
record's answers are still only what the person and the page give.

**The server serves spec 3 and spec 5** (`SERVED_SPEC_VERSIONS`). Every
version stored before this release says spec 3, and is served, and restored,
as it was stored: a read never compares a base with what this release
generates (0030). A stored document in spec 4, which no release generated,
is refused as edited by hand, and a later spec's construct in a spec 3
document is refused with this server's reason.

## Consequences

**What it buys.** A column documented in the database is documented on the
form, in the catalog's words, for the person filling it in, and a screen
reader says it with the control. A later property of spec 4 or 5 a column
fact answers -- `step` on a whole number -- now costs an integrator nothing
more.

**What it costs.**
- An integrator's page whose renderer is older than `@formancy/*` 0.8.0
  refuses every form published from this release on, at runtime; forms
  published before keep opening until they are published again. A host
  moves its renderer first.
- A comment reaches every person who opens the form, though it was written
  for whoever reads the catalog: a note meant for developers becomes the
  help text. The studio shows it in the Generate step's preview and notes,
  and does not edit help text yet; a comment is changed in the database,
  and the form generated again.
- A comment changed after publication reaches the form only when it is
  generated again, and drift review does not name it: comments are not
  compared (0010).
- A comment longer than 300 characters, and a lookup over several columns,
  give no help text.
- A studio session or a draft holding a base generated before the upgrade
  is refused at publish until it is generated again, as every generator
  change has been (0030).
- A deployment rolled back to a release before this one refuses every
  version published since, as spec `"5"`, until an earlier version is
  restored there; versions published before the upgrade are served as
  they were.

**What it forecloses.** Nothing.

## Alternatives considered

**Stay on spec 3.** No generated form could carry help text, and the cost
of moving stays ahead, the same whenever it is paid (0042).

**Help text from a comment only when a request asks for it.** An option on
every generation, for a fact the catalog states as plainly as a name. The
administrator reviews the preview before publishing, and help text a person
chooses belongs in the presentation, where the studio's next change puts it.

**Cut a long comment to fit.** A cut sentence can say the opposite of the
whole one.

**`step: 1` on whole numbers in the same change.** It changes what a host
page does with a fraction -- refused before Save, where the server refuses
it now -- which is a behaviour of its own, and on spec 5 it adds no cost for
an integrator later.
