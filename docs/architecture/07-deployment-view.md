# 7. Deployment view

The product is one server process beside the operator's databases. This
section is how that process is built, what stands in front of it, and how it
is configured. Three other things are deployed from this repository and are
not the product: the composed stack, an evaluation install on one machine;
the examples page on formancy.ai, which has no server at all; and the live
demo on formancy.ai, which runs the server for each visitor and is not a
deployment of it.

## What is built, and what is released

| Artefact | Built by | Released as | Held by |
|---|---|---|---|
| The server image, `packages/data-server/Dockerfile` | `release.yml` at the tagged commit; the `container` job on every pull request; Compose on the operator's machine, as `formancy/data-server:compose` | `ghcr.io/<owner>/formancy-data-server:<tag>`, signed by digest, the SBOM attached; no `latest` tag | the `container` job in `gates.yml`; `packages/data-server/src/dockerfile.test.ts`; `scripts/release-report/workflows.test.mjs` |
| The web image, `deploy/web/Dockerfile`: nginx with the studio and the host page | Compose on the operator's machine, as `formancy/data-web:compose` | never | review: nothing fails if a workflow pushed it |
| The npm packages | `release.yml` | with provenance, each tarball with `LICENSE.md` and `NOTICE` | `scripts/verify-licenses.mjs`; the release's `check` job |
| The Cloudflare overlay, `deploy/cloudflare/` | Compose on the operator's machine | never; in no package and no image | `pnpm test:cloudflare` |
| The examples page, `apps/examples` | Workers Builds, from `main` | served at formancy.ai/data/examples/ | `scripts/demo.test.mjs`; `scripts/demo.mjs` refuses before it deploys |
| The live demo: the Worker of `apps/live-demo`, the image of `deploy/demo/Dockerfile` and the host page's demo build | Workers Builds, from `main`; the image also by the `live-demo` job on every pull request | served at formancy.ai/data/demo/, the image pushed to the Cloudflare account's registry | `scripts/live-demo.test.mjs`; `pnpm test:live-demo`; `scripts/live-demo.mjs` refuses before it deploys |

What each of these needs set up outside the repository's files -- the
release's secrets and environment, the image's visibility, Cloudflare's
plan and the two Workers -- is [the setup guide](../setup.md): in order,
who does each step, and what was found done when it was last read.

**The server image** has two stages on Node's alpine image. The build stage
installs the server's workspace dependencies against the lockfile with
`--ignore-scripts`, builds them, copies `LICENSE.md` and `NOTICE` into each
package (`scripts/sync-licenses.mjs`) and writes a self-contained tree with
`pnpm deploy`; the runtime stage holds that tree and nothing of pnpm or the
repository. It runs as `node`, owns `/var/lib/formancy-data`, the directory
to mount the store's volume on, and declares no `VOLUME`: an anonymous volume
nobody asked for is a surprise, not a default. The issuer, the audience and
the identity key have no defaults, so an unconfigured container stops and
names the setting it needs rather than accept tokens from an issuer nobody
named.

`packages/data-server/src/dockerfile.test.ts` derives from the dependency
graph which workspace packages the Dockerfile must copy. The `container` job
builds the image on every pull request and runs it: unconfigured, it names
`FORMANCY_DATA_IDENTITY_SECRET`; configured, it serves `/health`, runs as
`node`, carries `LICENSE.md`, can write the store's directory, reads each
setting the table below marks as the job's, answers a path that is not plain
400 `path-not-plain`, and says `Cache-Control: no-store`, which a proxy in
front relies on ([0037](../decisions/0037-cloudflare-is-the-edge-not-the-runtime.md)).

**Releasing it** is `release.yml`'s alone
([`RELEASING.md`](../../RELEASING.md)). The gates run first, the same
`gates.yml` CI calls, and their last job builds the report of that run
([0035](../decisions/0035-a-release-report-is-derived-from-the-run-that-gated-it.md)).
A `check` job with read-only permissions and no secret then refuses a report
that is not this run's, green and whole, tarballs that are not the install
gate's or lack their licence files, and a release whose measured code,
runtime dependencies or build inputs differ from what `docs/performance.md`
was measured on
([0034](../decisions/0034-performance-is-measured-through-the-shipped-server-and-held-without-a-clock.md)).
Only then does `publish`, the one job with write permissions, push the image
with build provenance, sign it with cosign keylessly, by digest, attach the
CycloneDX SBOM as an attestation, and publish the tarballs. The report labels
the `container` job's image as the gate's, never as the published one.

`CHANGELOG.md`'s 0.1.0 section, dated 2026-10-16, names the released image
`ghcr.io/sharkysan/formancy-data-server:v0.1.0`. `RELEASING.md` still says
the publish job has never run, a sentence written before the `v0.1.0` tag;
nothing fails on the difference.

**The web image is never released**: the studio is private
([0024](../decisions/0024-the-studio-speaks-only-the-admin-plane.md)) and the
host page is an example
([0029](../decisions/0029-a-host-renders-a-published-form-through-one-client.md)).
It carries `LICENSE.md` and `NOTICE`, and each app's build writes
`THIRD-PARTY-NOTICES.txt` beside its page, served as UTF-8 text
([0046](../decisions/0046-a-built-app-carries-the-licence-and-notice-texts-of-everything-it-bundles.md)).

## The composed stack

`docker compose --profile stack up` is the clean install
([0032](../decisions/0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)),
and [`docs/getting-started.md`](../getting-started.md) walks an operator from
Docker and git to a published form on both engines.

```
                       published on loopback only
 browser ─────────────▶ web     nginx, unprivileged, built from the checkout
                         │        /studio/, /host/   the two apps' builds
                         │        /v1/, /health      passed to the server
                         │        anything else      404
                         │ `proxy`, from the one address the server trusts
                         ▼
                        server  built from the checkout; no published port
                         │        store: a named volume
                         │ compose's network
                ┌────────┴────────┐
                ▼                 ▼
             postgres         sqlserver      Developer edition
                ▲                 ▲
         seed-postgres     seed-sqlserver    the fixture, through each
                                             engine's own client

 secrets  on every start: makes what the secrets volume lacks, and hands
          each consumer only its own secrets, in a volume of its own
 token    the `tools` profile, run and never started: mints a host token
```

**One origin.** The studio, the host page and `/v1` share one origin, so
every request either page makes is same-origin, as
[0024](../decisions/0024-the-studio-speaks-only-the-admin-plane.md) and
[0029](../decisions/0029-a-host-renders-a-published-form-through-one-client.md)
require. The web image builds both apps with their base as a build flag, so
neither Vite config and neither browser gate changes. `deploy/web/nginx.conf`
serves them with no SPA fallback, hashed assets as immutable, and passes
`/v1/` and `/health` to the server with `proxy_next_upstream off`: a write
whose answer was lost is the client's to send again, with its own write id,
never the proxy's
([0031](../decisions/0031-an-answer-lost-after-a-write-is-unknown.md)). It
sends no-sniff, no-referrer and no-framing headers, and its body limit is the
server's own. It sends no Content-Security-Policy: React and Angular add
inline styles at run time, and a policy no gate has seen working in a browser
would be a claim nobody checked.

**Secrets in a volume, generated.** `deploy/secrets.sh`, run by the one-shot
`secrets` service, writes each password and key once, keeps what is there
and prints names only. Each consumer is handed only the secrets it reads, so
the server and the minter cannot read a database administrator's password.
Every setting names a file, and the allowlist `deploy/connections.json`
holds references only: an interpolated value would show in `docker compose
config` and `docker inspect`.

**The order form's own account is the connection**, `formancy_writer` on both
engines, so the row-level security the fixture sets on `sales.customer`
applies ([0027](../decisions/0027-a-snapshot-says-what-its-account-may-do.md));
a superuser would bypass it.

**The minter**, `deploy/mint-token.mjs`, runs in the server's image with the
server's identity settings, reads its key with the server's `resolveSecret`
and checks it with the server's `createIdentityVerifier`. It signs HS256
tokens only and refuses a key set file
([0059](../decisions/0059-the-host-identity-key-is-a-set-selected-by-kid-and-read-again-on-sighup.md));
`scripts/mint-token.test.mjs` runs it against the built server.

**Nothing restarts on its own.** A stack that came back after every reboot
would keep SQL Server running on a machine whose operator may have finished
with it; the gate refuses a restart policy.

**What holds it.** `pnpm test:getting-started`, the `getting-started` job,
runs the guide's own `sh` blocks from a clean checkout, with the runner's
Compose and with the oldest release the guide's section 0 names. It refuses
a resolved configuration that publishes anything off loopback or anything of
the server, holds a secret as a value or sets a restart policy; drives the
guide's journey over HTTP on both engines; stops and starts the stack and
finds every token, form and order still there; and fails if a secret or a
token reaches a log, the configuration or a container's inspect.
`scripts/getting-started/steps.test.mjs` and `stack.test.mjs` beside it, in
`pnpm test:repo`, hold the guide's generated tables, its control names and
the gate's pure checks without Docker.

**What it is not.** The guide's section 8 says so: no TLS, loopback only, a
minted HS256 token, one replica, SQL Server's Developer edition, fixture
data, secrets as plain files anybody who can run `docker` there can read,
every service reachable at its container address by a local process on a
Linux host, and the audit trail in a log removed with its container. A real
deployment brings its identity provider's keys, TLS at its own proxy that
keeps the studio and `/v1` on one origin, its own database accounts, and its
own secret store mounted as files.

## Whose address the server believes

Behind a proxy every request arrives from the proxy's address. The server
believes `X-Forwarded-For` only from the peers `FORMANCY_DATA_TRUSTED_PROXIES`
names, each an IP address or a CIDR range; unset, it believes nobody, and no
`X-Forwarded-*` header is read at all
([0071](../decisions/0071-the-server-believes-the-forwarded-address-only-from-the-proxies-an-operator-names.md)).
`true`, `*` and a prefix of 0 stop the process as trusting every peer, and a
whole number as counting hops. The rate limit's key and the log's client
address are one function's, so a forwarded value that is not an address is
not believed.

The composed stack fixes two networks outside Docker's default pools:
`proxy`, which the web front and the server alone join, and `edge`, which the
web front and, with the Cloudflare overlay, cloudflared alone join. The web
front and cloudflared each hold a fixed address outside the part of their
network Docker hands out, and the server trusts those two addresses and no
range: a range includes the network's gateway, where a local process reaches
a container from.

`packages/data-server/src/trusted-proxies.test.ts` holds what the setting
accepts and refuses, and `forwarded.test.ts` beside it what the server then
believes, through the real server and its log.
`scripts/getting-started/trust.test.mjs` holds `compose.yaml`, alone and
with the overlay, to the two addresses; the `getting-started` job runs that
check on what Compose resolves, and fails if the server's log names a request
by the web front's own address.

**What it costs.** A list too wide believes clients about themselves, and a
proxy that does not append is never safe to name. A list too narrow is one
bucket again, and nothing reports it. With a proxy named, the log holds
each client's address, which is personal data. Two stacks from
`compose.yaml` no longer run at once on one machine: Docker refuses the
second's networks.

## Cloudflare as the edge

Cloudflare can be the product's front door and cannot run it
([0037](../decisions/0037-cloudflare-is-the-edge-not-the-runtime.md)). The
server keeps a pool per connection, its published forms are files
([0013](../decisions/0013-published-configuration-is-files-with-link-based-swap.md)),
and its write ids live in one process
([0031](../decisions/0031-an-answer-lost-after-a-write-is-unknown.md)), so it
runs on the operator's machine as the composed stack, and Cloudflare gives
TLS at its edge, a tunnel with no inbound port, Access in front of the
administrator's hostname, and optionally a rate-limiting rule.
[`docs/deploy/cloudflare.md`](../deploy/cloudflare.md) walks through it; its
section 0 says why Workers, Hyperdrive, Containers and Pages do not run the
product as built.

```
 browser ─TLS─▶ Cloudflare's edge   Access on the administrator's hostname
                    │ tunnel, outbound from the operator's machine
                    ▼
                cloudflared         on `edge`, with the web front alone
     administrator's hostname: everything, Access required
     a host application's hostname: the runtime pattern only, else 404
                    ▼
                web, first server   the studio, the host page, /v1/, /health
                web, second server  no file; /v1/forms and below, as sent
                    │ `proxy`
                    ▼
                server              refuses a path that is not plain
```

`deploy/cloudflare/compose.yaml` adds `cloudflared`, `tunnel-setup`,
`tunnel-config` and `doors-check`, and changes no service of `compose.yaml`.
The tunnel is locally managed: `deploy/cloudflare/configure.mjs` writes its
configuration from `deploy/cloudflare/doors.json` and the operator's
hostnames, team and Access AUD tag, and replaces the one in use only when the
pinned cloudflared calls it valid and matches every probe to its rule.
cloudflared holds no token in its command line or environment, and runs at
info level: debug logs every request header, host tokens included.

**Two doors.** The administrator's hostname forwards everything to the web
front's first server, with Access required. A host application's hostname
forwards only paths matching a pattern generated from the router's runtime
routes, to a second server of `deploy/web/nginx.conf`, published nowhere,
which serves no file and passes only `/v1/forms` and what is below it
([0045](../decisions/0045-the-runtime-plane-lists-the-forms-a-person-may-read-and-nothing-about-the-others.md))
to the server as sent. It exists because cloudflared counts a backslash as a
slash where nginx does not: through the first server, a scripted client
could read the private studio's files without Access.

**A path that is not plain is refused** (`packages/data-server/src/paths.ts`):
before any route's work, a path with a percent-escape, a backslash, an empty
segment or a dot segment is 400 `path-not-plain`, so a path the router and a
normalising proxy read differently reaches no route behind any proxy. Every
answer the server's hooks run for says `Cache-Control: no-store`.

**What holds it.** `scripts/cloudflare/doors.test.mjs` fails when
`deploy/cloudflare/doors.json`, or a generated block of the guide, is not
what the built server's router registers; `scripts/cloudflare/ingress.test.mjs`
holds the refusals, the configuration read back and the hostile paths; and
`pnpm test:cloudflare` (`scripts/cloudflare.mjs`), the `cloudflare` job, has
the pinned cloudflared read what configure writes, and sends a corpus of
paths cloudflared reads differently through cloudflared, the built server and
nginx's second server, failing on a file served or a route's work done.

**What nothing holds.** Nothing has been run through a real tunnel, and the
guide says so first. Nothing reads the operator's account: Access and its
policy, who holds Tunnel edit permission, the zone's settings, a private
network route added after setup looked once. Cloudflare decrypts everything
at its edge, host tokens included, and anybody with Tunnel edit permission
can stream the tunnel's log at debug level. Running the product on
Cloudflare's Containers is left by 0037 to a later record; the live demo,
below, runs the server there for itself alone, which is not a deployment
of the product.

## The examples page on formancy.ai

https://formancy.ai/data/examples/ is served by a Worker of its own,
`formancy-data-examples`, with static assets and no code and no binding
([0069](../decisions/0069-the-examples-page-is-served-at-formancy-ai-data-examples.md)).
It is not a deployment of the product: no data server, no database and
neither plane is behind the address. The page generates its forms in the
visitor's browser from the snapshot its build carries
([0021](../decisions/0021-generated-forms-preview-in-both-frameworks.md)).

The Worker is routed at `formancy.ai/data/examples/*` and at the path without
its slash, so formancy.ai's own Worker never sees a request under it and this
one sees no other. Workers Builds deploys it from `main` on every push, with
`pnpm build` and `node scripts/demo.mjs`, which together are
`pnpm demo:deploy`. `scripts/demo.mjs` refuses a checkout with changes, a
Worker config naming any other Worker, and a build holding a file the page
never loads, not fitting the Content-Security-Policy of
`scripts/demo-headers.mjs`, or carrying no `THIRD-PARTY-NOTICES.txt`. Every
file is sent with that policy, which refuses anything inline and allows
styles and fonts from the page's own origin alone, where its faces are
(0072). `scripts/demo.test.mjs` holds the config, the refusals and the
headers; the examples page's browser gate serves the build under the same
path and headers through `scripts/demo-serve.mjs`, and fails on anything
the policy refuses.

**What it costs.** The demo is `main`'s page, not the latest release's, and
Workers Builds deploys a push without waiting for that commit's CI. The
Worker's build settings live in Cloudflare's dashboard, where nothing reads
them, and what the address sends was read by hand once, on 2026-10-16. No
workflow here deploys the demo or holds a Cloudflare token, which
`scripts/demo.test.mjs` checks.

## The live demo on formancy.ai

https://formancy.ai/data/demo/ runs the product's own server and a
PostgreSQL for each visitor, in a Cloudflare Container of their own, behind
a Worker, `formancy-data-demo`, and a Durable Object per visitor
([0070](../decisions/0070-the-live-demo-runs-the-real-server-and-postgresql-in-a-cloudflare-container-of-each-visitors-own.md)).
It narrows 0037 for this demo alone: it is not a deployment of the product
-- no durable store, no write ids that outlive a container, no
administrator's plane, PostgreSQL alone -- and every change a visitor makes
is meant to go when their container sleeps.

```
 browser ─TLS─▶ Cloudflare's edge
                    │ /data/demo/ and its files: static assets, no code runs
                    │ /data/demo/session and /data/demo/v1/…: the Worker
                    ▼
                Worker              one cookie, a random name, picks the
                formancy-data-demo  visitor's Durable Object; forwards the
                    │               runtime plane alone, with an allowlist
                    ▼               of headers
                DemoServer          starts the container only on a sign-in,
                (Durable Object)    with a key of its own; signs the tokens
                    │
                    ▼
                container, basic    the data server, runtime plane only,
                                    and PostgreSQL on 127.0.0.1, its disk
                                    the image's on every start
```

`apps/live-demo/wrangler.json` routes the Worker at `formancy.ai/data/demo/*`
and the path without its slash, runs it before the files only for the
session and the runtime plane, attaches one container of
`deploy/demo/Dockerfile` at the `basic` instance type with at most ten
running at once, and turns observability off. A sign-in from the page
starts a container if the visitor's is not running; a request to the
runtime plane for a container that is not running is the Worker's 503,
`unavailable`, which data-client reads as nothing saved. The container
stops ten minutes after its Durable Object is inactive, and with it the
visitor's data, key and write ids.

The image is built from the repository root, so it is main's code: on
`postgres:17-alpine` with the server image's Node, `deploy/demo/build.sh`
loads the fixture's schema and the demo's generated rows, and publishes
the four forms through the real administrator's plane under a build-only
key; `deploy/demo/start.sh` gives the demo's account a new password and
runs the server with the runtime plane alone, its lookup deadline the
default over the instance's quarter of a CPU.

Workers Builds deploys it from `main` on every push, with `pnpm build` and
`node scripts/live-demo.mjs`, which together are `pnpm live-demo:deploy`.
`scripts/live-demo.mjs` refuses a checkout with changes, a config that is
not exactly the demo's, Docker not answering, and a host page demo build
that fails the examples page's checks under the live policy,
`scripts/live-demo-headers.mjs`: the examples page's, with `'unsafe-inline'`
added to `style-src` for AG Grid's style elements and nothing else. It
deploys with `--containers-rollout=immediate`, so every running demo
restarts with a new image. `scripts/live-demo.test.mjs` holds the config,
the refusals and the headers; `pnpm test:live-demo`
(`scripts/live-demo-gate.mjs`), in the `live-demo` job, builds the image
and runs the Worker's own module in front of it over a stand-in for
Cloudflare's runtime (`scripts/live-demo-gate/cloudflare.mjs`), and walks a
visitor's journey over HTTP and in Chromium.

**What it costs.** The Workers Paid plan, and money for each container
while it runs, bounded by the cap; anybody can start one, and one visitor
can take every place. A first sign-in waits for a start, measured only
under Docker quotas on a workstation. Cloudflare runs code on formancy.ai's
zone and decrypts and holds what a visitor types. The Durable Object's
code is held by review, since `wrangler dev` runs no container here, and
what the cap answers and how long a container outlives its visitor are
read by hand after the first deploy; until the Worker is created, the
address is formancy.ai's 404. 0070 does the sums and names the rest.

## Configuration

**Every setting is read in `packages/data-server/src/main.ts`**, the
composition root, and a missing or malformed one stops the process with a
sentence naming it. The identity key's settings are parsed by
`identity-settings.ts`, which the image's key set tool,
`identity-keys-cli.ts`, shares. A secret is never a value in configuration:
it is a reference, `env:NAME` or `file:/absolute/path`, resolved by
`secrets.ts`, whose errors name the reference's form and never its value
(`secrets.test.ts`). A database password is resolved where its connection is
first opened, by the registry in `connections.ts`
([0019](../decisions/0019-a-published-form-is-checked-every-time-it-is-read.md)),
so a reference that cannot be resolved is found at that connection's first
use rather than at start, and the open is tried again on the next call. That
nothing in a package reads configuration is held by review: no test fails if
an adapter or `data-core` reads the environment.

| Setting | What it sets | Decided by | Held by |
|---|---|---|---|
| `FORMANCY_DATA_ISSUER`, `_AUDIENCE`, `_ATTRIBUTES` | what the host's tokens must say, and which claim each attribute comes from | [0014](../decisions/0014-host-identity-is-verified-offline.md) | `identity.test.ts` |
| `FORMANCY_DATA_IDENTITY_SECRET`, or `_PUBLIC_KEY_FILE`, or `_KEYS_FILE`, with `_ALGORITHM` | exactly one key source, its algorithm pinned | [0014](../decisions/0014-host-identity-is-verified-offline.md), [0059](../decisions/0059-the-host-identity-key-is-a-set-selected-by-kid-and-read-again-on-sighup.md) | `identity-settings.test.ts`, `identity-keys.test.ts`, `identity-file.test.ts`; the `container` job |
| `FORMANCY_DATA_STORE_DIR`, `FORMANCY_DATA_CONNECTIONS` | the store's directory and the allowlist; together, the runtime plane | [0013](../decisions/0013-published-configuration-is-files-with-link-based-swap.md), [0019](../decisions/0019-a-published-form-is-checked-every-time-it-is-read.md) | `config-store.test.ts`, `connections.test.ts` |
| `FORMANCY_DATA_ADMIN_ROLES` | the administrator's plane | [0020](../decisions/0020-administration-is-a-separate-plane.md) | `routes/admin.test.ts` |
| `FORMANCY_DATA_PUBLISHER_ROLES` | publication under review | [0065](../decisions/0065-with-publisher-roles-set-a-draft-is-published-only-when-a-publisher-who-did-not-submit-it-approves-it.md) | `publisher-roles.test.ts` |
| `FORMANCY_DATA_AUDIT_KEY` | a secret reference; records named in the trail by keyed hash | [0023](../decisions/0023-the-audit-trail-is-operational-not-evidence.md) | `routes/runtime.test.ts` |
| `FORMANCY_DATA_RATE_LIMIT` | requests a minute per client address | [0034](../decisions/0034-performance-is-measured-through-the-shipped-server-and-held-without-a-clock.md) | `rate-limit.test.ts`; the `container` job |
| `FORMANCY_DATA_TRUSTED_PROXIES` | whose `X-Forwarded-For` is believed | [0071](../decisions/0071-the-server-believes-the-forwarded-address-only-from-the-proxies-an-operator-names.md) | `trusted-proxies.test.ts`; the `container` job |
| `FORMANCY_DATA_CORS_ORIGINS` | the origins a page may call the runtime plane from | [0060](../decisions/0060-the-runtime-plane-answers-the-origins-an-operator-lists-and-the-administrators-plane-none.md) | `cors.test.ts`, `cross-origin.test.ts`; the `container` job |
| `FORMANCY_DATA_LOOKUP_DEADLINE_MS` | how long a lookup statement may run | [0061](../decisions/0061-a-lookup-statement-stops-when-its-request-is-abandoned-or-its-deadline-passes.md), [0063](../decisions/0063-the-default-lookup-deadline-is-outside-the-measured-product.md) | `lookup-deadline.test.ts`; the `container` job |

The files named are under `packages/data-server/src/`. Each setting's
default and spelling, `PORT`'s included, is in
[the data server's README](../../packages/data-server/README.md) and in
`main.ts`'s own comment, and not repeated here.

**Without the store and the allowlist the server verifies tokens and
nothing else**, which is how a host is wired in before any form exists. The
store and the allowlist turn the runtime plane on; administrator roles as
well, the administrator's plane; publisher roles put it under review. One of
the store and the allowlist without the other, an origin list without the
runtime plane, or publisher roles without the administrator's plane stops
the process.

**The key set is the one setting read again.**
`FORMANCY_DATA_IDENTITY_KEYS_FILE` names a JSON Web Key Set by absolute path.
On SIGHUP the server reads the same path again (`identity-file.ts`): a set
that is accepted replaces the one in force between tokens and logs the kids
added, removed and replaced; a file that cannot be read or is refused leaves
the set in force and logs so at `error`
([0059](../decisions/0059-the-host-identity-key-is-a-set-selected-by-kid-and-read-again-on-sighup.md)).
Nothing is fetched: a provider's set reaches the file through the operator's
own job, which the key set tool's `check` command lets refuse a bad file
before renaming it into place. The `container` job sends a running container
SIGHUP and checks both outcomes. Where no process can be sent SIGHUP,
natively on Windows, the set is read only at start.

**Every other setting is read once, at start**, so changing one is a
restart, and a restart forgets the write ids the process holds
([0031](../decisions/0031-an-answer-lost-after-a-write-is-unknown.md)): a
browser's resend that arrives after it is applied again. 0060 says so of the
origin list, 0071 of the trusted proxies, and 0019 of a database added to the
allowlist.

**Across origins.** The composed stack lists no origin. A host page on an
origin of its own is answered when that origin is listed exactly as a
browser sends `Origin`, and only on the runtime plane; anywhere else, a
token-bearing request a browser marks cross-site is refused before its token
is read. A refused preflight reaches the page as a network error, and only
the server's log says why
([0060](../decisions/0060-the-runtime-plane-answers-the-origins-an-operator-lists-and-the-administrators-plane-none.md)).

## What an operator needs to know

- **Run one replica.** The store's compare-and-swap is a hard link, atomic on
  a local filesystem and not to be relied on over NFS
  ([0013](../decisions/0013-published-configuration-is-files-with-link-based-swap.md));
  a write id is remembered in one process, so a resend that reaches another
  replica is applied again (0031); each process counts its own rate-limit
  buckets (0071) and reads its key set on its own signal, with nothing saying
  which keys another holds (0059).
- **Mount the store's volume** at `/var/lib/formancy-data` and name it in
  `FORMANCY_DATA_STORE_DIR`, or the published forms go with the container.
- **A published version moves between deployments as its file.** The version
  read route is the export, and `POST /v1/forms/:id/imports` writes it as a
  new version after the checks a publish makes and the drift gate a restore
  passes, against the target's own allowlist and database
  ([0062](../decisions/0062-a-published-version-moves-between-deployments-as-its-version-file.md)).
- **The audit trail is the server's log**: JSON lines on standard output, one
  `audit` line per request of either plane beside Fastify's request lines,
  which name the route matched and never the path, query or Host header as
  sent ([0023](../decisions/0023-the-audit-trail-is-operational-not-evidence.md),
  [0033](../decisions/0033-the-administrator-plane-is-audited.md)). It is
  operational, not evidence: written after the database commits, lost if the
  process dies between, editable by whoever runs the log. A deployment sends
  it to a store it keeps.
- **nginx's access log**, in the composed stack and behind Cloudflare, holds
  every visitor's address and every request line with its query: personal
  data on the operator's machine (0037).
- **An export's deadline rests on the proxy's read timeout.** A file of
  records is answered only once it is whole, so the proxy in front waits
  for its first byte as long as the file takes. `EXPORT_DEADLINE_MS`, 30 s,
  is derived from nginx's default `proxy_read_timeout`, 60 s, which
  `deploy/web/nginx.conf` does not change, less a SQL Server list statement
  in flight that runs on to mssql's 15 s; `export-limits.test.ts` fails when
  a forwarding location of that file waits less. A proxy of the operator's
  own that waits less than 45 s answers a long export with its own 504
  while the server finishes it; nothing holds that. Cloudflare waits 100 s
  by its documentation, not tried. An operator who wants no exports drops
  `POST /v1/forms/:id/records/export` at the proxy
  ([0079](../decisions/0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md)).
- **One export at a time per allowlisted connection in each replica**:
  each holds at most one of its pool's connections while a page runs,
  and up to about twice 16 MiB of memory while it is made; a file on its
  way to a slow client holds its bytes until they are sent, after the
  gate has opened for the next (0079).
- **On SIGTERM or SIGINT** the server stops taking requests, finishes those
  in flight and closes every database pool (`main.ts`). That the pools close
  is held by review; no test sends the signal and looks.
