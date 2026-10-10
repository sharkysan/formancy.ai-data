# 0042 — Generated forms stay on spec 3 after spec 4 is released

- **Status:** accepted
- **Date:** 2026-10-10
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/generate/generate.test.ts` — every
  fixture-shaped object on both engines, and the order form with its lookup,
  generates a document that says `specVersion: "3"` and that the released
  `@formancy/spec` validator accepts, which it does for a spec 3 document
  only when nothing in it is spec 4's; watched failing with the generator's
  version set to `"4"`, the one case in that file that failed. The same file
  shows a whole-number field with no `step` taking `1.5` in the engine, in
  the browser's mode and the server's; watched failing with the generator
  writing `step: 1` at spec 4. `packages/data-server/src/bundle.test.ts` and
  `routes/admin-evolution.test.ts` — a stored form or base in another spec
  version, or with a spec 4 construct, is refused on publish, on read and
  on restore; watched failing without the check, when a version edited on
  the volume to spec 4 was read with 200 and restored with 201. That an
  integrator's renderer may still be at `@formancy/*` 0.3.0 is the reason,
  and nothing in this repository can see an integrator's renderer or runs a
  0.3.0 one.

## Context

formancy.ai released `@formancy/*` 0.4.0 on 2026-10-09, and this repository
moved its pins to it on 2026-10-10. The release freezes spec version 4:
`ranking` and `matrix` field types, `rating` and `slider` widgets, and the
`step`, `mask` and option `image` properties. Version 4 is a superset of
version 3 and removes nothing; the 0.4.0 validator accepts a version 3
document as it did before, and refuses a version 4 construct in one, naming
the version it needs (`version.step` for a `step`).

[0009](0009-generation-is-deterministic-and-says-what-it-chose.md) generated
spec 3 because the released spec spoke nothing later, and left one rule on
one side: a `number` field for an integer column accepts `1.5` in the browser
and the server's codec refuses it, "until spec 4 is released". Spec 4's `step`
is the property that would close it, `step: 1` on the bounded number the
generator already writes. Nothing else in version 4 answers a column type:
the survey types, the widgets, `mask` and `image` are a person's choices, not
facts a catalog states. And version 4 froze without an exact-decimal type, so
the wait [0002](0002-depend-on-upstream-never-copy-it.md) named for one is now
for a version 5.

Upstream's `MIGRATIONS.md` names the cost of a version 4 document plainly: a
reader pinned at 0.3.0 **refuses** it, loudly, so the readers move first. The
readers of a generated form are this repository's server, studio and host
page, which move with this repository's pins, and the integrator's own page,
which renders it with `@formancy/react` or `@formancy/angular` at whatever
version that integrator installed. `@formancy/data-client` does not depend on
either renderer, but its types are `@formancy/spec`'s, pinned exactly like
every upstream package here (0002), so the `FormSchema` it hands a host is
0.4.0's.

The data server reads every stored version through formancy's validator
(0019), and until 0.4.0 that alone refused a spec 4 document. At 0.4.0 it
accepts one, so a version edited on the volume to spec 4, its base and form
alike, would have been served and restored -- found in review. Every version
a server has stored says `"3"`, unless somebody edited it: the generator has
written no other version since 0009.

## Decision

The generator keeps writing `specVersion: "3"`, `GENERATED_SPEC_VERSION` in
`@formancy/data-core`, and the data server publishes and serves no other:
`validateBundle` refuses a stored form or base in another version, or with a
construct of a later one, on publish and on every read, which a restore reads
through. Whole-ness stays the server's, as 0009 says, now by choice rather
than because nothing later was released. A generated document moves to
version 4 in a record of its own, when what it buys is worth an integrator's
renderer having to be at 0.4.0 first.

## Consequences

**What it buys.** At runtime, a host page whose reader is still at 0.3.0
keeps reading every form this module generates, and publishing changes
nothing about what it must install. Measured once, not tested: on 2026-10-10
every form generated from the committed snapshots validated under
`@formancy/spec` 0.3.0 and opened in `@formancy/core` 0.3.0's engine, in the
browser's mode and the server's, in a scratch check. Nothing here runs a
0.3.0 renderer, so nothing fails if that stops being true; what fails is the
generator writing another version, in the generate suite. No generated
document, and so no hash a publish compares (0030), moved with the upgrade: a
studio session that held a form generated before the server's upgrade
publishes it as it would have. And the server never hands such a page a
version in a spec nobody generated because a newer validator accepts it.

**What it costs.** The whole-number rule stays one-sided: a person who types
`1.5` into a whole-number field learns it is wrong only from the server's
refusal after Save. Nothing in version 4 reaches a generated form, which is
no loss today, since nothing in version 4 is a column's fact besides `step`;
and an integrator whose hosts are all at 0.4.0 cannot publish one by hand
either, because the server refuses it whoever sends it. The types do not hold
what the documents do: a TypeScript host whose renderer is at 0.3.0 does not
compile `createFormEngine({ schema: published.form })` against
`@formancy/data-client`, because `specVersion` may be `"4"` in 0.4.0's
`FormSchema` and not in 0.3.0's (TS2322, measured with TypeScript 6.0.3 and
`skipLibCheck` off on 2026-10-10 -- found in review). Such a host casts the
form to its own `FormSchema`, or moves its renderer to 0.4.0. A refusal of a
spec 4 construct names this record instead of repeating the validator's
advice to change the document to `"4"`, which this server would then refuse.

**What it forecloses.** Nothing permanently. Moving later changes every
generated document at once: each base a studio session holds is then not
what the server generates, so the publish refuses it until the session
generates again. Versions already stored stay readable only if the move keeps
spec 3 readable too, which narrows 0030's promise that a later release never
makes a stored version corrupt: the read check is `GENERATED_SPEC_VERSION`,
and moving it alone would refuse every version stored before as corrupt,
which `bundle.test.ts` would not see, since its bundles are generated at
whatever version the generator writes; the generate suite's literal `"3"` is
what fails first, and it points here. That is the same cost whenever it is
paid; deferring it adds none.

## Alternatives considered

**Move to spec 4 now, with `step: 1` on whole numbers.** Rejected for now: it
closes the one-sided rule at the price of every 0.3.0 renderer refusing
every generated form, and this repository cannot tell how many integrators
that is. It would also have made the upgrade a behaviour change for every
form rather than a dependency change.

**Write version 4 only for a form that has a whole-number field.** Rejected:
almost every table has one, the order fixture's `created_by` included, and a
document version that depends on the columns is one an integrator cannot
predict before publishing.

**Make the version a generation request option.** Rejected until somebody
asks for it: it doubles what the generator writes and what its suites must
cover, for a choice no integrator has made yet.

**Leave the version to the validator on read, as before 0.4.0.** Rejected:
what the validator accepts grows with every release that adds a version, so
what the server serves would grow with a dependency bump nobody decided. The
publish already refuses a base the generator would not write; a read that
holds the same line is the fail-closed half
([formancy.ai 0022](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0022-fail-open-fail-closed.md)).
