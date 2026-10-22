# 0095 — A nullable yes/no column is a select of Yes and No, not a radio group

- **Status:** accepted; narrows [0018](0018-one-planner-turns-answers-into-requests.md)'s three-state radio, whose answers it keeps
- **Date:** 2026-10-22
- **Deciders:** Daniel Bacher
- **Verified by:** `apps/examples/src/yes-no.test.tsx`, under React and
  under Angular, over the customer's form generated from the examples'
  captured snapshot with a nullable boolean column `vip` added. *An answer
  can be taken back to no answer* -- the control named Vip offers no answer,
  Yes and No, and Yes then no answer leaves the engine holding `'true'` and
  then nothing (watched failing before this record in both renderers: no box
  named Vip, a radio group). *A rule that disables it leaves nothing to
  choose* -- with the `disabled` rule a host writes for a field the person
  may not write (`apps/host/src/widgets.ts`), every control of the field is
  disabled (watched failing before this record in both renderers: both
  radios enabled). `packages/data-core/src/generate/generate.test.ts`, *a
  nullable boolean gets three states, a NOT NULL one a checkbox* -- a select
  of `'true'` Yes and `'false'` No (watched failing with `radio`); and the
  planner's, the answers' and the export's tests, whose three-state field is
  read from the binding and is unchanged: `'true'`, `'false'` or `null`, and
  nothing else. **Not mechanically enforced:** what the host page does with
  such a field; no table of the shared model has a nullable boolean column,
  so neither the host's suites nor its browser gate draw one.

## Context

A nullable boolean column holds yes, no or nothing, and a checkbox has two
answers: unticked would save false where the database holds "unknown". So
the generator drew it as a radio group of Yes, `'true'`, and No, `'false'`,
which the planner reads as true, false or, unanswered, NULL (0018).

A radio group does two things wrong for it, read from formancy 0.7.0's code
(`@formancy/react`'s `RadioGroupField`, `@formancy/angular`'s radio group
template) and measured in this record's test, in jsdom:

- **It cannot be taken back to no answer.** Once Yes or No is chosen, the
  only other choice is the other one. A person who answered by mistake can
  save yes or no, never the NULL the column held, short of discarding every
  change on the page.
- **A rule does not disable it.** Neither renderer puts `disabled` on its
  radios; formancy lists it among what 0.7.0 knowingly lacks (hazard B6a).
  Here a rule disables a field no write of the account reaches (the
  generator, 0027), and every field of a record the person may only read and
  a field the host fixes (the host page, `session.ts`, 0029). Such a yes/no
  took a choice anyway, and the server refuses a changed value in a field
  the actor may not write (0022): a save refused for a change the page let
  the person make.

A select does both: each renderer draws an empty first choice, which sets
the answer to nothing, and takes `disabled` from the engine's control
properties, which a `disabled` rule sets.

## Decision

- **A nullable boolean column is a `select` of Yes, `'true'`, and No,
  `'false'`**, in `generate/controls.ts`. The answers are the radio's
  strings, so the planner, the codec, the record's answers and the export
  read them as before; `records/answers.ts` tells the three-state field by
  its column's type and the control the generator gives it, so the two
  cannot disagree.
- **A NOT NULL boolean stays a checkbox.**

## Alternatives

- **Keep the radio group and wait for upstream** to disable its radios. That
  mends the second fault and not the first, and the generator would still
  hand every host a field that cannot say "unknown" again.
- **A third radio, "No answer".** An option is a value, and the empty answer
  is no value: the planner would have to read a sentinel as NULL, which every
  other client would have to know. It is still not disabled by a rule.
- **Propose a clearable radio group upstream.** Worth proposing, and a later
  record if it lands; the select works in every released renderer today.

## Consequences

**What it buys.** A person can give a nullable yes/no field every answer its
column holds, and cannot change one the page shows them disabled, under both
renderers.

**What it costs.**

- **A form published before this record keeps its radio group** until it is
  published again: a read never regenerates a form (`bundle-format2.ts`
  asks only when a version is written). Its answers are the same strings, so
  it works as it did, with both faults. Publishing it again draws the
  select; nothing in its presentation names the control.
- **The choice is one press further away.** A radio group shows both answers;
  a select shows the one given and opens for the rest.
- **Shown in jsdom, not in a browser.** No table of the shared model has a
  nullable boolean column, so the host's suites and the browser gates, in
  Chromium, Firefox and WebKit, never draw one (0058).
