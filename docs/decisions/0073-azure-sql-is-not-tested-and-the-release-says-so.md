# 0073 — Azure SQL Database, Azure SQL Managed Instance and SQL Server on an Azure VM are not tested, and the release says so where it said nothing

- **Status:** accepted
- **Date:** 2026-10-17
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/server.test.ts` -- `UNTESTED_PRODUCTS` is Azure
  SQL Database and Azure SQL Managed Instance, each with its name, and no
  product an engine of `TESTED_SERVERS` names (watched failing with its
  filter on `TESTED_SERVERS` taken out, when it listed PostgreSQL and SQL
  Server too); and `serverStanding` calls every product it lists not tested
  at every major and compatibility level the release was tested at, on both
  engines (watched failing with a standing that called an Azure product
  tested at a tested major other than 16, which 0068's cases, one major and
  one level per product, passed). 0068's cases there still hold Managed
  Instance not tested at the 16 it answers, and Azure SQL Database named as
  itself and never as 2014. `packages/data-sqlserver/src/server.test.ts`
  (0068) -- `EngineEdition` 5 is read as Azure SQL Database and 8 as Managed
  Instance, whatever major they answer. `scripts/release-report/tested-on.test.mjs`
  (`pnpm test:repo`, after `pnpm build`) -- the README's *What it is tested
  on* table has a "Recognised, not tested" row, rendered from data-core's
  `UNTESTED_PRODUCTS` as built, which names both Azure products and no
  product the release was tested on, and no such row when the list is
  empty (watched failing before the row existed); and the block in
  `README.md` saying anything other than what is rendered fails *say what
  testedOn() says*. **Not held by anything:** that no job connects to an
  Azure database -- a workflow that did would fail no check here, and it
  would be alternative B, which needs this record reversed -- and that no
  package description or keyword names Azure SQL, which none does today and
  review alone keeps so.

## Context

[0003](0003-real-databases-in-every-test-run.md) claims an engine only
where a real server, started from an image a test names, runs every test in
every run, and
[0067](0067-the-adapter-suites-run-on-every-image-of-a-per-engine-matrix.md)
narrowed the images to `MATRIX_IMAGES`. Azure SQL Database and Azure SQL
Managed Instance are services Microsoft runs, and neither has an image to
start: they cannot run in a container, so under 0003 they cannot be tested
here. Azure SQL Edge, a container image that carried Azure's name, is
retired, and [0035](0035-a-release-report-is-derived-from-the-run-that-gated-it.md)
names it only as the wrong image a guard was watched failing with.

[0068](0068-a-snapshot-records-the-server-it-was-read-from-and-nothing-refuses-a-server-discovery-can-read.md)
made a snapshot record what a server is. The SQL Server adapter reads
`EngineEdition` before the major, 5 as Azure SQL Database and 8 as Managed
Instance, and data-core calls both not tested, naming each as itself rather
than as the release its major would be on a boxed server. What those
servers answer is Microsoft's documentation and not a measurement here:
that Azure SQL Database reports `ProductVersion` 12.0, which on a boxed
server is 2014's major, and the two editions' numbers. No Azure server
answered anything in this repository; each translation is a unit test over
facts this repository wrote down.

So the product could tell an administrator who had already connected an
Azure database that this release was not tested on it. Nothing a buyer
reads before connecting said so: the README named the images the release
is tested on, and Azure SQL Database only as a server a snapshot does not
take for 2014; that no image here is Azure SQL was said in 0067's and
0068's consequences, which a buyer does not read. A buyer whose estate is
Azure SQL reads that silence as a question answered.

SQL Server on an Azure VM is a boxed SQL Server -- `EngineEdition` 2, 3
or 4 -- on a machine in Microsoft's cloud. Nothing the adapter reads tells
that machine from any other host.

The person decided on 2026-10-16 that Azure SQL is stated as not tested,
and that a CI job against a real Azure database is revisited when a design
partner runs one.

## Decision

No CI job runs against Azure SQL Database, Azure SQL Managed Instance or
SQL Server on an Azure VM, and the release says so where it said nothing:

- **data-core lists them.** `UNTESTED_PRODUCTS`, beside `TESTED_SERVERS` in
  `packages/data-core/src/server.ts`, is every product a snapshot can name
  that no engine of `TESTED_SERVERS` was tested on, `other` aside since it
  names no product, each with the name a person reads: Azure SQL Database
  and Azure SQL Managed Instance. It is derived from the two, not typed,
  and `server.test.ts` holds it to `serverStanding`, which compares the
  product first, at every major and level the release was tested at.
- **The README says it.** *What it is tested on*'s generated table gains a
  row, "Recognised, not tested", which `scripts/release-report/readme.mjs`
  renders from that list. A release tested on every product it recognises
  has no such row rather than an empty one.
- **The register says it,** under databases, with SQL Server on an Azure VM
  named beside the two services, since the README's row cannot name what no
  snapshot tells apart.
- **What already said it stays as it is**: 0068's standing, through the
  connection test, the studio and drift review; and the release report's
  sentence for each engine, that no other version, edition or managed
  service was tested.

## Consequences

**What it buys.** A buyer on Azure reads the answer before connecting, in
the README and in the register a release prints, as the product says it
after connecting. The row is derived from `TESTED_SERVERS`, which the
standing reads, so the README cannot go on saying "not tested" of a
product a later record tests, nor leave out one the product calls
untested.

**What it costs.**

- Buyers read "not tested". An estate on Azure SQL is told this release was
  not tested on it in the README, the register, every connection test and,
  through 0068's `server-untested`, on every drift review of every form
  published from it, for as long as this record stands.
- On Azure SQL nothing proves discovery
  ([0007](0007-sqlserver-discovery-and-what-it-hides.md)) -- that every
  catalog query it sends is accepted, and what the views hide from a
  restricted account there; the record operations
  ([0015](0015-a-record-operation-is-one-guarded-statement.md),
  [0017](0017-sqlserver-operations.md)), `rowversion` as a version among
  them, and what they do on a table with a trigger; row-level security,
  which discovery reads from the security policies;
  [0061](0061-a-lookup-statement-stops-when-its-request-is-abandoned-or-its-deadline-passes.md)'s
  cancellation, an attention that would go through Azure's gateway; the
  Redirect connection policy, under which Microsoft documents that a
  client goes on from port 1433 to the node holding the database on a port
  from 11000 to 11999, which a firewall in between must let through; and
  auto-pause, under which Microsoft documents error 40613 while a paused
  serverless database resumes, which a connection test or a record request
  would meet first, and what either answers then is not known.
- That Azure SQL Database answers `ProductVersion` 12.0, and the editions
  their numbers, is Microsoft's documentation and not measured here: if a
  service answered otherwise, nothing in this repository would know.
- SQL Server on an Azure VM is called tested when its release and its
  database's compatibility level are, as SQL Server on any host is, though
  every test ran SQL Server on Linux in a container; nothing the adapter
  reads tells a virtual machine in Azure from a container.
- `@formancy/data-core` exports one more constant, `UNTESTED_PRODUCTS`, and
  its type, `NamedProduct`.

**What it does not do.** It tests no Azure product and refuses none: a
form is generated, published and served on one as on a server the release
was tested on (0068). It does not connect to an Azure database that
accepts Entra logins only: the allowlist takes a SQL login alone
([0019](0019-a-published-form-is-checked-every-time-it-is-read.md)). It
names no other managed service: a managed PostgreSQL reads as PostgreSQL of
its major, 0068's cost.

## Alternatives considered

- **(B) A CI job against a real Azure database.** It reverses 0003, which
  tests through testcontainers against the images the tests name and
  rejects a shared, long-running test database, among other reasons
  because the version under test becomes whatever the shared instance
  happens to be, which is what a service Microsoft updates in place is.
  The job would need a database created for each run in a
  subscription, loaded with the model and removed however the run ends, as
  [0032](0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)'s
  gate removes its compose project; a login federated through OIDC to an
  Entra application, as `release.yml`'s publish job already asks GitHub for
  an OIDC token to sign with, which would prove a federated assertion and
  not a client secret; and a runner inside Azure for a managed identity.
  A pull request from a fork is given no secrets, so the job would be
  skipped there, and a suite that can be skipped is a suite that is
  skipped. The release report keys a shared
  case by the image its server was started from (`collect.mjs`,
  `versions.mjs`), and a service has no image. What it would cost in money
  is unmeasured. Revisited when a design partner runs Azure SQL.
- **(C) Azure Arc, or SQL Server on an Azure VM.** Each still needs a
  tenant, and neither is a container a test starts and removes; a VM's
  SQL Server is the boxed engine the containers already run, on another
  host.
- **Saying nothing**, as before: the product says "not tested" to an
  administrator after connecting, and 0067's and 0068's consequences say
  no image is Azure SQL. A buyer reads neither before deciding.
- **A row typed into the README.** It would go on saying "not tested" after
  a later record tested a product, and nothing would fail.

## Older records

Extended, not edited away:
[0003](0003-real-databases-in-every-test-run.md), whose rule that only an
image a test starts is tested now has its converse said where a buyer reads
it: the managed services no image can start are named as not tested, in
the README and the register, rather than left unsaid. 0067's sentence that
no image here is a managed service, and 0068's standing, are unchanged;
the row reads 0068's `TESTED_SERVERS`.
