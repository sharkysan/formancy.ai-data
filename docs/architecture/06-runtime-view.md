# 6. Runtime view

The path a form takes from a catalog to a person's record and back to
review, as `main` has it. Each step names the file that takes it and the
record that decided it; each scenario ends with what holds it and what it
costs. What every request meets before its route -- the path, the rate
limit, the origin, the audit event, the token read from `Authorization:
Bearer` alone (`app.ts`) -- is in sections 7 and 8. A path with no package
is under `packages/data-server/src`. Suites that reach a database run
against real servers of both engines
([0003](../decisions/0003-real-databases-in-every-test-run.md)).

## 6.1 Discovering a scope as a restricted account

1. The studio's Connect step (`apps/studio/src/connect.tsx`) asks `GET
   /v1/connections/:id/metadata`, on the only plane it speaks
   ([0024](../decisions/0024-the-studio-speaks-only-the-admin-plane.md)),
   with a token holding a role in `FORMANCY_DATA_ADMIN_ROLES`
   ([0020](../decisions/0020-administration-is-a-separate-plane.md)).
   `discover` in `routes/admin.ts` takes the approved schemas and the ports
   from the allowlist (`connections.ts`): only a listed id opens, on first
   use, through `drivers.ts`, and a failed open is tried again next time
   ([0019](../decisions/0019-a-published-form-is-checked-every-time-it-is-read.md),
   [0025](../decisions/0025-each-adapter-owns-its-driver.md)). A database
   that does not answer is 503, its address in the log and not the answer.
2. The adapter reads the catalog as the account the allowlist names:
   `packages/data-postgres/src/discovery/discover.ts` reads `pg_catalog` in
   one read-only REPEATABLE READ transaction
   ([0006](../decisions/0006-postgres-discovery-reads-pg-catalog.md)), and
   `packages/data-sqlserver/src/discovery/discover.ts` catalog views that
   leave out what the account holds nothing on
   ([0007](../decisions/0007-sqlserver-discovery-and-what-it-hides.md)).
   First each reads what the server is, by the query its ping shares
   (`server.ts`); a SQL Server catalog without `sys.edge_constraints`,
   every release before 2019, is refused there, naming its release
   ([0068](../decisions/0068-a-snapshot-records-the-server-it-was-read-from-and-nothing-refuses-a-server-discovery-can-read.md)).
3. Each column says what the account may do with it, as the database's
   privilege check answers; each object whether row security applies, the
   account may delete from it, and what refers to it; and its account
   ([0027](../decisions/0027-a-snapshot-says-what-its-account-may-do.md),
   [0049](../decisions/0049-a-snapshot-says-whether-its-account-may-delete-and-what-refers-to-each-table.md)).
4. What the account cannot establish is a gap, about the scope, a schema or
   an object, so "no relationship" and "cannot tell" stay apart.
   `createSnapshot` (`packages/data-core/src/snapshot.ts`), the only maker
   of a snapshot, sorts it and fingerprints the engine, the account's user,
   the objects and the gaps
   ([0004](../decisions/0004-a-snapshot-says-what-it-could-not-see.md));
   the server it was read from rides outside the fingerprint (0068).

Held by `packages/data-core/src/snapshot.test.ts`; each adapter's
`discovery-access.integration.test.ts`, where every capability reported for
owner, reader and writer is what a real statement gets; and
`packages/data-fixtures/src/conformance.test.ts`, the comparator both
answer to ([0005](../decisions/0005-one-fixture-written-twice.md)), where a
foreign key missing from a reader's snapshot without a gap disagrees; and
each adapter's `server.test.ts`, what its server's answer means, since no
container answers what it must tell apart. That no adapter builds a
snapshot by hand is held by review alone (0004), and that discovery refuses
a SQL Server before 2019 before reading its catalog by no test (0068). What
it costs: a snapshot is true as of discovery, so a grant revoked later is
`permission-denied` at runtime until review; nothing caches one, so each
proposal, review, restore, import and approval discovers again; SQL Server
without database VIEW DEFINITION reports row security `unknown` (0027).

## 6.2 Generating a form, and what its notes say

1. The Choose step (`apps/studio/src/choose.tsx`) picks a root, lookups
   with their display columns, a version column to confirm and columns to
   pin; `workbench.tsx` sends them as `POST /v1/form-proposals`, read by
   `readGeneration` (`generation.ts`) before a fresh discovery (6.1), by
   the rules a stored bundle's request is held to
   ([0030](../decisions/0030-presentation-is-a-patch-over-the-generated-base.md)).
2. `generateForm` (`packages/data-core/src/generate/generate.ts`) returns
   a spec 3 document
   ([0042](../decisions/0042-generated-forms-stay-on-spec-3-after-spec-4-is-released.md)),
   its `FormBindings` and its notes, with no model, clock or randomness
   ([0009](../decisions/0009-generation-is-deterministic-and-says-what-it-chose.md)).
   `apps/examples` runs it in the browser, over a captured snapshot
   ([0021](../decisions/0021-generated-forms-preview-in-both-frameworks.md)).
3. What the account may do decides what is offered: no field over a column
   it may not read, writes per operation, create only with INSERT (0027),
   update only with a confirmed concurrency token (0009). A key the
   database fills is shown and never written
   ([0056](../decisions/0056-a-key-the-database-fills-is-never-written-and-a-uuid-is-ordered-as-each-engine-orders-it.md));
   delete is offered only where the version proves the record
   (`generate/offers.ts`, 0050,
   [0057](../decisions/0057-a-key-of-one-column-filled-by-a-never-repeating-default-counts-as-numbered.md));
   a lookup a person can search is a typeahead
   ([0066](../decisions/0066-a-lookup-a-person-can-search-is-generated-as-a-typeahead.md)).
4. Every choice is a note -- `inferred`, `excluded`, `read-only`, `blocked`
   or `access` -- whose sentence the Generate step (`generate.tsx`) shows;
   a refused request is 422 `cannot-generate`, naming approved metadata only.
5. The administrator edits presentation as a patch over this base
   (`presentation.tsx`, 0030) and writes the `FormPolicy` (`policy.tsx`):
   who may do what, each field's grants, the row filters
   ([0011](../decisions/0011-every-operation-carries-a-trusted-policy-context.md)),
   and each foreign key a delete acts through, by name
   ([0052](../decisions/0052-the-studio-says-before-publication-who-may-delete-and-what-a-delete-also-does.md)).

Held by `packages/data-core/src/generate/generate.test.ts` -- every fixture
object on both engines gives a document the released `@formancy/spec`
accepts, byte-identical twice -- and `access.test.ts`;
`routes/admin.test.ts`; and `apps/studio/src/journey.test.tsx`. What it
costs is 0009's and 0042's, under *Forms* in
[section 11.2](11-risks-and-debt.md#112-known-limitations-by-area).

## 6.3 Publishing, alone and under review

1. The Publish step (`apps/studio/src/publish.tsx`) sends a format-2 bundle
   -- connection, request, base, presentation, form, bindings, policy and
   snapshot -- to `POST /v1/forms/:id/versions`, over the version it edited.
2. `storable` (`publishing.ts`) asks `validateBundle` (`bundle.ts`): the
   form against formancy's validator, the snapshot against its own
   fingerprint, the bindings against both, the policy against the bindings
   (0019); then a listed connection, that this server's generator
   writes exactly this base and these bindings (`bundle-format2.ts`, 0030),
   and that a list of these bindings can run every view the presentation
   names (`viewProblems`,
   [0105](../decisions/0105-a-forms-list-offers-views-its-administrator-named.md)).
   Otherwise 422 `invalid-bundle`, with the problems.
3. `keysRefusal` answers 422 `keys-reassigned` while the policy grants on a
   key that now stands for another column and the body does not confirm it
   ([0039](../decisions/0039-a-publish-says-what-happens-to-the-grants-of-reassigned-keys.md)).
4. `store.publish` (`config-store.ts`) writes a temporary file, flushes it
   and hard-links it to `<id>/<n>.json`. The link fails if the name exists,
   so of two publishes from one base one wins and the other is 409
   `conflict`, naming the current version
   ([0013](../decisions/0013-published-configuration-is-files-with-link-based-swap.md)).
   Every later read, on either plane, validates the bundle again
   (`published.ts`), so a version edited by hand is never served.

With `FORMANCY_DATA_PUBLISHER_ROLES` set, only an approval writes a version
([0065](../decisions/0065-with-publisher-roles-set-a-draft-is-published-only-when-a-publisher-who-did-not-submit-it-approves-it.md)):

5. `governance.ts` refuses a direct publish or import, 403
   `review-required`. `POST /v1/forms/:id/drafts` runs `gate`
   (`routes/admin-gate.ts`): `storable`, the database discovered now,
   `servable` -- another engine 422, drift that blocks 409 `incompatible`
   -- and the keys, then 409 for a base no longer the newest. `drafts.ts`
   appends the draft under `<store>/.drafts` by the same compare-and-swap,
   its submitter the token's `sub`.
6. `POST /v1/forms/:id/drafts/:draft/approval` refuses, in order, an
   unknown draft (404), an author (403 `publisher-required`), the submitter
   whatever roles they hold (403 `own-draft`) and a draft no longer pending
   (409); runs `gate` again; and writes the draft's bundle by
   `store.publish`. Who approved is the trail's `draft-approve` event
   (0033), never the version file. A rejection is a publisher's, or its
   submitter's withdrawal; a draft's state is derived on every read. An
   import (`routes/admin-promotion.ts`) passes `gate` before its write
   ([0062](../decisions/0062-a-published-version-moves-between-deployments-as-its-version-file.md)).

Held by `config-store.test.ts`, where concurrent publishes from one base
give exactly one winner; `bundle.test.ts`; `routes/admin.test.ts`;
`routes/admin-drafts.test.ts` and, on both engines with real tokens,
`routes/admin-drafts.integration.test.ts`; `routes/admin-promotion.test.ts`;
and `apps/studio/src/review.test.tsx`. What it costs: one instance (0013,
[section 7](07-deployment-view.md#what-an-operator-needs-to-know)); a direct
publish asks no database, so only review, an import and a restore refuse a
version the database cannot serve; an approval and a rejection at one
moment can both succeed, and nothing deletes a draft (0065).

## 6.4 A host page signs in and reads its menu

1. The host's identity provider signs a short-lived JWT; in the composed
   stack `deploy/mint-token.mjs` does
   ([0032](../decisions/0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)).
   Sign in (`apps/host/src/sign-in.tsx`) keeps it in the tab's memory only,
   and `forms()` (`packages/data-client/src/client.ts`) sends `GET
   /v1/forms`, the token in the Authorization header and nowhere else
   ([0029](../decisions/0029-a-host-renders-a-published-form-through-one-client.md)).
2. `createIdentityVerifier` (`identity.ts`, in `@formancy/data-identity`
   since [0091](../decisions/0091-the-host-identity-verifier-is-a-package-of-its-own-which-the-server-re-exports.md)) checks signature, issuer,
   audience, `exp` and `sub`, the algorithm pinned and no URL fetched
   ([0014](../decisions/0014-host-identity-is-verified-offline.md)). With
   `FORMANCY_DATA_IDENTITY_KEYS_FILE` the key is chosen by kid from a set
   `identity-file.ts` reads again on SIGHUP, the old set kept if refused
   ([0059](../decisions/0059-the-host-identity-key-is-a-set-selected-by-kid-and-read-again-on-sighup.md)).
   A refusal is 401, logged by jose's code, never with the token. The
   token's `sub`, roles and mapped claims become the `PolicyContext`, and
   nothing in a body or a query does (0011).
3. `routes/runtime-menu.ts` reads each form's newest version, validated,
   leaves out one that does not validate or names a connection the
   allowlist lacks, saying so in the log, and reads each bundle alone into
   `menuForm`; `formMenu` (`packages/data-core/src/records/menu.ts`) names
   the forms the policy lets this person read, with the children
   `records/children.ts` derives. No database is asked
   ([0045](../decisions/0045-the-runtime-plane-lists-the-forms-a-person-may-read-and-nothing-about-the-others.md)),
   and Forms (`apps/host/src/forms-nav.tsx`) draws the menu
   ([0047](../decisions/0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md)).

Held by data-identity's `identity.test.ts`, `identity-keys.test.ts` and
`identity-file.test.ts` and the server's `identity-settings.test.ts`, a real
SIGHUP among them;
`scripts/mint-token.test.mjs`; `menu.test.ts` and `children.test.ts` in
`packages/data-core/src/records`; `routes/runtime-menu.test.ts`, where the
menu answers over a registry that refuses every connection, the same to the
byte after a form the person may not read is published; and
`apps/host/src/plane.test.tsx`: every request carries the token in its
header only. What it costs: every menu reads and validates every published
form; a form it names can be 409 `drift` when opened, since only opening
asks the database (0045); a host with no backend cannot hold a signing
secret (0014); a key file refused on SIGHUP is said in an `error` line (0059).

## 6.5 A page of records, sorted, searched and filtered

1. Opening a form, `GET /v1/forms/:id` (`routes/runtime.ts`), starts from
   what the policy grants (0045), describes the root in one statement, and
   offers only what the database allows now
   ([0041](../decisions/0041-the-runtime-refuses-what-drift-blocks.md)):
   `operations`, the readable fields, `list` -- what a page may be sorted,
   searched and filtered by, and the published views this person could
   have built from those (`listColumns`, 0105), or `null` -- and
   `deleting`.
2. The Records panel (`apps/host/src/record-grid.tsx`, `grid-datasource.ts`)
   asks one `POST /v1/forms/:id/records/list` per block of AG Grid's
   infinite row model, the search sent on Search or Enter, never per key
   (0047), and with every block the conditions its Filter panel applied
   (`apps/host/src/filter-panel.tsx`, over the fields `list.filterable`
   names) and the section's sort; a new filter or sort starts the grid again
   from its first row. A View picker (`apps/host/src/view-picker.tsx`) offers
   `list.views` and sets both at once, as one first page; the grid opens on
   the view marked `default`, when it is offered (0105).
3. `routes/runtime-lists.ts` checks the body and asks `planList`
   (`packages/data-core/src/records/list.ts`) before any statement:
   `listable` puts the read policy first -- its filter, every through
   ([0043](../decisions/0043-a-child-forms-rows-are-reached-only-through-a-parent-its-policy-admits.md)),
   the readable fields -- then needs a key that is NOT NULL and readable;
   `listOrder` ends the order with every key column, so it is total
   ([0044](../decisions/0044-a-forms-records-are-listed-a-page-at-a-time-under-its-read-policy.md));
   `columnFilter` plans each of the person's conditions on a readable
   column field, its values spelled as the column holds them, or refuses it
   400 `not-filterable`
   ([0104](../decisions/0104-a-list-and-a-browse-are-filtered-by-conditions-on-their-columns.md)).
4. Each adapter's `records/list.ts` runs one statement: the description and
   `limit + 1` rows from the offset, searched through `sql/search.ts`,
   ordered through `sql/order.ts`, its filters compared exactly
   ([0028](../decisions/0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md)),
   and each condition of the person's filter one more predicate, its
   values bound as the column's type (0104).
   A page drift stops is 409 `drift`, its rows never sent (0041).
   `recordPage` makes each row what a read by its token returns, the extra
   row saying whether more follow; the grid then resolves lookup labels.

Held by each adapter's `list.integration.test.ts`, its shared cases in
`LIST_PARITY` and `COLUMN_FILTER_PARITY`; `routes/runtime-lists.test.ts`;
`plan-list.test.ts` and `filter.test.ts` in
`packages/data-core/src/records`, and `views.test.ts` in
`packages/data-core/src/presentation`; `lists.integration.test.ts` in
`packages/data-client/src`; and `apps/host/src/grid-datasource.test.ts`,
`filter.test.tsx`, `views.test.ts` and `view-picker.test.tsx`.
What it costs: a page reads every row before it, by how the engines run an
offset, not measured here; the rest is 0044's and 0061's, in
[section 11.2](11-risks-and-debt.md#112-known-limitations-by-area).

## 6.6 Opening, creating and updating a record

1. A row opened sends `POST /v1/forms/:id/records/read` with its token, a
   reference and never a permission
   ([0012](../decisions/0012-a-lookup-token-is-a-reference-not-a-permission.md)).
   `planRead` (`packages/data-core/src/records/plan.ts`) decides filter,
   throughs and readable fields before any statement
   ([0018](../decisions/0018-one-planner-turns-answers-into-requests.md));
   the adapter returns the record as canonical text
   ([0008](../decisions/0008-exact-values-travel-as-strings.md)) and the
   description it is decided over (0041). One outside the filters is 404,
   as one that does not exist
   ([0015](../decisions/0015-a-record-operation-is-one-guarded-statement.md)).
2. A save in the host's session (`apps/host/src/session.ts`) sends the
   client's `create` or `update` with a new `formancy-write-id`
   ([0031](../decisions/0031-an-answer-lost-after-a-write-is-unknown.md)).
   `routes/write-once.ts` lets a write run the first time its id arrives;
   a later arrival gets that answer, audited `repeated`.
3. A create asks the policy, describes the root and removes the empty echo
   of a field the actor may not write
   ([0022](../decisions/0022-the-runtime-plane-asks-the-policy-every-time.md));
   `planCreate` pins the tenant from the context, refuses over-posting and
   drift, and reads every answer through its column's codec, in its unit
   ([0026](../decisions/0026-name-every-column-fact-the-engines-disagree-on.md)).
   An update reads the record first, where the actor may, to tell an
   unedited echo from a change, an instant or a time included
   ([0040](../decisions/0040-instants-and-times-are-read-to-the-shape-and-an-unedited-one-is-never-written.md));
   read at a version newer than the one sent, every echo of a field the
   actor may not write is removed, and the statement answers the save stale
   ([0098](../decisions/0098-an-echo-the-record-moved-since-it-was-read-is-a-stale-save.md)),
   and `planUpdate` needs a confirmed concurrency token.
4. Each lookup selection is checked by `lookups.rejects` under the actor's
   filters, with a deadline and no abandonment, since a write goes on after
   its client leaves; one that cannot answer is 503, nothing saved (6.8).
5. One guarded statement writes, carrying the definition it was decided
   over; an update's key, filters, throughs and expected version are one
   WHERE (PostgreSQL [0016](../decisions/0016-postgres-operations.md), SQL
   Server [0017](../decisions/0017-sqlserver-operations.md)). Zero rows is
   followed by one read that tells `stale` from `not-found`. Stale is 409,
   and the session keeps the person's draft, merging nothing (0029).
6. A connection lost after the write was sent is `unknown-outcome`: logged
   once, answered 502 with the operation, record and version
   (`routes/runtime-errors.ts`), and never sent again. The client counts a
   write known only when the server says what happened, and `reconcile`
   reads what was addressed; the session holds an unknown create until a
   check finds it absent or the person enters it again. A browser's own
   resend gets the first answer, and which browser resends is named
   ([0058](../decisions/0058-the-browser-gates-run-in-chromium-firefox-and-webkit-and-each-fact-the-browsers-disagree-on-is-named-and-held.md)).

Held by each adapter's `records.integration.test.ts`, where two updates
from one version give one winner and one `stale`; `routes/runtime.test.ts`
and `routes/write-once.test.ts`; `e2e-lost-answer.integration.test.ts`, on
both engines through a TCP hop that drops the answer: a create stored once,
an update's resend 409 `stale`;
`packages/data-client/src/lost-answer.integration.test.ts`; and
`apps/host/src/session.test.ts`. What it costs is
[section 8.6](08-crosscutting-concepts.md#86-optimistic-concurrency-and-write-ids)'s,
and SQL Server over-reports a trigger's ROLLBACK and raise as unknown (0031).

## 6.7 Deleting a record

1. Delete record in the detail's header, or a row's Delete, opens a
   confirmation in place, worded from the form's `deleting`
   (`apps/host/src/deletion.ts`, `delete-confirm.tsx`)
   ([0053](../decisions/0053-a-host-deletes-a-record-from-its-detail-or-its-row-after-a-confirmation-in-place.md)).
   The client's `delete` sends `POST /v1/forms/:id/records/delete` with the
   token, the version the person read and a write id.
2. `routes/runtime-deletes.ts` asks the policy and describes the root;
   `planDelete` (`packages/data-core/src/records/delete.ts`) checks filters
   and throughs, that the form offers delete, what a delete also does
   (`deleteProblems`), drift, the token and the version
   ([0050](../decisions/0050-a-record-is-deleted-one-at-a-time-by-its-token-and-the-version-its-person-read.md)).
3. Each adapter's `records/delete.ts` deletes one row or none in one
   guarded statement, refused when a foreign key the policy does not name
   would act on the delete
   ([0051](../decisions/0051-a-delete-reaches-other-tables-only-through-foreign-keys-the-policy-names.md)).
4. The answer is 200 `{ record, deleted: true }`; 404; 409 `stale`, `drift`
   or `schema-changed`; 422 `referenced`, naming nothing, the key's name in
   the log; or 502 `unknown-outcome`, and deleting again at that version
   deletes nothing else (0031). The page never calls a 404 deleted.

Held by `packages/data-core/src/records/plan-delete.test.ts` and
`policy/cascades.test.ts`; each adapter's `delete.integration.test.ts` and
`cascade.integration.test.ts`; `routes/runtime-deletes.test.ts`;
`packages/data-client/src/deletes.integration.test.ts`; and
`apps/host/src/delete.test.tsx` and `unknown-delete.test.tsx`. What it
costs: one record at a time, no undo; two presses for every delete; a row's
Delete is as old as its page, stale for a record changed since (0053).

## 6.8 Searching a lookup

1. A typeahead (0066) asks the option source `lookupSources` gives it
   (`packages/data-client/src/lookups.ts`), with the text and an abort
   signal; it sends `POST /v1/forms/:id/lookups/:source/query` with the
   operation the form is open for (0022).
2. `routes/runtime-lookups.ts` listens for the client leaving
   (`routes/abandoned.ts`), finds the lookup by its source name, asks its
   row filter and derives its config from the bindings and their snapshot
   (`buildLookupConfig`, 0012). A deadline starts when the adapter is asked
   (`lookup-deadline.ts`), and the signal aborts at it or when the client
   leaves ([0061](../decisions/0061-a-lookup-statement-stops-when-its-request-is-abandoned-or-its-deadline-passes.md)).
3. `lookups.search` runs one statement under that signal. PostgreSQL's runs
   on a client of its own (`drivers.ts`), and an abort sends a cancel
   (`packages/data-postgres/src/lookups/cancel.ts`); SQL Server's asks
   mssql's `request.cancel()`. It matches displayed text and whole-number
   columns, under the actor's filters (0028).
4. A page answers with whether more follow; a search past the deadline is
   503 `lookup-timeout`, since the same search reads as much again; a
   client that left is 499 `abandoned`, which only the audit trail reads.
   `FORMANCY_DATA_LOOKUP_DEADLINE_MS` replaces the default, derived from
   the figures in `docs/performance/results.json` and kept alone in
   `packages/data-core/src/lookup/default-deadline.ts`, outside the
   measured product ([0063](../decisions/0063-the-default-lookup-deadline-is-outside-the-measured-product.md)).
5. The source answers the renderer that page as `{ options, more,
   withheld }` (`optionsPage`): `more` from `hasMore`, `withheld` from
   `omitted`, never a total, and the page it asked for is the source's
   `maxRows`, the server's own bound. The renderer's `optionsStatus` says
   what the control shows: under a plain select that there are more than
   it can show; in an open typeahead to keep typing, on the status line
   the open list is drawn over; nothing under a closed typeahead or a
   field nobody can change
   ([0085](../decisions/0085-a-lookup-says-when-its-list-goes-on-never-how-long-it-is.md)).

Held by `routes/runtime-lookup-limits.integration.test.ts`, where on both
engines an abandoned search and one past its deadline stop waiting in the
database while its lock is still held; `routes/runtime-lookups.test.ts`,
over fake ports; `routes/abandoned.test.ts`; `lookup-deadline.test.ts`;
`packages/data-performance/src/deadline.test.ts`, which fails when the
default is not what the figures derive; and each adapter's
`lookups-sized.integration.test.ts`, pinning the rows a search reads
([0034](../decisions/0034-performance-is-measured-through-the-shipped-server-and-held-without-a-clock.md)).
What it costs: a search still reads every row its filter admits, so the
deadline caps how long and not how much; that a proxy passes the abort on
is held by no test; the PostgreSQL adapter reads and patches three private
properties of postgres.js, which an upgrade can move (0061). A cancel that
lands while a statement's rows are on their way ends it part-way, which
postgres.js 3.4.9 answered by placing the next statement's rows on that
connection after empty slots; the adapter collects each statement's rows
itself, so the next lookup answers as it would have, and nothing of the
stopped statement reaches it
([0078](../decisions/0078-a-postgresql-statements-rows-are-collected-as-the-driver-reads-them.md)).
That a search says when its list goes on is held by
`packages/data-client/src/lookups.integration.test.ts` on both engines,
over tenant 3's paged customers, and by `apps/host/src/lookup-more.test.tsx`
in both renderers; where the sentence is drawn, by the host's browser gate
(`apps/host/scripts/browser/more.mjs`). What it costs: no total, and a
typeahead's sentence is under its own open list, so the eye does not read
it (0085).

## 6.9 Reviewing drift, regenerating and restoring

1. The Drift step (`apps/studio/src/drift.tsx`) sends `POST
   /v1/forms/:id/drift`: the newest version, the database discovered now,
   and `diffSnapshots` (`packages/data-core/src/drift/diff.ts`) over the
   published snapshot, the current one, the bindings and the policy
   ([0010](../decisions/0010-drift-is-classified-against-the-bindings.md)).
2. Each change has a kind, a severity for this form -- blocking, review or
   info -- the fields it affects and a sentence. The report says what the
   form may still read and write, and `runtime`, what each request will
   refuse (0041). Privileges, row security and the account are kinds of
   their own (0027), and so is a key that acts on a delete (0050, 0051). A
   server this release was not tested on is `server-untested`
   (`drift/server.ts`), on every report, stopping nothing (0068).
3. Meanwhile each record request decides over its own description of the
   root by drift's root rules (`diffRootDefinition`, through
   `records/drift.ts`), and refuses with 409 `drift` what they stop (0041).
4. `POST /v1/forms/:id/regenerations` (`routes/admin-evolution.ts`) writes
   nothing: it generates again from the stored request, trials each lookup
   through `buildLookupConfig`, carries the presentation by
   `rebasePresentation` -- its list views by what their fields stand for,
   each dropped whole, `view-dropped`, where a field is gone or no longer
   offers what it asks (0105) -- and lists conflicts and reassigned keys
   (0030, 0039); the studio publishes the result as in 6.3.
5. `POST /v1/forms/:id/restorations` loads the version validated, discovers
   the database and asks `servable` (`publishing.ts`): another engine is
   422 `other-engine`, drift that blocks 409 `incompatible` with only those
   changes and nothing written; otherwise the stored document is the next
   version, by the store's compare-and-swap (0030). Under review a restore
   is a publisher's alone (0065).

Held by `diff.test.ts`, `columns.test.ts`, `relationships.test.ts` and
`privileges.test.ts` in `packages/data-core/src/drift`, every report they
build held by `drift/fixture.ts` to a runtime that never refuses what
review allows; `routes/runtime-drift.integration.test.ts`, where on both
engines the report's `runtime` is what the server then does;
`routes/admin-evolution.test.ts`; `e2e.integration.test.ts`, a table
altered under a published form on both engines; and
`apps/studio/src/versions.test.tsx`, and `server.test.ts` beside
`diff.test.ts`. What it costs: nothing reports drift but the Drift step
and, once a request is refused for it, the server's log; the runtime is
looser than review
([section 11.1](11-risks-and-debt.md#drift-between-a-published-form-and-its-database));
and a publisher alone restores any version, unreviewed ones too (0065).

## 6.10 Downloading a form's records

1. A client asks `POST /v1/forms/:id/records/export` with the search, the
   sort, the parent and the filter its grid shows
   ([0104](../decisions/0104-a-list-and-a-browse-are-filtered-by-conditions-on-their-columns.md)) -- `exportRecords` in
   `packages/data-client/src/client.ts`, accepting `text/csv,
   application/json` -- where the form's `list` is not `null`
   ([0079](../decisions/0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md)).
   On the host page it is Download CSV, in the head of the Records panel
   or of a child section (`apps/host/src/download.tsx`): the panel's
   submitted search, and the filter and sort the section holds and its
   grid's headers show
   ([0105](../decisions/0105-a-forms-list-offers-views-its-administrator-named.md)),
   and a child section's record as the parent
   ([0080](../decisions/0080-a-host-downloads-the-records-its-grid-lists-and-the-browser-saves-the-servers-file.md)). Its line says "Making <form id>.csv."; the button is
   `aria-disabled` and sends nothing more; the section leaving the page
   aborts the request.
2. `routes/runtime-exports.ts` starts the export's clock, checks the body
   (`validateExportQuery`), loads the bundle once and asks `planList` for
   the first page, so every refusal of the policy comes before a
   statement, as a list's does
   ([0044](../decisions/0044-a-forms-records-are-listed-a-page-at-a-time-under-its-read-policy.md)).
   `exportColumns` (`packages/data-core/src/records/export.ts`) takes the
   readable fields in the form's order and heads each; each lookup among
   them is scoped by `lookupScope` (`routes/runtime-lookups.ts`) under the
   person's read filter, and a filter the policy refuses refuses the file.
3. The connection's gate: one export at a time per allowlisted connection
   in this server, another meanwhile 503 `export-busy`, before any
   statement.
4. Page after page, each the first page's request at the next offset:
   before each, the export stops for a client that left (499,
   `routes/abandoned.ts`) or a deadline passed (503 `export-timeout`,
   `export-limits.ts`); then the adapter's one list statement, decided over
   its own description as a list page is
   ([0041](../decisions/0041-the-runtime-refuses-what-drift-blocks.md)),
   and `recordPage`. Then one resolve per lookup field for the page's
   tokens, its signal the lookup deadline cut to what is left of the
   export's
   ([0061](../decisions/0061-a-lookup-statement-stops-when-its-request-is-abandoned-or-its-deadline-passes.md)).
5. Each record is written by `exportRecord` through `csv.ts` -- canonical
   values, a lookup's label and token, the formula rule -- and counted:
   a key already written -- known by its values, so a record with no
   token is held to it too -- is 409 `moved`, text UTF-8 cannot carry or
   a lookup whose key fits no token 409 `unencodable`, a byte past
   `EXPORT_MAX_BYTES` 422 `export-too-large`.
   The trail's `rows` grows with each record written (0023).
6. When a page says nothing follows, the whole file is sent: 200,
   `text/csv; charset=utf-8`, `attachment; filename="<form id>.csv"`, its
   length. Anything that stopped it was answered with a JSON refusal and
   nothing of the file. The client keeps the body as a `Blob` only when it
   is CSV and arrived whole.
7. On the host page, a refusal is the server's sentence on the button's
   line, and pressing again is the retry. A file is handed to the browser
   by `saveFile` (`apps/host/src/save-file.ts`): an object URL of the
   `Blob`, an `<a download="<form id>.csv">` put in the document, clicked
   and taken out, the URL revoked in the task after; the line says "Made
   <form id>.csv; your browser saves it.", which is the page's side and not
   the browser's.

Held by `routes/runtime-exports.test.ts` and `export-limits.test.ts`;
`csv.test.ts`, `export.test.ts` and `list-query.test.ts` in
`packages/data-core/src/records`; each adapter's `list.integration.test.ts`,
its shared case `export: shipments` in `EXPORT_PARITY`;
`e2e.integration.test.ts` on both engines; `exports.integration.test.ts`
and `transport.test.ts` in `packages/data-client/src`; the host's
`export.test.tsx`, `save-file.test.ts` and `page.test.tsx`, and the
browser gate's `apps/host/scripts/browser/exporting.mjs`, whose download event
compares every byte with the server's (0080). What it costs: the
file is not the table at one moment, each page reads every row before its
offset, and the bounds are a budget and a derivation, not measurements
([section 11.2](11-risks-and-debt.md#112-known-limitations-by-area)).

## 6.11 Drilling down a form's levels

1. Drill down, the fourth choice of the open form's Layout group, shows one
   level at a time: the records, the record, then a child row of the level
   above and its own child sections, as deep as the menu's children go
   ([0090](../decisions/0090-a-hosts-workspace-can-drill-down-one-level-at-a-time-with-a-trail-back.md)). The level shown is the workspace's place,
   `#form=…&layout=drill&view=record&level=<n>` (`apps/host/src/layout.ts`),
   a number and never a record.
2. A row opened in a section of level n -- a click, Space or Enter -- or
   its New goes down. `apps/host/src/use-drill.ts` shows the level below
   again when it already holds that row; otherwise it asks the guard with a
   `drill` request, which drops every level below n
   (`apps/host/src/leave.ts`, owners named by `drillOwner` and
   `drillBase`), sends `POST /v1/forms/:child/records/read` (6.6), drops an
   answer the person has since moved past, and asks again on the answer,
   as `opening.ts` does. `apps/host/src/drill-level.tsx` draws the row in
   its own sessions, the parent's field preset and disabled, and lists its
   own children with `parent: { field, record }` (6.5), each child form's
   definition asked once per form.
3. A crumb (`apps/host/src/trail.tsx`) or Back shows a level above and
   drops nothing; an entry asking for a level no longer held shows the
   deepest one above it and is written over (`apps/host/src/address.ts`).
   In another layout, Back onto one of the form's own entries takes it
   over, written over with what the page shows, and the next Back goes on
   ([0097](../decisions/0097-back-goes-on-past-the-open-forms-own-entries-in-every-layout.md)).
   A crumb's name is read from the stored record by
   `apps/host/src/crumbs.ts`, when the level opens and after a save or a
   Load the saved record, which also has the section above list the row
   again.
4. A delete (6.7) of a record a level holds -- at its level, or from any
   grid in any layout, whose confirmation names the levels' work and drops
   nothing before Delete it
   ([0094](../decisions/0094-a-held-rows-delete-names-the-levels-it-drops-in-its-confirmation.md))
   -- takes that level and the levels below with it, matched by the record
   and not the depth, and shows the level above, replacing the entry, its
   section's grid saying the row is gone. Back, like a crumb, drops a
   row's read still out.

Held by `apps/host/src/drill.test.tsx` on both engines, `layout.test.ts`,
`leave.test.ts`, `crumbs.test.ts`, `address.test.tsx`, and the browser
gate's `apps/host/scripts/browser/drilling.mjs`. What it costs: the levels
are in memory only, so a reload opens the records; a row open on a rail in
another layout and the same row a level down are two panes; a crumb's name
comes from a rule over the form's fields (0090).

## 6.12 Browsing a connection's rows

1. In the studio's Browse step, after a discovery, an administrator whose
   token holds a role `FORMANCY_DATA_BROWSE_ROLES` names chooses a table or
   view, and a search; the step sends `POST /v1/connections/:id/browse`
   with the object, the search, a sort and a page. Without such a role
   `governance.ts` refuses it, 403 `browse-role-required`, before the
   route reads its body, and the step was listed as waiting for one
   ([0099](../decisions/0099-a-browse-role-reads-any-table-or-views-rows-as-the-connections-account-does.md)).
2. `routes/admin-browse.ts` checks the body (`validateBrowseQuery`), then
   discovers the connection again, as `GET …/metadata` does, and
   `planBrowse` plans the page over that snapshot: an object it holds, the
   columns the account may select that have canonical text, and an order
   ended by a key it shows or, for a view, by every shown column. The
   object is in the audit event from here, as `schema.name`.
3. The request is a list's (6.5): the adapter's `list` runs it as one
   statement, through its own `listTerms`, with no row filter of a policy's,
   only what the account's grants and row security apply, and `browsePage`
   keeps fifty rows and whether more follow. The answer names the columns
   shown, those left out and why, and how the page is ordered.
4. A row follows its foreign keys either way
   ([0103](../decisions/0103-a-browsed-row-follows-its-foreign-keys-either-way.md)).
   From the snapshot the step holds, `browseRelations`
   (`packages/data-core/src/records/follow.ts`) finds the object's own
   foreign keys, and those its `referencedBy` names (0049), that a browse
   can follow: both ends in the scope, and every column at both ends one
   the account may read, of a key kind. When there is one, each row has a
   Related button listing them as the browses they make; whether or not
   there is, the page names each key it cannot follow, and why, and says
   when a table's discovery could not tell that every key referring to it
   was listed. A follow sends
   the other end's object with `equal`: `followTerms` pairs its columns
   with the row's values by position, and a key holding a NULL follows
   nothing. The page left goes onto a trail, and Back sends it again as it
   was -- its offset, sort, search and `equal`.
5. The server plans a follow as any page, over its own discovery:
   `planBrowse` takes an `equal` term only for a column the page shows, of
   a key kind, with a value it can hold, and refuses anything else 400
   `not-comparable`, naming the column and never the value; a column named
   twice is a malformed body, refused before the discovery. The
   terms are the list's `equal`, bound as a child form's parent is (0044)
   and compared with the database's own equality, as the key compares
   them; the audit event names the object, never a value.
6. A page is filtered by the administrator's own conditions on its columns
   ([0104](../decisions/0104-a-list-and-a-browse-are-filtered-by-conditions-on-their-columns.md)).
   The step's Filter rows (`apps/studio/src/browse-filter.tsx`) offers each
   shown column what `filterOffer` gives it in the studio's discovery, and
   sends `filter`, a list of `{ column, op, … }`, with page one;
   `validateBrowseQuery` reads it (`readFilter`), and `planBrowse` plans
   each condition through `columnFilter` for a column the page shows, or
   refuses it 400 `not-filterable`, naming the column and never the value.
   The conditions reach the adapter as the list's `filter`, as a form's do
   (6.5), beside a follow's `equal`. Paging and sorting send the filter
   again; a follow starts the other end without one, and Back sends the
   page it left with its filter.

Held by `routes/admin-browse.test.ts`, `browse-roles.test.ts`, data-core's
`records/browse.test.ts` and `records/follow.test.ts`, both adapters'
`list.integration.test.ts` (the shared `browse:` cases, `browse: follows`
among them, and `column filter: date`, browsed) and the studio's
`browse.test.tsx` and `browse-filter.test.tsx`. What it costs:
whoever holds the role reads every row the connection's account can read;
every page is a discovery and a statement; rows of a view equal in every
shown column may trade places between pages; only keys over key kinds are
followed; following what refers to a row may read the whole referring
table, since neither engine indexes its columns by itself; and the trail
is lost on a reload
([section 11.2](11-risks-and-debt.md#112-known-limitations-by-area)).
