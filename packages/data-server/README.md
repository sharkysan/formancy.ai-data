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
  Its `drafts()` is the store a deployment under review keeps its drafts
  in, `<root>/.drafts`, which `list()` never reports as a form
  ([0065](../../docs/decisions/0065-with-publisher-roles-set-a-draft-is-published-only-when-a-publisher-who-did-not-submit-it-approves-it.md)).
- **`createIdentityVerifier(options)`** — the host application's JWT, verified
  offline with a pinned algorithm, becomes an actor, roles and attributes such
  as the tenant ([0014](../../docs/decisions/0014-host-identity-is-verified-offline.md)).
  Its key is a shared secret, a public key, or a key set whose `keys()` is
  asked on every token and must return a set `readKeySet` or a builder made
  ([0059](../../docs/decisions/0059-the-host-identity-key-is-a-set-selected-by-kid-and-read-again-on-sighup.md)).
- **`readKeySet(text, algorithm)`** and **`openKeySetFile(path, algorithm)`**
  — a JSON Web Key Set, each key selected by the kid a token names, read from
  a file now and again whenever `readAgain()` is called: a valid set replaces
  the one in force, anything else leaves it (0059).
- **`resolveSecret(reference)`** — `env:NAME` or `file:/absolute/path`. Never
  the secret itself, and no error ever repeats one.
- **`createDataServer(options)`** — `GET /health`, and `GET /v1/whoami`, which
  returns exactly the identity the server derived from the host's token so a
  wrong issuer, audience or claim mapping shows before any form depends on it.
  `runtime.origins` lists the origins the runtime plane answers across
  origins, and the administrator's plane answers none (0060, *Across
  origins* below).

- **`validateBundle(document)`** — a published version is the form, its
  bindings, its policy and the snapshot they came from, checked on publish and
  on every read: a hand-edited file is refused, not served
  ([0019](../../docs/decisions/0019-a-published-form-is-checked-every-time-it-is-read.md)).
  It never throws: bindings of another shape than it reads are a problem
  like any other (0045). A version published before bindings version 2 is refused with "republish",
  and so is a row filter on a column the snapshot's account may not read, or,
  while the form offers create, a root filter on a column it may not
  `INSERT`, which every create writes
  ([0027](../../docs/decisions/0027-a-snapshot-says-what-its-account-may-do.md)).
  A row filter on a column a filter cannot compare — a boolean, a float, a
  time or a timestamp — or one the table lacks is refused the same way
  ([0028](../../docs/decisions/0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md)),
  and so is a policy's `through` over a lookup that offers every row, by
  `validatePolicy`, or over a text key or a lookup that does not configure,
  by `throughProblems`; the planner asks both too
  ([0043](../../docs/decisions/0043-a-child-forms-rows-are-reached-only-through-a-parent-its-policy-admits.md)).
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
- **`ROUTE_OPERATIONS`** and the type **`RuntimeOperation`** — the runtime
  plane's routes, `METHOD url`, each with the name its audit event gives it:
  what a host is allowed to send, which the host page's suite holds every
  request of its journey to
  ([0047](../../docs/decisions/0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md)).

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
  lookup, or names it in `through`, unless the body's `keysConfirmed` lists
  that key exactly as the regeneration's `keysReassigned` reported it. A
  through is a grant without a role: re-pointed to another foreign key, its
  filter scopes the form's rows through another parent
  ([0043](../../docs/decisions/0043-a-child-forms-rows-are-reached-only-through-a-parent-its-policy-admits.md)).
  A key with no role and no through left needs nothing, which is what
  removing its grants looks like — a lookup's filter, which every lookup
  field has, is not a grant by itself; a stale
  base is still 409 `conflict` first; a restore is not asked, because it
  brings a policy back with the bindings it was written for; and a publish
  over a version the server no longer serves, because its file does not
  parse or does not validate, is not checked. It compares with the version
  replaced and no other, and by column or foreign-key name: grants removed
  in one version and given back in the next, or carried to another table by
  a publish that moves the form there, are not asked about.
  Since [0062](../../docs/decisions/0062-a-published-version-moves-between-deployments-as-its-version-file.md),
  `POST /v1/forms/:id/imports`, body `{ expectedBase, bundle,
  keysConfirmed? }`, writes another deployment's version file -- read there
  as `GET /v1/forms/:id/versions/:n` -- as a new version here, as it came:
  400 for a body of another shape; 422 `invalid-bundle` for what a publish
  refuses, a connection this allowlist does not have by the same name among
  it; 503 when the database cannot be read; 422 `other-engine` for a
  database of another engine; 409 `incompatible` with only the blocking
  changes; 422 `keys-reassigned` against this deployment's base, a stale
  base the conflict first; 409 `conflict` with `current`. 201 answers
  `{ version, drift }` (the type `Importation`). Nothing is renamed, since a
  lookup's source name is made from the connection's. A restore over a
  database of another engine is 422 `other-engine` too, where it was 500.
  Since [0065](../../docs/decisions/0065-with-publisher-roles-set-a-draft-is-published-only-when-a-publisher-who-did-not-submit-it-approves-it.md),
  `GET /v1/administration` says whether the deployment reviews publication
  and what the caller may not do; with `publisherRoles` set, nobody
  publishes or imports directly, an administrator submits a draft and a
  publisher who did not submit it approves it, and restoring is a
  publisher's: *Publication under review*, below.
  Every request on the plane is audited, a publish, a restore and an
  import included
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

  A lookup's statement stops when its request is abandoned or its deadline
  passes ([0061](../../docs/decisions/0061-a-lookup-statement-stops-when-its-request-is-abandoned-or-its-deadline-passes.md)). The route passes the adapter a signal that aborts
  when the response or its socket closes before the answer
  (`routes/abandoned.ts`), or when `lookupDeadlineMs` passes, counted from
  when the adapter is asked for the statement, so a wait for a pooled
  connection counts and reading the form and opening its connection do not;
  the adapter stops the statement with its driver's own cancel. A search
  past the deadline is 503 `lookup-timeout`, whose sentence says the same
  search will take as long again; a resolve, which reads by key and so
  waited rather than read too much, is 503 `unavailable`, which invites
  another try, the log naming the deadline; one whose client left is
  answered 499 `abandoned`, which nobody reads and the audit trail records;
  each membership check inside a create or an update has a deadline of its
  own and no abandonment, since a write goes on after its client leaves,
  and past it is the usual 503 `unavailable`, nothing saved, the log saying
  the deadline passed. A lookup that completes
  is answered as before. On PostgreSQL the lookups run on a client of their
  own, `application_name` `formancy-data lookups` (`drivers.ts`), so a
  cancel PostgreSQL delivers late can stop only another lookup, never a
  record's statement; each allowlisted PostgreSQL database may use up to
  twice the connections. `routes/runtime-lookup-limits.integration.test.ts`
  holds each on both engines with a statement waiting behind a lock.

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
  database still allows and the person's context can scope -- a row
  filter's attribute and a through's (0043) -- is 403 when that leaves
  none, is 409 `drift` when the form cannot be read or
  leaves the person nothing, and asks the database, so an unreachable one is
  503. A write the adapter refuses because the table moved since its
  description is 409 `schema-changed`, and nothing was written. Lookups are
  searched and resolved whatever drift says. `routes/runtime.test.ts` holds
  the order and the counts over fake ports, and
  `routes/runtime-drift.integration.test.ts` every change of `DRIFTING`
  (`@formancy/data-fixtures`) on both engines.

  `POST /v1/forms/:id/records/list` answers one page of the records a person
  may read, `{ rows, hasMore }` and no total
  ([0044](../../docs/decisions/0044-a-forms-records-are-listed-a-page-at-a-time-under-its-read-policy.md)):
  a read of many, under the read filter and every through, each row what
  `records/read` returns for its token, a POST so the search is in no URL,
  and audited as `list` with no record and never the search, the sort or
  the parent. `GET /v1/forms/:id` sends `list` -- what a page may be searched
  and sorted by -- or `null` where the person would be refused one: a key
  that can be NULL or that they may not read, rows nothing scopes though a
  lookup's options are filtered, or a table that no longer holds the key
  unique and NOT NULL. A page is decided over the description its own
  statement carried, as a read is, and is also 409 `drift` when that
  description no longer holds the key unique and NOT NULL; its log line
  says `list`, as the audit does. `routes/runtime-lists.test.ts` holds the
  route over fake ports.

  `POST /v1/forms/:id/records/delete` deletes one record by its token and
  the version its person read, `{ record, version }` with a write id, under
  the policy's `operations.delete`
  ([0050](../../docs/decisions/0050-a-record-is-deleted-one-at-a-time-by-its-token-and-the-version-its-person-read.md)):
  the policy before any statement, the table described and the delete
  planned over it, one guarded statement that deletes one row or none and
  refuses a foreign key that would act on the delete unless the policy's
  `cascades` names it with its action ([0051](../../docs/decisions/0051-a-delete-reaches-other-tables-only-through-foreign-keys-the-policy-names.md)). 200 `{ record,
  deleted: true }`, the token of the row deleted and nothing of its values;
  404 not found or outside the person's rows; 409 `stale`, `drift` or
  `schema-changed`; 422 `referenced` while other rows refer to it, naming
  none -- the log names the key, at info, and no value -- or `refused`;
  503 "Nothing was deleted."; 502 `unknown-outcome`
  with `operation: 'delete'`, the record and the version, where deleting
  again with that version deletes nothing else. Never a field error.
  Audited as `delete`, by the record's keyed hash. `GET /v1/forms/:id`
  lists `delete` where the bindings offer it, the policy grants it and the
  database allows it, with `deleting: { cascades, clears, restricted }` --
  whether a key the policy accepts deletes or clears other rows, and
  whether one may refuse the delete -- `null` otherwise. `routes/runtime-deletes.test.ts` holds the route over
  fake ports, and `e2e.integration.test.ts` and
  `e2e-lost-answer.integration.test.ts` on both engines.

  `GET /v1/forms` answers the menu
  ([0045](../../docs/decisions/0045-the-runtime-plane-lists-the-forms-a-person-may-read-and-nothing-about-the-others.md)):
  every published form whose policy lets this person read, in codepoint
  order of its id, with its title, the operations the policy grants of
  what it offers as published -- what `GET /v1/forms/:id` starts from
  before it asks the database -- and its children, the forms whose rows a
  page may list below one of its records with that record's token as the
  list's `parent`: derived by `childFields` from the bundles, and named
  only where the person is offered that list and may read the field. It
  says nothing about any other form. Every request reads and validates
  every published form's newest version and reads each alone
  (`menuForm`), leaving out, with a line in the log, a form whose version
  no longer validates, does not parse or cannot be read, whose connection
  the allowlist does not have, or whose bindings the menu cannot read;
  a store that cannot list its forms is 500 `store-unavailable`, naming
  no path. It asks no database, and costs about 2 ms a published form,
  measured once in-process (0045), which any host token can ask for and
  only the rate limit bounds. Audited as `form-list`, with no form,
  version or record. `routes/runtime-menu.test.ts` holds the route over a
  real store and a registry that refuses every connection;
  `routes/runtime.test.ts` that a form it names opens with the operations
  it named.

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

  A write that arrives again is answered, not applied. Over HTTP/1.1,
  Chromium and Firefox send a request again -- a POST too -- when a
  connection they reused closed after the server read it and before any
  byte of an answer, below the page, so a create whose answer the network
  lost after the commit used to be stored twice behind one "Created"
  (measured in Chromium, 0031; in both, 0058). WebKit on Linux sends every
  POST on a new connection and never twice ([0058](../../docs/decisions/0058-the-browser-gates-run-in-chromium-firefox-and-webkit-and-each-fact-the-browsers-disagree-on-is-named-and-held.md)).
  `@formancy/data-client` sends a new `formancy-write-id` with every create
  and update; a request that arrives with an id this process has already
  acted on, for the same person, form and operation, gets the first
  sending's answer -- awaited, if it is still with the database -- and the
  database is not asked again. The same id with another body is 400
  `invalid-request`, and so is an id that is not one. Answers are kept for
  ten minutes, at most 10,000 of them and 32 MiB, oldest dropped first. A
  resend was measured arriving within 6 ms of the close, and a create's
  answer at about 236 bytes (2026-10-09, the host page's browser gate);
  ten minutes is a margin over that, not a measurement; on 2026-10-13, in
  the seven passes of one run of the host page's gate on the shared machine
  0058's *Measured* names, Chromium's arrived 10.1 to 13.8 ms after the
  close and Firefox's 20.6 to 27.3 ms. Held in this process only: a resend that reaches
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
  version read, compared, regenerated from or written; a publish, a
  restore and an import also the base the administrator named, and a
  restore the version it copied, which nothing on disk records. Under
  review a draft's event names the draft, the number a submit wrote or the
  one its path names, and an approval the version it wrote: who approved a
  version is that event's actor, and nothing else records it (0065).
  Refusals are events too: a 403 names the actor it refused. Never the bundle, the policy, a snapshot, a
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
  no hook of either plane and is not audited: a path no route matches (404,
  or 400 `path-not-plain` when it is not plain, below), a parameter
  past the router's limit (414) or one whose percent-encoding does not
  decode (400 `FST_ERR_BAD_URL`), the 503 Fastify sends while the server
  closes, and what Node's HTTP parser refuses before Fastify sees a request
  (431 for headers past its limit, 400 for a request it cannot parse). A
  preflight is answered by a route of neither plane and is not audited
  either (0060); a token-bearing request refused across origins on a
  plane's route is that plane's event, with no actor, and on `/v1/whoami`
  or `/health` is none. The
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
| `FORMANCY_DATA_PUBLISHER_ROLES` | Review of publication, for tokens holding one of these comma-separated roles, each also one of the administrator roles: nobody publishes alone, and a publisher approves another administrator's draft. Needs the administrator's plane. Unset, no review. See *Publication under review*, below ([0065](../../docs/decisions/0065-with-publisher-roles-set-a-draft-is-published-only-when-a-publisher-who-did-not-submit-it-approves-it.md)). |
| `FORMANCY_DATA_AUDIT_KEY` | Records named in the audit trail by a keyed hash. A secret reference. Without it, no record is named. |

Without the store and the allowlist the server verifies tokens and nothing
else, which is how a host is wired in before any form exists.

The host's identity is set by exactly one of three settings, beside
`FORMANCY_DATA_ISSUER`, `FORMANCY_DATA_AUDIENCE` and
`FORMANCY_DATA_ATTRIBUTES`
([0014](../../docs/decisions/0014-host-identity-is-verified-offline.md),
[0059](../../docs/decisions/0059-the-host-identity-key-is-a-set-selected-by-kid-and-read-again-on-sighup.md)):

| Variable | Key |
| --- | --- |
| `FORMANCY_DATA_IDENTITY_SECRET` | A shared secret, HS256, as a secret reference. `FORMANCY_DATA_IDENTITY_ALGORITHM` is not read. |
| `FORMANCY_DATA_IDENTITY_PUBLIC_KEY_FILE` | A PEM public key, with `FORMANCY_DATA_IDENTITY_ALGORITHM` RS256, ES256 or EdDSA. HS256 beside it stops the process: a public key's text is never a shared secret. |
| `FORMANCY_DATA_IDENTITY_KEYS_FILE` | The absolute path of a JSON Web Key Set, with `FORMANCY_DATA_IDENTITY_ALGORITHM` RS256, ES256, EdDSA or HS256 for every key in it, read again on SIGHUP. |

`src/identity-settings.test.ts` holds what these accept and refuse. The two
one-key settings rotate by restart; a key set rotates as below.

| Variable | Sets |
| --- | --- |
| `FORMANCY_DATA_RATE_LIMIT` | Requests a minute each client address may send to every route but `/health`: a whole number of at least 1, 600 when unset. Anything else stops the process with a sentence naming the setting. Behind a reverse proxy every client shares the proxy's address, so the limit is one bucket for all of them: Fastify's `trustProxy` is not offered, and the setting raises that bucket rather than splitting it. |
| `FORMANCY_DATA_CORS_ORIGINS` | The origins a page may call the runtime plane from, comma-separated, each exactly as a browser sends `Origin`: `https://app.example`, or plain HTTP on `localhost`, `127.0.0.1` or `[::1]`. Empty or unset, none. A wildcard, a pattern, `null`, a path or a spelling no browser sends stops the process, and so does a list without the runtime plane. Read at start ([0060](../../docs/decisions/0060-the-runtime-plane-answers-the-origins-an-operator-lists-and-the-administrators-plane-none.md)); see *Across origins*, below. |
| `FORMANCY_DATA_LOOKUP_DEADLINE_MS` | How long a lookup statement may run, in milliseconds counted from when the adapter is asked for it, before the server stops it ([0061](../../docs/decisions/0061-a-lookup-statement-stops-when-its-request-is-abandoned-or-its-deadline-passes.md)): a whole number from 1 to 2147483647, the longest a Node timer holds. Unset, `DEFAULT_LOOKUP_DEADLINE_MS` from `@formancy/data-core`, the slowest lookup answer `docs/performance.md` measured, which describes that machine and data: a slower or larger deployment raises it. Anything else stops the process with a sentence naming the setting, and `createDataServer` refuses the same as `runtime.lookupDeadlineMs`. On SQL Server mssql's default request timeout of 15 s still cuts any deadline set above it, answered `unavailable`. |
| `PORT` | The port it listens on, 4390 when unset. |

`src/rate-limit.test.ts` holds what the rate-limit setting accepts and
refuses, `src/cors.test.ts` what the origin list does,
`src/lookup-deadline.test.ts` what the lookup deadline accepts, and
`src/publisher-roles.test.ts` what the publisher roles do.

The log is JSON lines on standard output: Fastify's lines for each request,
and the audit trail. A request is logged by its method and the route it
matched, never by the path, the query or the Host header it was sent with,
because those are whatever a caller typed, token or none
([0033](../../docs/decisions/0033-the-administrator-plane-is-audited.md));
a 404 is logged with no route. A request refused across origins names its
`Origin` only in the form a browser sends one, which holds no user
information, path or query (0060). `src/server-log.test.ts` fails when a
line holds what was sent.

A path is routed only when it is plain
([0037](../../docs/decisions/0037-cloudflare-is-the-edge-not-the-runtime.md),
which [the Cloudflare guide](../../docs/deploy/cloudflare.md) rests on):
a `/`, then segments that are not empty, not `.` or `..`, and made of
letters, digits and `-._~!$&'()*+,;=:@` only -- no `%` escape, no backslash,
no doubled or trailing slash. Every other path is 400 `path-not-plain`
before any route's work: before the token is read and before either plane's
hooks, so an administrator's token sent with it runs nothing. The reason is
a proxy that chooses where to forward by the path after decoding it,
resolving its dot segments and collapsing its slashes, as cloudflared
2026.10.0 was measured doing, while the router routes the path as sent: a
door that forwards only the runtime plane's routes would otherwise forward
`/v1/forms/a/versions/..%2F..%2Fb`, which the router runs as an
administrator's version read. No name the server accepts needs any of it,
because the studio and `@formancy/data-client` send names through
`encodeURIComponent`, which leaves a valid name as it is; a name that is not
valid and needed escaping now gets this 400 where it used to get the
route's 400, 401 or 404. The query is not looked at, since nothing routes by
it. A refusal counts against the rate limit, and on a path that matched a
route it is that plane's one audit event, status 400, outcome
`path-not-plain` and no actor; on a path that matched none it is no event.
An escape that does not decode is still the router's own 400
`FST_ERR_BAD_URL`, answered before this check and not counted.
`src/paths.test.ts` holds what is plain, and derives from the store's and
the allowlist's own checks that every form and connection id is.
`src/app.test.ts` sends the paths cloudflared read differently over a real
socket, because light-my-request resolves dot segments and backslashes
before the router would see them, and fails when one reaches a route, a
token is read for one, or one escapes the limit.

Every answer that runs the server's hooks says `Cache-Control: no-store`,
success, refusal or error alike, over anything a route set: a form id may
end in `.js`, which a CDN caches by extension, and a cache that does not
treat `Authorization` as private would hand one person's form or record to
the next. What is written before any hook carries none: the router's 400
for an escape that does not decode and its 414 for a parameter past its
limit, which `src/app.test.ts` holds, and, not exercised there, the 503
while the server closes and what Node's parser refuses. None of those holds
a form or a record.

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

What each runtime request but a page of records costs through
`dist/main.mjs`, configured this way, on both engines and with the machine,
the database's size and the date it was measured on, is in
[`docs/performance.md`](../../docs/performance.md)
([0034](../../docs/decisions/0034-performance-is-measured-through-the-shipped-server-and-held-without-a-clock.md));
lists came after those figures, and 0044 says what measuring them needs.

### Rotating the identity key

A key set file is `{"keys":[…]}`, a provider's certs document as it is
published. Each key in force needs a `kid` of `A-Z a-z 0-9 . _ ~ + / = -`,
which selects it for a token that names it; a token without one is tried
against each key in turn. A key that cannot verify the pinned algorithm --
another `kty` or `crv`, a `use` other than `sig`, a `key_ops` without
`verify`, another `alg` -- is left out and named in the log with the member
that left it out, as Keycloak's `rsa-enc-generated` is `because: 'use'`. A
private key member anywhere, a kid missing or repeated among the keys in
force, a key that does not import, an RSA key under 2048 bits or with a
public exponent that is even or under 65537, an Ed25519 point of small order,
or an HS256 key under 32 bytes refuses the whole file, in a sentence naming
the key by kid or by place and never quoting it. A kid is logged as written,
so an HS256 key's kid is a name, never key material: one that is its own `k`,
or 43 base64 characters or more -- as long as a secret -- refuses the file.
The path must be a regular file; a FIFO or a directory is refused.

Moving from the secret or the public key is one command, run where the
server's environment is -- in the server's container, for example -- so it
reads the setting exactly as the server does:

```bash
(umask 077; docker exec <server> node dist/identity-keys-cli.mjs convert host-1 > keys.json)
```

It writes the key the server verifies with today, under the kid you give, and
says on standard error which settings to change. For HS256 the file is the
shared secret: keep it as `FORMANCY_DATA_IDENTITY_SECRET`'s file is kept,
readable only by the server's user or handed over as a Docker or Kubernetes
secret, and write every set after it with the same `umask`. Do not write the set by
hand from a secret: the secret's text is itself valid base64url, so pasted as
`k` it is accepted and is another key, and a secret file's bytes as read keep
the newline the server removes. Either way every token is refused.

To rotate:

1. Write the new set beside the one in use, in the directory that is mounted
   -- mount the directory, not the file: a file bind-mounted on its own keeps
   the inode it was given, and on Docker 29.8.1 a file renamed over it on the
   host was not seen inside the container.
2. Check it with the server's own reading:
   `docker exec <server> node dist/identity-keys-cli.mjs check /run/identity/next.json HS256`
   prints `in force: …` and `left out: …` and exits 0, or prints the refusal
   and exits 1.
3. Rename it over the old one, and signal the server:
   `docker kill --signal HUP <server>`, `docker compose kill -s HUP server`,
   `kill -HUP 1` inside the container, or `ExecReload=/bin/kill -HUP $MAINPID`
   under systemd.
4. Read the line it logs: `identity keys read again` with the kids `added`,
   `removed` and `replaced`, `identity keys read again; nothing changed`, or,
   at `error`, `identity keys not read again; the set in force is unchanged`
   with the reason. A failed read keeps the set in force, a key you removed
   included, and the same file stops the next start until it is fixed --
   which is why step 2 comes first. A read that never returns, from a
   network mount that stalls, logs nothing, and every signal after it waits
   behind it: no line within seconds is that.

On Kubernetes, mount the Secret as a volume and never through `subPath`,
which Kubernetes says "does not receive automated Secret updates"; a volume
is updated eventually, so wait until `check` inside the pod lists the new
kids before `kubectl exec <pod> -- kill -HUP 1`, then compare the logged
`added`, `removed` and `replaced` with what was written. A signal sent too
early logs that nothing changed. Neither has been run through a cluster here.

A provider's set reaches the file through the operator's own job -- a cron
entry, a systemd timer, a CronJob -- that fetches the document, writes it to
a temporary file, runs `check`, renames it into place, sends SIGHUP and reads
the line. The server fetches nothing (0014). Each instance reads its keys on
its own signal, and where no process can be sent one, natively on Windows, a
set is read only at start. The planes line at start names the kids in force
and what was left out. No line holds key material or a hash of the file.

### Across origins

The studio, the host page and `/v1` on one origin is the default, and the
composed stack's. A host page on an origin of its own -- a static page whose
identity provider issues the token -- calls the runtime plane directly when
`FORMANCY_DATA_CORS_ORIGINS` lists that origin exactly
([0060](../../docs/decisions/0060-the-runtime-plane-answers-the-origins-an-operator-lists-and-the-administrators-plane-none.md));
an embedder passes the same list as `runtime.origins`, held to the same rule.

- **What is granted.** Each runtime route has an `OPTIONS` route at its
  path. A preflight is granted when its `Origin` is a listed origin byte for
  byte, the method it asks for is the runtime route's at that path -- GET or
  POST, never HEAD -- and reaches that route, and it asks for no header but
  `authorization`, `content-type` and `formancy-write-id`, the ones
  data-client sends that a browser asks about. The grant is 204 with that
  origin, that method, those three headers, `Access-Control-Max-Age: 600` --
  WebKit keeps a grant no longer -- and `Vary`. A browser may send any GET,
  HEAD or POST to that URL on the grant without asking again: Chromium and
  WebKit did, Firefox asked (measured by hand, 0060). Every answer of a
  runtime route then carries `Access-Control-Allow-Origin` for a listed
  origin, refusals included, and `Vary: Origin` for any; what is written
  before any hook, the router's 414 and the 503 while closing among it,
  carries neither.
- **What is refused.** Any other preflight is 403 `cross-origin-refused`
  with no `Access-Control-*` header, which the page sees as a network
  error: a read is `unreachable`, a write unknown though nothing was sent.
  The administrator's plane, `/v1/whoami` and `/health` have no `OPTIONS`
  route, so their preflight is the router's 404, and no answer of theirs
  carries an origin. On every route, listed origins or none, a request with
  an `Authorization` header whose `Sec-Fetch-Site` is `cross-site` or
  `same-site` is refused 403 before its token is read unless its origin is
  listed and its route is the runtime plane's: a browser that cached a grant
  before its origin was removed sends without asking for up to ten minutes,
  and those requests now do nothing. Counted by the limiter as every route
  but `/health` is, and audited with no actor by the plane whose route it
  reached; on `/v1/whoami` and `/health` no event. A path no route takes is
  the router's 404, token or none. A request with no `Sec-Fetch-Site` --
  every client that is not a
  browser, and browsers before Chrome 76, Firefox 90 and Safari 16.4 -- and
  a `same-origin` one are answered as before. A deployment that put CORS
  headers on its own proxy has its cross-origin requests refused that way
  until it lists their origins.
- **What it logs.** "preflight refused" and "cross-origin request refused",
  at info, with the reason -- `origin not listed`, `method not offered on
  this route`, `method reaches another route`, `header not allowed`, `not a
  preflight`, `route not offered across origins` -- and the origin, but only
  when it is one a browser could send: no user information, path or query.
- **What is never sent.** `Access-Control-Allow-Credentials`, so no cookie
  crosses origins; `Access-Control-Expose-Headers`; and
  `Access-Control-Allow-Private-Network`. Preflights are not rate-limited by
  the server and not audited: they read no token and do no work.
- **What stops the server.** With origins listed, a GET, HEAD or POST route
  of another plane or an embedder's whose pattern could match a path a
  runtime route of any method matches -- a request a browser would send on
  that route's grant -- a route of another method overlapping a runtime
  route of its own method, and any route with a regex parameter, a
  wildcard, two parameters in one segment or a constraint, stop it at
  ready, rather than grant a preflight for one route and have another answer
  a request riding it. The preflight's own check that the method reaches
  the runtime route holds only a route registered before the server's own,
  which createDataServer registers none of.

`src/cross-origin.test.ts` holds each of these over the real server, and
`src/server-log.test.ts` what the log names. No browser gate runs against a
server with origins listed yet; the one measurement in browsers was by hand.

### Publication under review

Without it, every administrator publishes, imports and restores alone. A
deployment that wants a second person before a form reaches its users sets
`FORMANCY_DATA_PUBLISHER_ROLES` ([0065](../../docs/decisions/0065-with-publisher-roles-set-a-draft-is-published-only-when-a-publisher-who-did-not-submit-it-approves-it.md)):

```bash
FORMANCY_DATA_ADMIN_ROLES=data-admin,data-publisher \
FORMANCY_DATA_PUBLISHER_ROLES=data-publisher \
node dist/main.mjs
```

Comma-separated, space around each role ignored, each counted once, and
each also one of `FORMANCY_DATA_ADMIN_ROLES`: a publisher is an
administrator who may also approve. Set and naming no role, naming a role
the administrator roles do not have, or set on a server without the
administrator's plane, it stops the process with a sentence naming what is
wrong. It is read once, at start, and the startup `planes` line says
`review`. An embedder passes `admin.publisherRoles` to `createDataServer`,
held to the same rule. Unset, nothing changes, so upgrading puts no
deployment under review.

Under review an administrator whose token holds a publisher role is a
publisher, and one whose token does not is an author. Who they are is the
token's `sub`, and what they hold its `roles` claim, never anything a body
says.

| | An author | A publisher |
| --- | --- | --- |
| Connect, discover, propose, read versions, drift, regenerate | yes | yes |
| Publish or import directly | no: 403 `review-required` | no: 403 `review-required` |
| Submit a draft, read the queue and a draft | yes | yes |
| Approve a draft | no: 403 `publisher-required` | someone else's; their own is 403 `own-draft` |
| Reject a draft | their own, which is a withdrawal; someone else's is 403 `publisher-required` | any pending draft |
| Restore a version | no: 403 `publisher-required` | yes, alone and without a draft |

A token that holds both roles is a publisher, and still never approves a
draft it submitted. Each refusal is 403, decided by `refusalFor` in
`governance.ts` before the route reads its body -- for an approval or a
rejection, once the draft is read -- with one sentence each:

- `review-required`: "This deployment reviews publication: submit this
  version as a draft, and a publisher other than you approves it."
- `publisher-required`: "This needs a publisher role: restoring a version,
  and approving or rejecting someone else's draft, are a publisher's."
- `own-draft`: "You submitted this draft: a publisher other than you
  approves it."

The routes:

- **`GET /v1/administration`**, review or not: `{ review, publisher,
  refuses }` (the type `Administration`): whether the deployment reviews,
  whether the caller publishes, and every operation the caller's grant
  refuses them, each with its `code` and `message`. Without review it is
  `{ review: false, publisher: true, refuses: {} }`. A client draws what it
  offers from this rather than guessing; a clerk is 403 `forbidden`.
- **The draft routes exist only under review**; without it the router
  answers 404 for each.
  - **`POST /v1/forms/:id/drafts`**, the publish's body `{ expectedBase,
    bundle, keysConfirmed? }`, a `submittedBy` in it unread. It checks
    what an import checks, in its order: 400 for a body of another shape;
    422 `invalid-bundle` for what a publish refuses, among them a
    connection this allowlist has no entry by that name for, with the
    sentence that a version keeps its connection's name; 503 `unavailable`
    when the database cannot be discovered, with no address; 422
    `other-engine`; 409 `incompatible` with only the blocking changes; 422
    `keys-reassigned` with `keys` and `problems`; 409 `conflict` with
    `current` when `expectedBase` is not the newest version. 201 answers
    `{ draft, state: 'pending', drift }` (`DraftSubmission`). Nothing is
    written to the versions.
  - **`GET /v1/drafts`**, the queue (`DraftQueue`): `{ drafts, unreadable
    }`, each pending draft's `form`, `draft`, `expectedBase`,
    `submittedBy`, `title` and `refuses: { approve?, reject? }`, by form id
    in codepoint order and by number within a form; and the forms whose
    drafts cannot be read, which hide no other form's.
  - **`GET /v1/forms/:id/drafts/:draft`** (`DraftRead`): the draft, its
    `bundle` and `keysConfirmed`, its `state` -- `pending`, `rejected`,
    `published` or `stale` -- `rejectedBy` and `withdrawn` when a rejection
    names it, a published draft's included, the form's `current` version,
    and `refuses`. 404
    `unknown-draft` for a number no draft has.
  - **`POST /v1/forms/:id/drafts/:draft/approval`**, no body: 403
    `publisher-required` or `own-draft`; 409 `rejected`, `published`, or
    `stale` with `current`; then every check of the submit again, against
    the database as it is now -- so a bound column dropped since is 409
    `incompatible` and the draft waits -- and 409 `conflict` with `current`
    if another version landed first. 201 answers `{ version, drift }`
    (`Approval`), and the version file is the draft's bundle exactly as the
    store writes every version.
  - **`POST /v1/forms/:id/drafts/:draft/rejection`**, no body: 201 `{ draft,
    state: 'rejected', withdrawn }` (`DraftRejection`), `withdrawn` when the
    submitter took it back; 403 `publisher-required` for an author
    rejecting someone else's; 409 for a draft rejected, published or stale
    already.
  - A draft's number in a path is a whole number from 1; anything else is
    400 `invalid-request`.

Drafts are kept in `<FORMANCY_DATA_STORE_DIR>/.drafts`, a numbered entry per
draft and per rejection, each form's written by the same compare-and-swap
as its versions and never edited, so draft numbers have gaps where a
rejection took one. A draft's state is derived whenever it is read:
published when the version after its base holds its bundle, rejected when a
rejection names it, stale when another version replaced its base, pending
otherwise. Published is asked first because it is what is served: a
rejection that landed while the approval wrote the version decides
nothing. An entry edited or damaged on the volume makes that form's
drafts 500 `internal`, and the log says `a draft entry does not validate,
and is not served`, naming the form and the entry. Who approved a version
is the audit trail's `draft-approve` event, and nothing else.

What it costs and does not do, as 0065 says: every submit and approval
discovers the database, so one that cannot be reached refuses both;
nothing deletes a draft, and the queue reads every form's on every
request; nobody is told a draft waits; no route shows a publisher a
draft's drift before the approval answers with it; nobody approves their
own draft, so a deployment under review needs two people; a publisher
restores any version alone, one published before review was turned on
included; turning review off leaves the drafts on the volume, unread;
roles are read from the token's `roles` claim only; and an approval and a
rejection of one draft at the same moment can both succeed, the draft then
reading published. The composed
stack and [the getting-started guide](../../docs/getting-started.md) run
without review.

`src/routes/admin-drafts.test.ts` holds every route and refusal, and that
an author writes no version on any route;
`src/routes/admin-drafts-store.test.ts` what a drafts or versions store
that cannot be read, an entry edited on disk and concurrent submits
answer, and the queue;
`src/routes/admin-drafts.integration.test.ts`, on both engines, two drafts
of the order form: refused for drift and approved as version 1, then a
second over it from a submitter holding the publisher role, refused
`own-draft` for them, refused for drift and approved by the other
publisher as version 2, which the runtime serves, with who approved read
from the trail; `src/publisher-roles.test.ts` the setting, and an
embedder's `admin.publisherRoles` refused by `createDataServer`;
`src/routes/admin-audit.test.ts` the draft routes' events.

## Licence

Source-available, not open source. See [`LICENSE.md`](./LICENSE.md).
