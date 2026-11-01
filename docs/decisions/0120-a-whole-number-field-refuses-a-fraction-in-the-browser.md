# 0120 — A whole-number field refuses a fraction in the browser, as the server does

- **Status:** accepted; narrows [0118](0118-generated-forms-move-to-spec-5-for-help-text-from-column-comments.md): a whole-number field carries spec 4's `step`, the one construct of spec 4 or 5 besides help text a generated form holds
- **Date:** 2026-11-01
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/generate/generate.test.ts` -- a
  whole-number field is a bounded number with `step: 1`, and formancy's
  engine refuses 1.5 with `step` and takes a whole number, its minimum
  included, in the browser's mode and the server's replay alike (watched
  failing with no `step` written: 1.5 was taken).
  `packages/data-server/src/bundle.test.ts` -- a version stored at spec 3,
  as a release before 0118 wrote it with no `step`, is still served, and a
  `step` in a spec 3 document is refused as spec 4's.

## Context

A whole-number column the generator draws as a bounded `number` field was
the one rule checked on one side only (0009): the engine took `1.5`, and
the server's codec refused it after Save. 0042 kept it so because `step`
was spec 4's, and a host whose renderer was older refused a spec 4 form.
0118 moved generated forms to spec 5, for a field's help text, at that
very cost, and left `step` out as a change of its own: it changes what a
host page does with a fraction.

formancy's engine holds `step` from the field's minimum, and every number
field the generator writes is within the integers JavaScript holds
exactly -- a wider integer is a text field with a digit pattern (0009) --
so the arithmetic is exact.

## Decision

**A whole-number field carries `step: 1`** beside its `min` and `max`
(`packages/data-core/src/generate/controls.ts`). The engine refuses a
fraction with `step`, in the browser before Save and in the server's
replay alike, and says formancy's sentence for it: "Enter a value in steps
of 1." The server's codec still refuses a fraction, for a client of its
own.

## Consequences

**What it buys.** A person who types `1.5` into a whole-number field is
told at once, beside the field, as for every other rule the form states;
the browser and the server check the same thing.

**What it costs.**
- The sentence is formancy's for any step, "Enter a value in steps of 1.",
  not words about whole numbers; better words are upstream's to give.
- Every generated base changes: a studio session or a draft holding one
  generated before the upgrade is refused at publish until it is generated
  again (0030). Versions stored before are served as they were, without
  `step`, until they are published again.

**What it forecloses.** Nothing.

## Alternatives considered

**A validate rule with a message of this module's own.** A rule over every
whole-number field, its CEL and its words restating what `step` states,
and a second place the same check could disagree with the engine's.

**Keep the server's refusal alone.** The person learns after Save what the
form could have said, which no other rule the form states makes them do.
