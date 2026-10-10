<!-- Part of Formancy Data: https://github.com/sharkysan/formancy.ai-data -->

# @formancy/data-server

The Formancy Data server: Fastify, like formancy's own. What exists today is the
foundation the record, lookup and publication routes will stand on, and two
routes — no more, because a route that answered before the operations behind it
existed would be documented and inert.

- **`createFileConfigurationStore(root)`** — published bundles as immutable,
  versioned JSON files. Compare-and-swap is a hard link, so of two
  administrators publishing from one base exactly one wins
  ([0013](../../docs/decisions/0013-published-configuration-is-files-with-link-based-swap.md)).
  A version whose file does not parse throws `UnparsableVersionError` from
  `read`, so a publish over it can tell a damaged file from a read that
  failed
  ([0039](../../docs/decisions/0039-a-publish-says-what-happens-to-the-grants-of-reassigned-keys.md)).
- **`createIdentityVerifier(options)`** — the host application's JWT, verified
  offline with a pinned algorithm, becomes an actor, roles and attributes such
  as the tenant ([0014](../../docs/decisions/0014-host-identity-is-verified-offline.md)).
- **`resolveSecret(reference)`** — `env:NAME` or `file:/absolute/path`. Never
  the secret itself, and no error ever repeats one.
- **`createDataServer(options)`** — `GET /health`, and `GET /v1/whoami`, which
  returns exactly the identity the server derived from the host's token so a
  wrong issuer, audience or claim mapping shows before any form depends on it.

- **`validateBundle(document)`** — a published version is the form, its
  bindings, its policy and the snapshot they came from, checked on publish and
  on every read: a hand-edited file is refused, not served
  ([0019](../../docs/decisions/0019-a-published-form-is-checked-every-time-it-is-read.md)).
  A version published before bindings version 2 is refused with "republish",
  and so is a row filter on a column the snapshot's account may not read, or,
  while the form offers create, a root filter on a column it may not
  `INSERT`, which every create writes
  ([0027](../../docs/decisions/0027-a-snapshot-says-what-its-account-may-do.md)).
  A row filter on a column a filter cannot compare — a boolean, a float, a
  time or a timestamp — or one the table lacks is refused the same way
  ([0028](../../docs/decisions/0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md)).
  Since [0030](../../docs/decisions/0030-presentation-is-a-patch-over-the-generated-base.md)
  a bundle is format 2: it also keeps the generation request, the generated
  base and the presentation chosen over it, and its form must be that base
  with that presentation applied. Format 1 is still read and served, and no
  longer published. Publish also checks that this server's generator writes
  the stored base and bindings from the stored snapshot and request; reads
  do not, so a later generator never makes a stored version corrupt. Reads
  do check what the stored request alone decides — its title, root,
  confirmed version column, pins over written fields and lookups — against
  the base and bindings, because a regeneration generates from that request;
  a pin taken out by hand is the one edit to it that no check short of the
  generator can see. Publish and reads alike refuse a form or base that is
  not in the spec version the generator writes, data-core's
  `GENERATED_SPEC_VERSION`, or that carries a later version's construct,
  because formancy's validator accepts every version its release speaks and
  a host page's renderer may not
  ([0042](../../docs/decisions/0042-generated-forms-stay-on-spec-3-after-spec-4-is-released.md)).
- **`DRIVER_FACTORIES`** — one connection factory per engine, opening every
  connection through the adapter package's own `connect…` function, so a host
  embedding the server never builds a pool from another copy of a driver
  ([0025](../../docs/decisions/0025-each-adapter-owns-its-driver.md)).
- **`parseConnections` and `createConnectionRegistry`** — the allowlist of
  databases a form may bind to, with secret references for passwords, opened
  lazily through driver factories the composition root supplies.

- **The administrator's plane** — connections, discovery, proposals,
  publication and drift, for a host token holding an administrator role
  ([0020](../../docs/decisions/0020-administration-is-a-separate-plane.md)).
  Registered only when the server is given a registry, a store and those roles.
  Since [0030](../../docs/decisions/0030-presentation-is-a-patch-over-the-generated-base.md):
  `GET /v1/forms/:id/versions` and `GET /v1/forms/:id/versions/:n` list and
  read versions, each validated as the latest is; `POST
  /v1/forms/:id/regenerations` rediscovers, regenerates from the stored
  request, carries the presentation by the column or lookup each edit was
  chosen for, and reports what it could not carry, lookups the runtime would
  now refuse, keys that now name another column and the policy's problems
  with the new bindings — and writes nothing; `POST
  /v1/forms/:id/restorations` republishes an older version — the same
  document, written as the store writes every version, so the same bytes for
  a version this store wrote — only when drift against it blocks nothing. A
  restore brings back that version's policy and is not a database rollback.
  Since [0039](../../docs/decisions/0039-a-publish-says-what-happens-to-the-grants-of-reassigned-keys.md),
  `POST /v1/forms/:id/versions` refuses, 422 `keys-reassigned` with the
  `keys` and a sentence for each, a version whose policy gives a role, read
  or write, on a key the version it replaces bound to another column or
  lookup, unless the body's `keysConfirmed` lists that key exactly as the
  regeneration's `keysReassigned` reported it. A key with no role left
  needs nothing, which is what removing its grants looks like — a lookup's
  filter, which every lookup field has, is not a grant by itself; a stale
  base is still 409 `conflict` first; a restore is not asked, because it
  brings a policy back with the bindings it was written for; and a publish
  over a version the server no longer serves, because its file does not
  parse or does not validate, is not checked. It compares with the version
  replaced and no other, and by column or foreign-key name: grants removed
  in one version and given back in the next, or carried to another table by
  a publish that moves the form there, are not asked about.
  Every request on the plane is audited, a publish and a restore included
  ([0033](../../docs/decisions/0033-the-administrator-plane-is-audited.md)):
  see the audit trail below.

- **The runtime plane** — a published form, its records and its lookups, for
  the host application's people, each request asking the policy
  ([0022](../../docs/decisions/0022-the-runtime-plane-asks-the-policy-every-time.md)).
  Registered only when the server is given a registry and a store. A lookup's
  filter is scoped as a record request's is, so a trusted value its column
  does not hold in that spelling is 403 `invalid-context` for both. A write
  the database refused for a reason with no code of its own — a trigger's
  error, a declined write — is 422 `refused`, which says sending it again
  will be refused the same way; 503 `unavailable` is kept for what passes
  (0028). A write sent to the database whose answer was lost is 502
  `unknown-outcome` with `operation`, `record` and `version`: an update's
  token and version as sent, a create's token when the insert names its key
  -- a key the person types, a tenant pinned from the token -- and `null` when
  the database numbers it. Each sentence says what is safe next, and the
  route asks the adapter once and never again
  ([0031](../../docs/decisions/0031-an-answer-lost-after-a-write-is-unknown.md)).
  A read never answers one; an adapter that reported one for a read is a 500.
  `e2e-lost-answer.integration.test.ts` drops the database's answer after the
  commit, on both engines, and fails if the write crosses to the database a
  second time.

  Every record request, and opening a form, is decided over the form's
  table as the catalog describes it then
  ([0041](../../docs/decisions/0041-the-runtime-refuses-what-drift-blocks.md)),
  with drift review's own rules, after the policy -- an actor it refuses
  reaches no statement. A read and an update by an actor who may read take
  the description from the read they make anyway; opening a form, a create,
  and an update by an actor who may not read the record, or whose read
  failed, describe the table in one statement, inside the write's sending.
  What the description stops is 409 `drift`, with a sentence that says an
  administrator must review the form and names no column: a read whose form
  can no longer show its records faithfully -- its values never leave the
  server -- and a write the form cannot make safely, with no insert, update
  or membership check sent. The log says which changes, by kind and the
  fields they affect. `GET /v1/forms/:id` lists only the operations the
  database still allows, is 409 `drift` when the form cannot be read or
  leaves the person nothing, and asks the database, so an unreachable one is
  503. A write the adapter refuses because the table moved since its
  description is 409 `schema-changed`, and nothing was written. Lookups are
  searched and resolved whatever drift says. `routes/runtime.test.ts` holds
  the order and the counts over fake ports, and
  `routes/runtime-drift.integration.test.ts` every change of `DRIFTING`
  (`@formancy/data-fixtures`) on both engines.

  An update reads the record first and removes the echo it can prove
  ([0022](../../docs/decisions/0022-the-runtime-plane-asks-the-policy-every-time.md)):
  a field the actor may not write, equal to the record as read; and,
  through `planUpdate`, an instant or a time the actor may write and read,
  equal to the record as read at the version the update names
  ([0040](../../docs/decisions/0040-instants-and-times-are-read-to-the-shape-and-an-unedited-one-is-never-written.md)).
  Both adapters read those cut to formancy's shape, so written back they
  would replace the stored fraction or seconds. A form whose only change was
  such an echo is 400 `nothing-to-update`; an update carrying one is
  answered with the read's own failure when the read before it failed, 503
  for `unavailable`, 404 for `not-found`; and the read runs inside the
  update's sending, so a resend is answered before anything is asked.
  `routes/runtime-temporal.test.ts` holds each of these over fake ports. The
  host suite's `temporal-round-trip*.test.ts` holds, on both engines, what
  each engine then stores: the echo removed, a change written, nothing
  written for echoes alone, and what a field or a record the clerk may not
  read stores; the stale echo, the failed read and the resend run over the
  fake ports only.

  A write that arrives again is answered, not applied. Chromium resends a
  request -- a POST too -- when the connection it reused closed before any
  answer, below the page, so a create whose answer the network lost after
  the commit used to be stored twice behind one "Created" (measured, 0031).
  `@formancy/data-client` sends a new `formancy-write-id` with every create
  and update; a request that arrives with an id this process has already
  acted on, for the same person, form and operation, gets the first
  sending's answer -- awaited, if it is still with the database -- and the
  database is not asked again. The same id with another body is 400
  `invalid-request`, and so is an id that is not one. Answers are kept for
  ten minutes, at most 10,000 of them and 32 MiB, oldest dropped first. A
  resend was measured arriving within 6 ms of the close, and a create's
  answer at about 236 bytes (2026-10-09, the host page's browser gate);
  ten minutes is a margin over that, not a measurement. Held in this process only: a resend that reaches
  another replica behind a balancer, or this one after a restart, is
  applied again, and a request without an id is a write of its own every
  time. The host page's browser gate measures the resend at the socket and
  fails if the order is stored twice.

- **An operational audit trail** — one event per request on both planes,
  each naming its `plane`, never a value, records named by a keyed hash
  ([0023](../../docs/decisions/0023-the-audit-trail-is-operational-not-evidence.md)).
  Not evidence, and the record says why. A create whose answer was lost is
  named by the record it would have made, when the insert names its key; one
  the database numbers names none. A write answered with an earlier
  sending's answer is audited as `repeated`, with the record that answer
  names, so a resend is not counted as a second write (0031).

  On the administrator's plane
  ([0033](../../docs/decisions/0033-the-administrator-plane-is-audited.md))
  an event names the actor, the operation, the connection, the form and the
  version read, compared, regenerated from or written; a publish and a
  restore also the base the administrator named, and a restore the version
  it copied, which nothing on disk records. Refusals are events too: a 403
  names the actor it refused. Never the bundle, the policy, a snapshot, a
  drift report or a message. On both planes a connection is recorded only
  when the allowlist knows it and a form id only when it has a form id's
  shape, so a connection string typed into a path or a body never reaches
  the trail. A bare host name, an IP address or a lower-case word typed
  where a form id goes is a form id, though, and is recorded as typed.

  An event is written once for every request that reaches a route of either
  plane, however it ends: a client that disconnected while the route ran,
  or whose request was pipelined behind another on a connection that
  closed, included. The token is read after the body, so a body Fastify
  refuses (400, 413 or 415, or a client gone mid-body) is audited with no
  actor, whatever token it carried. What is answered before any route runs
  no hook and is not audited: a path no route matches (404), a parameter
  past the router's limit (414) or one whose percent-encoding does not
  decode (400 `FST_ERR_BAD_URL`), the 503 Fastify sends while the server
  closes, and what Node's HTTP parser refuses before Fastify sees a request
  (431 for headers past its limit, 400 for a request it cannot parse). The
  administrator's plane needs a sink
  (`admin.audit.sink`) and does not start without one; the runtime's is
  optional. A route registered on either plane without an audit name stops
  the server from starting, or, registered above the plane's hooks, answers
  500 `unaudited-route` and runs nothing.

## Running it

```bash
FORMANCY_DATA_ISSUER=https://host.example \
FORMANCY_DATA_AUDIENCE=formancy-data \
FORMANCY_DATA_IDENTITY_SECRET=env:HOST_JWT_SECRET \
FORMANCY_DATA_ATTRIBUTES=tenant=tid \
node dist/main.mjs
```

Every missing setting stops the process with a sentence naming it. The planes
are turned on by configuration:

| Variable | Turns on |
| --- | --- |
| `FORMANCY_DATA_STORE_DIR` and `FORMANCY_DATA_CONNECTIONS` | The runtime plane: published forms, records, lookups. The connections file is the allowlist (JSON); passwords in it are `env:` or `file:` references. |
| `FORMANCY_DATA_ADMIN_ROLES` | The administrator's plane, for tokens holding one of these comma-separated roles. Needs the two above. Its requests are audited to the same log as the runtime's, one `audit` line per event, told apart by `audit.plane`. |
| `FORMANCY_DATA_AUDIT_KEY` | Records named in the audit trail by a keyed hash. A secret reference. Without it, no record is named. |

Without the store and the allowlist the server verifies tokens and nothing
else, which is how a host is wired in before any form exists.

The log is JSON lines on standard output: Fastify's lines for each request,
and the audit trail. A request is logged by its method and the route it
matched, never by the path, the query or the Host header it was sent with,
because those are whatever a caller typed, token or none
([0033](../../docs/decisions/0033-the-administrator-plane-is-audited.md));
a 404 is logged with no route. `src/server-log.test.ts` fails when a line
holds what was sent.

The image (`packages/data-server/Dockerfile`) runs as `node` and owns
`/var/lib/formancy-data`, the directory to mount the store's volume on and to
name in `FORMANCY_DATA_STORE_DIR`. Docker gives a new named volume the owner
of the directory it is mounted on, so a volume there is the server's to
write; without that directory the first publish fails with `EACCES`, and the
CI container job fails if `node` cannot write it. The image declares no
`VOLUME`: mount one, or the published forms go with the container.

`compose.yaml`'s `stack` profile runs the image that way -- both planes, the
allowlist in `deploy/connections.json`, an audit key, and every secret a
`file:` reference into a volume -- behind one nginx that serves the studio
and the host page on the same origin as `/v1`, with a token minter beside it
for the demo. [`docs/getting-started.md`](../../docs/getting-started.md) walks
through it, and CI runs that guide as written
([0032](../../docs/decisions/0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)).
It is an evaluation stack, not a deployment: the guide's section 8 says what
a deployment changes.

## Licence

Source-available, not open source. See [`LICENSE.md`](./LICENSE.md).
