# 0060 — The runtime plane answers the origins an operator lists, exactly, and the administrator's plane answers no other origin

- **Status:** accepted; extended by [0079](0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md): a file of records is named by the client from the form's id, since no response header is exposed to another origin
- **Date:** 2026-10-13
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-server/src/cors.test.ts` — `FORMANCY_DATA_CORS_ORIGINS`
  accepts origins as a browser sends them, `http://[::1]:3000`, a punycode
  name, an IPv6 and an IPv4 host among them, and unset, `''`, `' , '` and
  `,,` are no list; it refuses, naming the entry by its place and never
  repeating it, `*`, `null`, a pattern, a trailing slash, a path, upper case
  in the host or the scheme, a default port written out, a name that is not
  punycode, user information holding a password, a query, `ftp:`, `wss:`,
  plain HTTP to `app.example`, to `localhost.example` and to `127.0.0.2`,
  `localhost.` and another trailing dot, a host that is no DNS name, and no
  scheme, each by the reason of the rule that refuses it; a list beside a
  server without the runtime plane stops it; `runtime.origins` is held to
  the same rule by place; and Vary gains `Origin` once, whatever an answer
  said already. `cross-origin.test.ts`, over the real server with both
  planes, both audit sinks, a verifier and a registry that count what they
  are asked, and the log — every runtime route's preflight from a listed
  origin is granted with its method, the three headers, Max-Age 600 and
  Vary, and nothing about credentials, exposed headers or the private
  network, read from `ROUTE_OPERATIONS`; the differential: every route
  printRoutes holds, HEAD included, sampled with plain names and with each
  static segment of the other plane at each parameter, the request sent
  without a token and its plane read from its audit event, the preflight
  sent from a listed origin — a grant exactly where the plane is the
  runtime's and the method one its table names, and what was sampled is
  everything the router holds; a HEAD audited as the runtime GET it answers
  for and its preflight refused, `method not offered on this route`; a
  server with origins does not start beside a route that could answer a path
  a runtime route of the same method answers (`POST
  /v1/forms/read/records/:id` beside `POST /v1/forms/:id/records/read`), nor
  beside a GET, HEAD or POST route at a path a runtime route of any method
  answers (`POST /v1/forms/:id`, an explicit `HEAD /v1/forms/menu`, `GET
  /v1/forms/:id/records/:operation`), nor beside a regex parameter, a
  wildcard, two parameters in one segment or a constraint, and without
  origins they start, as a `PUT /v1/forms/:id` does with them, its preflight
  refused; `crossOrigin` on a bare app refuses a preflight whose method
  reaches a static route registered before it, or no route, `method reaches
  another route`, and grants one at the path the GET route takes; an
  unlisted origin, `null`, the listed origin spelled otherwise, `DELETE`, an
  extra header and `cookie` are 403 `cross-origin-refused` with no
  `access-control-*` and the log's reason, an `OPTIONS` that is no preflight
  likewise, and one at an administrator's path, `/v1/whoami` or `/health` is
  404; a runtime route's 400 `path-not-plain` over a real socket, its 401,
  the plane's 404 and the limiter's 429 carry the listed origin back with
  `Vary: Origin`, another origin and none the Vary alone; no answer of the
  administrator's plane, `/v1/whoami`, `/health`, a HEAD or a 404 carries an
  origin, nor does the router's 414 at a runtime path, which carries no Vary
  either, and the two routes of neither plane write no event; five
  preflights under a limit of two are neither counted nor audited, and the
  429 after them carries the origin; a token-bearing update marked
  `cross-site` or `same-site` from an unlisted origin is 403 before its
  token is read — the verifier asked nothing, no connection opened, one
  runtime event with no actor, counted by the limiter — and one from a
  listed origin is served; on the administrator's plane, `/v1/whoami`,
  `/health` and a HEAD it is 403 whatever is listed, and only the planes
  write an event; at a path no route takes it is the router's 404, logged as
  no refusal; `same-origin`, `none`, no `Sec-Fetch-Site`, and no token are
  answered as without the rule, with origins and with none, and with none
  the rule still refuses; with no origin listed printRoutes has no
  `OPTIONS`, an `OPTIONS` is 404, and no answer carries Vary or
  `access-control-*`; createDataServer refuses `['*']` and a trailing slash,
  by place, takes `[]`, and grants the list it checked, not an origin pushed
  onto the embedder's array after the call. `server-log.test.ts` — a refused
  preflight and a refused cross-site request whose Origin holds a password
  and a host in its user information, its path, its query or its port leave
  neither in the log and name no origin, and a canonical unlisted origin is
  named as sent on both lines. `packages/data-client/src/transport.test.ts`
  — every function the client returns is called, every call carries
  `authorization`, read as fetch reads headers, and every header it sends is
  `accept` within the Fetch standard's safelist, transcribed, or one of
  `CROSS_ORIGIN_REQUEST_HEADERS`, and no request sets `credentials`.
  `scripts/cloudflare/doors.test.mjs` — what a runtime server with an origin
  listed adds beyond the runtime server's routes is `OPTIONS` routes only,
  each at a path the runtime door's pattern forwards; doors.json is
  unchanged. The `container` job's step "FORMANCY_DATA_CORS_ORIGINS answers
  a listed origin on the runtime plane, refuses a request riding another,
  and a wildcard stops the server". Each watched failing on 2026-10-13 or
  2026-10-14: `''` taken as an entry, the spelling compared
  case-insensitively, `*` allowed, the entry put into the sentence, the
  loopback rule off (the three plain-HTTP rows were accepted) and the host
  rule off (the four host rows were accepted or refused for another reason);
  Vary's value replaced, and `Origin` appended twice; the `OPTIONS` paths
  written by hand without `records/delete`; an `OPTIONS` route granting
  every path under `/v1/forms/` (an administrator's `POST
  /v1/forms/employee/versions` was granted); a scratch administrator route
  `GET /v1/forms/menu` with the parameter check removed and the check at
  ready off (its preflight was granted while its request was audited as
  `admin`) — and with the parameter check kept, the same route was refused
  by it alone; the key built the audit's way, HEAD as GET (HEAD was
  granted); the check at ready removed (the scratch server started, and a
  preflight for `POST /v1/forms/read/records/read` was granted while the
  request reached the scratch route); the check at ready comparing a route
  only with runtime patterns of its own method (`POST /v1/forms/:id`, `HEAD
  /v1/forms/menu` and `GET /v1/forms/:id/records/:operation` each started);
  on the bare app, the parameters not compared (the menu was granted) and no
  route not refused (a 500); the rule's no-route guard removed (the router's
  404 became a logged 403); createDataServer granting the array it was given
  (the origin pushed after the call was granted); the router's limit raised
  (the 414 became the runtime's 404, with both headers); any origin granted;
  the origin set only where a route's handler runs (only the 404 carried
  it); routes told apart by `startsWith('/v1/forms')` (the administrator's
  version routes carried the origin); `rateLimit: false` dropped (the third
  preflight was 429); the refusal before the token removed (the unlisted
  update reached the verifier and the registry); the `OPTIONS` routes
  registered whatever the list; createDataServer's check removed; the header
  logged as received; `x-requested-with` added to every client request,
  `accept` set to a value holding `"`, and `credentials: 'include'`; the
  client sending a `Headers` holding `x-requested-with`, which the test
  passed while it read headers with `Object.entries`, and fails now; the
  token left out of every call; and a scratch `OPTIONS /v1/whoami` in the
  built server, which doors.test.mjs named. The container step was run
  locally on 2026-10-14 against an image built from this branch's final
  tree, on another host port, green in 4 s, and red against the same
  image with main.ts's list patched out of its built chunk: the first
  preflight was the router's 404.

## Context

The server sent no CORS header, so a host page on its own origin -- a
static page whose identity provider issues the token, which 0014 already
verifies under a pinned public key -- could use the module only through a
proxy of its own on the page's origin. 0024 and 0029 rejected a CORS setting
because its usual mistake is a wildcard.

Facts this record rests on, read in the repository and measured on
2026-10-13 on Node 22.22.1 with Fastify 5.12.5 and @fastify/rate-limit
11.2.0, unless they say otherwise:

- The planes share `/v1/forms/:id` and its parameter name:
  `GET /v1/forms/:id/versions` has the `id` the runtime's `GET /v1/forms/:id`
  has. No administrator route of GET, HEAD or POST could match a path a
  runtime pattern of any method matches: where the numbers of segments
  agree, as for `GET /v1/connections` and `GET /v1/forms`, a static segment
  differs. The check at ready below holds that.
- Fastify's `findRoute` gives a route's handler, parameters and search
  parameters, not the route. With an administrator's static
  `GET /v1/forms/menu` beside the runtime's `GET /v1/forms/:id`, a root
  `OPTIONS /v1/forms/:id` takes `/v1/forms/menu` with `{ id: 'menu' }`, and
  `findRoute` for GET at that path gives `{}`: the parameters tell the two
  apart. They cannot always: beside `POST /v1/forms/:id/records/read`, a
  `POST /v1/forms/read/records/:id` takes `/v1/forms/read/records/read`
  with `{ id: 'read' }`, as the `OPTIONS` route at the runtime path does.
- A root `onRoute` added before a plugin registers sees every route it
  registers, the HEAD Fastify adds for a GET included; an `onReady` that
  throws rejects `ready()`, and so `listen`; a root `preHandler` runs after
  the limiter's `onRequest`, which the limiter adds to each route, so a
  refusal there is counted; root hooks run for the router's 404 too. Root
  `OPTIONS` routes print merged with a plane's methods at the same path, and
  an `OPTIONS` at a path with no `OPTIONS` route is the router's 404.
- The audit counts a HEAD as the GET it answers for (`audit.ts`).
- A browser keeps a granted preflight by URL: the Fetch standard asks again
  for a request only when its method is not GET, HEAD or POST and the grant
  did not name it, or when it carries a header the grant did not name, and
  a grant's headers are kept by origin and URL, whatever method it named
  (whatwg/fetch `fetch.bs` on main, read 2026-10-14, lines 5843-5854 and
  7234-7262). Measured by hand on 2026-10-14, not in CI, with Playwright 1.63, a page on
  `http://localhost:Q` and this server built from this branch on
  `127.0.0.1:P`, its request log recorded: after a granted GET preflight at
  `/v1/forms/employee`, answered with `Cache-Control: no-store`, Chromium
  153 and WebKit 26.6 sent a POST with a JSON body and a HEAD to that URL,
  each with `Authorization` and `Sec-Fetch-Site: cross-site`, and no
  second preflight; Firefox 155 asked again for each. A grant for one
  runtime route is a grant for every GET, HEAD and POST at its URL.
- Fastify throws `FST_ERR_DUPLICATED_ROUTE` for a HEAD registered after a
  GET at the same pattern, so the HEAD at a runtime GET's own pattern is
  the one Fastify adds.
- Node's WHATWG URL gives `https://*.example` and `https://a!b.example` back
  as their own origin, and `ftp:` and `ws:` origins too; it gives back
  upper case, a default port, a trailing slash, user information and a name
  that is not punycode as another origin. So "the URL parser leaves it as
  it is" alone accepts a pattern and another scheme.
- The Fetch standard (whatwg/fetch `fetch.bs` on main, read 2026-10-13):
  `accept` is a CORS-safelisted request-header while its value is at most
  128 bytes and holds no CORS-unsafe request-header byte (lines 1013-1040,
  1100-1108); a preflight lists every other header's name in
  `Access-Control-Request-Headers`, lower case, sorted and joined by `,`
  (920-944, 1114-1140, 7060-7072). data-client sends `authorization`,
  `accept: application/json`, `content-type: application/json` with a
  body and `formancy-write-id` on a write, and no `credentials`, so every
  call it makes is preflighted.
- A request a page sends across origins with no preflight -- no
  Authorization, a body of a type the safelist lets through -- is answered
  before any work: `text/plain` 401, because Fastify parses it, and a
  form-encoded or multipart body 415 `FST_ERR_CTP_INVALID_MEDIA_TYPE`.
- What each engine keeps a granted preflight for, read on main on
  2026-10-13: WebKit at most 600 s (`maxPreflightCacheTimeout`,
  CrossOriginPreflightResultCache.cpp:43), Chromium two hours
  (`kMaxTimeout`, services/network/cors/preflight_result.cc:40), Firefox
  86400 s (nsCORSListenerProxy.cpp:1404).
- `Sec-Fetch-Site` was first sent by Chrome 76, Firefox 90 and Safari 16.4
  (mdn/browser-compat-data `http/headers/Sec-Fetch-Site.json` on main, read
  2026-10-13). Its name starts with `sec-`, which makes it a forbidden
  request-header that no script sets (`fetch.bs` 1206-1239), and it says
  whether the browser sent the request from the same origin, the same site
  or another.
- `@fastify/cors` answers every preflight from one `OPTIONS *` route, and
  its `origin` defaults to `*` and takes RegExps and functions (its README
  on main, read 2026-10-13).
- A refused preflight reaches the page as a plain network error, with
  nothing of the server's answer: the page cannot say why.
- Chromium's Local Network Access may ask the person before a page on a
  public address calls a private one; nothing here read or measured it.

## Decision

**`FORMANCY_DATA_CORS_ORIGINS`** lists, comma-separated, the origins a page
may call the runtime plane from, each exactly as a browser sends `Origin`;
unset, empty or only commas is none. An entry is accepted only when the URL
parser gives it back unchanged as its origin, its host is a DNS name or an
IP address, and its scheme is `https:`, or `http:` on `localhost`,
`127.0.0.1` or `[::1]`. Anything else -- `*`, `null`, a pattern, a path or
trailing slash, upper case, a default port written out, a name that is not
punycode, user information, another scheme -- stops the process with a
sentence naming the entry by its place and never repeating it, and so does a
list beside a server without the runtime plane. The list is read at start.
An embedder passes it as `runtime.origins`, which createDataServer checks
with the same rule; the administrator's options have no list.

**Preflights.** With a list, the server registers, at the root and outside
both planes, one `OPTIONS` route per runtime path, derived from
`ROUTE_OPERATIONS`, not rate-limited. A preflight is granted only when its
Origin is byte-equal to a listed origin, `METHOD pattern` of the method it
asks for and the route's pattern is a key of the runtime table -- so HEAD
never is -- the router takes that method at that path to the same
parameters as the `OPTIONS` route, and every header it asks for is one of
data-core's `CROSS_ORIGIN_REQUEST_HEADERS`: `authorization`,
`content-type` and `formancy-write-id`. Granted is 204 with
`Access-Control-Allow-Origin` the origin, `Access-Control-Allow-Methods`
the method, `Access-Control-Allow-Headers` the three, `Access-Control-Max-Age:
600` and `Vary: Origin, Access-Control-Request-Method,
Access-Control-Request-Headers`. Anything else on an `OPTIONS` route is 403
`cross-origin-refused` with no `Access-Control-*`; an `OPTIONS` anywhere
else has no route.

**The check at ready.** With a list, the server does not start beside a
route outside the runtime table whose pattern could match a path a runtime
pattern matches -- the same number of segments, each equal static text or a
plain `:name` on either side. For a GET, HEAD or POST that is any runtime
pattern, whatever its method, because a browser sends those on the grant
for whatever method was granted at the URL; for another method, a runtime
pattern of that method, which a grant must name. `OPTIONS` routes are the
preflights', and a HEAD at a runtime GET's own pattern is the one Fastify
adds. Nor does it start beside any route with a regex parameter, a
wildcard, two parameters in one segment or a constraint, which that rule
does not model. The preflight's own check that the method reaches the
same parameters asks for the method asked alone, and holds only a route
registered before the server's own hooks, which createDataServer registers
none of: behind the check at ready, it is defence in depth.

**Answers.** Every answer of a runtime route says `Vary: Origin`, and
carries `Access-Control-Allow-Origin` when its Origin is listed: refusals
included -- `path-not-plain`, 401, 403, 404, 409, the limiter's 429, the
plane's 503 -- so a page on a listed origin reads the server's sentence.
What is written before any hook, the router's 414 and the 503 while the
server closes among it, carries neither. Nothing else ever carries it: the
administrator's plane, `/v1/whoami`, `/health`, a HEAD, a 404 no route
answered. `Access-Control-Allow-Credentials`,
`-Expose-Headers` and `-Allow-Private-Network` are never sent.

**A token-bearing request a browser marks cross-site.** On every route, with
or without a list, a request carrying an `Authorization` header whose
`Sec-Fetch-Site` is `cross-site` or `same-site` is refused 403
`cross-origin-refused` before its token is read, unless its Origin is
listed and its route is in the runtime table. It is counted by the limiter
wherever the limiter counts, every route but `/health`; it is audited with
no actor by the plane whose route it reached, and `/v1/whoami` and
`/health`, which are neither's, write no event; and it asks the verifier
nothing. A path no route takes is the router's 404, token or none. A
request with no `Sec-Fetch-Site`, `same-origin` or `none`, and one with no
Authorization are answered as before.

**The log.** A refused preflight logs "preflight refused" at info, and a
request refused across origins "cross-origin request refused", each with
its reason and with the origin only when the URL parser gives it back
unchanged and it is at most 267 characters -- `https://`, a 253-character
name and a port -- which holds no user information, path or query.

## Consequences

**What it buys.** A host page on its own origin calls the runtime plane
through data-client with no proxy, when its origin is listed. Every answer
of a runtime route is readable by that page, refusals included. A grant a
browser cached before its origin was removed does no work in any browser
that sends `Sec-Fetch-Site`. The administrator's plane stays same-origin,
held for every route, at the preflight, at a grant a browser reuses for
another method at the same URL, and at the request. An empty list grants
nothing.

**What it costs.**
- A refused preflight reaches the page as a network error: a read is
  `unreachable`, and a write is unknown though nothing was sent. Only the
  server's log says why.
- A request refused across origins carries no origin back either, so it
  too is a network error to the page: a write refused there is reported as
  possibly saved, though nothing ran.
- Across origins a request may carry only `Authorization`, `Content-Type`
  and the write id; a host whose fetch adds another header is refused at
  the preflight.
- No cookie crosses origins, HEAD is not offered, and `/v1/whoami`,
  `/health` and the administrator's plane answer no other origin.
- The list is read at start, so adding or removing an origin is a restart,
  with 0031's cost: the write ids are forgotten.
- A browser too old to send `Sec-Fetch-Site` -- Chrome before 76, Firefox
  before 90, Safari before 16.4 -- may keep sending requests the server
  runs to a route for up to Max-Age after its origin is removed, without
  reading the answers.
- A deployment that added CORS headers at its own proxy has its
  cross-origin requests, which now arrive marked cross-site with a token,
  refused until it lists their origins.
- Plain-HTTP origins are accepted only on loopback, so an intranet page
  without TLS is not listed.
- Preflights are neither rate-limited by the server nor audited: a script
  can send them as fast as the network allows, and each does no work.
- A GET, HEAD or POST route of another plane, or of an embedder, whose
  pattern overlaps any runtime pattern stops a server with origins from
  starting, as does a route of another method overlapping a runtime
  pattern of its own method, and any route with a regex parameter, a
  wildcard or a constraint.
- The log names a refused origin when a browser could have sent it, which
  is what any caller typed into the header as long as it is in that form.
- With origins set, an `OPTIONS` at a runtime path that is no preflight is
  403 where it was 404, and every runtime answer carries `Vary: Origin`.
- No browser gate runs against this yet: that a browser honours the
  grant, sends the headers as the Fetch standard says, reuses a cached
  grant across a restart and is then refused, is the host page's browser
  gate's to show, which needs a page on another origin. The one
  measurement in a browser, above, was by hand.
- Chromium may ask the person before a page on a public address calls a
  server on a private one; this is not tested.
- `docs/performance.md` was measured before this record added hooks to
  every request, and is measured again before the next release, as every
  change to the server requires.

**What it does not do.** No wildcard, pattern, `null` or credentials can be
configured. The origin list is not read again on SIGHUP, as 0059's key set
is; changing it is a restart. No Private or Local Network
Access header is sent. The composed stack lists no origin, nginx's
directives are unchanged -- it passes `/v1/` to the server whatever the
method -- and so is `deploy/cloudflare/doors.json`: every `OPTIONS` route is
at a runtime path, which the runtime door forwards by path. What the
Cloudflare guide and the composed stack say about origins is a later
change's.

**What it forecloses.** Cross-origin calls to the administrator's plane,
credentialed cross-origin calls, and origin patterns, for as long as this
record stands.

## Alternatives considered

**@fastify/cors.** One `OPTIONS *` route cannot know which route the actual
method reaches, and its `origin` defaults to `*` and takes RegExps and
functions.

**A preflight decided by path prefix.** `/v1/forms/` carries administrator
routes: watched granting `POST /v1/forms/employee/versions`.

**A hand-written matcher of paths to patterns, per request.** A second
router, which could disagree with the first. The check at ready only
refuses overlaps, and refuses what it does not model.

**`OPTIONS` routes inside the plane.** Each would need an audit name, and
every preflight would become an event.

**CORS at nginx or at Cloudflare.** A second decider over which path
belongs to which plane.

**Reflecting any requested header.** The list would no longer say what the
server reads.

**No check on the actual request.** A grant cached before an origin was
removed keeps writes running for up to Max-Age.

**An `Origin` check on every request, without `Sec-Fetch-Site`.** Behind a
proxy, same-origin cannot be told from `Host`, and the scheme is unknown
without `trustProxy`; `Sec-Fetch-Site` is the browser's own answer.

**Sharing the audit's `routeKey`.** It maps HEAD to GET, so it would offer
HEAD: watched granting it. The differential finds any disagreement between
the two.

**Logging no origin.** A canonical origin carries nothing a credential
rides in, and it is what the operator needs to add.

**`Access-Control-Allow-Origin: *`.** 0024's case.

**Reading the list again on SIGHUP**, as 0059 reads keys. Removing a
compromised origin would cost no restart, and the list would be one more
state to validate and log; not now.

**`/v1/whoami` across origins.** One more path outside the runtime table,
for a page that can ask the runtime plane what it needs.

## Older records

Narrowed, not edited away: 0029 (a host page on an origin the operator
lists calls the runtime plane across origins; same-origin stays the
default). Extended: 0024 (the administrator's plane answers no other
origin, held for every route at the preflight and at the request); 0033
(preflights are root routes outside both planes and are not audited; a
token-bearing request a browser marks cross-site is refused before its
token is read, and audited with no actor).
