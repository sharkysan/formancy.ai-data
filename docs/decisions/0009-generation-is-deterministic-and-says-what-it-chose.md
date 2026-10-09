# 0009 — A form is generated deterministically, and says what it chose and what it refused

- **Status:** accepted; text `maxLength` and identity notes narrowed by [0026](0026-name-every-column-fact-the-engines-disagree-on.md)
- **Date:** 2026-10-08
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/generate/generate.test.ts` — every
  fixture-shaped object on both engines produces a document the released
  `@formancy/spec` validator accepts; two runs are byte-identical; the released
  `@formancy/core` engine in server mode accepts the largest `numeric(18,4)` and
  refuses one fractional digit too many, one whole digit too many and `1e3`; a
  composite foreign key becomes one lookup field; an inferred version column
  does not enable update until confirmed; a zoneless timestamp is read-only; a
  view is read-only; and each refused request names its reason. Watched failing
  with an inferred version column trusted, and with the decimal fraction
  unbounded. `packages/data-core/src/generate/names.test.ts` — keys, option-source
  names and labels.

## Context

Plan section 3 has a person choose a root table, review what was inferred, and
publish. Section 9 asks for a deterministic first generator and four concerns
kept apart: the form, the database bindings, presentation, and policy. Two
constraints from the packages this depends on, at the versions it pins:

- **`@formancy/spec` 0.3.0 speaks spec 3**, the frozen version. Spec 4's `step`
  — the property that would let a browser check that a number is whole — is in
  formancy's source and not in a release.
- **formancy has no exact-decimal field type.** A `number` is a JavaScript
  number, which holds fifteen to seventeen significant digits. `numeric(18,4)`
  holds eighteen.

## Decision

`generateForm(snapshot, request)` returns three things: a spec 3 formancy
document, a `FormBindings` record kept apart from it, and a list of notes.

- **Deterministic.** No model, no clock, no randomness. Field order is catalog
  order; keys and option-source names are derived from names, with collisions
  numbered in that order.
- **Exact values are text with an exact pattern.** A decimal becomes a `text`
  field whose `pattern` encodes its precision and scale, and an integer wider
  than JavaScript holds becomes text with a digit-count pattern. formancy's
  engine checks the pattern identically in the browser and in its server-side
  replay, so the two cannot disagree. An integer that fits is a bounded `number`.
- **Whole-ness is the server's.** Until spec 4 is released, a `number` field
  for an integer column accepts `1.5` in the browser and the server's codec
  refuses it. That is the one rule known to be checked on one side only, and it
  is written here so it is not a surprise.
- **A composite foreign key is one lookup**, a `select` naming a deployment
  option source, in place of its columns. Two chosen lookups that share a column
  are refused.
- **Read-only when it cannot be written faithfully**: generated columns, views,
  and timestamps without a zone, because formancy's `datetime` is an instant and
  writing a wall clock as one would guess a zone.
- **Update needs proof against lost updates.** A `rowversion` is proof. A column
  named like a version column is a suggestion, noted, and not used until the
  request confirms it. With neither, the form is create-only and says why.
- **Every choice is a note**: inferred, excluded, read-only or blocked, each
  with a sentence.

## Consequences

**What it buys.** A first form in one call, valid by formancy's own validator,
that refuses rather than guesses at the three places guessing loses data: exact
numbers, zones, and concurrency. The notes are the review screen's content.

**What it costs.** Decimal fields are text inputs: no numeric keyboard hint, no
spinner, and a calculation over them needs a decimal-safe expression formancy
does not have, so totals over money are not offered. The whole-number rule is
checked on one side until spec 4 ships. A form for a table with a
version-looking column is create-only until somebody confirms it, which is
friction on purpose. Labels are de-snaked column names, which is a starting
point and nothing more.

**What it forecloses.** Generating from a model's suggestion. The optional AI
pass edits a generated form through formancy's propose-and-review flow; it does
not generate one.

## Alternatives considered

**Map decimals to `number`.** Rejected: it rounds past fifteen digits and turns
`0.1 + 0.2` into `0.30000000000000004`, in the browser, before anyone sees it.

**Target spec 4 for `step`.** Rejected: the released packages do not speak it,
and a form this module publishes must be one the released renderers accept.
The generator emits `step` when the pinned version does.

**One form per foreign-key column.** Rejected: a composite key would become two
inputs a person must keep consistent by hand, which is the error the lookup
exists to remove.
