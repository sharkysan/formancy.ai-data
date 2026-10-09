# Formancy Data

**Turn your existing database into forms that fit your application.**

A self-hosted module for [formancy](https://github.com/sharkysan/formancy.ai)
that discovers an existing relational database, generates an editable formancy
form from it, resolves foreign-key lookups under your application's own
authorisation, and loads and saves records. PostgreSQL and Microsoft SQL Server
in the first release, through one database-neutral core and two adapters. The
published form renders in Angular or React with the formancy renderers and
operates without any AI dependency.

> **Status: in development, nothing released.** Both adapters discover a real
> database, including what a restricted account cannot see, and the same model
> checks both. A form can be generated from a snapshot; values are checked
> exactly, and a snapshot says what its account may do with every column and
> whether row-level security applies to it, which generation and drift review
> now read. Both adapters answer lookups and records; the server publishes forms
> and serves them over HTTP, asking the policy every time and auditing every
> request, and one suite runs that whole journey on both engines. A page
> renders generated forms in React and Angular side by side, and the studio
> walks an administrator from a connection to a published form and its drift.
> `CHANGELOG.md` says what each step found.

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
| `@formancy/data-server` | The server: configuration store, host identity, the administrator and runtime planes over HTTP, the audit trail, and the composition root that starts them from configuration. Fastify, like formancy's. |
| `@formancy/data-fixtures` | Private test support: one business model for both engines, a restricted reader, and the comparator both adapters answer to. Never published. |

## Examples

`apps/examples` is a private page, never published, that shows a generated form
the way the people filling it in will see it — under both renderers at once.

```bash
pnpm build
pnpm --filter @formancy/data-examples dev        # http://localhost:4391
```

It reads a snapshot of the shared fixture, checks it against its fingerprint,
runs `generateForm` **in the browser** for `sales.order` and `sales.customer`,
and renders each with the released `@formancy/react` and `@formancy/angular`
side by side, on white paper in the Blueprint theme, with the generator's notes
— inferred, excluded, read-only, blocked — beside each. Its suite holds the two
renderers to the same fields by accessible name and the same error codes
([0021](./docs/decisions/0021-generated-forms-preview-in-both-frameworks.md)).

What the suite cannot see, because jsdom performs no layout, a browser gate
measures in Chromium: no sideways scroll down to 320 pixels, the keyboard path
through the skip link into the first preview, and colour contrast and target
size, clean and after a failed submit.

```bash
pnpm --filter @formancy/data-examples exec playwright install chromium   # once per machine
pnpm test:browser                                                        # builds both apps, then measures them
```

The snapshot is captured from a real PostgreSQL container, never written by
hand. After a change to the fixture, with Docker running:

```bash
pnpm build
pnpm --filter @formancy/data-examples snapshot
```

and commit `apps/examples/src/fixture-snapshot.json` and
`fixture-customers.json`. The suite compares the committed snapshot with the
fixture model and fails where they disagree, and refuses a snapshot edited by
hand. The customer lookup is an in-memory source over the captured customers
until the server's lookup route exists, and the page says so.

## Studio

`apps/studio` is the administrator's application, private and never
published: sign in with a host token, connect, choose a root table, generate,
write the policy, arrange labels, preview, publish, and review drift. It
speaks only to the server's administrator plane and `/v1/whoami`
([0024](./docs/decisions/0024-the-studio-speaks-only-the-admin-plane.md)).

```bash
pnpm build
FORMANCY_DATA_SERVER=http://127.0.0.1:4390 pnpm --filter @formancy/data-studio dev   # http://localhost:4392
```

The server sends no CORS headers, so the studio is served from the server's
origin: in development Vite proxies `/v1` to `FORMANCY_DATA_SERVER`, and in a
deployment one reverse proxy serves `apps/studio/dist` and `/v1` together. The
token is held in the tab's memory only; reloading the page signs out. The
server needs its administrator plane turned on — a store, an allowlist and
`FORMANCY_DATA_ADMIN_ROLES`, as
[its README](./packages/data-server/README.md) says; against a server without
one, the studio says so at sign-in.

Its suite runs the real server in the test — `createDataServer` with a fake
connection registry over snapshots captured from the shared fixture, as the
PostgreSQL owner, the restricted reader and the SQL Server owner — behind a
fake `fetch`, so a change to a response shape fails the studio's tests.
`pnpm test:browser` walks the whole journey in Chromium against the same
server. After a change to the fixture, with Docker running:

```bash
pnpm build
pnpm --filter @formancy/data-studio snapshot
```

and commit the three files under `apps/studio/src/fixtures/`.

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
pnpm test        # starts postgres:17-alpine (and 18-alpine for one suite) and mssql/server:2022 through testcontainers
```

There is no mocked driver and no `--skip-db` flag. Database behaviour is proved
against real servers or it is not proved
([0003](./docs/decisions/0003-real-databases-in-every-test-run.md)). The first
run pulls the SQL Server image, which is about a gigabyte and a half.

`docker compose up -d` gives you both databases on loopback for a shell or a
client; the tests do not use it. See `.env.example`.

The gates CI runs, in order: `pnpm build`, `pnpm typecheck`,
`pnpm test:coverage`, `pnpm check:pkg`, `node scripts/verify-licenses.mjs`,
`pnpm test:repo`, and in jobs of their own `pnpm test:e2e:install` and
`pnpm test:browser`.
[`CLAUDE.md`](./CLAUDE.md) says what each is for and what the bar is.

## Documents

- [`docs/decisions/`](./docs/decisions/README.md) — every decision somebody could helpfully undo, with what verifies it.
- [`CHANGELOG.md`](./CHANGELOG.md) — what changed and why.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`CLA.md`](./CLA.md) — contributions are taken under a CLA, checked on every pull request.
- [`SECURITY.md`](./SECURITY.md) — how to report a vulnerability, and what this product considers highest risk.
- [`RELEASING.md`](./RELEASING.md) — releases are cut by the workflow, with provenance and a signed SBOM.
