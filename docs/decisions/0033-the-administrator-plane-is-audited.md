# 0033 — The administrator's plane is audited like the runtime, one event per request

- **Status:** accepted
- **Date:** 2026-10-09
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-server/src/routes/admin-audit.test.ts` — a route registered
  on either plane without an audit name stops the registration, naming the
  route, on the runtime plane with no sink configured too (watched failing
  with the `onRoute` check disabled); on each plane, every route the router
  holds, HEAD included, sent once with no token, gives exactly one 401
  `unauthenticated` event under its name in `ADMIN_OPERATIONS` or
  `ROUTE_OPERATIONS`, and the table names no route the router does not hold
  nor the router one the table does not name (watched failing with events
  built for POST routes only, and, on the runtime plane, with an unnamed
  route registered above its hooks); a route registered above a plane's
  hooks, where `onRoute` cannot see it, answers 500 `unaudited-route`, runs
  no handler and is named in the log (watched failing: it answered 200 and
  left no event); the administrator's plane does not start without a sink,
  its type bypassed by a cast (watched failing with the check removed); a publish's
  whole event, and no title or policy role from the bundle in any event
  (watched failing with the request body spread into the event); a stale
  publish is 409 `conflict` with its base and no version; a
  restore names the version it wrote and the one it copied, and an
  incompatible one is 409 `incompatible` with no change in it; each read
  names the version it served; a clerk's 403 names the clerk (watched failing
  with the identity set after the role check) and a request with no token
  names no actor; a body Fastify refuses — JSON that does not parse, a type
  nothing parses, one past the limit — is audited by its code with no actor,
  an administrator's token notwithstanding (watched failing with the plane
  authenticating in `preParsing`, before the body); a database that is down
  is 503 `unavailable` with no address in the trail; a discovery holds no
  column of the snapshot; a request over the rate limit is audited as
  `http-429`, and a path no route matches, a parameter past the router's
  limit, or one whose percent-encoding does not decode, leaves no event
  (watched failing with an outcome other than `http-NNN` for a body without
  a code); a sink that throws leaves the publish standing and is logged.
  What a caller cannot write into the trail: a connection string in the
  path, with a token and without, and in a proposal's body, is recorded as
  no connection, and no event holds its password or host; a path that is
  not a form id is recorded as no form (both watched failing against this
  decision as first designed, which recorded path parameters as addressed,
  and again with each check removed); and the limit of that, an IP address,
  a host name or a lower-case password in a form id's place is recorded as
  typed (watched failing with a narrower shape). Over a real socket: a
  publish whose client disconnected while the write waited is audited
  exactly once, naming the version it wrote (watched failing with the event
  written from `onResponse` alone: no event); a publish pipelined behind a
  held request, its connection gone after its answer was decided or before,
  is audited exactly once, naming the version it wrote (watched failing as
  first built, and each case again without the connection's `close` or
  without the check for a connection already gone); a body cut off by a
  client that left is audited as 400 `ECONNRESET` with no actor (watched
  failing as above); a socket destroyed after `onSend` and before the
  response finished is audited once (watched failing with the connection's
  `close` writing nothing); a publish answered normally is audited exactly
  once (watched failing, with most of this suite and the runtime's, without
  the guard against a second event); a keep-alive connection holds as many
  `close` listeners after one request and after twenty as before the first
  (watched failing with the listener left on once nothing waited, and, as
  this decision's second build had it, with a listener per request never
  removed: 21 against 2); twenty requests pipelined behind a held one put
  no more listeners on their connection than one does (watched failing
  with a listener per waiting request, the second build's: 23 against 4);
  a request answered 503 because the server is closing leaves no event
  (watched failing with Fastify's `return503OnClosing` off, when it ran and
  was audited); a request Node's parser refuses, headers past its limit
  (431) or a body framed two ways (400), leaves no event (watched failing
  with Node's header limit raised and its lenient parser on, when the first
  reached the route and answered 200).
  `packages/data-server/src/routes/runtime.test.ts`, "the operational audit
  trail" — whole events with `plane: 'runtime'`, through a sink that narrows
  on `plane`; a path that is not a form id is recorded as no form (watched
  failing with the path recorded as addressed); a body Fastify refuses has
  no actor (watched failing as above).
  `packages/data-server/src/server-log.test.ts` — the server as `main.ts`
  composes it, through `servedPlanes`: no line of its log holds a password or
  host sent in a path, a query, a Host header or a 404's path, and each
  request line names its route (watched failing against Fastify's default,
  seven lines, and again without the serializer, and without the 404 line's
  override); both planes' events are `audit` lines of the one log (watched
  failing with the administrator's plane given a sink of its own).
  `packages/data-server/src/audit.test.ts` — the default sink writes either
  plane's event as one structured line, unchanged.
  `scripts/install-fixture/consume.ts`, run by `pnpm test:e2e:install` — a
  consumer of the packed tarball imports `AuditEvent`, `RuntimeAuditEvent`
  and `AdminAuditEvent` and narrows the union on `plane`, with
  `skipLibCheck` off (watched failing with the two planes' types dropped
  from the package's exports).

## Context

[0023](0023-the-audit-trail-is-operational-not-evidence.md) audits the runtime
plane: every request, reads and lookups included, one event, never a value.
The administrator's plane ([0020](0020-administration-is-a-separate-plane.md)),
which holds the stronger permission, had no trail.
[0030](0030-presentation-is-a-patch-over-the-generated-base.md) wrote that
down as a cost: a publish and a restore wrote no audit event and no log line.
So "who published version 3 of this form, and when" had no answer, and a
restore left a file that was the old version's document with nothing saying it
was a copy.

On this plane the reads are where much of the risk is. Discovery runs the
administrator's account against the customer's catalog and hands back the
schema; a connection test reaches a database; the versions, a version, a
regeneration and drift hand back a policy, which says who may see what. A
refused read — a clerk probing metadata, 403 — is the event an operator most
needs.

**What was measured** (2026-10-09, Fastify 5.12.5, Node 22.22.1,
light-my-request 6.6.0 behind `inject`), with a bare Fastify route that waited
and a client socket destroyed after the body was sent:

- **The route completes and its write commits; `onSend` runs, with the
  response already destroyed; `onResponse` never runs.** Fastify starts
  `onResponse` on the response's `finish` or `error` only (`setupResponseListeners`
  in `lib/reply.js`), and a response whose socket is gone emits neither.
- **`onRequestAbort` never runs either.** Fastify starts it on the request's
  `close` only when `req.aborted`, which is false once the body was read
  (`lib/route.js`).
- **A response that finishes** runs `onSend`, `onResponse` and then the
  response's `close`, finished. Under `inject`, `close` follows `finish` on the
  next tick (read in light-my-request's `lib/response.js`).
- **A request pipelined behind another** on one connection is routed and
  runs at once, and its answer waits in Node's queue with no socket until
  the answer ahead of it is written. When the connection goes first, that
  response emits neither `finish` nor `close` and is never destroyed: the
  route completes, its write commits, and nothing the response does says so
  (over a real socket, by the pipelined case of `admin-audit.test.ts`
  against the first build).
- **An async hook ahead of the body.** Fastify reads the body only after its
  `preParsing` hooks. With one that awaited for 100 ms and a client that
  left half-way through its body during it, nothing followed: no `onSend`,
  no `onResponse`, no answer. `onRequestAbort` does run then, during the
  wait, because the body had not been read (measured again the same day,
  after the first measurement had left it out), and the same holds with the
  wait in a route's own `onRequest` instead. With the same wait in
  `preHandler`, after the body, the request was answered 400 `ECONNRESET`
  and `onSend` ran.
- **A listener per waiting request.** Forty requests pipelined behind one
  held request, with the trail listening to the connection's `close` once
  per request, put forty-two `close` listeners on one socket and made Node
  print `MaxListenersExceededWarning`; without that listener the peak was
  two. Any client can pipeline, token or none.
- **What Node's parser refuses** never becomes a request: headers past
  Node's limit (`http.maxHeaderSize`, 16384 bytes on this Node) are
  answered 431, here with 20 KiB of them, and a body framed by
  both `Content-Length` and `Transfer-Encoding` 400, by Fastify's
  `clientError` handler, which logs at trace level only.
- **The rate limit is a route-level hook.** `@fastify/rate-limit` 11.2.0
  adds its `onRequest` hook to each route as it is registered (read in its
  `index.js`), and Fastify runs a route's own hooks after its context's.
- **Fastify's request log** writes each request's URL as sent and its Host
  header in `incoming request`, and a 404's path in its own line: seven
  lines of `server-log.test.ts` held a planted password before the change.

A review of this decision's first build, with probes against the real server,
found that it recorded a connection string typed into the path — host, user
and password, with or without a token — as the event's connection; recorded
any text in the path as the form; and wrote no event for a publish whose
client disconnected, though the version was written. A second review found
that a pipelined publish whose connection closed still left no event; that a
route registered above a plane's hooks answered unaudited; that the runnable
server's request log wrote the connection string the trail left out, one
line above it; and that the documents claimed more than the tests showed —
every request audited, a refusal always naming its actor, no address ever in
`form`. A check of those fixes found that the listener added for the
pipelined case was one per request, so a client could pipeline its way to
Node's leak warning; that the answers no hook sees left out Node's own; and
that one reason given for reading the token after the body did not hold as
written. Each is decided below.

## Decision

**Every administrator request that reaches a route of the plane emits one
audit event**, through hooks both planes share.

- **What is audited: every route of the plane**, by an operation name keyed
  `METHOD url`, HEAD as the GET it answers for:

  | Route | Operation | What it names beyond the actor |
  |---|---|---|
  | `GET /v1/connections` | `connection-list` | — |
  | `POST /v1/connections/:id/test` | `connection-test` | the connection |
  | `GET /v1/connections/:id/metadata` | `discovery` | the connection |
  | `POST /v1/form-proposals` | `proposal` | form and connection, once the body is read |
  | `POST /v1/forms/:id/versions` | `publish` | the base, once the body is read; the connection, once the bundle validates; the version written, on 201 only |
  | `GET /v1/forms/:id/versions` | `version-list` | the form |
  | `GET /v1/forms/:id/versions/latest` | `version-latest` | the version and connection loaded |
  | `GET /v1/forms/:id/versions/:version` | `version-read` | the version and connection, once loaded |
  | `POST /v1/forms/:id/drift` | `drift` | the published version compared, and its connection |
  | `POST /v1/forms/:id/regenerations` | `regeneration` | the version regenerated from, and its connection |
  | `POST /v1/forms/:id/restorations` | `restore` | the version copied and the base, once the body is read; the connection, once loaded; the version written, on 201 only |

  `/health` and `/v1/whoami` belong to neither plane and are not audited.

- **One event type, two planes.** `AuditEvent` is `RuntimeAuditEvent |
  AdminAuditEvent`, told apart by `plane`, both written to one sink. Every
  field is always present, `null` where it does not apply, so a collector sees
  one fixed shape per plane. An administrator's event carries `connection`,
  `form`, `formVersion` (the version read, compared, regenerated from or
  written), `expectedBase` (publish and restore) and `restoredFrom` (restore
  only: the one record that the new version is a copy). It has no `record`
  field, so it cannot be given one. A version is named by the pair of form
  and version, which is enough because versions are immutable files
  ([0013](0013-published-configuration-is-files-with-link-based-swap.md)).
  `outcome` is `ok` below 400; otherwise the response body's `code`, or
  `http-NNN` when it has none — one rule for both planes.

- **A name is recorded only once it is known to be one.**
  - **A connection only when the allowlist knows it**, wherever it came from:
    the path, a proposal's body, a stored bundle. A connection id is a name,
    never an address ([0019](0019-a-published-form-is-checked-every-time-it-is-read.md)),
    and anybody who can reach the port, token or none, could otherwise write a
    host, a user and a password into the trail by pasting a connection string
    where the name goes. It is checked where the event is made, so no route
    can forget it.
  - **A form id only when it has the store's shape**, on both planes, so the
    two agree on what a form is: lower-case letters, digits, dot, hyphen and
    underscore, which hold no `:`, `;`, `@`, `=` or `/`, so no connection
    string. Anything else in the path is `null`. The shape does admit an IP
    address, a host name, or a lower-case word that is somebody's password:
    those are form ids, and are recorded as typed.
  - A body's other names after the body passes its check; a version once it
    is loaded or written.

- **A refusal records the actor, the operation, the status and the code**,
  and whatever addressing was established before it. No token: actor `null`.
  A 403 names the actor, which needs the plane's preHandler to set the
  identity before its role check. A stale publish is 409 `conflict` with its
  base and no version; an incompatible restore is 409 `incompatible` with the
  version it would have copied and none of the `changes` its response
  carries. A request over the rate limit is refused before anybody is known,
  and is audited with no actor as `http-429`.

- **The token is read after the body**, in each plane's `preHandler`, as
  before this decision. So a body Fastify refuses — JSON that does not
  parse (400), a type nothing parses (415), one past the limit (413), a
  client gone mid-body (400 `ECONNRESET`) — is refused before anybody is
  known, and is audited by its code with no actor, whatever token it
  carried. Reading the token first would name them, and costs more than it
  buys (measured above): in the context's `onRequest` it runs ahead of the
  rate limit, so a token replayed past the limit is verified and refused 401
  without being counted, which is what the limit is there to stop; behind
  the limit and before the body, in `preParsing` or a route's own
  `onRequest`, a client that leaves while the token is verified gets no
  answer, and only `onRequestAbort` hears of it — so its event would be one
  for a request the server never answered, with no status to record, and
  this decision does not invent one.

- **Never recorded:** the bundle, the policy or any role it names, a snapshot,
  the generation request, a drift report, `problems`, `changes`, `current`,
  any response message — the generator's sentence or a driver's, which names
  hosts and ports — a password, or a connection string.

- **Where, and exactly once.** `auditRequests(app, { names, sink, now,
  describe })` in `audit.ts`, called by each plane before it registers a
  route:
  - its `onRoute` hook throws `"<METHOD> <url> has no audit name (0023,
    0033)"` for a route of that plane with no name, with or without a sink,
    so a route added later stops the server instead of answering unaudited;
  - `onRoute` sees only the routes registered after it, so its `onRequest`
    hook, which covers every route of the context, refuses a route with no
    name — one registered above the call — with 500 `unaudited-route`
    before its handler runs, and logs the same sentence: fail closed, as
    formancy.ai 0022 has it, rather than answer and log;
  - its `onSend` hook reads the refusal's code from the response;
  - the event is written from `onResponse`; from `onSend` when the response
    or its connection is already gone; or from the connection's `close`
    when it goes after `onSend` and before the event is written — whichever
    comes first, and a `WeakSet` of requests makes the others do nothing.
    The connection's `close` is what hears a response whose socket went
    after `onSend`, and a pipelined answer still queued behind another. A
    connection holds one such listener while any answer waits on it,
    however many requests were pipelined on it, and none once the last
    event is written;
  - a sink that throws is logged, and the request is not failed (0023).

- **The administrator's sink is required.** `AdminOptions.audit: { sink, now? }`
  is not optional, and `adminRoutes` throws without a sink, for a caller the
  type does not reach. The runtime's `audit` stays optional.

- **`main.ts` passes one sink to both planes**, through `servedPlanes` in
  `planes.ts`: the server's own log, one `audit` line per event, which a
  collector separates by `audit.plane`. The administrator's plane takes no
  audit key, because it names no record. That `main.ts` calls `servedPlanes`
  is held by review: no test starts the runnable server.

- **The request log names routes, not paths.** The trail and Fastify's
  request lines share one stream, so keeping a connection string out of the
  one and not the other keeps it out of nothing. `createDataServer` gives
  the logger a `req` serializer that writes the method and the route that
  matched — never the URL, the query or the Host header as sent — and a
  `LogController` whose 404 line names no path.

## Consequences

**What it buys.** "Who published version 3 of this form, and when" has an
answer: operation `publish`, `formVersion` 3, the actor and the time. A restore
leaves a trail, naming the version it copied. Refused attempts at
administration are visible — a clerk's 403, a stale base's 409, a request
with no token, one over the rate limit. One sink and one outcome rule serve
both planes. A route added to either plane later cannot answer unaudited:
its registration fails, or, registered above the plane's hooks, it is
refused on every request. And nothing a caller types into a path or a body
reaches the trail as a connection unless the allowlist has it, or as a form
unless it has a form id's shape; nor, as a path, a query or a Host header,
the request log beside it.

**What it costs.**

- **Volume.** Every request of the plane is a log line, the studio's page
  loads and every refused probe included. Not measured.
- **`AuditEvent` is a union.** A TypeScript sink that read `event.record`
  without narrowing on `plane` stops compiling, and the runtime's `form` is
  now `string | null`. To a log reader, `plane` is one more field.
- **An asymmetry.** The administrator's sink is required while the runtime's
  stays optional, because a runtime plane without a trail is an existing,
  documented configuration (0023) and this decision does not change it.
- **A probe is recorded as a probe of nothing in particular.** A path whose
  connection is not allowlisted, or whose form id does not have the shape, is
  `null`: the event keeps the actor, the operation, the status and the
  outcome, and loses what was typed. So does a stored version whose
  connection was taken out of the allowlist after it was published, on every
  read of it.
- **A request whose client left is recorded with the status the server
  answered**, as [0031](0031-an-answer-lost-after-a-write-is-unknown.md)
  records a write whose answer the page lost: the server answered, and only
  the client did not hear it.
- **A listener on each connection while an answer waits on it**, its
  `close`, which is how a socket lost after `onSend`, and a pipelined
  answer whose connection went, are noticed: one for every answer waiting
  on that connection, removed when the last event is written, and a map
  per connection of the requests still waiting.
- **A body Fastify refuses names nobody**, an administrator's included,
  because the token is read after the body (above). The event still says
  which route, which status and which code.
- **The request log no longer says which path.** Which form or connection a
  404 or a refused request addressed is in the audit event when it has a
  form id's shape or the allowlist knows it, and nowhere when it does not;
  an operator who needs the path as sent has a proxy's log for that.

**What it does not do.**

- **It is not tamper-evident.** Whoever runs the log can edit it (0023).
- **It is not atomic with the store write.** The event is written after the
  store's link swap has committed; a crash in between loses it, and a sink
  that fails is logged while the publish stands.
- **A route that never finishes writes no event**, and a process killed while
  a route runs writes none for it.
- **The exactly-once rule rests on what was measured on Fastify 5.12.5 and
  Node 22**: that `onSend` runs for a response whose socket is gone, and
  that a pipelined answer's connection emits `close` when it goes. A Fastify
  or Node that changed either would lose an event, and a socket test would
  fail; one that started running `onResponse` on `close` would still write
  one event, because of the guard.
- **A request that never reaches a route of the plane is not audited** — a
  path no route matches (404), a parameter past the router's limit (414) or
  one whose percent-encoding does not decode (400 `FST_ERR_BAD_URL`), all
  answered by the router; the 503 Fastify writes itself for a request
  that arrives on a held connection while the server closes; and what
  Node's HTTP parser refuses before Fastify sees a request at all, headers
  past Node's limit (431) or a request it cannot parse (400), answered by
  Fastify's `clientError` handler. None runs a hook of any plane, and none
  runs a route, so nothing was done that the trail could name. As on the
  runtime plane since 0023.
- It says nothing about what changed between two versions; for that, read
  the two versions.
- It does not record the bundle, the policy, a snapshot, a drift report or a
  message, and it does not hash the bundle to detect edits on disk: 0019's
  re-validation on read is what exists there.
- It does not audit `/health` or `/v1/whoami`.

## Alternatives considered

- **Audit only the routes that change published state, and metadata reads.**
  Rejected: it needs a per-route exemption list that only review holds, misses
  refused probes and policy reads, and leaves the stronger permission with
  the weaker trail.
- **A separate sink for the administrator's plane.** Two things to wire, one
  of which gets forgotten.
- **One flat event with every field of both planes.** Invites a `record` on
  an administrator's event and a `connection: null` on every runtime one.
- **An explicit emit call in each route.** A route can forget it, which is
  the failure 0023's hook was built to avoid.
- **Record path parameters as addressed**, as this decision's first build did
  and the runtime did since 0023. Rejected: a connection string in the path
  put a password in the trail, token or none.
- **Check the connection in each route that sets it.** Rejected: the path's
  connection is known before any route runs, on a 401 or 403 too, and a route
  added later could forget the check. One check where the event is made holds
  for every source.
- **Record an unknown connection or form by a keyed hash**, so repeated probes
  with one pasted string could be correlated. Deferred: the actor and the
  time already correlate them, and a short password hashes no more safely
  than 0023 says a small key does.
- **Write the event from `onRequestAbort`.** It does not run once the body
  was read (measured above).
- **Read the token before the body**, so a body Fastify refuses names who
  sent it, and an unauthenticated body is never buffered. Rejected for now,
  each place measured above: the context's `onRequest` runs ahead of the
  route-level rate limit, and behind it, in `preParsing` or a route's own
  `onRequest`, a client that leaves during the check gets no answer, and
  its event could come only from `onRequestAbort`, with no status the
  server answered.
- **Listen to the connection once per waiting request**, as the second
  build did. Rejected: any client, token or none, puts a listener on a
  socket for each request it pipelines (measured above). One listener per
  connection hears the same.
- **Log a route that has no name, and let it answer.** Rejected: it answers
  unaudited, which is what the name exists to prevent.
- **Turn Fastify's request logging off.** Rejected: the operator loses the
  line per request, its status and its time; naming the route keeps it.
- **Audit the 503 Fastify sends while closing.** The plane cannot: Fastify
  writes it before any hook. Turning that load-shedding off would audit it by
  running the route during a drain, which is the work the 503 is there to
  spare.
- **Write every event from `onSend`.** It would hold every answer until the
  sink returned; `onResponse` stays the ordinary path, as in 0023.
- **Include a bundle hash in the event.** Deferred, because tamper-evidence is
  not claimed.

## Older records

Extended: [0020](0020-administration-is-a-separate-plane.md)'s plane, whose
every request that reaches a route is now audited and whose preHandler sets
the identity before the role check; [0023](0023-the-audit-trail-is-operational-not-evidence.md)'s
trail, which now covers both planes, names its plane in every event, and
records a runtime path that is not a form id as no form. Narrowed:
[0030](0030-presentation-is-a-patch-over-the-generated-base.md)'s cost that a
publish and a restore write no audit event — they do now; its text is left as
written.
