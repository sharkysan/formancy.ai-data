# Changelog

All notable changes to Formancy Data. Every package moves on one version
number. The versions of the upstream `@formancy/*` packages this repository
depends on are a separate line, and a change to one is called out explicitly.

Loosely [Keep a Changelog](https://keepachangelog.com), with reasons attached —
a line that says only *what* changed is rarely the line you need six months
later.

## Unreleased

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
