# 4. Solution strategy

The ideas the rest of the design follows from. Each links the decision record
that argues it and names what fails when it stops being true, or says that
nothing does.

## 1. One path, and most changes touch one step of it

```
  catalog ──discover──▶ snapshot ──generate──▶ base form, bindings, notes
                                                            │ + policy and
                                                            │   presentation
                                                            ▼
  fresh snapshot ──diff──▶ drift report ◀──────── published bundle
                           (what each change                   │ run
                            stops, for this form)              ▼
                                                      records and lookups
```

1. **Discover.** An adapter's `discover(scope)` reads the catalog as the
   connected account and returns a `MetadataSnapshot`, made only through
   `createSnapshot` in `packages/data-core/src/snapshot.ts`, with a gap for
   whatever that account could not see
   ([0004](../decisions/0004-a-snapshot-says-what-it-could-not-see.md),
   [0027](../decisions/0027-a-snapshot-says-what-its-account-may-do.md)).
2. **Generate.** `generateForm` in `packages/data-core/src/generate/` turns
   the snapshot and a generation request into a formancy form, its
   `FormBindings`, field to column, and notes saying what it inferred and
   what it refused
   ([0009](../decisions/0009-generation-is-deterministic-and-says-what-it-chose.md)).
3. **Govern and arrange.** A `FormPolicy` (`packages/data-core/src/policy/`)
   says who may read, create, update and delete which fields and which rows
   ([0011](../decisions/0011-every-operation-carries-a-trusted-policy-context.md)).
   A presentation (`packages/data-core/src/presentation/`) is a patch over
   the generated base
   ([0030](../decisions/0030-presentation-is-a-patch-over-the-generated-base.md)).
4. **Publish.** The administrator's plane stores a bundle -- snapshot,
   request, base, presentation, bindings, policy -- in the file
   configuration store, where compare-and-swap is a hard link
   ([0013](../decisions/0013-published-configuration-is-files-with-link-based-swap.md)),
   and checks it on publish and on every read
   ([0019](../decisions/0019-a-published-form-is-checked-every-time-it-is-read.md)).
5. **Run.** The runtime plane serves a published form's records and lookups.
   `packages/data-core/src/records/plan.ts`, and `records/list.ts` for a
   page of records, is where a request meets the policy, the codecs, the
   tokens and the bindings and becomes a typed request to an adapter
   ([0018](../decisions/0018-one-planner-turns-answers-into-requests.md),
   [0044](../decisions/0044-a-forms-records-are-listed-a-page-at-a-time-under-its-read-policy.md)),
   which runs it as one guarded statement
   ([0015](../decisions/0015-a-record-operation-is-one-guarded-statement.md)).
6. **Review drift.** `diffSnapshots` in `packages/data-core/src/drift/`
   classifies a fresh snapshot against what a published form's bindings and
   lookups rest on
   ([0010](../decisions/0010-drift-is-classified-against-the-bindings.md)),
   and the runtime refuses what that review blocks
   ([0041](../decisions/0041-the-runtime-refuses-what-drift-blocks.md)).

`packages/data-server/src/e2e.integration.test.ts` walks the whole path over
HTTP into the real server and the real drivers, on PostgreSQL and SQL
Server: an administrator proposes and publishes the order form, a clerk
finds a customer, creates and reads back an order exactly, and is refused a
stale save; another tenant can neither read the order nor pick its customer
([0025](../decisions/0025-each-adapter-owns-its-driver.md)).

## 2. data-core decides; an adapter translates

`@formancy/data-core` describes intent and has no driver, no HTTP and no
Node; each adapter turns that intent into one engine's statements. The ports
are `DatabaseAdapter` (`packages/data-core/src/adapter.ts`), `RecordAdapter`
(`records/types.ts`) and `LookupAdapter` (`lookup/types.ts`), and each
exists because there are two implementations and a suite that proves they
agree. The configuration store is an interface with one implementation,
and [section 5](05-building-blocks.md#the-ports) says why it is kept.

The question is never whether code is repeated, but whether anybody would
find out if two copies of one decision disagreed. So a decision both engines
must share is made once, in the core: how a snapshot sorts and hashes
(0004); how a value is
spelled and checked (0008); how a key becomes a token
([0012](../decisions/0012-a-lookup-token-is-a-reference-not-a-permission.md));
what a request may do (0018); how a label is spelled and a refusal named
([0028](../decisions/0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md));
whether a key is one the database numbers, which the generator, the planner
and drift review all ask of one predicate, `numbersKey` in
`packages/data-core/src/generate/offers.ts`
([0057](../decisions/0057-a-key-of-one-column-filled-by-a-never-repeating-default-counts-as-numbered.md)).
Two adapters implementing one operation by hand is deliberate; each says,
in its own record, what its engine does differently
([0016](../decisions/0016-postgres-operations.md),
[0017](../decisions/0017-sqlserver-operations.md),
[0026](../decisions/0026-name-every-column-fact-the-engines-disagree-on.md)).

What finds a disagreement: one business model written in both dialects,
with one comparator both adapters' discovery answers to
([0005](../decisions/0005-one-fixture-written-twice.md)); one expectation
per shared case in `packages/data-fixtures/src/parity.ts`, run by both
adapters' parity suites (0028); and the release report, which fails a run in
which a shared case passed through one adapter only
([0035](../decisions/0035-a-release-report-is-derived-from-the-run-that-gated-it.md)).

## 3. A snapshot is the only description, and says what it could not see

A snapshot carries its gaps, per object and per aspect, and what its account
may do with every column and table (0004, 0027,
[0049](../decisions/0049-a-snapshot-says-whether-its-account-may-delete-and-what-refers-to-each-table.md)).
What is built on a snapshot is checked against it by fingerprint: the
bindings are read against the snapshot they were generated from (0018), and
a lookup's configuration is derived from the bindings and that snapshot
rather than written (0012), so every identifier an adapter quotes is
approved metadata. A snapshot that cannot establish completeness
says so; "cannot tell" is never reported as "does not exist".

Held by `packages/data-core/src/snapshot.test.ts` and
`packages/data-fixtures/src/conformance.test.ts`, where a foreign key
missing from a restricted reader's snapshot with no gap is a disagreement.
That every adapter builds its snapshot through `createSnapshot` is held by
review.

## 4. Generated deterministically, and kept in four parts

The form, its bindings, its policy and its presentation are kept apart
(0009, 0011, 0030). Generation reads no model, no clock and no randomness,
so two runs are byte-identical, and that is what lets the server check, at
publish, that a bundle's base and bindings are exactly what its own
generator writes from the request the bundle carries. A client other than
the studio therefore cannot publish a binding change as a layout edit:
whatever is not one of the presentation's edits is refused, naming its JSON
path (0030). A regenerated form keeps its presentation by what each field
stands for, says what it could not carry, and keeps a moved key's grants only
once somebody confirms them
([0039](../decisions/0039-a-publish-says-what-happens-to-the-grants-of-reassigned-keys.md)).

Held by `packages/data-core/src/generate/generate.test.ts`,
`packages/data-core/src/presentation/derive.test.ts`,
`packages/data-server/src/bundle.test.ts` and
`packages/data-server/src/routes/admin.test.ts`, and in the studio by
`apps/studio/src/presentation.test.tsx`, where nothing the presentation step
offers can remove, rename or retype a bound field.

## 5. One bundle, checked whenever it is read

`validateBundle` checks the form against formancy's validator, the snapshot
against its fingerprint, the bindings against the snapshot and the form, and
the policy against the bindings, on publish and on every read from the
store (0019). A version edited on disk is not served. Publication is
compare-and-swap, so of two administrators publishing from one version
exactly one wins (0013). Restoring an old version and importing one from
another deployment pass the same checks and are refused while drift blocks
them ([0062](../decisions/0062-a-published-version-moves-between-deployments-as-its-version-file.md)).
With publisher roles set, a draft is published only when a publisher who
did not submit it approves it
([0065](../decisions/0065-with-publisher-roles-set-a-draft-is-published-only-when-a-publisher-who-did-not-submit-it-approves-it.md)).
The studio says early what the server will refuse only with the functions
the server refuses by, from `@formancy/data-core`: `validatePolicy`, and for
a delete grant `deleteProblems`, beside `deleteReview` over the same walk
([0024](../decisions/0024-the-studio-speaks-only-the-admin-plane.md),
[0052](../decisions/0052-the-studio-says-before-publication-who-may-delete-and-what-a-delete-also-does.md)).

Held by `packages/data-server/src/bundle.test.ts`,
`packages/data-server/src/config-store.test.ts`,
`packages/data-server/src/routes/admin-promotion.test.ts` and
`packages/data-server/src/routes/admin-drafts.test.ts`.

## 6. The policy is asked on every request, with a context nobody sent

The context is built from a token the server verified offline
([0014](../decisions/0014-host-identity-is-verified-offline.md)), never from
the request, and every runtime route asks the policy and the planner on
every request, with nothing cached per person
([0022](../decisions/0022-the-runtime-plane-asks-the-policy-every-time.md)).
Deny by default: a field with no entry is nobody's, a missing attribute is
a refusal rather than a shorter filter (0011). Row filters go into the same
statement as the operation (0012, 0015), so a row outside them does not
exist for the call, and another tenant's record is answered exactly as a
missing one is. A child form's rows can be held to the parent rows its
policy admits
([0043](../decisions/0043-a-child-forms-rows-are-reached-only-through-a-parent-its-policy-admits.md)).
A selection is checked against the database before anything is written,
because membership is the database's to answer (0018), and a lookup that
cannot answer refuses the save. The menu of forms asks every form's policy
and no database
([0045](../decisions/0045-the-runtime-plane-lists-the-forms-a-person-may-read-and-nothing-about-the-others.md)).

Held by `packages/data-core/src/policy/evaluate.test.ts`,
`packages/data-core/src/policy/validate.test.ts`,
`packages/data-server/src/routes/runtime.test.ts`, and both adapters'
`lookups.integration.test.ts` and `through.integration.test.ts`. That the
server plans every request through these functions is held by the runtime
suites and the end-to-end suite, not by the functions themselves.

## 7. One guarded statement per write, and never a second sending

An update names the key, the trusted filters and the expected version in one
`WHERE`, and moves a version column in the same statement, so nothing can
change between the check and the write (0015). A delete is one statement
that deletes one row or none, by the token and the version its person read
([0050](../decisions/0050-a-record-is-deleted-one-at-a-time-by-its-token-and-the-version-its-person-read.md)),
and reaches another table only through a foreign key the policy names, with
what it does
([0051](../decisions/0051-a-delete-reaches-other-tables-only-through-foreign-keys-the-policy-names.md)).
An instant or a time the person did not change is removed from the update
rather than written back
([0040](../decisions/0040-instants-and-times-are-read-to-the-shape-and-an-unedited-one-is-never-written.md)).
Nothing here retries a write: an answer lost after it was sent is
`unknown-outcome` at every layer, carried to the host as unknown, and a
browser's own resend is answered with the first sending's answer, within one
server process
([0031](../decisions/0031-an-answer-lost-after-a-write-is-unknown.md)).

Held by both adapters' `records.integration.test.ts`, where two concurrent
updates with one expected version give one winner and one `stale`; their
`delete.integration.test.ts`, `cascade.integration.test.ts` and
`records-lost-answer.integration.test.ts`; and
`packages/data-client/src/lost-answer.integration.test.ts`.

## 8. Drift is decided once, and asked again at run time

`diffSnapshots` gives every change a kind and a severity for this form, from
what the change stops, and a gap is never called a deletion (0010). The
runtime does not trust that review happened: every read, write and opening
of a form is decided over the root table as the catalog describes it in that
request, with drift's own rules, and every write carries the definition it
was decided over and runs only while the table still has it (0041). The cost
is round trips on every record request, which 0041 counts, and a narrower
promise about PostgreSQL's session settings, which 0016's status line
records.

Held by `packages/data-core/src/drift/diff.test.ts` and
`packages/data-server/src/routes/runtime-drift.integration.test.ts`, where
what the runtime refuses is what review's report stops, for every drifting
case, on both engines.

## 9. Prove it on real servers, and derive what is said about it

Database behaviour is proved against real servers on both engines in every
run ([0003](../decisions/0003-real-databases-in-every-test-run.md)), the
adapter suites on every image of each engine's matrix
([0067](../decisions/0067-the-adapter-suites-run-on-every-image-of-a-per-engine-matrix.md)). A
release report is built from the run that gated it, never written by hand
(0035); performance is measured through the shipped server and held in CI by
rows read and round trips, never by a time
([0034](../decisions/0034-performance-is-measured-through-the-shipped-server-and-held-without-a-clock.md));
a lookup statement stops when its request is abandoned or its deadline
passes, and the default deadline is derived from those figures
([0061](../decisions/0061-a-lookup-statement-stops-when-its-request-is-abandoned-or-its-deadline-passes.md),
[0063](../decisions/0063-the-default-lookup-deadline-is-outside-the-measured-product.md)).
The browser gates make every check in Chromium, Firefox and WebKit
([0058](../decisions/0058-the-browser-gates-run-in-chromium-firefox-and-webkit-and-each-fact-the-browsers-disagree-on-is-named-and-held.md)),
and the README's pictures are taken by a script from states the product
reaches and held to the text they show
([0038](../decisions/0038-readme-pictures-are-taken-by-a-script-and-held-to-the-text-they-show.md)).

---

## Rules that follow

Most are cross-cutting concepts, and [section 8](08-crosscutting-concepts.md)
says for each what decided it, what holds it and what it costs.

**Fail closed**, as formancy.ai's
[0022](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0022-fail-open-fail-closed.md)
has it: a check that cannot answer refuses
([section 8.2](08-crosscutting-concepts.md#82-fail-closed)). Beside the
cases listed there, at an adapter's port an empty restriction is refused,
and only an explicit `unrestricted` reads every row (0012); and a menu entry
whose bundle no longer validates is left out, and the log says which (0045).

**A name, never an address.** A form document names an option source, and
the deployment resolves it; a document never supplies a URL, a header, a
token, a tenant or an operation
([formancy.ai 0077](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0077-options-may-come-from-a-named-source.md),
[0029](../decisions/0029-a-host-renders-a-published-form-through-one-client.md)).

**Identifiers come from approved metadata; values are bound.** Neither the
browser nor a form document supplies SQL or an identifier to execute
(0015, 0016, 0017;
[section 8.3](08-crosscutting-concepts.md#83-identifiers-from-approved-metadata-values-bound)).

**Nothing in a package reads configuration.** The composition root,
`packages/data-server/src/main.ts`, reads every setting and resolves a
secret once, and a database the server cannot reach is a `503` with a
sentence and no detail (0019, 0025,
[0020](../decisions/0020-administration-is-a-separate-plane.md);
[section 8.4](08-crosscutting-concepts.md#84-secrets-handled-once)).

**The person reads the server's words, never the database's.** A refusal is
a value with a stable code and a sentence of the server's own (0015, 0022;
[section 8.8](08-crosscutting-concepts.md#88-errors-are-fixed-sentences)).
