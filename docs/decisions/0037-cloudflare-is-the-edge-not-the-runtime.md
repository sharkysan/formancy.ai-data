# 0037 — Cloudflare is the edge, not the runtime: one locally-managed tunnel with generated doors, and a server that refuses a path a proxy could read differently

- **Status:** accepted
- **Date:** 2026-10-11
- **Deciders:** Daniel Bacher
- **Verified by:**
  `scripts/cloudflare/doors.test.mjs` (`pnpm test:repo`, after `pnpm build`)
  — `deploy/cloudflare/doors.json` is what three servers built through the
  package's public exports register, classified by plane (watched failing
  with a scratch administrator route `GET /v1/forms/:id/export`, rebuilt:
  "GET /v1/forms/:id/export is not in deploy/cloudflare/doors.json", with
  "run node scripts/cloudflare/doors.mjs --write"); the runtime pattern
  matches every runtime route's sample and no other, and forwards no path
  where another plane registers a method (watched failing with a scratch
  `DELETE /v1/forms/:id`, named by all three cases, and with the renderer
  emitting no `$`, which named all seven administrator routes under
  `/v1/forms/:id`); the guide's five generated blocks -- the configuration
  configure writes for the example names, by ingress.mjs itself, the doors,
  the edge rule, its body and doors-check's output -- are what doors.json and
  rate-limited.json render (watched failing with the pattern hand-edited in
  the guide: 'the block "doors" is not what scripts/cloudflare/doors.mjs
  renders', and with the configuration's block empty); rate-limited.json is
  a code and a sentence within 30 KB.
  `scripts/cloudflare/ingress.test.mjs` — the inputs refused with their
  sentences before anything is done, the configuration read back with a
  YAML parser, the probes, and the hostile paths each resolving, as
  cloudflared was measured resolving, to a runtime route while the router
  reads the parameter as one segment (watched failing with `required: true`
  dropped from the renderer, with the catch-all rendered first, and with the
  upper-case refusal removed); the climbs out of every location of
  `deploy/web/nginx.conf` that serves files, read from it, each a runtime
  route to cloudflared and, as the test models nginx's reading, a file of
  that location or a path under `/v1/` to nginx; and the runtime rule naming nginx.conf's server for the runtime
  door, which serves no file and passes `/v1/forms/` alone (watched failing,
  in review on 2026-10-11, with the runtime rule's service back on
  `web:8080`: the rendered rule, and "meet, on the runtime rule's port, an
  nginx server that serves no file").
  `scripts/cloudflare/check.test.mjs` — each of doors-check's four verdicts
  against the built server's answers with the headers
  `deploy/web/nginx.conf` adds, and edge-shaped fixtures (watched failing
  with each verdict's rule inverted: Access's login location not checked,
  the HTTPS redirect's location not checked, the server's verdict without
  the web front's headers, "outside" always passing, and path-not-plain
  not accepted); nginx's own 404, captured from the web front's nginx, as
  "outside"; no answer at all, status 0, failing every verdict with its
  reason; "outside" asked only beside runtime routes that fail when an edge
  rewrites nginx's headers; and a doors-check path that climbs out of
  `/studio/` (watched failing in review: the 404, the status-0 and the
  climb cases before check.mjs changed, and the rewritten-headers case with
  nginx's headers dropped from the server's verdict).
  `scripts/cloudflare/answers.test.mjs` — data-client, as built, reads
  Cloudflare's documented 522, a 530 for error 1033, a 403 for error 1020,
  a 1015, Cloudflare's own error, which is what Free's rate-limiting
  block answers,
  nginx's own 504 and Access's redirect as an unknown write and an
  unexpected read, and the edge's rate-limit body and the server's
  path-not-plain as refusals (watched failing with `message` removed from
  rate-limited.json: the 429 then read as `unknown-outcome`; and with a
  `message` added to the 1015, then read as a refusal).
  `scripts/cloudflare/configure.test.mjs` and `setup.test.mjs` — against a
  stand-in that answers as each case says, configure replaces the file in
  use only after cloudflared calls it valid and matches every probe, setup
  checks every input before the login, stops at a failed login, a failed
  create or a hostname it cannot route, never asks for `--overwrite-dns`,
  and prints the tunnel's secret nowhere (watched failing with the mode
  0444, with a mismatched probe ignored, with the redaction removed, with
  `--overwrite-dns` added, and with a login before the input check); and,
  added in review, configure and setup refuse arguments that would close a
  door the configuration in use opens unless `--drop` names its hostname,
  setup says what to do with a `cert.pem` the browser downloaded, names
  both hostnames' zone, and stops at a private network route to the tunnel
  before routing any hostname (each watched failing before the change).
  `scripts/cloudflare/gate.test.mjs` — the overlay's checks, each against
  its own edit (watched failing with the comparison of compose.yaml's
  services removed, with the Dockerfile's reference not compared, and with
  the guide's services not checked); and cloudflared on compose.yaml's
  `edge` alone, beside the web front and nothing else (watched failing in
  review on the committed files: "cloudflared is on default, not on edge
  alone", and "web is not on edge").
  `scripts/getting-started/steps.test.mjs` — every refusal of the guide
  reader names the document it read.
  `scripts/cloudflare.mjs` (`pnpm test:cloudflare`; the CI job
  `cloudflare` in `gates.yml`, with the runner's Compose and with 2.20.3)
  — the resolved configuration of both files, the guide's commands, the
  configure step run in the tools image with a random fake tunnel, the
  generated file's meaning under the pinned cloudflared, cloudflared run as
  the overlay runs it with no network, and the differential (watched
  failing, each against the real binary on 2026-10-11: with configure's
  mode 0444, "the tunnel's files are not cloudflared's alone"; with the
  credentials echoed by configure, "the tunnel's secret was printed",
  naming both tunnel-config runs; with one probe expectation inverted in
  ingress.mjs, the configure step itself refused in the tools image, naming
  each URL cloudflared matched otherwise; and with the server built without
  the path-not-plain hook, "the admin version-read route ran for a path
  cloudflared sends to the runtime door", and likewise discovery,
  connection-test, drift, regeneration, restore, version-list and publish,
  with "the server read the token for 60 of them"); and, added in review,
  every path cloudflared forwards to the runtime door sent on through
  `deploy/web/nginx.conf` in the web front's own nginx, in front of the
  built server, to end at the server's path-not-plain or nginx's own 404,
  with every runtime route's sample reaching the server (watched failing
  on 2026-10-11 against nginx.conf as the design left it, the rule on
  `web:8080`: sixteen climbs out of `/studio/`, `/studio/assets/`,
  `/host/` and `/host/assets/` answered 200 with the stand-in file there).
  `packages/data-server/src/paths.test.ts` — what is plain, and, derived
  from the store's and the allowlist's own checks, that every valid form and
  connection id is (watched failing with `%` accepted, seven refusals; with
  `_` refused, on `/v1/forms/a_0`; with the dot-segment check removed, four;
  with the form-id grammar widened to `+`, on `/v1/forms/a%2B0`).
  `packages/data-server/src/app.test.ts`, over a real socket — thirteen
  hostile paths answered 400 path-not-plain with the token never read and
  one audit event per path that names a route (watched failing without the
  hook: `POST /v1/connections/..%2Fforms/test` answered 404 "No connection
  is called ../forms."); a refusal counted by the limiter (watched failing
  as `[400, 400, 200, 400]` with the hook after the limiter, as the design
  had it); `no-store` on every kind of answer (watched failing on all
  eleven without the P2 hook); and the router's own 400 and 414 with none,
  uncounted (watched failing with a `frameworkErrors` handler adding it).
  `routes/admin-audit.test.ts`, `routes/runtime.test.ts` and
  `server-log.test.ts` — encoded paths now 400 path-not-plain, their raw
  variants still reaching each plane's filters, nothing of the string in
  the log or the trail (each watched failing with the hook removed).
  The `container` job's two steps, against the built image: `curl
  --path-as-is` to `/v1/forms/a/versions/..%2F..%2Fb` answers 400
  path-not-plain, and `/health` and a 401 carry `Cache-Control: no-store`.
  The getting-started gate (`scripts/getting-started.mjs`), through the
  composed stack's web port: a published form and a refusal carry
  `no-store`, and the same path, sent as written, is the server's 400
  path-not-plain.
  Nothing reads the operator's Cloudflare account:
  `deploy/cloudflare/check.mjs` is the operator's check, and no CI job runs
  it.

## Context

The request, in German, was for a guide to deploying this product on
Cloudflare. The honest answer had to come first: Cloudflare can be this
product's edge, and cannot be its runtime.

**What the product needs, from this repository.** Published forms are files
on a volume with a hard-link swap
([0013](0013-published-configuration-is-files-with-link-based-swap.md));
host identity is a token verified offline with one pinned key
([0014](0014-host-identity-is-verified-offline.md)); a write's id is
remembered in one process
([0031](0031-an-answer-lost-after-a-write-is-unknown.md)); the server
keeps a pool per connection and speaks to SQL Server through tedious; the
studio and the host page share one origin with `/v1`
([0024](0024-the-studio-speaks-only-the-admin-plane.md),
[0029](0029-a-host-renders-a-published-form-through-one-client.md)); the
composed stack is one proxy in front of an unpublished server
([0032](0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md));
and the rate limit is one bucket behind a proxy, with no `trustProxy`
([0034](0034-performance-is-measured-through-the-shipped-server-and-held-without-a-clock.md)).

**What Cloudflare offers.** From the documentation, re-read at
cloudflare-docs `0d35c2c` (2026-10-10) unless marked: a remotely-managed
tunnel is recommended "for most use cases", a locally-managed one is
"intended for specific scenarios such as local development, testing, or
legacy configurations" (`partials/cloudflare-one/tunnel/locally-managed/overview.mdx`),
and remote management is recommended "when working with Docker"
(`docs/tunnel/guides/update-cloudflared.mdx`, read at `b55f5bd` on
2026-10-09); `cert.pem` "allows users to create, delete, and manage all
tunnels for the account", is valid at least 10 years, and its token "is
valid until revoked", while a tunnel's credentials file "only allows the user
to run that specific tunnel" and does not expire
(`…/tunnel-permissions.mdx`); `originRequest.access` with `required`,
`teamName` and `audTag` has cloudflared "validate the Cloudflare Access JWT
prior to proxying traffic" (`partials/cloudflare-one/tunnel/origin-parameters.mdx`);
log streams need Tunnel edit permission and `cloudflared tail` defaults to
debug whatever the tunnel's own level (`…/monitor-tunnels/logs.mdx`, at
`b55f5bd`); Bot Fight Mode "cannot be skipped with custom rules"
(`docs/waf/feature-interoperability.mdx`); "Remove visitor IP headers"
removes the address from `x-forwarded-for` only behind another CDN
(`docs/rules/transform/managed-transforms/reference.mdx`); an error answer
asked for as JSON carries `type`, `title`, `status`, `detail`, `error_code`
and no `message`, and 1033, "Argo Tunnel error", is retryable after 120 s
(`docs/fundamentals/reference/error-responses.mdx`); the proxy read timeout
is 125 s (`…/connection-limits.mdx`); a rate-limiting rule on Free matches
the path alone, counts by IP over 10 s for 10 s, one rule per zone, and its
Block action can answer a custom JSON body with a status of 400 to 499 and a
body of at most 30 KB (`docs/waf/rate-limiting-rules/parameters.mdx` and
`partials/waf/rate-limiting-availability-by-plan.mdx`) -- on Pro and above
only: "This feature is only available on Pro plans and above"
(`…/rate-limiting-rules/create-zone-dashboard.mdx`), and Custom Errors are
not on Free (`docs/rules/custom-errors/index.mdx`), so on Free a block is
Cloudflare's own error 1015, of the `rate_limit` category (error-responses.mdx);
a Configuration Rule's settings are I'm Under Attack, Browser Integrity
Check, Disable Real User Monitoring (RUM), Disable Zaraz, Email
Obfuscation, Fonts, Rocket Loader and others, with no Security Level, which
in the new dashboard is I'm Under Attack on or off
(`docs/rules/configuration-rules/settings.mdx`,
`docs/waf/tools/security-level.mdx`); Super Bot Fight Mode, on Pro and
above, "may challenge API or mobile app traffic"
(`partials/bots/about-plan-considerations.mdx`) and wants Definitely
automated on Allow where a Tunnel runs
(`docs/bots/get-started/super-bot-fight-mode.mdx`); an Access application's
AUD tag "will never change unless you delete or recreate the Access
application" (`…/authorization-cookie/validating-json.mdx`); Managed OAuth,
off unless enabled, "replaces the `401` response behavior" of the
application (`…/http-apps/managed-oauth.mdx`); `Cache-Control:
no-store` prevents caching in either Origin Cache Control mode, and with
Origin Cache Control off, the Enterprise default, `Authorization` "does not
by itself prevent caching" (`docs/cache/concepts/cache-responses.mdx`);
Access sessions default to 24 h, and an AJAX request gets 401 instead of a
redirect only with `X-Requested-With` (`…/session-management.mdx`, at
`b55f5bd`). What the guide says of Workers, Hyperdrive, Containers, Pages,
Configuration Rules and Zero Trust's pricing is from an earlier survey and
marked *[survey, not re-read]* where it is said.

**Measured on 2026-10-09** (the design's, a Linux x86_64 sandbox):

- **C1.** cloudflared 2026.10.0's release binary for linux-amd64 had sha256
  `d33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db`;
  `cloudflare/cloudflared:2026.10.0` had index digest
  `sha256:9b49eed8f62806d5d45ddf59ecefb5710429598ea6d3fcccd2af938f621b2b07`,
  28,956,725 bytes compressed for amd64 and 27,842,671 for arm64 (Docker
  Hub's API).
- **C2.** `ingress validate` says OK with a credentials file that points
  nowhere and with `access: {required: true}` lacking `teamName` and
  `audTag`; a missing catch-all exits 1; a misspelled `originRequest` key is
  a warning.
- **C3.** `ingress rule` matches the path after percent-decoding it --
  `%2F`, `%2E` and `%5C`, a decoded backslash acting as a slash -- after
  resolving `.` and `..` and collapsing repeated slashes, keeps a trailing
  slash, ignores the query, and treats `;` and `%00` as ordinary.
  `/v1/forms/a/versions/..%2F..%2Fb` matched a runtime-only rule.
- **C5.** cloudflared's help: `--loglevel debug` "will log … all request and
  response headers"; `--metrics`' default in a container binds every
  interface; `--management-diagnostics` defaults to true; nothing turns the
  management service's log streaming off.
- **C6.** Fastify 5.12.5 routes the raw path: `POST
  /v1/connections/..%2Fforms/test` went to connection-test with id
  `../forms`, and `GET /v1/forms/a/versions/..%2F..%2Fb` to version-read with
  version `../../b`. light-my-request resolves dot segments before the
  router, so a test of them needs a real socket.
- **C8.** Cloudflare's Zero Trust pricing page could not be read.

**Measured on 2026-10-11**, in a Docker Sandbox VM (Linux x86_64, kernel
7.0.14, 20 CPUs, 15 GiB) with Docker Engine 29.8.1, Compose 5.5.1 and
2.20.3, and Node 22.22.1, shared with a live demo and another workflow's
database suites:

- **M1. The image.** Pulled by the digest above: user `65532:65532`,
  entrypoint `cloudflared --no-autoupdate`, no VOLUME and no health check;
  97,568,695 bytes by `docker image inspect` on this image store. Its binary
  is `/usr/local/bin/cloudflared`, 39,898,394 bytes, sha256
  `6fb373461c6de859684477920d9c599c309751f162e08592857f310a68906c8e` --
  another build than C1's release binary, both "2026.10.0 (built
  2026-10-05)" -- static (`ldd`: "not a dynamic executable"), and it runs on
  `node:22.12-alpine`.
- **M2. C3 again**, with the image's binary: every path of C3 gave C3's
  answer again. Also `//v1/forms/a`, a query holding `/versions` and a raw
  backslash matched the runtime rule; and
  a decoded `%3F` or `%23` is no query and no fragment
  (`/v1/forms/order%3F/versions/latest` fell to the catch-all), and `%20`
  matched as an ordinary character.
- **M3. The generated configuration**, for the guide's example names with a
  host application: `ingress validate` OK; all 57 probes on their rules;
  all 65 hostile paths -- 52 built from the administrator routes'
  parameters, 13 measured -- matched to the runtime door. One `ingress
  rule` took 0.135 s on average (7.7 s for 57, 8.7 s for 65).
- **M4. `tunnel … run` as the overlay runs it**, with `--network none` on
  the volume configure wrote: it read `config.yml` and `credentials.json`
  at 0400 owned by 65532 from a read-only mount and printed
  `Settings: map[… loglevel:info management-diagnostics:false
  metrics:127.0.0.1:20241 no-autoupdate:true]`, then failed to reach the
  edge. `tunnel --metrics 127.0.0.1:20241 ready` with no tunnel: "connection
  refused", exit 1.
- **M5. The login**, in `node:22.12-alpine` with `HOME=/tmp/login` on a
  tmpfs: it printed the dashboard URL and named
  `/tmp/login/.cloudflared/cert.pem`, then could not resolve
  `login.cloudflareaccess.org` from the sandbox. Nothing after its first
  step was seen.
- **M6. Compose.** Both files resolve with 5.5.1 and 2.20.3, every bind
  against the checkout's root; 2.20.3 adds `create_host_path` to each, and
  nothing else differs. Both have `run --build`.
- **M7. The gate.** `pnpm test:cloudflare` took 46.1 s with 5.5.1 and
  43.4 s with 2.20.3, images cached, and about 58 s with 5.5.1 on this
  record's final code, the steps' own times summing to 56.7 s; with the web
  front step review added, 55.3 s with 5.5.1 and 55.6 s with 2.20.3 in one
  pair of runs, and 64.9 s and 70.8 s in a later pair (`time`); the machine
  was shared throughout, so the spread is not the gate's.
- **M8. nginx.** `nginxinc/nginx-unprivileged:1.30.5-alpine`'s
  `/etc/nginx/nginx.conf` logs in the `main` format, which ends in
  `"$http_x_forwarded_for"` and holds `"$request"`, query included. With
  `server_tokens off` and an upstream that accepted and never answered it
  answered 504 with its own 160-byte HTML page.

**Measured in review, 2026-10-11**, on the same VM:

- **M9. The web front's own reading.** cloudflared 2026.10.0's `ingress
  rule` sends `/studio/..%5Cv1%5Cforms%5CZ/%2E%2E/index.html`, its variants
  with a literal `..` and with raw backslashes, and the same climbs out of
  `/studio/assets/`, `/host/` and `/host/assets/`, to the runtime rule
  (the CI job's step 5 asks it on every run), while nginx 1.30.5, which
  keeps a backslash as a character on Linux, answered them on 8080 with
  the file the location held: the review measured the studio's own page
  and a 721,451-byte bundle marked immutable, and the CI job's web front
  step, before the fix, sixteen such climbs answered 200 with its stand-in
  files. The `%2F` variants nginx resolves into `/v1/` and sends to the
  server as written, which refuses them. nginx's own 404 for a path no
  location takes carried its three headers and no Cache-Control.
- **M10. Disk.** `cloudflare/cloudflared` at the digest above: 97,568,695
  bytes; the tools image 282,731,700, of which 223.3 MB is
  `node:22.12-alpine`, shared with the server's image (`docker image
  inspect`, `docker system df -v`; Docker Engine 29.8.1, containerd image
  store).
- **M11. Read from cloudflared 2026.10.0's source**, not run against an
  account: `tunnel login` that cannot fetch the certificate says "Your
  browser will download the certificate instead" and exits non-zero
  (`cmd/cloudflared/tunnel/login.go`); `tunnel route ip show --output json`
  prints the routes it lists as JSON with `network` and `tunnel_id`, and
  `null` for none (`cfapi/ip_route.go`, `cfapi/base_client.go`,
  `subcommands.go`); and since 2023.9.0 a locally-managed tunnel proxies
  private network traffic whenever the account routes a network to it, the
  configuration's `warp-routing` flag gone (`CHANGES.md`).

**Not measured by anyone:** anything through a real tunnel, no account or
zone being available -- whether the edge forwards `..%2F`, `%5C` and dot
segments as sent; what cloudflared answers to a request without a valid
Access token on a rule that requires one; whether `cloudflared tail --level
debug` shows `Authorization`; whether anything at Cloudflare sends a POST
twice; the body of Access's answers, whether Always Use HTTPS answers
before Access, what Access answers a `POST`, where Instant Auth sends a
person, and whether Access lets through a request carrying the host token
in `Authorization` beside its cookie; the login past its first step,
whether the browser downloads `cert.pem` among it; what `route ip show`
prints from an account; what `route dns` does with an existing record;
what status and body Free's rate-limiting block carries; how long a tunnel
takes to become ready; the latency it adds.

## Decision

- **The shape.** Cloudflare gives TLS at its edge, a tunnel with no inbound
  port, Access in front of the administrator's hostname, and optionally one
  rate-limiting rule. The server, nginx, the store and the databases run on
  the operator's machine as 0032's composed stack. `deploy/cloudflare/compose.yaml`
  adds `cloudflared`, `tunnel-setup`, `tunnel-config` and `doors-check`, and
  changes no service of `compose.yaml`. cloudflared joins compose.yaml's
  network `edge`, which only the web front joins besides, so the composed
  stack's databases and the server past nginx are not reached through
  Cloudflare whatever the tunnel's ingress says, and no database is, as
  long as the tunnel has no private network route.
- **The tunnel** is locally managed. Its configuration is written by
  `deploy/cloudflare/configure.mjs` from `doors.json` and the operator's
  hostnames, team and AUD tag, into the `formancy-data-tunnel` volume, and
  replaces the one in use only when the cloudflared binary of the pinned
  image -- copied into the tools image by the same reference -- calls it
  valid and matches every probe to its rule. cloudflared runs with
  `--loglevel info`, `--metrics 127.0.0.1:20241` and
  `--management-diagnostics=false`, on its files read-only, readable by its
  user alone, with no token on its command line or in its environment.
  `setup.mjs` logs in with its HOME on a tmpfs, creates the tunnel, stops
  at a private network route to it, routes DNS without ever overwriting a
  record, configures, and says to revoke the login. Setup and
  `tunnel-config` refuse arguments that would close a door the
  configuration in use opens, unless `--drop` names its hostname.
- **Two doors.** The administrator's hostname forwards everything to
  nginx's 8080 with Access required, team and AUD tag in the file. A host
  application's hostname forwards only paths matching a pattern generated
  from the router's runtime routes, to a second server of
  `deploy/web/nginx.conf`, 8081, published nowhere, which serves no file and
  passes only `/v1/forms/` to the server, as sent; then optionally the host
  application's own service; then 404. Refused rather than normalised at
  nginx too: whatever nginx makes of a path there, it is the server's
  `/v1/forms/`, where P3 holds, or nginx's 404.
- **P3: a path that is not plain is refused** (`packages/data-server/src/paths.ts`).
  Before any route's work, a path with a percent-escape, a backslash, an
  empty segment, or a `.` or `..` segment, or a character a path does not
  carry as itself, is answered 400 `path-not-plain`; the refusal counts
  against the rate limit and, where it matched a route, is that plane's one
  audit event.
- **P2: every answer the server's hooks run for says `Cache-Control:
  no-store`**, from an `onSend` hook, over anything a route set.
- **Rate limiting** stays one bucket at the server, sized by
  `FORMANCY_DATA_RATE_LIMIT` (0034); per-address limiting is the edge's
  rule, with, on Pro and above, a JSON body that data-client reads as a
  refusal, and on Free Cloudflare's own 1015, which it reads as unknown.
- **Edge answers** are left to data-client's rules from 0031: an answer
  without a sentence is an unknown write.
- **The guide**, `docs/deploy/cloudflare.md`, with five blocks generated
  from doors.json and rate-limited.json, and commands that name both files.
- **The gate**, `pnpm test:cloudflare` in a CI job of its own, two steps in
  the container job, and one in the getting-started gate.

Found on the way, against the design this record follows:

- The design had the P3 hook registered after `@fastify/rate-limit` so the
  limiter counted its refusals. The limiter adds its hook to each route, and
  a route's hooks run after every root hook, so it never saw them (the
  rate-limit case answered `[400, 400, 200, 400]`); the hook asks the
  limiter itself before refusing.
- The router answers some requests before any hook runs -- an escape that
  does not decode (400 `FST_ERR_BAD_URL`), a parameter past its length
  (414), the 503 while closing, what Node's parser refuses. None reaches a
  route, but none says `no-store` or is counted; app.test.ts holds that, and
  the data server's README says it.
- One administrator route, `GET /v1/forms/:id/versions/latest`, has no path
  through the runtime door at all: what follows its one parameter ends no
  runtime route, and nothing cloudflared resolves removes a segment after a
  parameter (M2). The differential requires a reached climb for every route
  that has one, and ingress.test.mjs names the route that has none.
- doors-check's "does not reach a route" is "no answer of the web front's,
  or the server's path-not-plain", not "no answer of the server's": the
  studio's page through the runtime door would have passed the design's
  form.
- `tunnel-config` makes no call to Cloudflare, so it runs with no network
  at all, not on Docker's bridge; doors-check runs as `node`.
- An image's declared volumes are checked from `docker image inspect`
  rather than from containers left running, since every tool runs with
  `--rm`.

Found in review, against this record's first version:

- **The runtime door served the studio's files.** It went to nginx's 8080,
  whose locations serve the studio and the host page, and cloudflared counts
  a backslash as a slash where nginx does not (M9): a scripted client could
  read the private studio's code through the door without Access. P3 never
  saw those paths, because nginx answered them itself, and the differential
  sent its paths straight to the server, past nginx. Hence the second
  server of nginx.conf, which the design held unchanged, and the gate step
  through it.
- **cloudflared sat beside the server and both databases** on compose's
  network, so any change of its ingress, or a private network route, could
  reach them past nginx. Hence `edge`, declared in compose.yaml, which the
  design held unchanged too, because the overlay cannot attach the web
  front to a network without changing its service; and a check that
  cloudflared joins `edge` alone.
- **A private network route to the tunnel is a door no configuration
  closes** (M11). Setup now looks for one while its login lasts.
- **Free's rate-limiting rule cannot answer with the body** this record
  first prescribed for it; on Free a block reads as an unknown write.
- **The design's "Security Level lowest" no longer exists** as a
  Configuration Rule setting; the guide names the settings that do.
- **doors-check read no answer as an answer**, "answered 0 without Access",
  and "outside" passed it; and `tunnel-config` run with fewer arguments than
  setup was given closed a door silently, the guide's own command for
  shape (b) doing that to shape (a).
- **A deleted and recreated Access application has a new AUD tag**, so the
  guide's measurement that deletes one now says how to put it back.

## Consequences

**What it buys.** An evaluation stack reachable over the internet with no
inbound port, the studio behind the organisation's identity provider, and a
runtime door for a host application, with the two settings whose mistakes
open a door -- Access with its AUD tag, and the 186-character pattern --
generated from the router and checked by the binary that runs them, on the
operator's own file, before it runs. A path the router and a normalising
proxy read differently reaches no route's work behind any proxy, not only
this one; on the runtime door it reaches no file either; and no cache that
honours the origin keeps a form or a record from an answer the server's
hooks ran for.

**What it costs.**

- **Cloudflare decrypts everything** at its edge -- host tokens, record
  values, forms -- and anybody with Cloudflare Tunnel edit permission, or a
  login token not yet revoked, can stream the tunnel's log at debug level,
  which Cloudflare documents as every request header: every host token.
  No flag stops it.
- **Against Cloudflare's recommendation.** The tunnel is locally managed,
  against "remotely-managed … for most use cases" and "when working with
  Docker"; routes cannot be edited in the dashboard, and a change is a
  rerun of setup or `tunnel-config` and a restart of cloudflared.
- **The login.** Each setup run makes an account-wide token, valid until
  revoked, that the operator must delete by hand; nothing checks that. The
  tmpfs holds its `cert.pem` when cloudflared fetches it; when it cannot,
  cloudflared says the browser will download it instead (M11), where setup
  cannot use it and the operator must delete it. The login past its first
  step is unmeasured.
- **Whoever changes the tunnel reaches the web front without Access.** A
  changed ingress, a configuration pushed by somebody with Tunnel edit
  permission, or a private network route -- which no setting of cloudflared
  refuses -- reaches what cloudflared's container reaches: the web front's
  both ports, the machine's addresses and what it routes to, though not
  compose's network. Setup looks for private network routes once, by CIDR;
  nothing looks again, and nothing looks for a private hostname route.
- **P3** answers 400 before authentication where a route used to answer
  401, 404 or 400, for paths no valid name produces; the router's own
  refusals stay outside it, without `no-store`, uncounted.
- **Rate limiting** is one server bucket with a fixed window, so up to
  twice its size can pass across a boundary; the edge counts per location,
  imprecisely, and a host application's backend is one visitor to it. On
  Free the edge's block carries no sentence, so a write it blocked reads as
  unknown though nothing reached the server; only Pro and above can answer
  with a body that reads as a refusal.
- **A lapse** of Access reads as "could not be reached" in the studio and
  "may have been saved" on the host page, and an edge block of a write as
  unknown; nothing reached the server, so nothing is audited.
- **nginx's access log** holds every visitor's address as forwarded, and
  every request line with its query: personal data on the operator's
  machine. Its log format is unchanged; nginx.conf gains the runtime
  door's server, and compose.yaml the `edge` network, which every
  getting-started stack now makes too.
- **One server process**, nothing restarts on its own, nothing is released,
  and no production licence can be had yet.
- **Here.** The overlay, the tools image, four deploy scripts, the
  generated doors file and the edge's rate-limit body; P2 and P3 in the
  server; a second server in nginx.conf and a network in compose.yaml; a
  gate in a job of its own that pulls about 29 MB of cloudflared, Node's
  image and the web front's nginx, builds the server, and took 43 to 58 s
  locally before review added the web front step, and 55 to 71 s with it
  (M7) -- not measured on CI, so its limit is verify's. A stale `doors.json` fails `pnpm test:repo` on any server
  change that moves a route.
- **`docs/performance.md` no longer describes what ships.** The P2 and P3
  hooks are on every request, and the figures there were measured before
  them: `node scripts/performance-stale.mjs` names `paths.ts` and `app.ts`,
  and RELEASING.md's step 2b, `pnpm performance` on a quiet machine, must
  run before the next release, which the release's `check` job otherwise
  refuses. Nothing here re-measured, the machine being shared.
- **What nothing holds:** the Access application, its policy, who holds
  Tunnel edit permission, the login's revocation, a private network route
  added after setup looked, or any private hostname route, the zone's
  settings beyond what doors-check observes (Always Use HTTPS and Access in
  front) -- Bot Fight Mode or Super Bot Fight Mode, the Configuration Rule,
  challenges, managed rules, cache rules, the transforms -- the
  rate-limiting rule as typed, Cloudflare's behaviour through a real
  tunnel, the dashboard click paths, an operator's own Compose file for
  shape (a), how evaluators receive tokens, and what nginx's log holds.

**What it forecloses.** Nothing published: `deploy/cloudflare/` is in no
package and no image the release builds. `path-not-plain` becomes part of
the server's public answer set. Running the product on Cloudflare's
Containers is left to a later record that brings a second store (0013), a
durable write-id memory (0031), ingress code and a released image.

## Alternatives considered

- **Workers.** A port, not a deployment: no socket shared across requests
  for the pools, no lasting file system for the store, no single process
  for write ids, and neither tedious nor Fastify run there.
- **Hyperdrive.** Reached only from a Worker, no SQL Server, and a query
  cache on by default that a write does not invalidate *[survey]*.
- **Containers.** An ephemeral disk for the store, write ids lost on sleep,
  ingress needing a Worker and a Durable Object, and the databases on public
  endpoints *[survey]*.
- **Pages or Workers static assets for the apps.** Another origin than
  `/v1`, against 0024 and 0029, unless a Function proxies `/v1`, which is
  new code.
- **`cloudflared access tcp` to a database.** The server belongs beside its
  databases.
- **The Access identity as the host token**, or Access for SaaS as the
  host's identity provider. Its keys rotate and are fetched; 0014 pins one
  and fetches none.
- **A remotely-managed tunnel with dashboard routes.** The pattern and
  Access would be typed into a field no CI can see. Kept as the fallback
  should Cloudflare withdraw local configuration.
- **A remotely-managed tunnel configured through the API.** A scoped API
  token and code here that calls Cloudflare, which CI cannot exercise.
- **The tunnel's token in `TUNNEL_TOKEN`, `--token` or
  `--credentials-contents`.** A secret in the environment or on the command
  line, which 0032's gate refuses.
- **`latest`, or a tag without a digest.** Unpinned.
- **cloudflared as a host package.** Per-OS steps outside Compose; not
  refused, and the guide says the configuration then names the web front's
  address.
- **Quick Tunnels.** No Access, and a random hostname.
- **`cert.pem` in a named volume.** It would outlive setup on disk.
- **One hostname with Access on the administrator's paths.** A list kept by
  hand, one wildcard per segment.
- **Access on the runtime door.** The host application's people are not in
  the operator's policy; Service Auth remains for a backend.
- **The runtime door straight to the server.** It would bypass nginx's body
  limit, headers and `proxy_next_upstream off`.
- **The runtime door on nginx's 8080, with a refusal of `\` and `%5C`**,
  a `map` on `$request_uri` before any location. The smaller change, and a
  list again: of what cloudflared reads as a slash that nginx does not. A
  server that serves no file needs no such list.
- **cloudflared on compose's network, its reach stated** rather than
  closed. Every change of its ingress, and every private network route,
  would then reach the server past nginx and the databases; a network costs
  one line of compose.yaml.
- **A WAF rule blocking administrator paths on the runtime hostname.** A
  hand-kept list, and its block reads as an unknown write.
- **Normalising paths at nginx or the server instead of refusing them.** Two
  normalisers would have to agree with cloudflared's, which is not
  documented; a refusal needs no agreement. Only `%2F`, `%5C` and dot
  segments would need a list of what every proxy decodes; nginx's own
  check would hold behind this nginx only.
- **Trusted proxies, `FORMANCY_DATA_TRUSTED_PROXIES`.** Docker's gateway
  would be trusted, so any local process could choose its own address and
  the audit stream's; it would reverse 0034's sentence on `trustProxy`; it
  would put visitors' addresses into the server's log; and shape (b) gains
  nothing from it.
- **Relying on `Authorization` to keep answers out of caches.** It holds
  under Origin Cache Control only.
- **The apps sending `X-Requested-With`**, so Access answers 401, with a
  message built on that 401. Its body is not measured.
- **nginx stripping Access's header and cookie.** The server's log writes
  no header already (server-log.test.ts).
- **`restart: unless-stopped` in the overlay.** A stack that reconnects
  itself to the internet after a reboot is the operator's decision.
- **Running doors-check in CI.** There is no account.

## Older records

Applied and unchanged: 0013, 0014 and 0031, whose store, key and write-id
memory are why the server stays on the operator's machine; 0023, whose
trail is the server's log behind the tunnel too; 0024 and 0029, whose one
origin both doors keep by going through `deploy/web/nginx.conf` -- the
runtime door's server serves the runtime routes alone, which the host page
and data-client call on the host application's own origin; and 0033, whose
"one event per request that reaches a route" holds for P3's refusals, which
a new case in admin-audit.test.ts shows, while the expected statuses of
three suites' encoded paths change and their properties do not. 0034 is
cited, not changed: its sentence that `trustProxy` is not offered, and that
the setting raises the bucket rather than splitting it, stays true.

Extended: 0032, whose stack the overlay adds to without changing a service,
and whose checks of the resolved configuration the gate runs on both files.
Its web front gains a second server, on 8081, published nowhere, and joins
a second network, `edge`; what 0032 decided of the origin on 8080 -- the
apps and `/v1/` on one origin, everything else 404, the server unpublished
-- is as it was.
