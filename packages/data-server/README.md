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
  generator can see.
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
  Neither a restore nor a publish writes an audit event or a log line: the
  audit trail ([0023](../../docs/decisions/0023-the-audit-trail-is-operational-not-evidence.md))
  covers the runtime plane only.

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

- **An operational audit trail** — one event per runtime request, never a
  value, records named by a keyed hash
  ([0023](../../docs/decisions/0023-the-audit-trail-is-operational-not-evidence.md)).
  Not evidence, and the record says why. A create whose answer was lost is
  named by the record it would have made, when the insert names its key; one
  the database numbers names none. A write answered with an earlier
  sending's answer is audited as `repeated`, with the record that answer
  names, so a resend is not counted as a second write (0031).

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
| `FORMANCY_DATA_ADMIN_ROLES` | The administrator's plane, for tokens holding one of these comma-separated roles. Needs the two above. |
| `FORMANCY_DATA_AUDIT_KEY` | Records named in the audit trail by a keyed hash. A secret reference. Without it, no record is named. |

Without the store and the allowlist the server verifies tokens and nothing
else, which is how a host is wired in before any form exists.

## Licence

Source-available, not open source. See [`LICENSE.md`](./LICENSE.md).
