# Changelog

All notable changes to Formancy Data. Every package moves on one version
number. The versions of the upstream `@formancy/*` packages this repository
depends on are a separate line, and a change to one is called out explicitly.

Loosely [Keep a Changelog](https://keepachangelog.com), with reasons attached —
a line that says only *what* changed is rarely the line you need six months
later.

## Unreleased

**The administrator's plane** ([0020](docs/decisions/0020-administration-is-a-separate-plane.md)). `GET /v1/connections`, `POST /v1/connections/:id/test`, `GET /v1/connections/:id/metadata`, `POST /v1/form-proposals`, `POST /v1/forms/:id/versions`, `GET /v1/forms/:id/versions/latest` and `POST /v1/forms/:id/drift`, each requiring a host token with an administrator role — publishing a form and writing a record are different permissions, and nothing here touches a record. A proposal is the generator over a fresh discovery; publication is compare-and-swap, and a stale base is a 409 naming the current version; a version edited on disk is refused, not served; drift compares the published snapshot with the database now. A database that is down answers 503 without the driver's message, which names hosts and logins.

**A published form is one bundle, and connections are an allowlist** ([0019](docs/decisions/0019-a-published-form-is-checked-every-time-it-is-read.md)). A bundle carries the form, its bindings, its policy and the snapshot they came from; `validateBundle` checks it on publish and on every read from the store, recomputing the snapshot's fingerprint so a hand-edited column type is refused rather than trusted by the planner. Connections are a file the operator writes — host, database, user, a secret reference for the password, the approved schemas — and `createConnectionRegistry` is the only place a name becomes a database, opening it on first use through a factory the composition root supplies and retrying a failed open on the next request. The image now copies `data-core`: the Dockerfile guard failed the moment the server depended on it and the COPY list did not say so, which is what it is for.

**Drift review** ([0010](docs/decisions/0010-drift-is-classified-against-the-bindings.md)). `diffSnapshots(base, current, bindings)` compares the snapshot a form was generated from with the database now, through that form's bindings, and classifies every change by what it means for that form: a new nullable column is for review, a new NOT NULL column with no default stops create, a dropped or retyped bound column blocks the form, a tightened one stops writes of that field, a column the published control can no longer hold — an integer past 2^53 in a number field — blocks it, a changed foreign key behind a lookup blocks the lookup, and the concurrency column gone stops update. An apparent rename is two changes and a hint matched on definition, never on names. Something that vanished behind a gap is an access problem, never a deletion. The review found two fail-opens, both fixed: a column vanishing behind a new gap could leave create writable when the gap alone would have blocked it, and foreign keys were compared through `schema.name` strings, so a retargeting between `a.b`.`c` and `a`.`b.c` went unnoticed. Bindings that could not have come from the base snapshot are now refused even when nothing changed.

**`DatabaseAdapter` discovers, and the record port is defined** ([0015](docs/decisions/0015-a-record-operation-is-one-guarded-statement.md)). Both adapters now answer `discover(scope)` through the port, with the same fingerprint as calling their discovery directly. `RecordAdapter` — `read`, `insert`, `update` — is a port of its own beside the lookup port: values in and out are canonical text, never the driver's numbers or dates; an update is one statement guarded by key, trusted filters and expected version; another tenant's record is `not-found`, never `forbidden`; a database refusal is a stable failure code and PostgreSQL's `40001` is `stale`; a write whose result was lost in transit is `unknown-outcome` and is never retried. SQL Server's version query moved into its own module, so discovery no longer imports the adapter that imports it.

**The database-neutral half of lookups** ([0012](docs/decisions/0012-a-lookup-token-is-a-reference-not-a-permission.md)). A referenced key, composite or not, is encoded as the string a formancy `select` stores: `k1:` and the values, with every character outside `A-Z a-z 0-9 - . _` escaped as `~` and four upper-case hex digits, so each key has exactly one spelling and the decoder refuses every other. A key whose token would exceed formancy's 200 characters is refused, never truncated. `validateLookupQuery` bounds the page and the search; `buildLookupConfig` derives a lookup from the bindings and checks it against the snapshot's actual foreign key. Row filters for a lookup are `unrestricted` or `restricted` with at least one equality — an empty list cannot mean every row — and `lookupFilters` converts what the policy's `lookupRowFilter` returned, the one place an empty list may become unrestricted. The review found a lookup config not checked against its foreign key, key values not checked by type, NULL ordering unspecified, and an empty filter that would have meant every row; all four are fixed. Nothing implements the lookup port yet: the adapters do next.

**Access policy** ([0011](docs/decisions/0011-every-operation-carries-a-trusted-policy-context.md)). A `FormPolicy` grants operations and fields to roles and pins root and lookup rows to trusted attributes such as the tenant; a `PolicyContext` comes from the verified host identity and nothing else. Every function fails closed: a missing tenant attribute is a refusal, never an empty filter that would mean every tenant; a field with no entry is readable by nobody; roles match exactly; the tenant column is over-posting on create and on update; a lookup over the tenant column must pin its target to the same tenant. The adversarial review found the read path failing open — an actor with field grants and no read grant got a filter and a column list — and every function that returns data now authorises the operation it serves. Nothing calls these yet; the record and lookup routes will, on every request.

**SQL Server discovery** ([0007](docs/decisions/0007-sqlserver-discovery-and-what-it-hides.md)). `discoverSqlServer(pool, scope)` reads the catalog views with every join to something a restricted account might not see written as a left join, so a blind spot becomes a gap instead of a dropped row. What the restricted reader sees of a foreign key into a table it cannot read: the key, its columns and its flags, and a target whose name resolves to NULL — so `fk_order_customer` is reported with a gap, never as "no relationship". Defaults and checks are visible as objects with NULL definitions. A user-defined alias type the account cannot see would drop the column from an inner join. `VIEW DEFINITION` on the schema, with no `SELECT` at all, is the minimum for complete discovery; a `DENY VIEW DEFINITION` or `DENY CONTROL` on one table, to the account or a role it is in, removes it from `sys.objects` while the schema grant still says yes, so discovery counts its own deny rows and says something is hidden. Driver traps for the read path: `tedious` returns `decimal(18,4)` as a JavaScript number (99999999999999.9999 reads as 100000000000000) and `date` as midnight UTC, so every value is converted to text in SQL. Rowversion concurrency holds between two connections: the stale update affects 0 rows. `nvarchar(n)` counts UTF-16 code units and a UTF-8 `varchar(n)` counts bytes, which the contract does not yet say.

**PostgreSQL discovery** ([0006](docs/decisions/0006-postgres-discovery-reads-pg-catalog.md)). `discoverPostgres(sql, scope)` reads `pg_catalog`, never `information_schema`, in one read-only repeatable-read transaction, with schema names bound. To a SELECT-only account `information_schema` hides every constraint on a table — not only foreign keys, but the primary key and checks too — while `pg_catalog` hides none. An object the account may not use is a gap naming it rather than an omission. Found on the real server and pinned by tests: a stored generated column files its expression where defaults live; a foreign key to a partitioned table appears once per partition unless `conparentid = 0`; `DISABLE TRIGGER ALL` stops a key being checked while `pg_constraint` still says validated, including through partition clones; unique indexes that are not constraints are valid foreign-key targets; since PostgreSQL 15 a numeric scale may be negative. Two driver traps for the write path: a `bigint` key bound as a JavaScript number addresses a different row, and `sql('a.b')` quotes a dotted table name as two identifiers.

**Values are checked exactly on their way to the database.** `codecFor(column)` validates and canonicalises one API value from metadata alone ([0008](docs/decisions/0008-exact-values-travel-as-strings.md)). Decimals are strings only — a JSON number has been through a double before anything can look at it — canonicalised to the column's scale and never rounded; an extra digit is refused. Integers past 2^53 are strings. Text length is counted in UTF-16 code units, as formancy's `maxLength` counts it in the browser, so the two agree. Dates must be real days, in formancy's own shapes read from `@formancy/spec`. A test proves every decimal the generated form's pattern accepts, the codec accepts too.

**The server ships as an image, and CI proves it starts.** `packages/data-server/Dockerfile` follows formancy's: two stages, an explicit COPY list, `--ignore-scripts`, an unprivileged runtime, a health check against `/health`. `src/dockerfile.test.ts` derives the COPY list from the dependency graph, so adding a workspace dependency without telling the Dockerfile fails a test instead of the container. A new `container` job builds the image on every pull request and checks that unconfigured it names the setting it needs, configured it serves `/health` and answers an unauthenticated request with 401, and it runs as `node` with its licence. The release workflow pushes it to GHCR, signs it by digest and attaches the SBOM, as formancy's does; there is no `latest` tag.

**`@formancy/data-server` exists, with its foundations and two routes.** A configuration store keeps published bundles as immutable, versioned files, and decides concurrent publishes with a hard link: of twenty publishes from one base, exactly one wins ([0013](docs/decisions/0013-published-configuration-is-files-with-link-based-swap.md)). Ids are lower case only, because on Windows and macOS `Order` and `order` are one directory and one form would silently read another's bundle — the suite found that on Windows. The host application's JWT is verified offline, with the algorithm pinned per key kind, and becomes an actor, roles and attributes such as the tenant; nothing else in a request contributes ([0014](docs/decisions/0014-host-identity-is-verified-offline.md)). Secrets are referenced as `env:` or `file:`, and no error repeats one. The server answers `/health` and `/v1/whoami` and nothing else yet: the record and lookup routes arrive with the operations behind them.

**A form can be generated from a snapshot.** `generateForm` turns a discovered table into a formancy document, its database bindings and a list of notes saying what was inferred, excluded, read-only or blocked ([0009](docs/decisions/0009-generation-is-deterministic-and-says-what-it-chose.md)). It is deterministic, and it targets spec 3, the version the released `@formancy/spec` speaks. Exact decimals and integers past 2^53 become text with an exact pattern, which formancy's engine checks identically in the browser and on the server; a JavaScript number would round them. A composite foreign key becomes one lookup. Update is offered only with a `rowversion` or a version column an administrator has confirmed, because a column that merely looks like one is how a lost update happens. **The one rule checked on one side only:** a `number` field for an integer column accepts `1.5` in the browser until spec 4's `step` is released, and the server's codec refuses it.

**The metadata contract exists, and so does the database both adapters will be held to.** `@formancy/data-core` now describes what discovery returns: objects as schema and name, columns with a normalised type beside the database's own spelling, ordered primary, unique and foreign keys, checks, comments — and **gaps**, the things the connection could not establish. A catalog filtered by permissions looks exactly like a complete one with fewer things in it, so a foreign key whose target an account cannot see is reported with an unknown target and a gap, never dropped ([0004](docs/decisions/0004-a-snapshot-says-what-it-could-not-see.md)). Every snapshot is made by `createSnapshot`, which sorts by codepoint, refuses structures no catalog could produce, and fingerprints with `@formancy/spec`'s canonical hash — the first upstream dependency, at exactly 0.3.0.

**`@formancy/data-fixtures`** is one business model written for both engines — a composite key, a foreign key to a unique key, a reserved word as a table and a column, a self-reference added over a row that breaks it, an exact decimal at its limit, an integer past 2^53, an identity, a computed column, a view and a type nobody supports — plus a restricted reader who may read `sales.order` only, the containers that load it, and a comparator that reports every way a snapshot differs from the expected model ([0005](docs/decisions/0005-one-fixture-written-twice.md)). The one place the engines are deliberately different, the version column, is written down per engine. Private, never published.

**The repository exists, with the pipeline formancy.ai runs and nothing that
generates a form yet.** Three packages: `@formancy/data-core` holds the adapter
port; `@formancy/data-postgres` and `@formancy/data-sqlserver` each implement
it far enough to reach a real server and say which version answered. The point
of starting there rather than with generation is the gate: on every pull
request, both adapters run against a real PostgreSQL 17 and a real SQL Server
2022 through testcontainers, and there is no mocked driver to pass without them
([0003](docs/decisions/0003-real-databases-in-every-test-run.md)).

**The pipeline is formancy.ai's, adapted.** `verify` builds, type-checks, runs
coverage against both databases, checks packaging with publint and attw, checks
that every tarball carries its licence, and runs the repository's own guards.
`install` packs the tarballs into a plain npm project and type-checks that
project with `skipLibCheck` off — the gate that found upstream's package with no
`exports` map after four releases. CodeQL and dependency review are unchanged.
The CLA check is unchanged in mechanism and matters more here. The release
workflow publishes with provenance and a signed SBOM, refuses a tag that
disagrees with the manifests, and refuses an SBOM that omits either database
driver. There is no browser job and no container job, because there is no page
and no server; both return with the packages that need them.

**The licence is written down and marked a draft.** `LICENSE.md` states the
terms in one table — read and fork free, develop and test free including in
companies, production paid, redistribution by agreement, customer data and
generated definitions the customer's — and says at the top that it has not had
legal review. Why a paid module exists beside an Apache-2.0 project, and why in
its own repository, is
[0001](docs/decisions/0001-a-paid-module-in-its-own-repository.md). Every
publishable manifest declares `SEE LICENSE IN LICENSE.md`, and
`scripts/verify-licenses.mjs` refuses one that says anything else — the
realistic mistake being a manifest copied from upstream, which is how every
manifest here started.

**Upstream is depended on and never copied, at exact versions.** No package
here depends on `@formancy/*` yet; when one does, `scripts/upstream-deps.mjs`
refuses a range, a `workspace:` link or a path, because the package APIs
upstream are not frozen before 1.0 and a minor is allowed to break this
repository ([0002](docs/decisions/0002-depend-on-upstream-never-copy-it.md)).

**What is not here**: discovery, metadata, codecs, generation, lookups, writes,
a server, a studio, examples. The next step is the both-database spike the plan
calls phase 1: composite foreign keys, exact decimals and large integers,
restricted-account metadata, and a concurrency strategy — demonstrated on both
engines before anything is generated from them.
