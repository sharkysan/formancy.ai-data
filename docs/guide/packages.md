# Packages

The packages this repository builds, which of them are published, how they
relate to the Apache-2.0 formancy packages they build on, and the licence
they are under, with what the built apps carry of what they bundle.

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
nothing here runs an older renderer. Generated forms stay on spec 5, though
formancy's builder writes spec 6 from `@formancy/*` 0.14.0 on. A TypeScript
host whose renderer is older than 0.14.0 casts the published form to its own
`FormSchema`, since `@formancy/data-client`'s types are those of the
`@formancy/spec` it pins, where `specVersion` may be `"6"`.

A host draws a published form with `@formancy/react` or
`@formancy/angular`, given its options by `@formancy/data-client`, and
dresses it with a theme of `@formancy/themes`: the renderers ship no CSS.

## The licence, and what the apps bundle

The packages here are source-available under [`LICENSE.md`](../../LICENSE.md),
never Apache-2.0, as [the README's table](../../README.md#licence-in-one-table)
says. Why a paid module exists beside an Apache-2.0 project, and why in a
repository of its own, is decision
[0001](../decisions/0001-a-paid-module-in-its-own-repository.md); the
decision to put the licence in force before a lawyer had read it, and what
that leaves open, is
[0048](../decisions/0048-the-licence-is-in-force-before-a-lawyer-has-read-it.md);
Version 1.1, under which a redistribution agreement is requested at the same
address as a production licence, is
[0054](../decisions/0054-version-1-1-names-the-address-for-a-redistribution-agreement-too.md).

The studio, the host page and the examples page bundle other people's
packages, React, Angular and upstream formancy among them: each build writes
`THIRD-PARTY-NOTICES.txt` beside its page with their licence and notice
texts, but for what
[0046](../decisions/0046-a-built-app-carries-the-licence-and-notice-texts-of-everything-it-bundles.md)
names, and stops when a bundled package ships no licence text. The composed
stack serves them at `/studio/THIRD-PARTY-NOTICES.txt` and
`/host/THIRD-PARTY-NOTICES.txt`, and this repository's own `LICENSE.md` and
`NOTICE` are in the image. The examples page's are at
https://formancy.ai/data/examples/THIRD-PARTY-NOTICES.txt, and the page
links this repository for the rest
([0069](../decisions/0069-the-examples-page-is-served-at-formancy-ai-data-examples.md)).
