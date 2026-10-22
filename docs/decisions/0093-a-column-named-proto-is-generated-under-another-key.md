# 0093 — A column named `__proto__` is generated under another key, and `constructor` keeps its own

- **Status:** accepted
- **Date:** 2026-10-22
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/generate/names.test.ts`, *steps around
  `__proto__`, which formancy refuses as a key* -- `fieldKeyFor('__proto__')`
  is `__proto___` and `fieldKeyFor('constructor')` is `constructor` (watched
  failing before this record, with `__proto__` returned as it came).
  `packages/data-core/src/generate/generate.test.ts`, *a column named
  `__proto__` generates a document formancy accepts, bound to that column*
  -- the order table's `notes` column renamed `__proto__`, the generated
  form passes `@formancy/spec`'s `validateSchema`, and the one column binding
  over `__proto__` is the field `__proto___` (watched failing at
  `@formancy/*` 0.7.0 before this record, `key.unstorable` at
  `/model/fields/5/key`; and at 0.6.0, with the key `__proto__`, which that
  validator accepted); and *a NOT NULL column named `constructor` is a field
  the engine refuses empty* -- the order's `order_date` renamed
  `constructor`, and the released engine, in server mode, answers a
  submission that leaves it out with `required` for it and nothing else
  (watched failing at 0.6.0 with `shape`, the inherited `function Object`
  checked as a date). **Not mechanically enforced:** that a form published
  before this record over such a column is refused when it is read; that is
  read from the code below, not tested.

## Context

A field's key is made from its column's name by `fieldKeyFor`
(`packages/data-core/src/generate/names.ts`): every character formancy's key
rule does not take becomes `_`, and a name that is one of CEL's reserved words,
or `_id`, which formancy reserves for a repeater's row, gets a `_` added, so
`in` is `in_` ([0009](0009-generation-is-deterministic-and-says-what-it-chose.md)).
`__proto__` is letters and underscores, so it was kept as it was. It is a name
a table may have: both engines take a regular identifier that starts with an
underscore, read from their documentation and not measured here.

formancy 0.7.0 refuses `__proto__` as a field's key, with the validator's new
code `key.unstorable`, and its engine will not open a document with a field so
keyed ([formancy.ai 0185](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0185-an-answer-is-what-the-value-holds-as-its-own.md)).
No release could keep an answer under it in the browser: written, it replaced
the answers object's prototype. This repository's own code was not the
problem -- the server builds answers and a record token's values with
`Object.fromEntries` (`records/answers.ts`, `records/token.ts`), which makes
`__proto__` an own member -- but a generated form is drawn by formancy's
renderers, and published through formancy's validator: a column named
`__proto__` would now make a form the studio generates, a person reviews and
the server refuses at publish, with a `422` naming the key
([0019](0019-a-published-form-is-checked-every-time-it-is-read.md)).

The same release reads an answer as what the value holds as its own, so a
field keyed after a name every object has -- `constructor`, `toString`,
`valueOf` -- is answered only by what the person gave it. Through 0.6.0 an
unanswered one held what the object inherits, `function Object` for
`constructor`, and the engine checked that as the answer.

## Decision

- **`__proto__` is one of the names `fieldKeyFor` steps around**, as CEL's
  reserved words and `_id` are: the column `__proto__` is the field
  `__proto___`, and the binding still names the column, so a record reads and
  writes it as before. Its label is still made from the column's name.
- **`constructor` and the rest of `Object.prototype`'s names keep their own
  key.** From 0.7.0 on, formancy reads them as any other key, and this
  repository's server already did.

## Alternatives

- **Exclude the column with a note**, as a column of a type no codec reads is
  excluded. It loses a column the table has for a name, where a key of a
  different spelling loses nothing: the key is not shown, the label is.
- **Step around every name `Object.prototype` has**, `constructor` included.
  It would rename keys that formancy 0.7.0 holds correctly, so every form
  generated over such a column would change its key at its next regeneration
  for no gain, and the list would be this repository's guess at what the
  renderers read through inheritance, which upstream has now settled.
- **Stay on formancy 0.6.0.** A form over such a column was published there,
  and lost what the person typed into that field in the browser, quietly.

## Consequences

**What it buys.** Every table generates a form formancy 0.7.0 accepts, and the
field over a column named `__proto__` keeps what the person types, in the
browser as on the server.

**What it costs.**

- **A form published before this record over a column named `__proto__` is
  refused when it is read**, until it is published again. Its stored form
  carries the key `__proto__`, which the validator refuses on every read of a
  bundle (`served-schema.ts`, 0019), and its base is no longer what the
  generator makes from its request. So it leaves the menu, and its records,
  lookups and export are refused. Read from the code, not tested. Publishing
  it again generates the field under `__proto___`; a presentation follows the
  field by the column it stands for
  ([0030](0030-presentation-is-a-patch-over-the-generated-base.md)), so
  a label a person gave it is kept.
- **A host's own code that named the field `__proto__`** -- a stored draft, a
  rule of its own, a test -- names a key the form no longer has. The answer a
  record holds is the column's and is unchanged.
- **The key differs from the column's name by one underscore**, which a
  person reading the bindings must notice, as with `in_`.
