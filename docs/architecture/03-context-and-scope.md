# 3. Context and scope

## Business context

```
 identity provider ── signs the host's tokens ──┐
        :                                       ▼
        : its key set,        host application and its people
        : copied in by        (@formancy/data-client and
        : the operator         formancy's renderers)
        ▼                                       │
     operator ── settings, allowlist, ──┐       │ runtime plane
                 secret references      │       │
                                        ▼       ▼
                          ┌─────────────────────────────────┐
 administrator ──studio──▶│                                 │──▶ PostgreSQL
 (and a publisher,  admin │      Formancy Data server       │
  under review)     plane │                                 │──▶ SQL Server
                          └────────┬───────────────┬────────┘
                                   ▼               ▼           the customer's
                           configuration      audit trail      databases, each
                           store: files       (the server's    as the account
                           on a volume         log)            its connection
                                                               names
```

Not drawn: formancy's packages, which the core, the client, the server and
every app depend on, and the proxy in front of both planes. Both are in the
tables below.

| Party | Exchanges |
|---|---|
| **Administrator** | Signs in to the studio with a host token holding an administrator role. Connects, discovers, generates, writes the policy, arranges labels, previews and publishes, and reviews drift. Receives a snapshot with what the account could not see, the generator's notes, and drift reports. Never reads or writes a record: the administrator's plane is separate, and a form's policy never grants it ([0020](../decisions/0020-administration-is-a-separate-plane.md), [0024](../decisions/0024-the-studio-speaks-only-the-admin-plane.md)) |
| **Publisher** | Exists only when the operator names publisher roles. Approves a draft somebody else submitted, which the server checks again against the database and writes exactly as submitted; restoring a version is a publisher's alone ([0065](../decisions/0065-with-publisher-roles-set-a-draft-is-published-only-when-a-publisher-who-did-not-submit-it-approves-it.md)) |
| **Host application** | Holds the person's session and a token for them, and hands that token to `@formancy/data-client` for every request. Receives the forms the person may read, a published form's definition, its records and its lookups; renders the form with `@formancy/react` or `@formancy/angular` ([0029](../decisions/0029-a-host-renders-a-published-form-through-one-client.md)). `apps/host` is one, private and never published: a workspace of linked grids over the runtime plane alone ([0047](../decisions/0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md)) |
| **Person filling in a form** | Reaches the module only through a host. Sees the forms they may read and nothing about the others ([0045](../decisions/0045-the-runtime-plane-lists-the-forms-a-person-may-read-and-nothing-about-the-others.md)), a page of records at a time ([0044](../decisions/0044-a-forms-records-are-listed-a-page-at-a-time-under-its-read-policy.md)), the rows a lookup may offer them ([0012](../decisions/0012-a-lookup-token-is-a-reference-not-a-permission.md)); creates, updates and, where granted, deletes one record at a time, after a confirmation in place on the host page ([0053](../decisions/0053-a-host-deletes-a-record-from-its-detail-or-its-row-after-a-confirmation-in-place.md)) |
| **Identity provider** | Signs the tokens the host sends, or the host's own backend does: a JWT that must carry `sub`, the actor, and an expiry, with a `roles` claim and the attribute claims the operator maps, such as the tenant. Nothing calls it: the operator copies its published key set into a file the server reads at start and again on SIGHUP, or configures one shared secret or public key ([0014](../decisions/0014-host-identity-is-verified-offline.md), [0059](../decisions/0059-the-host-identity-key-is-a-set-selected-by-kid-and-read-again-on-sighup.md)) |
| **Operator** | Runs the server image and a proxy in front of it. Supplies the settings `packages/data-server/src/main.ts` reads at start, the allowlist of connections, each password by a secret reference, the identity key, the audit key, and the roles that administer and publish. Receives the audit trail and the server's log. The composed stack is one command from a clean checkout ([0032](../decisions/0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)) |
| **The customer's databases** | PostgreSQL and SQL Server, reached only as the account each allowlisted connection names, in the schemas it approves ([0019](../decisions/0019-a-published-form-is-checked-every-time-it-is-read.md)). That account's grants decide what discovery describes and what a generated form may do ([0027](../decisions/0027-a-snapshot-says-what-its-account-may-do.md)). The module reads the catalog and reads and writes rows. Its adapters are tested on every image of each engine's matrix, which the README's *What it is tested on* names ([0067](../decisions/0067-the-adapter-suites-run-on-every-image-of-a-per-engine-matrix.md)); a snapshot records the server it was read from, and the connection test, the studio and drift review say when this release was not tested on it. Nothing refuses such a server, but a SQL Server older than 2019 cannot be discovered ([0068](../decisions/0068-a-snapshot-records-the-server-it-was-read-from-and-nothing-refuses-a-server-discovery-can-read.md)) |
| **formancy** | Its released packages at exact versions: `@formancy/spec` in the core, the client and the server, for document validation and canonical hashing; `@formancy/core` to check generated forms in the core's and the client's tests; in the apps at run time, `@formancy/core` as the form engine, `@formancy/spec`, the renderers, `@formancy/themes` and, in the studio, `@formancy/builder-core`, with `@formancy/conformance` in their tests ([0002](../decisions/0002-depend-on-upstream-never-copy-it.md)). Nothing flows back except through formancy's own contribution rules |
| **Proxy and edge** | One proxy serves the studio and the host page on the origin of `/v1`: `deploy/web/nginx.conf` in the composed stack, a deployment's own in production, optionally behind Cloudflare's tunnel and Access ([0037](../decisions/0037-cloudflare-is-the-edge-not-the-runtime.md)). The server believes a forwarded client address only from the proxies the operator names ([0071](../decisions/0071-the-server-believes-the-forwarded-address-only-from-the-proxies-an-operator-names.md)) |

## Technical context

| Interface | Protocol | Notes |
|---|---|---|
| Studio → administrator's plane | HTTP and JSON, the host token in `Authorization` | The routes are `ADMIN_OPERATIONS` in `packages/data-server/src/routes/admin-audit.ts`, registered only when the server has a connection registry, a store and administrator roles (0020). Same origin only, at the preflight and at the request ([0060](../decisions/0060-the-runtime-plane-answers-the-origins-an-operator-lists-and-the-administrators-plane-none.md)). `apps/studio/src/journey.test.tsx` fails when the studio calls anything else |
| Host → runtime plane | HTTP and JSON through `@formancy/data-client`, the token in `Authorization` and never in a URL or a body | The routes are `ROUTE_OPERATIONS` in `packages/data-server/src/routes/runtime.ts`. A record list is a POST, so its search never appears in a URL a proxy logs (0044); every write carries a write id of its own ([0031](../decisions/0031-an-answer-lost-after-a-write-is-unknown.md)). Same origin unless the operator lists the host's origin exactly (0060). `apps/host/src/plane.test.tsx` fails when the host page calls anything else or puts the token elsewhere |
| An orchestrator → `/health`; a person wiring a host in → `/v1/whoami` | HTTP | `/health` needs no token and is not rate-limited; `/v1/whoami` returns exactly the identity the server derived from a token, so a wrong issuer, audience or claim mapping shows before any form depends on it. Every answer is `no-store`, and a path a proxy could read differently is `400` `path-not-plain` before authentication (0037) |
| Server → PostgreSQL | The `postgres` driver, opened by `connectPostgres` in `@formancy/data-postgres` | Each adapter package owns its driver, and the server imports none: `packages/data-server/src/drivers.ts` is where it meets them ([0025](../decisions/0025-each-adapter-owns-its-driver.md)). Discovery reads `pg_catalog` in one read-only transaction ([0006](../decisions/0006-postgres-discovery-reads-pg-catalog.md)); every value is bound as text the server converts ([0016](../decisions/0016-postgres-operations.md)) |
| Server → SQL Server | `mssql` over `tedious`, pure JavaScript and no ODBC, opened by `connectSqlServer` in `@formancy/data-sqlserver` | Discovery reads the catalog views ([0007](../decisions/0007-sqlserver-discovery-and-what-it-hides.md)); every write is one batch that checks what the table stored ([0017](../decisions/0017-sqlserver-operations.md)) |
| Server → configuration store | The file system: one JSON file per published version, compare-and-swap by hard link | `packages/data-server/src/config-store.ts` ([0013](../decisions/0013-published-configuration-is-files-with-link-based-swap.md)); under review, drafts beside the versions (0065) |
| Server → audit trail | One structured log line per request that reaches a route of either plane | Never a value; a record named only by a keyed hash, and not at all without an audit key ([0023](../decisions/0023-the-audit-trail-is-operational-not-evidence.md), [0033](../decisions/0033-the-administrator-plane-is-audited.md)) |
| Operator → server | Environment variables read at start; SIGHUP; SIGTERM | A missing or malformed setting stops the process with a sentence naming it. SIGHUP reads the key set file again; SIGTERM finishes requests in flight and closes every pool (0025, 0059) |
| Deployment → deployment | One version's file, byte for byte what the store wrote | Exported by the route that reads a version, imported through the checks a publish makes and the drift gate a restore passes ([0062](../decisions/0062-a-published-version-moves-between-deployments-as-its-version-file.md)) |
| formancy → this repository | npm, exact versions | `scripts/upstream-deps.mjs` refuses anything else (0002); an upstream release is adopted the day it is published ([0055](../decisions/0055-an-upstream-release-is-adopted-the-day-it-is-published.md)) |
| This repository → integrators | npm packages, ESM only, with provenance; the server image | `@formancy/data-core`, the two adapters, `@formancy/data-server` and `@formancy/data-client`. `pnpm test:e2e:install` installs the packed tarballs into a plain project and type-checks it with `skipLibCheck` off |
| Cloudflare → the examples page | Static files from a Worker with no code, at `formancy.ai/data/examples/` | No server, database or plane behind it; generation runs in the browser over a captured snapshot ([0021](../decisions/0021-generated-forms-preview-in-both-frameworks.md), [0069](../decisions/0069-the-examples-page-is-served-at-formancy-ai-data-examples.md)) |

## What is deliberately outside the boundary

- **Identity.** The server verifies a token somebody else issued, and never
  issues one: no users, no sessions, no passwords, and no key fetched from
  anywhere (0014, 0059). The studio and the host page hold a token in
  memory and forget it on a reload (0024).
- **A table's definition.** The module reads the catalog and reads and
  writes rows. Drift is reviewed and refused, never migrated
  ([0010](../decisions/0010-drift-is-classified-against-the-bindings.md),
  [0041](../decisions/0041-the-runtime-refuses-what-drift-blocks.md)), and
  restoring a version changes no table
  ([0030](../decisions/0030-presentation-is-a-patch-over-the-generated-base.md)).
  No test looks for a statement that alters a table; that the adapters hold
  none is held by review.
- **What the database runs on its own.** Triggers and rules are the
  database's. A SQL Server write an enabled INSTEAD OF trigger would decide
  is refused (0017); a PostgreSQL rule that acts on a delete makes every
  delete of its table refused, and the rows a cascade reaches are asked of no
  form's policy
  ([0050](../decisions/0050-a-record-is-deleted-one-at-a-time-by-its-token-and-the-version-its-person-read.md),
  [0051](../decisions/0051-a-delete-reaches-other-tables-only-through-foreign-keys-the-policy-names.md)).
- **Where secrets live.** Configuration names a secret and never holds one;
  `packages/data-server/src/secrets.ts` resolves `env:` and `file:`
  references once, in the composition root, and the store behind them is
  the operator's (0019).
- **Transport security.** TLS is the operator's proxy's. The composed
  stack is plain and on loopback, and its guide's section 8 says so
  ([`../getting-started.md`](../getting-started.md#8-what-this-is-not)).
- **Evidence-grade audit.** The audit trail is written after the database
  commits, by another system, and is not evidence; a customer who needs
  that needs an outbox in their own database or service (0023).
- **More than one server process.** One process and one volume, for the
  reasons [section 9](09-quality-requirements.md#94-qualities-deliberately-not-pursued)
  gives. Running the product at Cloudflare is left to a later record
  (0037).
- **Markup and styling of a form.** A published form is drawn by formancy's
  renderers and themes; nothing this repository adds to a form carries
  styling
  ([formancy.ai 0101](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0101-a-control-is-operable-without-a-theme.md)).
