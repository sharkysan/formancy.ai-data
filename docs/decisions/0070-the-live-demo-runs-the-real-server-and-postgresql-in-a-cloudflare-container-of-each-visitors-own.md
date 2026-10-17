# 0070 — The live demo at formancy.ai/data/demo/ runs the real data server and PostgreSQL in a Cloudflare Container of each visitor's own, started only by a sign-in and gone when it sleeps

- **Status:** accepted; narrows [0037](0037-cloudflare-is-the-edge-not-the-runtime.md) for this demo alone, and extends [0047](0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md) and [0069](0069-the-examples-page-is-served-at-formancy-ai-data-examples.md)
- **Date:** 2026-10-17
- **Deciders:** Daniel Bacher
- **Verified by:**
  - **`apps/live-demo`'s suite, in its own test job.**
    - The data, `src/data/`. `generate.test.ts` holds the generated rows to
      every invariant `invariants.ts` states -- an order's amount the sum
      of its lines, a delivery if and only if the order is shipped, one to
      six lines numbered from one, a town of the customer's own country,
      names unique within a tenant, one tree of employees under one
      managing director, approvals by heads and never on a draft -- and to
      the same rows twice, other rows from another seed, and more than
      eight pages of `LIST_PAGE_SIZE` per tenant; `invariants.test.ts`
      breaks each in a copy and watches it named; `render.test.ts` holds
      the SQL, which refuses data that breaks one. Watched failing against
      the generator broken in turn: "order 7: amount 1793.31 is not its
      lines' sum 1793.30", "order 4 is placed and has a delivery", "names
      Hamburg, a town of DE, not of FR", and the seed ignored.
    - `src/data/load.integration.test.ts`, on `postgres:17-alpine` through
      data-fixtures' `startPostgresContainer`: the fixture's `postgres.sql`
      and the demo's SQL in one transaction, as the image loads them; the
      rows read back as exactly the rows generated; every invariant as the
      database stores it; the database's own `line_total` adding up to
      each amount; no foreign key left unvalidated; each identity past its
      rows; two loads alike in every column. Watched failing with the
      identity restart left out ("'"order"'s next id: expected 1 to be
      greater than 840"), the validation left out ("[ { conname:
      'fk_employee_manager' } ]"), and `created_at` left to its default.
    - The people and their tokens, `src/personas.test.ts` and
      `src/token.test.ts`: data-server's own `createIdentityVerifier`,
      configured as the image configures the server, accepts each persona's
      token with its roles and tenant; a key under 32 bytes and another
      key's token are refused; and each persona's sentence is derived from
      what the role is granted. Watched failing: the key decoded from
      base64url (`ERR_JWS_SIGNATURE_VERIFICATION_FAILED`), the short-key
      check removed, the lifetime counted in milliseconds, an extra `nbf`,
      the tenant sent as text, an auditor granted a create without a read
      ("may change only what they may read"), a typed sentence in place of
      the derived one, and both clerks put in tenant 1.
    - The image, `src/image/`. `forms.test.ts` holds each policy to
      `ROLE_GRANTS` and the fields to the studio's own "Fill every field
      from the operations"; `dockerfile.test.ts` holds
      `deploy/demo/Dockerfile` to data-fixtures' `POSTGRES_IMAGE`, the
      server image's Node, the token's issuer, audience and tenant claim,
      the port, the key's variable and every file its scripts name;
      `publish.integration.test.ts` loads the image's own files with
      `psql` into PostgreSQL 17, runs the real server in process, publishes
      the four forms over a socket as the image's build does, and reads
      each persona's menu and opened forms back against `ROLE_GRANTS`,
      then a clerk's typeahead, create, children, change and delete, the
      other tenant's 404 and the auditor's 403. Watched failing: no
      `DELETE` on `order_line`, no `UPDATE` on `delivery`, the order's
      cascades left out and an unfiltered order form, each refused at
      publish; the labels left out; clerks said to delete lines; filters
      and labels chosen by field key; the order shown by its date alone;
      and, in a real build of the image, the role's password left set:
      "build.sh: formancy_demo still has a password."
    - The Worker, `src/worker/*.test.ts`: its routes, its cookie, the
      sign-in's refusals, its answers and the headers it forwards, the key
      and the wait for `/health`, and its dispatch, each watched failing
      against a router, cookie, refusal, answer and dispatch that let more
      through. `src/worker/` is covered whole; `src/worker.ts` is left out
      of the coverage, as *Review alone* below says.
  - **`scripts/live-demo.test.mjs`, in `pnpm test:repo`.** The Worker's
    config is the demo's and nothing more, the deploy refuses every config
    that is not, `PREFIX` and `MAX_INSTANCES` are what the config routes
    and caps, the Worker's `RUNTIME_ROUTES` are exactly the routes
    `deploy/cloudflare/doors.json` says 0037's runtime door forwards, each
    by its method, and every other route the server registers, by its
    sample path, is not forwarded, the `_headers` file reads back as the
    live policy and fits Cloudflare's limits, `.github/REPO-METADATA.md`'s
    settings are `pnpm live-demo:deploy`'s two halves for this Worker and
    this repository, and no workflow names a Cloudflare token or runs the
    deploy. Watched failing against a deploy script that accepted every
    config, a policy with a second allowance, the examples' main-module
    guard, the ignore lines removed, settings copied from the examples'
    section, a workflow running the deploy, build checks that ignored the
    policy or the allowance they were given, a Worker that forwarded all of
    `/v1/forms` ("POST /v1/forms/:id/drafts: expected 'forward' not to be
    'forward'") and one with the update route left out.
  - **`scripts/demo.test.mjs`, in `pnpm test:repo`,** unchanged in what it
    holds of the examples page, which its checks still pass. It reads the
    examples' settings from their own section of REPO-METADATA.md; with the
    live demo's section placed first it read the live Worker's name, and
    failed. It runs both deploys, `scripts/demo.mjs` and
    `scripts/live-demo.mjs`, with an option neither has, by their path,
    through a directory linked to the checkout and by a relative path from
    inside the link, and expects each one's own usage and status 1: watched
    failing against the guard that compared the paths as given, which
    exited 0 having done nothing through the link ("expected +0 to be 1").
  - **`scripts/live-demo-docs.test.mjs`, in `pnpm test:repo`.** README's
    *Try it* and *Live demo* name the address the Worker is routed at; *Live
    demo* lists exactly the people the Worker offers, states the Worker's
    idle minutes and cap and no other, says each tenant has the customers
    and orders the generator makes, and names only commands the root
    manifest has; and *Host example* names the demo build's script. Watched
    failing before the README said any of it, and then with each defect
    planted in the written README and taken out again: the address moved
    in *Try it* ("expected '\n## Try it\n\nFrom an empty machine …' to
    contain 'https://formancy.ai/data/demo/'"), a person renamed and one
    left out ("expected [ 'Clara', 'Otto' ] to deeply equal [ 'Clara',
    'Otto', 'Vera' ]"), the minutes and the cap changed ("expected 15 to
    be 10"), the customers changed ("expected { customers: 100, orders:
    420 } to deeply equal { customers: 120, orders: 420 }"), a command
    renamed, and the demo build's script taken out of *Host example*.
  - **The host page's suites, `apps/host/src/demo.test.ts`,
    `persona-sign-in.test.tsx` and `plane.test.tsx`,** in jsdom against the
    Worker's own `handle()` in front of the real server on PostgreSQL: the
    people and their sentences, a page view starting nothing, one sign-in
    then the menu with the token in `Authorization` alone, a second press
    sending nothing, a refusal in the Worker's or the server's words, the
    token in no storage, address or document, axe and a name on every
    control in each state, and every request under `/data/demo/v1/` a route
    of the runtime plane. Watched failing, each against its own break: the
    description not linked to its button, people of the page's own, the
    idle minutes typed, the buttons disabled while asking, a refusal in the
    page's words, the token kept in `sessionStorage`, every press signing in
    as Clara, and a stray `GET /v1/forms` outside the base ("expected [
    'GET /v1/forms' ] to deeply equal []").
  - **`pnpm test:live-demo`, the `live-demo` job in `gates.yml`,** which the
    release report waits for; `scripts/release-report/workflows.test.mjs`
    holds the job and the script, and failed before either existed. It
    builds the host page's demo build and the image, runs the Worker's own
    module over a stand-in for Cloudflare's runtime whose containers are
    `docker run`s of the image at the instance type's share, and walks a
    visitor's journey over HTTP -- the session starting nothing, a sign-in
    from another site refused, the cold start and the one cookie, each
    persona's menu, nine pages of each tenant's orders, a search, the
    typeahead keeping to a tenant, the data's invariants through the
    product, writes, refusals, the same create answered once, every route
    of the server's that 0037's runtime door does not forward answered by
    the Worker's own 404, each administrator's route sent straight to a
    container's port the server's own 404, a second
    visitor never seeing the first one's changes, neither secret in what
    the container wrote, and the reset -- and then the page in Chromium,
    under the live headers, with axe, at 320 pixels, by keyboard. Its pure
    helpers are held in `pnpm test:repo` by `scripts/live-demo-gate/*.test.mjs`,
    watched failing with the key's value put on a command line, the swap
    quota changed, `run_worker_first` ignored, the redirect sent to the
    Worker, and `HttpOnly` not required of the cookie. `docker.test.mjs`
    derives the image's lookup deadline from data-core's default and the
    instance type, and failed with the Dockerfile's line absent. The reason
    for the policy's one allowance was watched in Chromium: under the
    examples page's policy the same page reports `style-src-elem` refusing
    AG Grid's style elements. All 61 of the gate's checks passed on
    2026-10-17 on the Windows workstation; the job has not yet run in CI.
  - **`scripts/live-demo-gate/worker.test.mjs`, in `pnpm test:repo`,** runs
    the Worker's own module over the gate's stand-in, without Docker, with
    containers that fail as the documentation says a start may: a start
    that throws, as at the cap, an inactivity timeout that throws after a
    start, and a container that stops before it answers. Each sign-in is
    refused with no cookie, its container is not left running, and its
    Durable Object keeps no key and no alarm, nor the key of a start
    before it; a start that answers keeps its key and an alarm a day on.
    Watched failing against the Durable Object as it was, which stored the
    key and set the alarm before starting and kept both after a refusal
    ("expected [ { stored: [ 'key' ], …(2) }, …(2) ] to deeply equal [ {
    stored: [], …(2) }, …(2) ]") and left a container running whose
    timeout threw, then with the alarm's deletion and the destroy each
    taken out of the cleanup.
  - **Review alone** holds `apps/live-demo/src/worker.ts` as Cloudflare runs
    it -- the Durable Object's glue to `ctx.container`, its inactivity
    timeout, its alarm -- because no gate here runs workerd with a
    container (*Context*); what is in Cloudflare's dashboard and GitHub's
    settings, as for 0069; and a rate limiting rule of the zone, if one is
    made.
  - **By hand, after the first deploy,** what RELEASING.md lists: the page
    and each person, the headers at the address, what the cap answers, how
    long a server outlives its visitor, and the images the account holds.
    Not yet done: the Worker does not exist yet.

## Context

The rightsholder chose to put the product itself online: a page where
anybody can sign in, search a page of orders, open one with its lines and
deliveries in linked grids, pick a customer with the typeahead, and save,
create and delete, against the real data server and a real PostgreSQL, not
a recording. The examples page at formancy.ai/data/examples/
([0069](0069-the-examples-page-is-served-at-formancy-ai-data-examples.md))
generates forms in the browser and has no server; the host page
([0047](0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md))
is the workspace to show, and it runs only from a clone or the composed
stack ([0032](0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)).
The rightsholder chose Cloudflare Containers on the Workers Paid plan, data
that resets when a container sleeps, the path `/data/demo/` of formancy.ai,
and a deploy by Workers Builds from `main`, as 0069's.

[0037](0037-cloudflare-is-the-edge-not-the-runtime.md) decided that
Cloudflare is this product's edge and cannot be its runtime, and rejected
Containers for four reasons: an ephemeral disk for the store, write ids
lost on sleep, ingress needing a Worker and a Durable Object, and the
databases on public endpoints. For a deployment of the product each still
holds. For a demo whose data is meant to reset, the first two are what is
wanted, consistently: the store, the database and the write ids go
together. The third is code this record writes and tests. The fourth does
not arise when the database is inside the visitor's own container, on
127.0.0.1.

**Read in Cloudflare's documentation,** `cloudflare/cloudflare-docs` at
`0a7e37ca429f`, on 2026-10-16:
- **Instance types:** `lite` 1/16 vCPU, 256 MiB, 2 GB of disk; `basic` 1/4
  vCPU, 1 GiB, 4 GB; four `standard` sizes above. An image may be as large
  as the instance's disk; an account holds 50 GB of images.
- **Pricing:** Containers are not available on the free plan, and come with
  the Workers Paid plan, "$5 USD per month". Billed per 10 ms while running:
  25 GiB-hours of memory, 375 vCPU-minutes and 200 GB-hours of disk a month
  included, then $0.0000025 per GiB-second, $0.000020 per vCPU-second and
  $0.00000007 per GB-second. Memory and disk are billed as the instance
  type provisions them, CPU only while it is used. Workers and Durable
  Objects are billed as usual on top.
- **`max_instances`:** "If a request to start a container will exceed this
  limit, that request will error", not enforced in local development.
  What the error is, and how it reaches the Durable Object, is not said.
- **The API:** the Durable Object Container API, `ctx.container`, is the
  one recommended for new applications; `start()` returns before the
  container is ready and throws when it already runs;
  `setInactivityTimeout` is how long a container runs on once its Durable
  Object is inactive, set after `start()` and again in the constructor.
  A Durable Object is hibernatable after 10 s idle and evicted after 70 to
  140 s.
- **Lifecycle:** a request reaches a container only through a Worker and
  its Durable Object, which need not be in the same place; cold starts are
  "often in the 1-3 second range" plus the entrypoint; **a restarted
  instance gets a fresh disk from the image**; a stop is SIGTERM, then
  SIGKILL; each instance is a Firecracker microVM.
- **Deploy:** `wrangler deploy` uploads and activates the Worker before it
  processes the containers, "not transactional"; a changed image rolls
  out; Workers Builds runs a full deploy on the production branch, with a
  20-minute timeout and 6,000 build minutes a month on Workers Paid; no
  version or preview address is made for a Worker with Durable Objects.
- **Static assets:** with a Worker script the assets are tried first and the
  Worker runs on a miss, or first for the paths `run_worker_first` names;
  `_headers` is not applied to what the Worker answers.

**Read in this repository:** data-client reads a write's answer as a
refusal only when it is 4xx with the server's sentence or 503 `unavailable`,
and anything else as an unknown write
([0031](0031-an-answer-lost-after-a-write-is-unknown.md));
`DataClientOptions.base` prefixes every route; the composed stack's order
account may not read `sales.order_line`, so its guide shows no child grid
(0047). And AG Grid 36.2.0 injects its theme as `<style>` elements, which
0069's `style-src 'self'` refuses.

**Measured,** on the Windows 11 workstation with Docker Desktop engine
28.3.3, CPU and memory as `docker run --cpus`/`--memory` quotas, which
emulate an instance type's share and are not Cloudflare's scheduler:
- **Which instance type** (2026-10-16, a prototype image and a rough data
  set, not the ones built here), from `docker run` to `/health` answering
  and for a 23-request journey: at `lite`'s share 16,367 ms and 12,553 ms;
  at `basic`'s 4,691 to 5,172 ms and 2,814 to 2,897 ms over three; at
  `standard-1`'s 2,759 ms and 1,520 ms.
- **The data** (2026-10-16, PostgreSQL 17.11): 6,580 rows -- 7 countries,
  18 employees, 240 customers, 840 orders, 2,885 lines, 864 deliveries and
  1,726 parcels -- in 344,490 bytes of SQL, generated in 44 to 46 ms and
  loaded with the fixture in one transaction in 361 to 388 ms over six
  runs; the database 8,951,475 bytes loaded, 7,537,167 empty.
- **The image** (2026-10-16, at `basic`'s share): built uncached in 53.1 s
  and 56.4 s; 531,629,545 bytes, 197,538,291 through `docker save | gzip
  -1`; `/health` answering 4,825 to 5,278 ms after `docker run` over six
  starts; peak memory 108,863,488 to 111,026,176 bytes; `docker stop` in
  934 to 1,192 ms with status 0.
- **The whole demo, through the Worker's own module** (2026-10-17, at
  `basic`'s share, the gate): the image 531,941,176 bytes; `/health` 5,456
  to 9,787 ms after `docker run` over eight starts; a cold sign-in through
  the Worker 5,721 and 6,758 ms; in Chromium, Enter on a person to the menu
  of forms 7,013 to 7,828 ms; peak memory after the journey 117,215,232
  and 122,974,208 bytes, never killed; the gate 124,996 ms with the image's
  install cached, the image's build 313,851 ms with it not. While another
  session's PostgreSQL and SQL Server test containers ran on the same
  engine, a start took about 31 s, Node's first line 28.6 s after
  PostgreSQL was ready, in two runs.
- **The lookup deadline:** three cold visitors at once beside a type-check,
  each container at `basic`'s share, had a new order's three lookups
  answer 503 `lookup-timeout` at the server's default of 892 ms in two of
  three passes, and none in six with the deadline below.
- **`wrangler@4.146.0 dev`** refused local containers on Windows ("Local
  development with containers is currently not supported on Windows"). In
  WSL against Docker Desktop (kernel 5.15.167.4-microsoft-standard-WSL2)
  it ran this Worker and its Durable Object in workerd and started the
  image, but the sidecar it reaches containers through,
  `cloudflare/proxy-everything:3cb1195`, exited with status 4 at its first
  iptables rule ("Extension socket revision 0 not supported, missing kernel
  module?"), and after 35.2 s the Worker answered its own 503 that the
  server could not be started (2026-10-16 and 2026-10-17).

## Decision

**The live demo is https://formancy.ai/data/demo/.** Each visitor who signs
in gets a data server and a PostgreSQL of their own, in a Cloudflare
Container, with sample sales data, and loses it, and everything they
changed, when it sleeps.

**One Worker, `formancy-data-demo`** (`apps/live-demo/wrangler.json`),
routed at `formancy.ai/data/demo/*` and at the path without its slash on
formancy.ai's zone, with no workers.dev and no preview address, as 0069's
is. Its static assets are the host page's demo build, served with no Worker
invocation and no container; it runs first only for the session and the
runtime plane, and answers four things and nothing else:

| Request | Answer |
|---|---|
| `GET /data/demo/session` | the people a visitor can be and the idle minutes, from constants; no Durable Object, no container |
| `POST /data/demo/session`, `{ "persona": … }` | starts the visitor's container if none runs, and a token for that person |
| a route of the runtime plane under `/data/demo/v1/forms`, by its one method: the menu, a form, a lookup's query and resolve, and a record's create, read, list, update and delete | forwarded once to the visitor's container, `/data/demo` taken off and the query kept; 503 `unavailable` when none runs; a bare 502 when the forward fails, since it may have reached the server |
| anything else | the Worker's own 404, or 405 for another method on one of those routes |

The routes forwarded are exactly 0037's runtime door, as
`deploy/cloudflare/doors.json` derives it from the routes the built server
registers, and not the prefix `/v1/forms`: the administrator's plane shares
`/v1/forms/:id` -- its versions, imports, restorations, regenerations,
drift and drafts -- and none of that is forwarded. The administrator's
plane is kept out twice: the Worker forwards none of its routes, and the
image runs the server without administrator roles, so it registers none,
which the gate shows by sending each straight to a container's port. A
segment of a forwarded route that is not plain is sent as written, for the
server's own `400 path-not-plain` (0037). The headers forwarded are an
allowlist -- `authorization`, `content-type`, `accept`, data-core's
write-id header,
`origin` and the three `sec-fetch-` headers -- so neither the cookie nor a
visitor's address reaches the container. A forwarded answer keeps the
server's headers and gains the three nginx gives `/v1/` (0032); the
Worker's own answers say `no-store`, `nosniff`, `no-referrer` and a policy
that loads nothing.

**A container of each visitor's own.** The Worker sets one cookie,
`__Secure-formancy-data-demo`: 128 random bits as hex, `Path=/data/demo/`,
`Secure`, `HttpOnly`, `SameSite=Strict`, no lifetime, so the browser
forgets it when it closes. It names the visitor's Durable Object,
`DemoServer`, by `idFromName`, and a value of any other shape is no
cookie. The shape is all the Worker can check: a client that writes 32
hex characters of its own reaches the Durable Object of that name, a new
one nobody else holds, since every visitor's name is 128 random bits. Two
tabs share one container. **The cookie is that container's only
credential**, and the page says so.

**Started only by a sign-in from the page.** A `POST` to the session starts
anything only when its `Origin` is the page's, its body is declared JSON,
the browser does not mark it cross-site, the body fits in 1 KiB and it names
a person the demo has; otherwise 403 `cross-origin-refused`, 400
`malformed` or 400 `unknown-persona`. No `GET` of any path starts a
container, so a crawler, a prefetch or a form on another site starts
nothing. Starts in flight share one promise, so two tabs pressing at once
start one container with one key; not `blockConcurrencyWhile`, because a
start may take up to its deadline of 30 s, and a callback that runs past
30 s resets the Durable Object. The Durable Object then:
- makes a new key, 32 random bytes as base64url, and starts the container
  with it as `FORMANCY_DATA_DEMO_IDENTITY_SECRET`, `enableInternet: false`;
- sets the inactivity timeout to **10 minutes**, after the start and again
  in its constructor when a container already runs;
- asks `/health` every 250 ms for at most 30 s -- about six times the
  starts measured at `basic`'s share, plus Cloudflare's documented 1 to
  3 s -- and gives up when a container it saw running stops;
- once the server answers, keeps the key in its own storage and sets an
  alarm a day on, which deletes the key when no container runs, so
  nothing about a visitor outlives a day;
- answers every failed start alike, a throw or no answer in time, with 503
  `unavailable`: "No demo server could be started just now. At most 10 run
  at once, and Cloudflare may have had none to give; nothing was started
  for you. Try again in a few minutes.", and forgets the start: the
  container destroyed if it runs, so it keeps no place, and the alarm and
  every stored value deleted, the key of an earlier start included, so a
  refused sign-in leaves nothing behind.

**`max_instances` is 10,** in the config and in the Worker's
`MAX_INSTANCES`, which the sentence above is made from: a budget, not a
measurement, whose cost is below. **The instance type is `basic`:** the
measured peak memory is about a ninth of its GiB, `lite` took more than
three times as long to start, and `standard-1` provisions four times the
memory, billed whether used or not.

**No shared secret.** A token is signed in the Durable Object with the key
of the container it is for (`src/token.ts`, WebCrypto): HS256, issuer and
audience `formancy-data-demo`, the person as `sub`, their roles, their
tenant as `tid`, an hour's lifetime, which is what the server reads. A
token from before a restart is refused by the new key. A visit can outlast
the hour, since every request keeps its container running: its token is
then refused, 401 "A valid host token is required.", by a server that
still runs, and the page does not sign anybody in again by itself. Sign
out and a new sign-in, signed with the key the Durable Object stored,
reach the same server and what the visitor changed. The page holds it as
the host page always has, in memory, in `Authorization` alone
([0029](0029-a-host-renders-a-published-form-through-one-client.md)).

**Three people, and no administrator** (`src/personas.ts`), each sentence
derived from `ROLE_GRANTS`, from which the forms' policies are derived too:
- **Clara**, order clerk of tenant 1: reads tenant 1's customers, orders,
  order lines and deliveries, and nothing of tenant 2's; adds customers;
  adds, changes and deletes orders and deliveries; adds and changes order
  lines.
- **Otto**, the same for tenant 2.
- **Vera**, auditor of tenant 1: reads, and changes nothing.

The customer form offers no update or delete and the order line no delete,
as the generator decides for this schema and says in its notes: the
customer table has no version column it can use, and a line created again
with a deleted line's key starts its row version where the deleted one
did.

**The image, `deploy/demo/Dockerfile`,** built from the repository root, so
it is main's code and no local `dist/`: `postgres:17-alpine`, the tag
data-fixtures' `POSTGRES_IMAGE` names, with the server image's Node 22.12
copied in. At build time `build.sh`:
- creates the cluster, peer over the socket and a password over TCP,
  listening on 127.0.0.1 alone, at a path outside the base's declared
  `VOLUME`;
- loads the fixture's `postgres.sql` byte for byte, the demo's rows and the
  demo's own account (`accounts.sql`), granted what the forms use and
  nothing else, in one transaction;
- starts the server with its administrator's plane under a build-only key
  and publishes the four forms through it, `customer`, `order`,
  `order-line` and `delivery`, generated from the snapshot the demo's
  account discovers, as the getting-started journey publishes, each lookup
  filter, path and label chosen by foreign key and the order's employees
  relabelled "Created by" and "Approved by";
- nulls the account's password, checks that it did, and stops cleanly.

At every start `start.sh` gives the account a new password and runs the
server as PID 1, as `node`, with the runtime plane alone. Neither key nor
password is written to a file. The image sets
`FORMANCY_DATA_LOOKUP_DEADLINE_MS` to 3,568: the default of 892 ms
([0063](0063-the-default-lookup-deadline-is-outside-the-measured-product.md))
over `basic`'s quarter of a CPU, derived by a test, not typed.

**The data,** `apps/live-demo/src/data/`, is generated from a fixed seed,
with no dependency and no clock: two tenants of 120 customers and 420
orders, over the 18 months up to 2026-09-30, with their lines, deliveries
and parcels, shared employees in one hierarchy, and the countries the
fixture lacks. It replaces the fixture's rows and leaves its schema alone,
so the fixture's edge rows are not in the demo and the demo's are not in any
suite. A visitor's change leaves an order's amount as typed: nothing in the
schema keeps it the sum of the lines.

**The page is the host page's demo build,** `build:demo` (Vite's `demo`
mode, a relative base), which signs a visitor in as one of the people
rather than with a pasted token, and reaches the session and the runtime
plane beside its own files through data-client's `base`. The ordinary build
leaves that branch out. Every file is sent with
`scripts/live-demo-headers.mjs`'s headers: 0069's, with `'unsafe-inline'`
added to `style-src` and nothing else, for AG Grid's style elements:
`default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
font-src 'self'; img-src data:; connect-src 'self'; object-src 'none';
base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.

**Observability is off,** for the Worker and the container: Cloudflare
keeps no log of anybody's requests to the demo.

**Cloudflare deploys it from `main`,** as 0069's: Workers Builds with root
`/`, build command `pnpm build`, deploy command `node
scripts/live-demo.mjs`, no other branch built and no variable, which
together are `pnpm live-demo:deploy`, the same command by hand. The script
refuses a checkout with changes, a config that is not exactly the demo's,
Docker not answering, and a demo build that fails 0069's checks under the
live policy; it stages the build under `data/demo/` beside its `_headers`
and runs the pinned Wrangler with `--containers-rollout=immediate`. No
workflow here holds a Cloudflare token or deploys. **CI builds and runs the
image** on every pull request, in the `live-demo` job, because Workers
Builds does not wait for it and a deploy is not one transaction.

**What it is not.**
- **Not a deployment of the product.** No durable store
  ([0013](0013-published-configuration-is-files-with-link-based-swap.md)),
  no write ids that outlive a container (0031), no administrator's plane,
  PostgreSQL alone, and an instance per visitor that nobody operates.
  **0037's guidance for a deployment stands**: Cloudflare is its edge, and
  its Containers alternative stays rejected for it.
- **Not formancy.ai/data.** That path, and the site's shell, are
  formancy.ai's, as 0069 says; this is an app with the host page's own
  header.

## Consequences

**What it buys.**
- **The product, tried with nothing installed:** the menu, a page of
  records searched and paged, a typeahead over a tenant's customers, an
  order with its lines and deliveries in linked grids, a save, a create, a
  delete with its cascade, another tenant's refusal and an auditor's,
  against the real server and the real database.
- **Isolation that is the product's own:** the two tenants are separated by
  the forms' row filters on the token's `tid`, as a customer's would be,
  and each visitor's writes are in their own database.
- **A reset nobody schedules:** the image is the data, and a container's
  disk is the image's on every start.
- **The image gated before it is deployed,** in the gate's journey on every
  pull request, through the Worker's own module.

**What it costs.**
- **Money, as long as people use it.** The account needs Workers Paid, $5 a
  month. One `basic` instance costs, at the prices read, $0.009 an hour for
  its memory and $0.001008 for its disk while it runs, and up to $0.018 for
  its CPU if busy the whole hour. A visit of ten minutes' use keeps its
  container running at most about 22 minutes -- the use, the 10 minutes'
  timeout and up to 140 s before the Durable Object is evicted -- so the
  included amounts cover about 67 such visits a month, memory being the
  first to run out, and each further one costs about $0.0037, plus at most
  $0.000037 of CPU for a start and a journey at the times measured. **At
  most**, ten instances running a whole 30-day month cost $72.06 with idle
  CPUs and $201.66 with busy ones, less at most $0.73 of included use, plus
  the plan, Worker and Durable Object requests, which were not computed,
  and egress past the included allotment. `max_instances` is the bound;
  lowering it lowers that. Beside the containers, Cloudflare bills Durable
  Objects as usual, which was not computed either: a Durable Object
  request for every sign-in and every forwarded request, the object's
  compute while it runs, a storage write of the key and of its alarm for
  every start that answers, and that alarm's one invocation a day later,
  again each day while its container still runs. A refused sign-in leaves
  no stored key and no alarm, but its storage deletes are still asked, and
  it is still a Durable Object request -- for a new object, under a name
  of the Worker's making, whenever the request carries no cookie.
- **Anybody can start one, and one visitor can take all ten.** Starts are
  bounded by the cap alone; when it is reached, every other sign-in is
  refused until a container stops. A rate limiting rule of the zone on
  `POST /data/demo/session` would bound it; REPO-METADATA.md names it as
  the operator's choice, and nothing here sets or reads it.
- **What Cloudflare answers at the cap was not read:** the documentation
  says only that the start "will error". The Durable Object answers every
  failed start alike, so a visitor is told the cap may be the reason when
  it may not be.
- **Gone when it sleeps:** every change, the visitor's token, and their
  write ids with them. A container stops 10 minutes after its Durable
  Object becomes inactive, which Cloudflare's documentation puts 10 s to
  140 s after the visitor's last request; read, not measured. Gone too on
  every deploy whose image changed: the rollout is immediate, so every
  running demo restarts at once. The image's build
  makes a new database cluster and new publish times each time it runs, so
  an image built again from unchanged files differs; whether Workers Builds
  keeps Docker's layer cache between builds, which would leave an unchanged
  image alone, was not read.
- **PostgreSQL only.** SQL Server's image is about a gigabyte and a half,
  SQL Server on Linux needs at least 2 GB of memory as Microsoft documents
  it, more than `basic` has, and its Developer edition is not licensed for
  production use. The demo shows one engine, as the examples page does,
  and the page says which.
- **A wait for the first sign-in:** the start measured at `basic`'s share on
  a workstation, 5.7 to 6.8 s through the Worker and 7.0 to 7.8 s to the
  menu in Chromium, plus Cloudflare's documented 1 to 3 s; on Cloudflare
  not measured. On a busy Docker engine a start took about 31 s, past the
  30 s deadline, and a visitor is then refused; Cloudflare's microVMs have
  no such neighbour, which is also unmeasured. Every request then crosses
  the Worker, the Durable Object, which may be elsewhere, and the
  container, whose latency nobody has measured.
- **A slower lookup is allowed to run longer.** The server stops a lookup
  after 3,568 ms, four times the product's default, which at a quarter of
  a CPU is what the default is on a whole machine.
- **Cloudflare runs code on formancy.ai's zone,** which 0069 avoided: a
  Worker, a Durable Object per visitor and their containers. It decrypts
  everything at its edge and holds what a visitor types, personal data
  included, in their container until it stops.
- **0037 narrowed,** for this demo alone. A reader of 0037 meets a
  Cloudflare that runs the product's server here, and must read why it
  does not for a deployment.
- **A visit longer than an hour signs in again.** The token lasts an hour
  and is not renewed; past it every request is refused 401 until the
  visitor signs out and signs in, which reaches the same running server.
- **The cookie is the credential.** Whoever holds a visitor's cookie while
  their browser keeps it can sign in to their container and see and change
  what they changed. It is one cookie, strictly necessary, holding a
  random name.
- **Any client can choose a Durable Object's name.** The Worker cannot
  tell a name it made from one of the same shape a script wrote, so a
  script can address, and on Cloudflare create, Durable Objects by names
  of its choosing, each a Durable Object request billed, and start a
  container in one by signing in. That reaches no other visitor's server,
  whose name is 128 random bits, and does nothing a sign-in without a
  cookie, which makes a new object every time, does not already. Names the
  Worker could tell from a script's -- `newUniqueId()` checked with
  `idFromString` -- were not chosen: what `idFromString` refuses was not
  read in Cloudflare's documentation for this record, nor seen, since
  nothing here runs workerd.
- **No logs.** With observability off, a failed start is diagnosed by
  reproducing it, not by reading what happened.
- **The Durable Object's code is held by review.** `wrangler dev` runs no
  container here, so the gate runs the Worker's module over a stand-in
  written from the documentation, and the containers as `docker run`s
  under CPU and memory quotas. The stand-in does not take the container's
  network away, stop it when idle, or cap it, and it is not workerd. That
  `setInactivityTimeout`, `getTcpPort` and `start`'s options behave as
  documented, what the cap answers and how long a server outlives its
  visitor are the first deploy's to read, by hand, once.
- **The page is measured in Chromium alone,** inside the gate; the host
  page's browser gate does not run the demo build in Firefox or WebKit.
  That the ordinary host build carries none of the demo's code was read in
  its chunks once, on 2026-10-16, and nothing checks it.
- **The policy allows inline styles,** a weaker `style-src` than the
  examples page's, for AG Grid's injected theme. `font-src`, `img-src` and
  `connect-src` still keep an injected style from loading anything from
  another host. Cloudflare's injected bot-detection script is refused here
  too, one console error per load, and `'self'` is all of formancy.ai, as
  0069 says.
- **Images accumulate.** Each deploy whose image changed pushes one of
  about 198 MB compressed, as `gzip -1` measured it (the registry's own
  figure was not read), into the account's 50 GB; old ones are deleted by
  hand.
- **Two whole builds a push.** Workers Builds builds the whole repository
  for the examples' Worker and again, with the image, for this one, each
  against the account's build minutes; whether this one fits the 20-minute
  limit is first read in the first build's log. The image's build alone
  took 5.2 minutes uncached on the workstation.
- **Main's demo, not a release's,** deployed without waiting for CI, its
  settings in the dashboard, its compatibility date one more to move, the
  Cloudflare GitHub app on this repository: each as 0069 says.
- **The release report does not record the demo's PostgreSQL:** the gate's
  server is not among *What it is tested on*'s, which would need the report
  to learn a second kind of composed server.
- **The host page depends on the live demo's package** for the Worker's
  answer types, and its entry has a branch the ordinary build drops.

**What it forecloses.** Nothing that cannot be undone. Deleting the Worker
gives `/data/demo/` back to formancy.ai's 404, and `wrangler containers
delete` removes the application and its images.

## Alternatives considered

**A static recording, or a mock server.** Rejected by the rightsholder:
the point is the real server, and a recording shows a journey nobody can
leave.

**One instance shared by every visitor, or a pool.** Rejected. One
visitor's writes would be the next one's data, a reset would come at
nobody's chosen moment, and a tenant's isolation would be a page's
promise, not each visitor's own database.

**The composed stack on a machine, behind 0037's tunnel.** Rejected. It is
the product's documented deployment, but one machine kept running for
strangers, shared data again, a reset to schedule, and the rightsholder's
network behind a public demo. Its edge would be the same Cloudflare.

**A subdomain, demo.formancy.ai, as a Custom Domain.** Rejected, as 0069
rejected one: a second address for the product beside its website. The
deploy refuses a Custom Domain.

**The `Container` class, `@cloudflare/containers`.** Not chosen. The
documentation now keeps it for existing applications; it is a runtime
package for what is a few dozen lines here.

**The `durable_object` scheduling policy, and snapshots.** Rejected. It is
in beta and has no `max_instances`, so nothing would bound the cost, and a
snapshot would keep what the reset is meant to lose.

**Starting on the first request, or on any `GET`.** Rejected. Crawlers and
prefetches would start containers, each billed.

**The page served by the container.** Rejected. Every page view would be a
cold start, and every crawler a container.

**The Worker adding the token from the cookie.** Rejected. The cookie would
then authorise every write, from any site the browser sends it to, and the
demo's page would hold its token otherwise than every host (0029).

**A pasted token, as the host page asks.** Rejected. A visitor has no
minter, and the key is made per start.

**`lite` or `standard-1`.** Rejected: `lite` took 16.4 s to answer and
12.6 s for the journey at its share; `standard-1` halves the times and
provisions four times the memory.

**SQL Server beside PostgreSQL.** Rejected, for the reasons the costs give.

**The released server image.** Rejected. The host page is main's, and so is
the server it must speak to.

**A hash or a nonce for AG Grid's styles, or its legacy stylesheets.**
Rejected. Hashes of generated CSS would be read from a browser and change
with every grid release; a nonce needs code on every page response, which
the assets do not run; the legacy stylesheets would change the host page's
theming for the demo's sake.

**Container logs on.** Rejected: every visitor's requests kept by
Cloudflare, for a demo.

**A jurisdiction constraint.** Not chosen. The data is synthetic, and it
would slow starts for visitors elsewhere; it can be added.

**A CI job that deploys.** Rejected, for 0069's reason: a token able to
change formancy.ai's zone in GitHub.

**`wrangler dev` with the container as the gate.** Rejected: measured not
to run here. Whether it runs on a Linux runner with its own Docker engine
is untried.
