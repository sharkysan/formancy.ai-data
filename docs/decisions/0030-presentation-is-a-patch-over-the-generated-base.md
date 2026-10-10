# 0030 — Presentation is a patch over the generated base, kept beside it, and carried to the next base by what each field stands for

- **Status:** accepted; narrowed by [0033](0033-the-administrator-plane-is-audited.md): a publish and a restore are audited; narrowed by [0039](0039-a-publish-says-what-happens-to-the-grants-of-reassigned-keys.md): the server refuses a publish whose policy grants on a reassigned key unless the publish confirms it, which the studio does for each key kept
- **Date:** 2026-10-09
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/presentation/derive.test.ts` — an unedited form,
  and an edit undone, derive the empty presentation; each of the four edits
  derives exactly its entry, `span: 'one'` included, and applying it gives the
  edited form back; a removed field, a changed key, a changed `required`,
  `pattern`, `maxLength` or `optionsSource`, a move between sections, a new
  section, a numeric span, a changed title, logic or `i18n`, and a base of
  another shape are refused, each naming its JSON path. Watched failing
  against a naive derive that kept every difference as presentation (the
  `required` case). `apply.test.ts` — an unknown key, an anchor naming
  another column, an order that is not a permutation of its section, an
  unmatched section, a non-minimal entry, entries out of the base's order,
  an unknown version or property and duplicates are refused.
  `rebase.test.ts` — identical bases carry everything with no conflict; a
  new nullable column lands after its generated predecessor; a dropped
  column with a label is `field-gone`, and one only in an order is no
  conflict; a dropped colliding column renumbers a key, and the label follows
  the column (`field-rekeyed`) and is not given to the key's new holder; a
  lookup re-pointed to another table is `field-rekeyed` and `both-changed`,
  keeping the person's label; a label the generator now writes itself is
  dropped silently; a column that became generated is `moved-section`; the
  last generated column dropped is `section-gone`; a root named `record`
  keeps its two sections apart by occurrence, and when its main section
  vanishes or appears neither section carries a label or an order, both are
  reported `section-gone`, and no field is said to have moved (watched
  failing against matching by occurrence alone, which put the main section's
  label on the system section and reported a move that never happened);
  two runs are byte-identical;
  every merged form passes `@formancy/spec/validate`; `reassignedKeys`
  reports the renumbered key. Watched failing with key-only anchors (the
  renumber and re-pointed cases).
  `packages/data-server/src/bundle.test.ts` — a format-2 bundle whose form,
  base or presentation was edited is refused on read; a generation request
  for another connection or form, or not in its normalised form, is refused;
  a request whose title, root, confirmed version column, pins over written
  fields or lookups disagree with its base and bindings is refused, and one
  that confirms a column beside a rowversion, readable or not, is not (each
  watched failing against the read without these checks, the unreadable
  rowversion against a check that did not know a rowversion wins);
  format 1 still validates and format 3 is refused; `generatedProblems`
  names a base or bindings the generator would not write, and a request it
  cannot honour; `policyProblems` is what `validateBundle` reports.
  `config-store.test.ts` — `versions()` lists what was published, ascending,
  never a leftover, and nothing for an id never published.
  `routes/admin.test.ts` — the proposal carries its normalised request;
  format 1 is refused at publish; a forged base is 422 at publish while the
  same document written straight into the store is still served, watched
  failing with the generator check moved into the read path.
  `routes/admin-evolution.test.ts` — regeneration of an unchanged database
  carries the presentation and writes nothing; a column added is placed; a
  column dropped is `field-gone` with the policy's problem; a lookup whose
  foreign key is gone, or whose display column became binary, is dropped and
  the rest generated (watched failing with `buildLookupConfig` skipped); a
  pinned column gone is 422 with the drift; format 1 is 409
  `published-before-0030`; a request edited on disk is 500 and nothing is
  regenerated from it (watched failing with the request check removed);
  restore of a compatible version gives the same document — the same bytes
  for a file this store wrote, the store's own spelling for one reformatted
  on the volume —
  of an incompatible one 409 with only the blocking changes and nothing
  written (watched failing with the drift check removed), from a stale base
  a conflict; versions list and read, and a hand-edited version is 500.
  `e2e.integration.test.ts` — plan section 14's step 8 on PostgreSQL and SQL
  Server: the DDL below under a published presentation, drift, regeneration,
  restore, refusal and republish, each asserted; watched failing on both
  engines with the restore's drift check removed.
  `apps/studio`, through the real server: `publish.test.tsx` — a draft that
  is not only presentation keeps Publish disabled and lists each problem
  (watched failing with that blocker removed); `carry.test.ts` — a carried
  draft keeps its labels and reports a dropped one; `regenerate.test.tsx` —
  a dropped label is reported and given to the new field chosen, in one
  command Undo takes back (watched failing with "Give" ignoring the select);
  a lookup the runtime would refuse is listed (watched failing with the list
  emptied); a reassigned key holds Publish until kept (watched failing with
  that blocker removed); a regenerated draft publishes against the version
  it came from; "Generate again" after a regeneration still reports the
  dropped label and still offers it to the renamed column (watched failing
  with the earlier conflicts dropped, and with the earlier fresh fields not
  followed); a 422 `cannot-generate` shows the server's sentence, what to do,
  and the drift it found (watched failing with the refusal's drift ignored);
  a version that cannot be read offers no field (watched failing with every
  field offered); `versions.test.tsx` — a restore, an incompatible one, a
  stale base; a second form checked shows nothing of the first's restore
  (watched failing without the panel keyed by form); a newest version
  edited on disk can be restored over from the studio (watched failing with
  the panel shown only after a successful check); `policy.test.tsx` —
  "Generate again" keeps a label and an order; `journey.test.tsx` — the four
  routes are the plane's, and axe runs at four new states;
  `scripts/browser-test.mjs` — the same four states at every width, watched
  failing with a low-contrast colour and a too-wide panel.

## Context

Plan section 9 keeps presentation as a concern of its own, and section 14's
gate 7 and demonstration step 8 ask that a person's layout survive a
compatible database change. Under
[0024](0024-the-studio-speaks-only-the-admin-plane.md) it did not: the studio
published the edited document, and a regeneration started again from the
generator's.

What was true when this was decided, each checked:

- **builder-core 0.3.0 keeps no command log and addresses nodes by index
  path** (probe PD2, on the studio's captured `postgres-owner.json`). An
  unedited session exports a document byte-equal to the base; the studio's
  four edits change only their own paths; a reversal is canonically equal to
  the base; no `renamedFrom` appears.
- **builder-core accepts a numeric `span` and a move into another section's
  grid** (PD2), so its validator alone does not keep an edit within what
  regeneration can carry.
- **The generated layout always has one shape.** `layoutFor` writes one
  layout, up to two sections — the root's, and `Record` for generated
  columns — each holding one two-column table, `span: 'all'` for a textarea.
- **Keys renumber.** Two columns that sanitise to one key are `x` and `x_2`
  in catalog order; drop the first and the second becomes `x`.
- **A generator release can change the base**, so a difference between two
  stored documents is not necessarily a person's edit.
- **0028's `buildLookupConfig` refuses more than the generator does**: a
  display column with no text form, a float key.

Measured on 2026-10-09 against `postgres:17-alpine` (17.11) and
`mcr.microsoft.com/mssql/server:2022-latest` (16.0.4295.3, RTM-CU27), with
the shared fixture and the e2e order request (probes PD1 and PD3):

| Change | PostgreSQL | SQL Server |
|---|---|---|
| Add a nullable column | `alter table sales."order" add column reference varchar(40)` | `alter table sales.[order] add reference nvarchar(40) null` |
| Widen `group` | `alter column "group" type varchar(60)` | `alter column [group] nvarchar(60) null` |
| Replace `ck_order_status` | one ALTER, drop and add | two statements in one batch |
| Drop `approved_by` | `drop column approved_by`; the foreign key goes with it | the bare drop fails ("one or more objects access this column"): `drop constraint fk_order_approved_by` first |

Column-level grants on `group` and `approved_by`, and on SQL Server the
auto-created statistics on them, blocked neither the type change nor the
drop, and went with the dropped column; no REVOKE was needed. After the
compatible set, drift of the published form was the same on both engines:
`column-added` (review), `check-changed` (info), `column-loosened` (info),
nothing blocking — a wider text control stays a text control. The new column
took the next ordinal on both, and after the drop the ordinals have a gap,
which does no harm: only their order is used.

## Decision

A published version keeps, beside the form it serves, the generation
request, the generated base, and a **presentation**: a patch holding exactly
the studio's four edits — a field's label, a section's label, a field's place
within its own section's grid, and full width. Bundle format 2.

- **Anchors.** A field's entry is anchored by what it stands for: its column,
  or its lookup's foreign key. A section is anchored by the label the
  generator wrote and which of the sections with that label it is. Only a
  root whose own label is `Record` has two sections with one label, and
  when their number differs between the bases, occurrence no longer says
  which is which: the rebase matches neither, reports their overrides
  `section-gone`, and says no field moved between them.
- **One spelling.** An entry holds only what differs from the base, and an
  empty one is refused, so two files that mean the same thing are equal.
- **Everything else is refused** at publish by `presentationOf`, naming the
  JSON path, including what builder-core accepts: a numeric span, a move
  between sections, a new section, help text, translations, `required`,
  `pattern`, `maxLength`, `optionsSource`, the title, logic.
- **The base is stored, and the generator is checked at publish only.** The
  server refuses a base or bindings its generator would not write from the
  stored snapshot and request. On every read it checks that the form is the
  base with the presentation applied, and that what the request alone
  decides — the title, the root, a confirmed version column, a pin over a
  field the form writes, the lookups — agrees with the base and bindings,
  because a regeneration generates from that request and its draft is
  checked at publish against the same one. A read never asks the generator,
  so a later release never makes a stored version corrupt.
- **A regeneration is a three-way rebase** in data-core,
  `rebasePresentation`, from the old base and its presentation onto the new
  base, by anchor. What it cannot carry as it was is a conflict: a field
  gone (`field-gone`, for a label or a span — never for an order, because
  the person's order names every key of its section, drift already reports
  the drop, and a conflict per dropped key would bury the one that matters);
  a field under a new key (`field-rekeyed`); a field the generator now puts
  in another section (`moved-section`); a section gone (`section-gone`); a
  label the generator also changed (`both-changed`, labels only, keeping the
  person's — a span has two values, so an override is either still one or
  now the generator's). A new field goes after its nearest preceding field
  in the new base that is already placed, or first.
- **Lookups are trialled through the runtime's own builder.** Each lookup
  of the stored request is generated alone and put through
  `buildLookupConfig` against the current snapshot; one either refuses is
  left out with the sentence that refused it, and the rest generated.
- **Restore** republishes an older version as the next one, the stored
  document as it was read and validated, written as the store writes every
  version — for a file this store wrote, the same bytes — only when drift
  against it blocks nothing.
- **The studio** regenerates from the Drift step and continues with the
  draft into Presentation, where each conflict is listed in the server's
  words with a choice where one exists: "Use the generator's label" for
  `both-changed`, "Give this label to…" a field new in this base for a
  dropped label. The Policy step's "Generate again" runs the same
  `presentationOf` and `rebasePresentation`, and keeps what an earlier
  regeneration dropped, since the draft no longer holds it to report.
  Publishing waits until each reassigned key's grants are kept or removed.
  The Drift step lists versions and restores one, also when the newest
  version is not served.

Routes, on the administrator plane: `GET /v1/forms/:id/versions`, `GET
/v1/forms/:id/versions/:n`, `POST /v1/forms/:id/regenerations` (writes
nothing) and `POST /v1/forms/:id/restorations`. The store's port gains
`versions(id)`.

## Consequences

It buys the plan's gate: a compatible change to a table leaves a person's
labels, order and full width where they put them, proved on both engines,
and every place it could not is said in words, with what was done instead.

What it costs:

- **Size.** About 3.1 kB per version file, 7.6 % of a 40 kB bundle for
  `sales.order` with its customer lookup: the stored base is 3,062 bytes
  against a PostgreSQL bundle of 40,222 and a SQL Server one of 39,977, as
  `JSON.stringify(…, null, 2)` writes them. Measured on 2026-10-09 on the
  studio's captured owner snapshots (PostgreSQL 17.11, SQL Server
  16.0.4295.3).
- **A column rename loses its overrides.** It reads as one column gone and
  one new, the old label is reported `field-gone`, and a person carries it
  across by hand.
- **A generator release that renames a section** reports that section's
  overrides as `section-gone`.
- **A root whose own label is `Record` loses its section overrides** when its
  main or system section comes or goes — a column granted or revoked, the
  last generated column dropped — reported `section-gone` though the section
  may still be there.
- **A pin taken out of a stored request by hand is not caught on read.** A
  field no operation writes may be pinned, generated, not writable by the
  account or on a view, and only the generator tells them apart. The policy
  still decides what is written and which rows are reached; the next
  regeneration's form would show the field writable.
- **New fields go by the generator's neighbour**, not where a person would
  put them.
- **`both-changed` keeps the person's label**, which can keep a stale one.
- **A dropped field's place in an order is not reported**; drift reports the
  drop.
- **Format 1 cannot be regenerated** — it kept no request and no base — and
  says "propose the form again". It is still served, and can be restored.
- **Publish needs format 2 and a base this server would generate.** A server
  upgraded between propose and publish refuses the draft, which is proposed
  again.
- **Anything outside the four edits is refused at publish**: help text,
  translations, new sections, a numeric span, moves between sections, and
  what the optional AI pass would change.
- **Restore brings back that version's policy.** It is not a database
  rollback, and nothing about the database changes.
- **A restore leaves no trail but its response.** Like a publish, it writes
  no audit event and no log line — the audit trail of
  [0023](0023-the-audit-trail-is-operational-not-evidence.md) covers the
  runtime plane — and the new file is the old document, so nothing on disk
  says it was a restore. An administrator-plane trail is its own decision.
- **Regeneration cost**: one discovery, then two generations plus one per
  lookup, and one `buildLookupConfig` per lookup. Not measured.
- **`keysReassigned` is held by the studio only.** The regeneration names
  keys that now stand for another column, whose grants somebody must
  confirm; the server does not refuse a publish that ignores them.
- **Not done here:** the runtime still does not stop writes on drift;
  publish conflicts are still a rebase onto the other version, not a merge;
  publish does not run `buildLookupConfig`, as before.

## Alternatives considered

- **Replaying the builder's commands.** builder-core keeps no log, and its
  addresses are index paths that mean something else once the generator
  adds a field.
- **A generic JSON three-way merge.** Nodes have no identity, and a merge of
  whole documents would carry binding facts — `maxLength`, `required` — as
  if they were presentation.
- **Storing only the edited form.** A generator change between releases
  would read as the person's edit, and there is nothing to rebase from.
- **Overrides in a second store file.** Two files per version are two
  compare-and-swaps, and a version could be half published.
- **Key-only anchors.** A label follows the key to whichever column holds it
  after a renumber; the rebase tests fail on exactly that.
- **Anchoring sections by role** (main, system). The role is a column's
  generation, which neither the form nor the bindings record, so a lone
  section labelled Record could be either; label plus occurrence is what the
  document holds, and where it cannot decide, the rebase says so instead.
- **Refusing format 1 on read.** Every form published before this would stop
  being served on upgrade, for nothing about its database.
- **Restoring by regenerating.** The result would be today's generator's
  form, not the version reviewed then.
- **Reporting `field-gone` for every dropped key of a reordered section.**
  The person's order lists every key, so each dropped column would be a
  conflict saying what drift already says, and step 8's one real conflict
  would be one of several.

## Older records

Narrowed or extended, not edited away:
[0024](0024-the-studio-speaks-only-the-admin-plane.md)'s presentation now
survives regeneration, and non-presentation edits are refused at publish —
its cost "Presentation edits do not survive regeneration yet" is answered
here; [0019](0019-a-published-form-is-checked-every-time-it-is-read.md)'s
bundle gains format 2, its presentation checked on every read and its
generator at publish;
[0013](0013-published-configuration-is-files-with-link-based-swap.md)'s store
gains `versions()`, and a restore is a new version;
[0010](0010-drift-is-classified-against-the-bindings.md)'s compatible changes
now preserve overrides (DATA-14).
