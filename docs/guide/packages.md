# Packages

The packages this repository builds, which of them are published, and how
they relate to the Apache-2.0 formancy packages they build on.

| Package | What it is |
| --- | --- |
| `@formancy/data-core` | The database-neutral core: the ports, the metadata contract and what discovery could not see, generation, policy, presentation, the record planner, drift review and the codecs. No driver, no HTTP, no Node. |
| `@formancy/data-postgres` | The PostgreSQL adapter, on the `postgres` driver. |
| `@formancy/data-sqlserver` | The SQL Server adapter, on `mssql` over `tedious` — pure JavaScript, no ODBC. |
| `@formancy/data-client` | The browser's side of the runtime plane: a `fetch`-based client for the forms a person may read, a published form's definition, its records -- one by its token or a page at a time, created, updated and deleted -- and its lookups, and the option sources both formancy renderers take. Source-available, framework-neutral, no Node. |
| `@formancy/data-identity` | The host's identity token, verified offline under a pinned algorithm against one key or a JSON Web Key Set read from a file and read again on demand, and the secret references a setting names. jose and Node alone, so a product that verifies the same tokens installs neither Fastify nor a driver; the server re-exports it. Published since 0.3.0 ([0091](../decisions/0091-the-host-identity-verifier-is-a-package-of-its-own-which-the-server-re-exports.md)). |
| `@formancy/data-server` | The server: configuration store, host identity through `@formancy/data-identity` and the settings that choose its key, the administrator and runtime planes over HTTP, the audit trail, and the composition root that starts them from configuration. Fastify, like formancy's. |
| `@formancy/data-fixtures` | Private test support: one business model for both engines, a table keyed by a uuid the database fills among its edge cases, with its restricted reader and the order form's own account; the comparator both adapters' discovery answers to; the cases both engines share -- parity and drift -- each with one expectation; the sized table the performance harness reads; and `renamedColumn`, a snapshot as discovery reports it after a rename. Never published. |
| `@formancy/data-performance` | Private: the harness that measures the shipped server against both engines and renders `docs/performance.md` from what it measured. Never published. |

## How it relates to formancy.ai

This repository **depends on** the released `@formancy/*` packages and copies
none of their code ([0002](../decisions/0002-depend-on-upstream-never-copy-it.md)).
Upstream versions are exact, and a guard refuses a range or a path. A release
can be adopted the day it is published: its packages, and nothing else, are
exempt from pnpm's one-day minimum release age, each by its exact version
([0055](../decisions/0055-an-upstream-release-is-adopted-the-day-it-is-published.md)),
and the same guard refuses any other exemption. A generic improvement the
module needs — an exact-decimal field type, say, proposed as
[formancy.ai#258](https://github.com/sharkysan/formancy.ai/issues/258) — goes
upstream through formancy's own contribution rules rather than being patched
here.

Generated forms are formancy's spec 5, for a field's help text from its
column's comment, and the server serves spec 3 beside it, which every version
published before says
([0118](../decisions/0118-generated-forms-move-to-spec-5-for-help-text-from-column-comments.md),
superseding [0042](../decisions/0042-generated-forms-stay-on-spec-3-after-spec-4-is-released.md)).
A host whose renderer is older than `@formancy/*` 0.8.0 refuses a spec 5
form outright, so it moves its renderer before a form is published again;
nothing here runs an older renderer. A TypeScript host on one casts the
published form to its own `FormSchema`.
