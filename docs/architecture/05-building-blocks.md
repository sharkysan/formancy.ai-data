# 5. Building blocks

## Level 1 — the workspace

The workspace is what `pnpm-workspace.yaml` names, `packages/*` and
`apps/*`, and nothing else: the guards under `scripts/` and the stack under
`deploy/` are not packages. Dependencies point downward only. `data-core`
decides, an adapter translates, the server composes, and each app speaks
one plane.

```
apps         examples              studio                  host
(private)    data-core             data-core               data-client
             react · angular       builder-core · react    react · angular
             no server             administrator plane     runtime plane
──────────────────────────────────────────────────────────────────────────
server       data-server           Fastify, jose; meets the adapters in
                                   drivers.ts and nowhere else
──────────────────────────────────────────────────────────────────────────
edges        data-postgres         data-sqlserver          data-client
             data-core, postgres   data-core, mssql        data-core, fetch
──────────────────────────────────────────────────────────────────────────
core         data-core             @formancy/spec at run time and nothing
                                   else: no driver, no HTTP, no Node
──────────────────────────────────────────────────────────────────────────
upstream     @formancy/spec · core · react · angular · themes · builder-core
             released Apache-2.0 packages at exact versions, never copied

beside them, private, for tests and measurement:
             data-fixtures         data-core, both drivers, testcontainers
             data-performance      data-server, data-client, both adapters,
                                   data-fixtures

and the live demo's own code, private, which nothing installs:
             live-demo             data-core; the demo's data, people, forms
                                   and Worker, which forwards the runtime plane
```

What each manifest lets it import:

| Package | Published | At run time | Besides, in its tests and scripts |
|---|---|---|---|
| `@formancy/data-core` | yes | `@formancy/spec` | `@formancy/core` |
| `@formancy/data-postgres` | yes | data-core, `postgres` | data-fixtures |
| `@formancy/data-sqlserver` | yes | data-core, `mssql`, `@types/mssql` | data-fixtures |
| `@formancy/data-client` | yes | data-core, `@formancy/spec` | data-server, data-fixtures, both drivers, `jose`, `@formancy/core` |
| `@formancy/data-server` | yes | data-core, data-postgres, data-sqlserver, `@formancy/spec`, `fastify`, `@fastify/rate-limit`, `jose` | data-fixtures |
| `@formancy/data-fixtures` | no | data-core, `postgres`, `mssql`, testcontainers, `vitest` | — |
| `@formancy/data-performance` | no | data-core, data-client, data-server, both adapters, data-fixtures, both drivers, `jose` | — |
| `@formancy/data-examples` | no | data-core; formancy's renderers, engine, spec and themes; Fontsource's faces; React, Angular | data-fixtures, data-postgres and `postgres` for the snapshot capture; `@formancy/conformance` |
| `@formancy/data-studio` | no | data-core, `@formancy/builder-core`; formancy's React renderer, engine, spec and themes; Fontsource's faces; React | data-server, both adapters, data-fixtures, `@formancy/conformance` |
| `@formancy/data-host` | no | data-client; formancy's renderers, engine, spec and themes; Fontsource's faces; AG Grid Community; React, Angular | data-core, data-server, data-fixtures, both drivers, `@formancy/conformance`; data-live-demo, for the Worker's answer types in the demo build and its code in the tests |
| `@formancy/data-live-demo` | no | data-core, in the Worker and the image's programs | data-server and data-fixtures in its tests and the image's build; `postgres`; `@cloudflare/workers-types`, for the Worker's types alone |

**What holds it.** The manifests, and pnpm's isolated linker
(`node-linker=isolated` in `.npmrc`), which links into a package's
`node_modules` only what that manifest declares: an import of anything
else does not resolve, unless the root manifest happens to declare it, and
`pnpm typecheck` and `pnpm build` fail. Every `tsdown.config.ts` under
`packages/` sets `deps: { onlyBundle: [] }`, so a build that would inline a
package nobody declared fails, naming it ([0046](../decisions/0046-a-built-app-carries-the-licence-and-notice-texts-of-everything-it-bundles.md)).
`data-core` declares no `@types/node`, the rule `@formancy/core` holds
upstream for the same reason
([formancy.ai 0008](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0008-layered-packages.md));
`data-client` compiles with the DOM library and `types: []`, so its source
sees the browser's globals and not Node's.

**What does not hold it.** No test reads the import graph. A development
dependency is as importable from source as a runtime one, so that the
studio's source takes only types from `@formancy/data-server`
(`import type`, for the plane's answers) and that the host's source reaches
`data-core` only through `data-client`'s re-exports are held by review.

Repository rules sit on the same line. Upstream packages are
dependencies at exact released versions and none of their code is here
([0002](../decisions/0002-depend-on-upstream-never-copy-it.md)), adopted the
day they are published and exempt from pnpm's release age by name and
version alone
([0055](../decisions/0055-an-upstream-release-is-adopted-the-day-it-is-published.md)):
`scripts/upstream-deps.mjs`, in `pnpm test:repo`. Every published package
declares the source-available licence and ships `LICENSE.md` and `NOTICE`
([0001](../decisions/0001-a-paid-module-in-its-own-repository.md)):
`scripts/verify-licenses.mjs`, in the gates. And only `data-fixtures` may
declare testcontainers, so a suite or a gate that starts a container
through it does so through data-fixtures, which records what answered for
the release report
([0035](../decisions/0035-a-release-report-is-derived-from-the-run-that-gated-it.md)):
`scripts/release-report/tested-on.test.mjs`. It reads declarations only;
compose and `docker run` start databases it does not see.

Packages meet each other through `dist/`: every `exports` map points there,
and turbo builds a package's dependencies before its tests
(`dependsOn: ["^build"]` in `turbo.json`). Inside the workspace a sibling
still resolves through a symlink, so `pnpm test:e2e:install`
(`scripts/install-test.mjs`) packs the published packages, installs the
tarballs into a plain npm project and type-checks it with `skipLibCheck`
off: the one gate that sees a package as a consumer does.

## Level 2 — inside each package

### `@formancy/data-core`

The database-neutral core: what both adapters must agree on, so nothing
above them needs to know which engine answered. No driver, no HTTP, no
Node. Its suites sit beside the modules they test and need no Docker.

| Module | Responsibility |
|---|---|
| `adapter.ts` | `DatabaseAdapter` — `ping`, `discover`, `close` — and `DATABASE_KINDS`, a tuple, so a third engine is a compile error wherever a `switch` covers them |
| `metadata.ts`, `snapshot.ts` | `MetadataSnapshot`, and `createSnapshot`, the only way one is made: sorted by codepoint, checked, fingerprinted with `@formancy/spec`'s canonical hash. It carries what it could not see as gaps ([0004](../decisions/0004-a-snapshot-says-what-it-could-not-see.md)), whose it is and what that account may do column by column ([0027](../decisions/0027-a-snapshot-says-what-its-account-may-do.md)), the column facts the engines disagree on ([0026](../decisions/0026-name-every-column-fact-the-engines-disagree-on.md)), and DELETE and every key that refers to each table ([0049](../decisions/0049-a-snapshot-says-whether-its-account-may-delete-and-what-refers-to-each-table.md)) |
| `server.ts` | Which servers this release was tested on, and whether a given one is: `TESTED_SERVERS`, the majors of the test matrix and SQL Server's compatibility floor; `serverStanding`, tested or not with a sentence a person reads, an unknown never tested; `SQLSERVER_RELEASES`, the one table of SQL Server's years. Each adapter translates what its server answered into these facts, the snapshot carries them outside the fingerprint, and nothing here refuses a server ([0068](../decisions/0068-a-snapshot-records-the-server-it-was-read-from-and-nothing-refuses-a-server-discovery-can-read.md)) |
| `generate/` | `generateForm`: a spec 3 document, its `FormBindings` and a note on every choice, the same bytes on every run ([0009](../decisions/0009-generation-is-deterministic-and-says-what-it-chose.md)). `controls.ts` is the control a column's type gets; `access.ts` what the account may do, applied to the form; `names.ts` the field keys; `offers.ts` which writes a form offers, and `numbersKey`, the one answer to whether the database numbers a key ([0056](../decisions/0056-a-key-the-database-fills-is-never-written-and-a-uuid-is-ordered-as-each-engine-orders-it.md), [0057](../decisions/0057-a-key-of-one-column-filled-by-a-never-repeating-default-counts-as-numbered.md)); `version.ts` the spec version written and the bindings version read ([0042](../decisions/0042-generated-forms-stay-on-spec-3-after-spec-4-is-released.md)). A lookup a person can search is a typeahead ([0066](../decisions/0066-a-lookup-a-person-can-search-is-generated-as-a-typeahead.md)) |
| `policy/` | `FormPolicy` over a trusted `PolicyContext`, deny by default ([0011](../decisions/0011-every-operation-carries-a-trusted-policy-context.md)). `inputs.ts` reads both at run time before anything is decided; `evaluate.ts` answers each question or refuses; `validate.ts` is `validatePolicy`; `through.ts` scopes a child form through a parent ([0043](../decisions/0043-a-child-forms-rows-are-reached-only-through-a-parent-its-policy-admits.md)); `cascades.ts` is what a delete also does, and whether the policy names it ([0050](../decisions/0050-a-record-is-deleted-one-at-a-time-by-its-token-and-the-version-its-person-read.md), [0051](../decisions/0051-a-delete-reaches-other-tables-only-through-foreign-keys-the-policy-names.md)) |
| `presentation/` | The patch over the generated base ([0030](../decisions/0030-presentation-is-a-patch-over-the-generated-base.md)). `layout.ts` reads the one layout shape the generator writes; `derive.ts` (`presentationOf`) refuses every edit but a label, a place in its section's grid, a move to another generated section that leaves each section a field ([0075](../decisions/0075-a-field-may-move-to-another-generated-section.md)), and full width; `placement.ts` is where fields sit once the moves are made, which applying, deriving and rebasing all ask; `apply.ts` is what the server checks a stored form against; `rebase.ts` carries a patch to a new base, its moves through `rebase-moves.ts`, and names the keys that now stand for another column ([0039](../decisions/0039-a-publish-says-what-happens-to-the-grants-of-reassigned-keys.md)) |
| `records/` | Where a browser's request meets the policy, the codecs, the tokens and the bindings ([0018](../decisions/0018-one-planner-turns-answers-into-requests.md)): `plan.ts` for one record, `list.ts` for a page ([0044](../decisions/0044-a-forms-records-are-listed-a-page-at-a-time-under-its-read-policy.md)), `export.ts` and `csv.ts` for a file of every page -- its columns, each value as text, `canonicalValue` undoing what a control holds, and RFC 4180 with the formula rule -- and `list-query.ts`'s `validateExportQuery` for its body ([0079](../decisions/0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md)), `delete.ts` ([0050](../decisions/0050-a-record-is-deleted-one-at-a-time-by-its-token-and-the-version-its-person-read.md)), `drift.ts` for what a request refuses over the table as it described it ([0041](../decisions/0041-the-runtime-refuses-what-drift-blocks.md)), `menu.ts` and `children.ts` for the menu ([0045](../decisions/0045-the-runtime-plane-lists-the-forms-a-person-may-read-and-nothing-about-the-others.md)). `types.ts` declares `RecordAdapter`. Each `*-terms.ts` is how an adapter reads a request, and throws on one the planner would not have made |
| `lookup/` | The database-neutral half of a lookup ([0012](../decisions/0012-a-lookup-token-is-a-reference-not-a-permission.md)): `token.ts` the key token, `config.ts` `buildLookupConfig`, `rows.ts` membership and paging, `filters.ts` and `display.ts` row filters and labels that mean the same on both engines ([0028](../decisions/0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md)), `search.ts` and `searchable.ts` what a search may be, shared with a list. `types.ts` declares `LookupAdapter`. `default-deadline.ts` holds the measured default deadline and nothing else ([0061](../decisions/0061-a-lookup-statement-stops-when-its-request-is-abandoned-or-its-deadline-passes.md), [0063](../decisions/0063-the-default-lookup-deadline-is-outside-the-measured-product.md)) |
| `drift/` | `diffSnapshots`, every change classified against one form's bindings and policy ([0010](../decisions/0010-drift-is-classified-against-the-bindings.md)), and `diffRootDefinition`, its root families alone, which a request asks (0041). One family per file: `columns.ts`, `relationships.ts`, `access.ts` for gaps, `privileges.ts` for the account, `referrers.ts` for what a delete acts through, `server.ts` for a server this release was not tested on, which stops nothing (0068). `fixture.ts` is test support that `index.ts` does not reach |
| `codecs/` | `codecFor(column)`: exact numbers as strings, never rounded ([0008](../decisions/0008-exact-values-travel-as-strings.md)); text counted in its column's own unit (0026); dates and times in formancy's shapes, taken from `@formancy/spec` ([formancy.ai 0067](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0067-a-temporal-answer-is-one-fixed-width-string.md)), which both adapters cut a stored instant or time to, so `planUpdate` never writes back an unedited one ([0040](../decisions/0040-instants-and-times-are-read-to-the-shape-and-an-unedited-one-is-never-written.md)); a concurrency token as text |
| `runtime.ts` | The runtime plane's answers, declared once so the server that sends them and the client that reads them compile against one shape ([0029](../decisions/0029-a-host-renders-a-published-form-through-one-client.md)); the write id's header ([0031](../decisions/0031-an-answer-lost-after-a-write-is-unknown.md)), the list's page size, a file's byte budget `EXPORT_MAX_BYTES` and its name `exportFileName` ([0079](../decisions/0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md)), and the headers a cross-origin request may carry ([0060](../decisions/0060-the-runtime-plane-answers-the-origins-an-operator-lists-and-the-administrators-plane-none.md)) |

Bundle validation is not here. `validateBundle` is the server's
(`packages/data-server/src/bundle.ts`), and asks this package: the
fingerprint through `createSnapshot`, `bindingsVersionProblem`,
`validatePolicy`, `rowFilterColumnProblem`, `throughProblems`,
`deleteProblems`, `presentationShapeProblems` and `applyPresentation` on
every read, and `generateForm` at every write but a restore.

### The ports

| Port | Declared in | Asked | PostgreSQL | SQL Server |
|---|---|---|---|---|
| `DatabaseAdapter` | `adapter.ts` | `ping`, `discover`, `close` | `createPostgresAdapter` | `createSqlServerAdapter` |
| `RecordAdapter` | `records/types.ts` | `describe`, `read`, `list`, `insert`, `update`, `delete` | `createPostgresRecords` | `createSqlServerRecords` |
| `LookupAdapter` | `lookup/types.ts` | `search`, `resolve`, `rejects`, each with the actor's filters and a signal | `createPostgresLookups` | `createSqlServerLookups` |

Records and lookups are ports of their own beside `DatabaseAdapter`, so the
two halves are built and tested apart; a write is one guarded statement,
canonical in and out, and never retried
([0015](../decisions/0015-a-record-operation-is-one-guarded-statement.md)).
Each port has two implementations and something that fails when they
disagree, against real servers in every run (0003): discovery answers to
`FIXTURE_MODEL` through `data-fixtures`' comparators
([0005](../decisions/0005-one-fixture-written-twice.md)); records, lists,
deletes and lookups answer to expectations written once in `data-fixtures`,
which a test names with `covers()`, and the release report fails a run in
which a shared case passed through one adapter only
([0035](../decisions/0035-a-release-report-is-derived-from-the-run-that-gated-it.md));
and `packages/data-server/src/e2e.integration.test.ts` runs the whole
product on both engines
([0025](../decisions/0025-each-adapter-owns-its-driver.md)).

The server has interfaces that are not database ports. `ConnectionFactory`
is the composition root's, so the registry is tested with a fake.
`AuditSink` is a function whose default writes the server's log
([0023](../decisions/0023-the-audit-trail-is-operational-not-evidence.md)).
`ConfigurationStore` is an interface with one implementation,
`createFileConfigurationStore`, kept for a second that
[0013](../decisions/0013-published-configuration-is-files-with-link-based-swap.md)
names — a shared store for more than one instance — and that does not exist.
`config-store.test.ts` is written against the interface; nothing fails while
the second is missing.

### Inside each adapter

Each adapter package owns its driver and opens its own connections, so a
connection and the code that binds values on it come from one copy of the
driver (0025). Nothing in either reads configuration: the composition root
connects and hands the driver in. One catalog concern per file in
`discovery/`; quoting, binding and statement building in `sql/`; the
operations in `records/` and `lookups/`.

| Concern | `data-postgres` | `data-sqlserver` |
|---|---|---|
| Connecting | `connect.ts`, `connectPostgres`, over postgres.js | `connect.ts`, `connectSqlServer`, over mssql; no native module, no ODBC. A SQL login, over TDS 7 through `encryption.ts`'s connector when it asks for TLS, which refuses a server that answers it will not encrypt before the login is sent ([0081](../decisions/0081-a-sql-login-that-asks-for-tls-is-refused-when-the-server-answers-that-it-will-not-encrypt.md)); or an Entra principal through `entra.ts`, over TDS 8.0: one credential for each login it is given, kept across pools, asked for Azure SQL's token alone, and a failed login said in a sentence naming nothing of the principal ([0074](../decisions/0074-a-sql-server-connection-may-log-in-as-an-entra-principal-and-no-test-logs-in-as-one.md)) |
| `DatabaseAdapter` | `adapter.ts`, and `server.ts`, the one query ping and discovery share for what the server is (0068) | `adapter.ts`, and `server.ts`, the same query, and the refusal of a catalog without `sys.edge_constraints`, every release before 2019 (0068) |
| `discovery/` | `pg_catalog`, one query per concern, all in one `REPEATABLE READ` read-only transaction ([0006](../decisions/0006-postgres-discovery-reads-pg-catalog.md)): `objects`, `columns`, `types`, `keys`, `foreign-keys`, `checks`, `comments`, `access`, `account`, `referenced-by`, assembled by `discover.ts` | the catalog views, one concern per query, side by side and not one consistent read ([0007](../decisions/0007-sqlserver-discovery-and-what-it-hides.md)): `objects`, `columns`, `types`, `keys`, `foreign-keys`, `checks`, `access`, `account`, `referenced-by`, and besides them `visibility.ts` and `row-security.ts` for what a permission-filtered catalog hides, and `catalog.ts` for a gap found before its object has a name |
| `sql/` | `identifiers.ts` quotes one part at a time; `statement.ts` sends every value as text the server casts, and collects a statement's rows as the driver reads them ([0078](../decisions/0078-a-postgresql-statements-rows-are-collected-as-the-driver-reads-them.md)); `values.ts` reads each column back as canonical text; `catalog.ts` names every function, operator, type and collation in `pg_catalog` ([0016](../decisions/0016-postgres-operations.md)); `filters.ts`, `order.ts`, `search.ts` | `quote.ts` bracket-quotes as QUOTENAME does; `statement.ts` binds each value under a generated name; `values.ts` ([0017](../decisions/0017-sqlserver-operations.md)); `filters.ts`, `order.ts`, `search.ts` |
| `records/` | `records.ts`, `sql.ts`, `requests.ts`; `definition.ts`, the table's definition a write is guarded by (0041); `list.ts`; `delete.ts`; `errors.ts` | `records.ts`, `statements.ts`; `definition.ts`; `list.ts`; `delete.ts`; `errors.ts` |
| `lookups/` | `lookups.ts`, `sql.ts`, and `cancel.ts`, which stops a statement in the database through three of postgres.js's own properties (0061) | `lookups.ts`, `statements.ts`; a statement is stopped by `request.cancel()` (0061) |

Where the engines differ, the adapter says so in its own files rather than
the core smoothing it over. SQL Server's catalog is filtered by permission
and PostgreSQL's is not, which is why only one adapter has
`visibility.ts`. A PostgreSQL lookup runs on a client of its own, because
PostgreSQL delivers a cancel on a separate connection and a late one stops
whatever that backend runs next; the server opens that second client in
`packages/data-server/src/drivers.ts`, at the cost of up to twice the
connections per database (0061). Each behaviour is held by the package's
`*.integration.test.ts` suites against the images they name (0003).

### `@formancy/data-server`

Fastify. `createDataServer` (`app.ts`) installs what every route passes —
no answer kept by a cache and a path refused that a proxy could read
differently ([0037](../decisions/0037-cloudflare-is-the-edge-not-the-runtime.md)),
the per-address rate limit on all but `/health`, the client address
believed only from the proxies an operator names
([0071](../decisions/0071-the-server-believes-the-forwarded-address-only-from-the-proxies-an-operator-names.md)),
and the cross-origin rule (0060) — then `/health` and `/v1/whoami`, and
registers the administrator's plane only when given a registry, a store,
administrator roles and an audit sink
([0020](../decisions/0020-administration-is-a-separate-plane.md)), and the
runtime plane only when given a registry and a store.

| File | Responsibility |
|---|---|
| `main.ts` | The composition root: every setting is read here, and a missing or malformed one stops the process with a sentence saying which. Turns the planes on, resolves the audit key, says once for each Entra connection that no test logs in as one and stops for a managed identity while `AZURE_FEDERATED_TOKEN_FILE` is set (0074, `scripts/server-start.test.mjs`), reads the key set again on SIGHUP, closes every pool on SIGTERM (0025) |
| `planes.ts` | `servedPlanes`: one audit sink, the server's log, for both planes ([0033](../decisions/0033-the-administrator-plane-is-audited.md)); out of `main.ts` so `server-log.test.ts` can hold the wiring |
| `drivers.ts` | `DRIVER_FACTORIES`, the one place the server meets the adapters: per engine, its connection opened through the adapter's own connect function, as a SQL login or, on SQL Server, an Entra principal, one login object for each connection while its secret is the same (0074), pinged, and its ports made (0025) |
| `connections.ts` | The operator's allowlist, every problem at once, and `createConnectionRegistry`, the only place a connection's name becomes a database ([0019](../decisions/0019-a-published-form-is-checked-every-time-it-is-read.md)). An entry logs in as a SQL login or as an Entra principal, and refuses a key it does not read (0074) |
| `secrets.ts` | `resolveSecret`: `env:NAME` or `file:/absolute/path`, and no error that repeats the reference's value |
| `config-store.ts` | `<root>/<id>/<version>.json`, compare-and-swap by hard link (0013); `drafts()` beside it under review |
| `bundle.ts`, `bundle-format2.ts`, `served-schema.ts`, `generation.ts` | `validateBundle`, on publish and on every read (0019): the form in the spec version the generator writes (0042), the fingerprint, the bindings, the policy, and in format 2 the base with its presentation (0030) |
| `published.ts` | `loadPublished` and `loadVersion`: one read, validated, for both planes |
| `publishing.ts`, `reassigned.ts` | What a version must be to be written and what the database must be to serve it, shared by publish, restore and import ([0062](../decisions/0062-a-published-version-moves-between-deployments-as-its-version-file.md)); the keys a publish must confirm (0039) |
| `governance.ts`, `drafts.ts`, `publisher-roles.ts` | Publication under review ([0065](../decisions/0065-with-publisher-roles-set-a-draft-is-published-only-when-a-publisher-who-did-not-submit-it-approves-it.md)): `GRANTS` classifies every administrator operation and `refusalFor` is the one decision; each form's drafts are numbered entries beside its versions, their state derived on every read; the setting that turns review on |
| `identity.ts`, `identity-keys.ts`, `identity-settings.ts`, `identity-file.ts`, `ed25519.ts` | The host's token, verified offline under a pinned algorithm ([0014](../decisions/0014-host-identity-is-verified-offline.md)), from one key or a key set selected by kid and read again on SIGHUP ([0059](../decisions/0059-the-host-identity-key-is-a-set-selected-by-kid-and-read-again-on-sighup.md)) |
| `identity-keys-tool.ts`, `identity-keys-cli.ts` | The key set file tool the image ships beside the server, reading the settings through `identity-settings.ts` as `main.ts` does (0059) |
| `audit.ts` | `auditRequests`, the one set of hooks both planes install: one event per request, and a route without an audit name stops the server (0023, 0033) |
| `export-limits.ts` | `EXPORT_DEADLINE_MS`, how long a file of records may take, derived from the read timeout of the proxy in front, which `export-limits.test.ts` holds it below in `deploy/web/nginx.conf` ([0079](../decisions/0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md)) |
| `cors.ts`, `trusted-proxies.ts`, `lookup-deadline.ts`, `rate-limit.ts` | Each setting's rule, parsed here so it is tested without starting a process; `createDataServer` holds an embedder's origins, proxies and deadline to the same rules (0060, 0071, 0061) |
| `paths.ts` | `plainPath`: the server routes only a path with nothing in it to normalise, and refuses every other before any route's work (0037) |

The routes, one plane per file prefix:

| File | Plane | Routes |
|---|---|---|
| `routes/admin.ts` | administrator | the role check and governance for every route; connections, a connection's test and metadata, `form-proposals`, publish, `versions/latest`, drift; registers the files below |
| `routes/admin-evolution.ts` | administrator | the versions list and one version, regeneration and restore (0030) |
| `routes/admin-promotion.ts` | administrator | import (0062) |
| `routes/admin-drafts.ts` | administrator | `/v1/administration`; under review, the queue, submit, read, approval, rejection (0065) |
| `routes/admin-gate.ts` | administrator | the gate an import, a submit and an approval each pass |
| `routes/admin-audit.ts` | administrator | `ADMIN_OPERATIONS`, every route's audit name (0033) |
| `routes/runtime.ts` | runtime | a form, a record's read, create and update; `ROUTE_OPERATIONS`; registers the files below ([0022](../decisions/0022-the-runtime-plane-asks-the-policy-every-time.md)) |
| `routes/runtime-menu.ts` | runtime | `GET /v1/forms`, each bundle read alone (0045) |
| `routes/runtime-lists.ts` | runtime | a page of records (0044) |
| `routes/runtime-exports.ts` | runtime | a file of every page, made whole or refused, one export per connection at a time, its labels through `lookupScope` (0079) |
| `routes/runtime-deletes.ts` | runtime | a delete (0050) |
| `routes/runtime-lookups.ts`, `routes/abandoned.ts` | runtime | a lookup's query and resolve, stopped in the database when the browser leaves or the deadline passes (0061); `lookupScope`, the one place a lookup's filter is decided, which an export asks too |
| `routes/write-once.ts`, `routes/runtime-errors.ts` | runtime | a write applied once per sending (0031); a refusal as an HTTP answer that names a rule, never a value (0011) |

What holds the planes: `routes/admin.test.ts` holds a clerk the host
vouches for to 403 on the administrator's routes; `routes/admin-audit.test.ts`
fails when a route on either plane has no audit name, and sends every route
the router holds; `e2e.integration.test.ts` runs both planes over HTTP on
both engines.

### `@formancy/data-client`

The browser's side of the runtime plane, one function per runtime route
over `fetch` and nothing else (0029): `forms`, `form`, `read`, `list`,
`exportRecords`, `create`, `update`, `delete`, `query` and `resolve` in
`client.ts`, plus `reconcile`. `exportRecords` is the transport's one
answer read as bytes: a `Blob` and the name the form's id gives it, a 200
that is not CSV `unexpected` and a body cut short `incomplete` ([0079](../decisions/0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md)); `exportFileName`, re-exported, is that name for a page that says it before the file arrives ([0080](../decisions/0080-a-host-downloads-the-records-its-grid-lists-and-the-browser-saves-the-servers-file.md)). The token is asked of the host on every request and sent in the
Authorization header only. The base is the page's own origin unless the
host names another, which the server answers only when its operator lists
the page's origin (0060). `writes.ts` and `reconcile.ts` carry a write whose
answer was lost as unknown, never as refused, and read what it addressed
instead of sending it again (0031). `lookups.ts` turns a form's lookups into
option sources both renderers take, a document naming a source and nothing
else
([formancy.ai 0077](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0077-options-may-come-from-a-named-source.md),
0012). `problems.ts` gives a refusal's field problems as sentences a
renderer prints; `shapes.ts` tells the server's answer from a proxy's page.
Nothing is cached and nothing is retried (0022). Its integration suites run
over real HTTP into the real server on both engines.

### `@formancy/data-fixtures`

Test support, private. One business model written for each engine
(`fixtures/postgres.sql`, `fixtures/sqlserver.sql`) with its neutral truth,
`FIXTURE_MODEL` (`model.ts`), and the comparators each adapter's discovery
answers to (`conformance.ts`) (0005); the `parity` schema and the one
expectation per case both adapters' parity suites share (`parity.ts`, 0028);
the shared cases by id, which a test declares with `covers()` (`cases.ts`,
0035); the containers (`containers.ts`), each labelled with the file that
started it, and the report a SQL Server container that never became ready
fails its start with, Docker's account of how it ended and its last lines
(`unready.ts`, [0082](../decisions/0082-a-sql-server-container-that-never-becomes-ready-says-how-it-ended-and-is-given-no-memory-bound.md)); a TCP hop that can lose an answer
after the database sent it (`tcp-hop.ts`, 0031); a stand-in that answers a
client's PRELOGIN in a SQL Server's place and keeps the type of every
packet the client sends after (`prelogin.ts`, 0081); the sized customer table
the measurements read ([0034](../decisions/0034-performance-is-measured-through-the-shipped-server-and-held-without-a-clock.md));
the images the suites start (`images.ts`): `DEFAULT_IMAGES`, one per
engine, and `MATRIX_IMAGES`, each engine's default first, of which
`FORMANCY_IMAGES` chooses one per engine for a run; `VERSION_FACTS`
(`versions.ts`), what the versions of one engine disagree on, each named
and asserted by the major its server answered
([0067](../decisions/0067-the-adapter-suites-run-on-every-image-of-a-per-engine-matrix.md));
and the shared cases for drift, deletes, cascades and uuid keys
(`drifting.ts`, `deletes.ts`, `cascades.ts`, `uuid.ts`; 0041, 0050, 0051,
0056), and for a file of records, `exports.ts`: `EXPORT_PARITY`, the bytes
both adapters' lists must make through data-core, and `EXPORT_ROWS`, the
customers whose names a file must quote or neutralise ([0079](../decisions/0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md)). `load.test.ts` holds both SQL files to the same constraint names.

### `@formancy/data-performance`

Private, and nothing in it is a contract. It starts the shipped server,
`data-server`'s `dist/main.mjs`, as a child process configured only
through its environment, sends the requests a host sends through
`data-client` against both fixtures with the sized table loaded, and
renders `docs/performance.md` from `docs/performance/results.json` (0034).
Rows read and round trips are pinned on both engines in CI; timing never
is. `scripts/performance-stale.mjs` names what changed in the measured
product since the results; `RELEASING.md` runs it before a release and no
workflow does, so nothing refuses a release for it
([0084](../decisions/0084-a-release-does-not-wait-for-the-performance-figures-to-be-measured-again.md)), and the default lookup deadline is left out of
that product on purpose (0063).

### The applications

Every app with a page -- the examples page, the studio and the host page --
is private, built by Vite, and carries the licence and notice
texts of everything it bundles in `THIRD-PARTY-NOTICES.txt` (0046). Each
is formancy.ai's admin applied: `admin.css`'s variables copied into the
app's stylesheet, which `scripts/palette.test.mjs` holds to the other
apps' and nothing holds to upstream's, and the room's faces imported in
`apps/*/src/main.tsx` from Fontsource's packages and bundled, so no page
asks another host for anything
([0072](../decisions/0072-the-apps-serve-their-own-fonts-and-no-page-asks-another-host-for-anything.md)).
Each has a browser gate,
`apps/*/scripts/browser-test.mjs`, which CI runs in Chromium, Firefox and
WebKit
([0058](../decisions/0058-the-browser-gates-run-in-chromium-firefox-and-webkit-and-each-fact-the-browsers-disagree-on-is-named-and-held.md)),
and takes the README's pictures with `apps/*/scripts/pictures.mjs`
([0038](../decisions/0038-readme-pictures-are-taken-by-a-script-and-held-to-the-text-they-show.md)).

**`apps/examples`** has no server
([0021](../decisions/0021-generated-forms-preview-in-both-frameworks.md)).
`apps/examples/scripts/capture-snapshot.mjs` discovers the shared
PostgreSQL fixture and
writes `src/fixture-snapshot.json`; `src/snapshot.ts` refuses the file
unless it hashes to its fingerprint; `generateForm` runs in the browser; and
`src/app.tsx` draws each form under both renderers (`src/panes.tsx`), each
with an engine of its own (`src/engines.ts`), beside the generator's notes
(`src/notes.tsx`). Its lookups answer from the captured rows in memory
(`src/lookup-source.ts`). The page alone is on the internet, at
`formancy.ai/data/examples/`, served by a Worker with no code
([0069](../decisions/0069-the-examples-page-is-served-at-formancy-ai-data-examples.md)):
`scripts/demo.test.mjs`. `src/examples.test.ts` holds every document it
shows to the released spec.

**`apps/studio`** speaks the administrator's plane and nothing else
([0024](../decisions/0024-the-studio-speaks-only-the-admin-plane.md)):
`src/api.ts` is one function per route and `/v1/whoami`, the token held in
memory. `src/workbench.tsx` is the journey's steps: connect, choose,
generate, policy, presentation, preview, publish, drift, and under review a
Review step (0065). Presentation edits, a field's move to another section
among them (0075), go through `@formancy/builder-core`'s session with
controls of the studio's own (`src/presentation.tsx`, 0030);
the Policy step asks `validatePolicy` and `deleteProblems` as the server
does and names each key a delete acts through
([0052](../decisions/0052-the-studio-says-before-publication-who-may-delete-and-what-a-delete-also-does.md));
`src/versions.tsx` and `src/import.tsx` download and import a version's file
(0062). Its tests run the real `createDataServer` behind a fake `fetch`
(`src/test-server.ts`), and `src/journey.test.tsx` fails on any request
outside the plane.

**`apps/host`** speaks the runtime plane through `data-client` and nothing
else ([0047](../decisions/0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md)).
`src/session.ts` is one pane's session — engine, record, version, what a
save's answer does — framework-neutral, so both renderers show one decision
(0029). `src/forms-nav.tsx` draws the menu (0045); `src/record-grid.tsx`,
`src/grid-datasource.ts` and `src/grid-options.tsx` put a page of records
at a time in AG Grid Community (0044), the grid's handle giving the sort
its datasource last asked with; `src/children.tsx` lists a record's
child rows; `src/download.tsx` is Download CSV in the head of the Records
panel and of each child section, and `src/save-file.ts` hands the file to
the browser through an object URL and a clicked `<a download>`
([0080](../decisions/0080-a-host-downloads-the-records-its-grid-lists-and-the-browser-saves-the-servers-file.md)); `src/guard.ts` and `src/leave.ts` are one guard over every way
of leaving a form; `src/delete-flow.ts` and `src/deletion.ts` a delete
confirmed in place
([0053](../decisions/0053-a-host-deletes-a-record-from-its-detail-or-its-row-after-a-confirmation-in-place.md));
`src/unknown-notice.tsx` an unknown write (0031). The address names the
form, layout and view, never the record (`src/layout.ts`). `src/host.tsx`
loads the workspace, AG Grid with it, only after sign-in.
`src/plane.test.tsx` reads every request off the wire against the server's
own `ROUTE_OPERATIONS`, fails on any other and on any it never sent; the
suites run against the real server on both engines. Its demo build, `build:demo`, is the live
demo's page: `src/main.tsx` takes the demo's wiring only in Vite's `demo`
mode, which the ordinary build drops; `src/demo.ts` asks the path the page
was served from for the demo's people and a sign-in, and
`src/persona-sign-in.tsx` offers each person as a button where the token
form would be, then asks for the menu through a client made as the token
form makes it, at that path
([0070](../decisions/0070-the-live-demo-runs-the-real-server-and-postgresql-in-a-cloudflare-container-of-each-visitors-own.md)).

**`apps/live-demo`** is the live demo's own code, and has no page: the host
page's demo build is its page. It is built by tsdown, like a package, and
nothing installs it. `src/data/` generates the sample sales data from a
fixed seed, with no dependency and no clock, holds it to its invariants
and writes it as SQL for the image; `src/personas.ts` says once what each
person's role may do on each form, which the forms' policies and the page's
sentences are both derived from; `src/token.ts` signs their tokens with
WebCrypto; `src/image/` generates and publishes the four forms during the
image's build, through the real administrator's plane. `src/worker/` is
everything the Worker decides with -- the routes, the cookie, the
sign-in's refusals, the answers and the headers it forwards, the key and
the wait for a start -- tested in Node; `src/worker.ts`, its `fetch` and
the `DemoServer` Durable Object, is the one file that imports
`cloudflare:workers`, which the package's own suite does not run:
`scripts/live-demo-gate/worker.test.mjs` runs it over the gate's stand-in
for Cloudflare's runtime with containers that fail to start, and `pnpm
test:live-demo` in front of the image. The image it starts is
`deploy/demo/Dockerfile`, beside `deploy/demo/build.sh`, which loads and
publishes at build time, and `deploy/demo/start.sh`, which starts each
container; `apps/live-demo/wrangler.json` is the Worker's config, which
`scripts/live-demo.mjs` refuses to deploy unless it is exactly the demo's
(0070).

In a deployment the studio and the host page are served by one nginx
(`deploy/web/nginx.conf`) at `/studio/` and `/host/`, beside `/v1` on the
same origin
([0032](../decisions/0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)).
