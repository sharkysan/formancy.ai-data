# Architecture decision records

Every decision here was actually made, in the order the numbers suggest, while
building Formancy Data. Where a decision was reversed or narrowed later, the
record says so and points at the one that superseded it. Where a decision rests
on one made in formancy.ai, the record cites it as `formancy.ai NNNN` with a
link, and does not restate it.

## Why these exist

Two audiences:

1. **Contributors**, who need to know why the obvious simpler thing was not
   done, so they do not helpfully undo it.
2. **Customers and evaluators**, deciding whether to build on this module, who
   want the reasoning and not just the result — especially about the licence
   and about what the module refuses to do with their database.

## Format

[MADR](https://adr.github.io/madr/)-shaped, trimmed to what is load-bearing:

```markdown
# NNNN — Title in the imperative

- **Status:** accepted | superseded by NNNN | reversed
- **Date:** YYYY-MM-DD
- **Deciders:** who
- **Verified by:** the tests, gates or files that hold this decision in place

## Context

The forces. What was true when the decision was made.

## Decision

What was decided, in one or two sentences.

## Consequences

What this buys, what it costs, and what it forecloses. The cost paragraph is
not optional: a record with no downside is marketing, not a decision.

## Alternatives considered

Each with the reason it lost.
```

**Verified by** is the field that distinguishes a decision record from an
opinion. If a decision is load-bearing, something in the repository fails when
it is violated — a test, a CI gate, a script the workflow runs. A record whose
only enforcement is "we remember" says so plainly.

## Index

| # | Decision | Status |
|---|---|---|
| [0001](0001-a-paid-module-in-its-own-repository.md) | A paid module lives in its own repository, under its own licence | accepted; extended by 0048 |
| [0002](0002-depend-on-upstream-never-copy-it.md) | Depend on released upstream packages at exact versions; never copy them | accepted; spec 4 window closed, 0042; extended by 0055 |
| [0003](0003-real-databases-in-every-test-run.md) | Database behaviour is proved against real servers, on both engines, in every run | accepted; narrowed by 0067, 0074; extended by 0073 |
| [0004](0004-a-snapshot-says-what-it-could-not-see.md) | A metadata snapshot says what it could not see, and is made in one place | accepted; narrowed by 0027; extended by 0049 |
| [0005](0005-one-fixture-written-twice.md) | One business model, written twice, and one comparator both adapters answer to | accepted; extended by 0026, 0027, 0034, 0043, 0049, 0056 |
| [0006](0006-postgres-discovery-reads-pg-catalog.md) | PostgreSQL discovery reads pg_catalog, and says what the account may not use | accepted; narrowed by 0027; extended by 0049, 0057, 0067, 0077 |
| [0007](0007-sqlserver-discovery-and-what-it-hides.md) | SQL Server discovery reads the catalog views, and names each thing they hide | accepted; narrowed by 0026, 0027, 0067; extended by 0049, 0068 |
| [0008](0008-exact-values-travel-as-strings.md) | Exact values travel as strings, are canonical, and are never rounded | accepted; narrowed by 0026, 0028; extended by 0079 |
| [0009](0009-generation-is-deterministic-and-says-what-it-chose.md) | A form is generated deterministically, and says what it chose and what it refused | accepted; narrowed by 0026, 0027, 0042, 0056; extended by 0066 |
| [0010](0010-drift-is-classified-against-the-bindings.md) | Drift is classified against the bindings | accepted; narrowed by 0026, 0027, 0028, 0041, 0049, 0050; extended by 0030, 0051, 0068 |
| [0011](0011-every-operation-carries-a-trusted-policy-context.md) | Every operation carries a trusted policy context | accepted; extended by 0043, 0050 |
| [0012](0012-a-lookup-token-is-a-reference-not-a-permission.md) | A lookup token is a reference, not a permission | accepted; narrowed by 0028, 0056; extended by 0044, 0061, 0085 |
| [0013](0013-published-configuration-is-files-with-link-based-swap.md) | Published configuration is files, and compare-and-swap is a hard link | accepted; extended by 0030, 0065; narrowed by 0062 |
| [0014](0014-host-identity-is-verified-offline.md) | Host identity is a token verified offline, with a pinned algorithm | accepted; extended by 0059; narrowed by 0101 |
| [0015](0015-a-record-operation-is-one-guarded-statement.md) | A record operation is one guarded statement, canonical in and out, never retried | accepted; narrowed by 0041; extended by 0031, 0043, 0044, 0050, 0079 |
| [0016](0016-postgres-operations.md) | PostgreSQL operations: canonical text in and out, every name from pg_catalog | accepted; narrowed by 0028, 0040, 0041; extended by 0031, 0043, 0044, 0050, 0051, 0061, 0078 |
| [0017](0017-sqlserver-operations.md) | SQL Server operations: one guarded batch, and a write reported done only when the table holds it | accepted; narrowed by 0026, 0028, 0031, 0040, 0041; extended by 0027, 0031, 0043, 0044, 0050, 0051, 0061 |
| [0018](0018-one-planner-turns-answers-into-requests.md) | One planner turns answers into requests, and leaves membership to the database | accepted; narrowed by 0028, 0041, 0095; extended by 0040, 0043, 0044, 0050 |
| [0019](0019-a-published-form-is-checked-every-time-it-is-read.md) | A published form is one bundle, checked every time it is read; a form reaches only allowlisted databases | accepted; extended by 0030, 0041, 0042, 0045, 0062, 0074 |
| [0020](0020-administration-is-a-separate-plane.md) | Administration is a separate plane, held by a role in the host's token | accepted; extended by 0033, 0065, 0099 |
| [0021](0021-generated-forms-preview-in-both-frameworks.md) | Generated forms are previewed in both frameworks, generated in the browser from a captured snapshot | accepted; narrowed by 0029; extended by 0058, 0069 |
| [0022](0022-the-runtime-plane-asks-the-policy-every-time.md) | The runtime plane asks the policy on every request, and removes only the echo it can prove | accepted; narrowed by 0031, 0040, 0098; extended by 0041, 0044, 0045, 0050 |
| [0023](0023-the-audit-trail-is-operational-not-evidence.md) | The audit trail is operational, never holds a value, and is not evidence | accepted; extended by 0031, 0033, 0044, 0045, 0050, 0079 |
| [0024](0024-the-studio-speaks-only-the-admin-plane.md) | The studio speaks only the administrator plane, holds the token in memory, and edits presentation with its own controls | accepted; narrowed by 0030; extended by 0032, 0052, 0058, 0060, 0062, 0065, 0075; palette copy reversed by 0096 |
| [0025](0025-each-adapter-owns-its-driver.md) | Each adapter package owns its driver, and one suite runs the whole product on both engines | accepted; extended by 0061, 0074 |
| [0026](0026-name-every-column-fact-the-engines-disagree-on.md) | Name every column fact the two engines disagree on, and check values in the column's own unit | accepted; narrowed by 0040 |
| [0027](0027-a-snapshot-says-what-its-account-may-do.md) | A snapshot says what its account may do, and whose it is | accepted; extended by 0049 |
| [0028](0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md) | Row filters, labels and refusals mean the same on both engines | accepted; narrowed by 0067; extended by 0079 |
| [0029](0029-a-host-renders-a-published-form-through-one-client.md) | A host renders a published form through one client of the runtime plane | accepted; narrowed by 0031, 0047, 0060, 0066, 0085; extended by 0032, 0058 |
| [0030](0030-presentation-is-a-patch-over-the-generated-base.md) | Presentation is a patch over the generated base, kept beside it, and carried to the next base by what each field stands for | accepted; narrowed by 0033, 0039, 0041, 0042, 0066; extended by 0062, 0075 |
| [0031](0031-an-answer-lost-after-a-write-is-unknown.md) | An answer lost after a write is unknown, carried to the host as such, and never replayed by anything here | accepted; extended by 0040, 0041, 0047, 0050, 0053, 0058 |
| [0032](0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md) | A clean install is the composed stack behind one proxy, and CI runs its guide | accepted; extended by 0035, 0037, 0046, 0051, 0059, 0071; narrowed by 0072, 0083 |
| [0033](0033-the-administrator-plane-is-audited.md) | The administrator's plane is audited like the runtime, one event per request | accepted; extended by 0060, 0062, 0065, 0099 |
| [0034](0034-performance-is-measured-through-the-shipped-server-and-held-without-a-clock.md) | Performance is measured through the shipped server against a sized lookup table, and held without a clock by rows read and round trips | accepted; narrowed by 0061, 0063, 0071, 0084; extended by 0061 |
| [0035](0035-a-release-report-is-derived-from-the-run-that-gated-it.md) | A release report is derived from the run that gated the release, and says what it did not test | accepted; extended by 0034, 0058, 0064, 0067, 0068; SBOM by 0092 |
| [0036](0036-a-merged-branch-is-deleted-by-the-merge.md) | A merged branch is deleted by the merge, and only by the merge | accepted |
| [0037](0037-cloudflare-is-the-edge-not-the-runtime.md) | Cloudflare is the edge, not the runtime: one locally-managed tunnel with generated doors, and a server that refuses a path a proxy could read differently | accepted; extended by 0045, 0069; narrowed by 0070, 0071 |
| [0038](0038-readme-pictures-are-taken-by-a-script-and-held-to-the-text-they-show.md) | README pictures are taken by a script from states the product reaches, and held to the text they show | accepted; extended by 0058, 0072; narrowed by 0062 |
| [0039](0039-a-publish-says-what-happens-to-the-grants-of-reassigned-keys.md) | The server refuses a publish whose keys now name other columns, unless it says what happens to their grants | accepted; extended by 0043, 0062, 0065 |
| [0040](0040-instants-and-times-are-read-to-the-shape-and-an-unedited-one-is-never-written.md) | Instants and times are read to formancy's shape on both engines, and an unedited one is never written back | accepted; narrowed by 0041; extended by 0041, 0079 |
| [0041](0041-the-runtime-refuses-what-drift-blocks.md) | The runtime refuses what drift blocks in the form's own table, decided over a description read in each request, and every write holds the table to it | accepted; extended by 0044, 0050, 0051 |
| [0042](0042-generated-forms-stay-on-spec-3-after-spec-4-is-released.md) | Generated forms stay on spec 3 after spec 4 is released | accepted |
| [0043](0043-a-child-forms-rows-are-reached-only-through-a-parent-its-policy-admits.md) | A child form's rows are reached only through a parent its policy admits | accepted; extended by 0044, 0050, 0079 |
| [0044](0044-a-forms-records-are-listed-a-page-at-a-time-under-its-read-policy.md) | A form's records are listed a page at a time under its read policy, searched and paged as a lookup is | accepted; narrowed by 0056; extended by 0079, 0099 |
| [0045](0045-the-runtime-plane-lists-the-forms-a-person-may-read-and-nothing-about-the-others.md) | The runtime plane lists the forms a person may read, and nothing about the others | accepted; extended by 0050 |
| [0046](0046-a-built-app-carries-the-licence-and-notice-texts-of-everything-it-bundles.md) | A built app carries the licence and notice texts of everything it bundles | accepted; extended by 0069, 0072 |
| [0047](0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md) | A host's workspace lists, opens and edits records in linked grids, on the runtime plane alone | accepted; extended by 0050, 0058, 0070, 0080; narrowed by 0053; amended by 0097 |
| [0048](0048-the-licence-is-in-force-before-a-lawyer-has-read-it.md) | The licence is in force before a lawyer has read it | accepted; extended by 0054; amended by 0064 |
| [0049](0049-a-snapshot-says-whether-its-account-may-delete-and-what-refers-to-each-table.md) | A snapshot says whether its account may delete from each table, and every foreign key that refers to it | accepted; narrowed by 0050; extended by 0056 |
| [0050](0050-a-record-is-deleted-one-at-a-time-by-its-token-and-the-version-its-person-read.md) | A record is deleted one at a time, by its token and the version its person read, under the form's policy, in one guarded statement | accepted; narrowed by 0067; extended by 0051, 0052, 0053, 0057 |
| [0051](0051-a-delete-reaches-other-tables-only-through-foreign-keys-the-policy-names.md) | A delete reaches other tables only through foreign keys the policy names, each with what it does | accepted; narrowed by 0067; extended by 0052, 0053 |
| [0052](0052-the-studio-says-before-publication-who-may-delete-and-what-a-delete-also-does.md) | The studio says before publication who may delete and what a delete also does, and asks for each foreign key by name | accepted; extended by 0058 |
| [0053](0053-a-host-deletes-a-record-from-its-detail-or-its-row-after-a-confirmation-in-place.md) | A host deletes a record from its detail or its row, after a confirmation in place, and says what the server did | accepted; extended by 0058 |
| [0054](0054-version-1-1-names-the-address-for-a-redistribution-agreement-too.md) | Version 1.1 of the licence names the address for a redistribution agreement too | accepted |
| [0055](0055-an-upstream-release-is-adopted-the-day-it-is-published.md) | An upstream release is adopted the day it is published, and only upstream is exempt from the release age | accepted |
| [0056](0056-a-key-the-database-fills-is-never-written-and-a-uuid-is-ordered-as-each-engine-orders-it.md) | A key the database fills is never written by a form unless the person gives another part of it, and a uuid is ordered as each engine orders it | accepted |
| [0057](0057-a-key-of-one-column-filled-by-a-never-repeating-default-counts-as-numbered.md) | A key of one column that `gen_random_uuid()` or `newsequentialid()` fills, and no foreign key includes, counts as one the database numbers | accepted |
| [0058](0058-the-browser-gates-run-in-chromium-firefox-and-webkit-and-each-fact-the-browsers-disagree-on-is-named-and-held.md) | The browser gates run in Chromium, Firefox and WebKit, and each fact the browsers disagree on is named and held | accepted; extended by 0072, 0083 |
| [0059](0059-the-host-identity-key-is-a-set-selected-by-kid-and-read-again-on-sighup.md) | The host identity key is a set selected by kid, read again from its file on SIGHUP, and nothing is fetched | accepted |
| [0060](0060-the-runtime-plane-answers-the-origins-an-operator-lists-and-the-administrators-plane-none.md) | The runtime plane answers the origins an operator lists, exactly, and the administrator's plane answers no other origin | accepted; extended by 0079 |
| [0061](0061-a-lookup-statement-stops-when-its-request-is-abandoned-or-its-deadline-passes.md) | A lookup statement stops when its request is abandoned or its deadline passes, and a search is not bounded before it scans | accepted; extended by 0063, 0079 |
| [0062](0062-a-published-version-moves-between-deployments-as-its-version-file.md) | A published version moves between deployments as its version file, and is imported as a publish the target's database must be able to serve | accepted; extended by 0065 |
| [0063](0063-the-default-lookup-deadline-is-outside-the-measured-product.md) | The default lookup deadline is outside the measured product | accepted |
| [0064](0064-the-first-releases-notes-summarise-the-development-before-it.md) | The first release's notes summarise the development before it | accepted |
| [0065](0065-with-publisher-roles-set-a-draft-is-published-only-when-a-publisher-who-did-not-submit-it-approves-it.md) | With publisher roles set, a draft is published only when a publisher who did not submit it approves it, and a restore is one publisher's alone | accepted; extended by 0099 |
| [0066](0066-a-lookup-a-person-can-search-is-generated-as-a-typeahead.md) | A lookup a person can search is generated as a typeahead, and a host draws the control it is given | accepted; extended by 0085 |
| [0067](0067-the-adapter-suites-run-on-every-image-of-a-per-engine-matrix.md) | The adapter suites run on every image of a per-engine matrix, and what the versions disagree on is named | accepted; extended by 0077 |
| [0068](0068-a-snapshot-records-the-server-it-was-read-from-and-nothing-refuses-a-server-discovery-can-read.md) | A snapshot records the server it was read from, data-core says whether this release was tested on it, and nothing refuses a server discovery can read | accepted |
| [0069](0069-the-examples-page-is-served-at-formancy-ai-data-examples.md) | The examples page is served at formancy.ai/data/examples/, by a Worker of its own that Cloudflare deploys from main, under a policy that refuses anything inline | accepted; narrowed by 0072; extended by 0070, 0083 |
| [0070](0070-the-live-demo-runs-the-real-server-and-postgresql-in-a-cloudflare-container-of-each-visitors-own.md) | The live demo at formancy.ai/data/demo/ runs the real data server and PostgreSQL in a Cloudflare Container of each visitor's own, started only by a sign-in and gone when it sleeps | accepted; narrowed by 0086, 0087; extended by 0088 |
| [0071](0071-the-server-believes-the-forwarded-address-only-from-the-proxies-an-operator-names.md) | The server believes a forwarded client address only from the proxies an operator names, each by its address, and the composed stack names its nginx and cloudflared alone | accepted |
| [0072](0072-the-apps-serve-their-own-fonts-and-no-page-asks-another-host-for-anything.md) | The apps serve their own fonts, from Fontsource's packages at the release formancy.ai installs, and no page asks another host for anything | accepted; narrowed by 0096 |
| [0073](0073-azure-sql-is-not-tested-and-the-release-says-so.md) | Azure SQL Database and Azure SQL Managed Instance are not tested, and the release says so where it said nothing | accepted; narrowed by 0074 |
| [0074](0074-a-sql-server-connection-may-log-in-as-an-entra-principal-and-no-test-logs-in-as-one.md) | A SQL Server connection may log in as an Entra managed identity or service principal, over TDS 8.0 with one credential per connection asked for Azure SQL's token alone, and no test logs in as either | accepted; extended by 0081 |
| [0075](0075-a-field-may-move-to-another-generated-section.md) | A field may move to another generated section, recorded on its own entry and carried by what it stands for | accepted |
| [0076](0076-the-architecture-is-documented-as-arc42-and-every-change-updates-the-section-it-touches.md) | The architecture is documented as arc42 in docs/architecture, and every change updates the section it touches | accepted |
| [0077](0077-a-not-null-added-not-valid-is-read-as-the-unvalidated-check-it-is.md) | A NOT NULL that PostgreSQL 18 added NOT VALID is read as the check it is: the column nullable, the constraint enforced and not validated | accepted |
| [0078](0078-a-postgresql-statements-rows-are-collected-as-the-driver-reads-them.md) | A PostgreSQL statement's rows are collected as the driver reads them, never taken from the array it resolves with | accepted |
| [0079](0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md) | A person downloads the records a list shows them as one CSV file, made whole or not at all | accepted; extended by 0080 |
| [0080](0080-a-host-downloads-the-records-its-grid-lists-and-the-browser-saves-the-servers-file.md) | A host downloads the records its grid lists, and the browser saves the server's file | accepted |
| [0081](0081-a-sql-login-that-asks-for-tls-is-refused-when-the-server-answers-that-it-will-not-encrypt.md) | A SQL login that asks for TLS is refused when the server answers that it will not encrypt, before its login is sent | accepted; tedious 20.3.7 refuses too, the guard stays |
| [0082](0082-a-sql-server-container-that-never-becomes-ready-says-how-it-ended-and-is-given-no-memory-bound.md) | A SQL Server container that never becomes ready fails its start with how Docker says it ended, and is given no memory bound | accepted |
| [0083](0083-the-studio-and-the-host-page-are-served-under-a-content-security-policy-each.md) | The studio and the host page are served under a Content-Security-Policy each, the examples page's with only what each was measured needing | accepted |
| [0084](0084-a-release-does-not-wait-for-the-performance-figures-to-be-measured-again.md) | A release does not wait for the performance figures to be measured again | accepted |
| [0085](0085-a-lookup-says-when-its-list-goes-on-never-how-long-it-is.md) | A lookup says when its list goes on, never how long it is | accepted |
| [0086](0086-a-failed-start-of-the-live-demo-says-why-in-the-workers-live-log.md) | A failed start of the live demo says why in the Worker's live log | accepted; extended by 0087 |
| [0087](0087-a-live-demo-start-cloudflare-has-no-instance-for-is-started-again-within-a-minute.md) | A live demo start Cloudflare has no instance for is started again, within a minute | accepted |
| [0088](0088-the-demo-image-makes-postgresqls-socket-directory-at-every-start-and-the-gate-runs-it-with-run-empty.md) | The demo image makes PostgreSQL's socket directory at every start, and the gate runs it with /run empty, as Cloudflare does | accepted |
| [0089](0089-the-live-demos-account-may-not-write-when-a-customer-was-created.md) | The live demo's account may not write when a customer was created | accepted |
| [0090](0090-a-hosts-workspace-can-drill-down-one-level-at-a-time-with-a-trail-back.md) | A host's workspace can drill down one level at a time, with a trail back | accepted; amended by 0094, 0097 |
| [0091](0091-the-host-identity-verifier-is-a-package-of-its-own-which-the-server-re-exports.md) | The host identity verifier is a package of its own, which the server re-exports | accepted |
| [0092](0092-the-sbom-describes-what-a-consumer-installs-and-is-held-to-that-install.md) | The SBOM describes what a consumer installs, and is held to that install | accepted |
| [0093](0093-a-column-named-proto-is-generated-under-another-key.md) | A column named `__proto__` is generated under another key, and `constructor` keeps its own | accepted |
| [0094](0094-a-held-rows-delete-names-the-levels-it-drops-in-its-confirmation.md) | A row a Drill down level holds names the levels it drops in its Delete's confirmation, and drops nothing before Delete it | accepted |
| [0095](0095-a-nullable-yes-no-column-is-a-select-of-yes-and-no.md) | A nullable yes/no column is a select of Yes and No, not a radio group | accepted |
| [0096](0096-the-apps-wear-formancys-room-css-rather-than-a-copy-of-admin-css.md) | The apps wear formancy's `room.css` rather than a copy of `admin.css` | accepted |
| [0097](0097-back-goes-on-past-the-open-forms-own-entries-in-every-layout.md) | Back goes on past the open form's own entries in every layout | accepted |
| [0098](0098-an-echo-the-record-moved-since-it-was-read-is-a-stale-save.md) | An echo the record moved since it was read is a stale save, not over-posting | accepted |
| [0099](0099-a-browse-role-reads-any-table-or-views-rows-as-the-connections-account-does.md) | A browse role reads any table or view's rows, a page at a time, as the connection's account reads them | accepted |
| [0101](0101-a-host-token-is-refused-unless-it-is-its-compact-form-exactly.md) | A host token is refused unless it is its compact form exactly | accepted |
