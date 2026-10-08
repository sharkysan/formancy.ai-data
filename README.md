# Formancy Data

**Turn your existing database into forms that fit your application.**

A self-hosted module for [formancy](https://github.com/sharkysan/formancy.ai)
that discovers an existing relational database, generates an editable formancy
form from it, resolves foreign-key lookups under your application's own
authorisation, and loads and saves records. PostgreSQL and Microsoft SQL Server
in the first release, through one database-neutral core and two adapters. The
published form renders in Angular or React with the formancy renderers and
operates without any AI dependency.

> **Status: started 8 October 2026. Nothing generates a form yet.**
>
> What exists is the shape of the product and the pipeline that will prove it:
> three packages, two of which reach a real PostgreSQL and a real SQL Server
> and report which version answered, and a CI gate that runs them against
> both on every pull request. The next step is the both-database spike —
> metadata discovery, composite keys, exact decimals and a concurrency
> strategy, on both engines, before anything is generated.

## Licence, in one table

Source-available, **not** open source. The formancy engine, renderers, builder
and backend this module builds on stay Apache-2.0; this module does not.

| Use | Terms |
| --- | --- |
| Read the source and fork the repository | Free |
| Evaluate, develop and test — including in companies | Free |
| Run in production, internally or customer-facing | Paid licence |
| Redistribute inside another software product | Separate commercial agreement |
| Customer data and generated form definitions | Remain the customer's |

[`LICENSE.md`](./LICENSE.md) has the terms. It is a draft awaiting legal
review and says so at the top. Why a paid module exists beside an Apache-2.0
project, and why in a repository of its own, is decision
[0001](./docs/decisions/0001-a-paid-module-in-its-own-repository.md).

## Packages

| Package | What it is |
| --- | --- |
| `@formancy/data-core` | The database-neutral port and metadata contract: what discovery returns, including what it could not see. No driver, no HTTP, no Node. |
| `@formancy/data-postgres` | The PostgreSQL adapter, on the `postgres` driver. |
| `@formancy/data-sqlserver` | The SQL Server adapter, on `mssql` over `tedious` — pure JavaScript, no ODBC. |
| `@formancy/data-server` | The server: configuration store, host identity, and the HTTP surface the adapters will sit behind. Fastify, like formancy's. |
| `@formancy/data-fixtures` | Private test support: one business model for both engines, a restricted reader, and the comparator both adapters answer to. Never published. |

Planned and not here: the record, lookup and publication routes of the
server, the studio for connecting a database and
reviewing a generated form, and the Angular and React integration examples.

## How it relates to formancy.ai

This repository **depends on** the released `@formancy/*` packages and copies
none of their code ([0002](./docs/decisions/0002-depend-on-upstream-never-copy-it.md)).
Upstream versions are exact, and a guard refuses a range or a path. A generic
improvement the module needs — an exact-decimal field type, say — goes upstream
through formancy's own contribution rules rather than being patched here.

## Development

Node 22.12 or later, pnpm through corepack, and Docker for the tests.

```bash
corepack enable pnpm
pnpm install
pnpm build
pnpm test        # starts postgres:17-alpine and mssql/server:2022 through testcontainers
```

There is no mocked driver and no `--skip-db` flag. Database behaviour is proved
against real servers or it is not proved
([0003](./docs/decisions/0003-real-databases-in-every-test-run.md)). The first
run pulls the SQL Server image, which is about a gigabyte and a half.

`docker compose up -d` gives you both databases on loopback for a shell or a
client; the tests do not use it. See `.env.example`.

The gates CI runs, in order: `pnpm build`, `pnpm typecheck`,
`pnpm test:coverage`, `pnpm check:pkg`, `node scripts/verify-licenses.mjs`,
`pnpm test:repo`, and in a job of its own `pnpm test:e2e:install`.
[`CLAUDE.md`](./CLAUDE.md) says what each is for and what the bar is.

## Documents

- [`docs/decisions/`](./docs/decisions/README.md) — every decision somebody could helpfully undo, with what verifies it.
- [`CHANGELOG.md`](./CHANGELOG.md) — what changed and why.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`CLA.md`](./CLA.md) — contributions are taken under a CLA, checked on every pull request.
- [`SECURITY.md`](./SECURITY.md) — how to report a vulnerability, and what this product considers highest risk.
- [`RELEASING.md`](./RELEASING.md) — releases are cut by the workflow, with provenance and a signed SBOM.
