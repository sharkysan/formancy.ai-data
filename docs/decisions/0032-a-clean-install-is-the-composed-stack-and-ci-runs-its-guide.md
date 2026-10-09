# 0032 — A clean install is the composed stack behind one proxy, and CI runs its guide

- **Status:** accepted
- **Date:** 2026-10-09
- **Deciders:** Daniel Bacher
- **Verified by:**
  `scripts/getting-started.mjs` (`pnpm test:getting-started`; the
  `getting-started` job in `ci.yml` on every pull request and in
  `release.yml` before `release`, each run once with the runner's Compose and
  once with Compose 2.20.3) — `docs/getting-started.md`'s own `sh` blocks,
  in order and as written, from a checkout with nothing installed, in a
  compose project and on ports of its own; then:
  compose's resolved configuration, before anything starts, publishes
  nothing off loopback and nothing of the server, holds no secret as a value
  and gives no service a restart policy (watched failing with
  `MSSQL_SA_PASSWORD: x` under `sqlserver`: "sqlserver's MSSQL_SA_PASSWORD
  holds a value of its own; a secret here is a file: reference or a _FILE
  setting, naming an absolute path"); every file of the checkout a service
  that is not root reads is
  readable by it (watched failing with `deploy/connections.json` at 0600 for
  `server`, and with `deploy/seed/sqlserver.sh` at 0640 while its seed ran as
  `mssql`);
  the tokens are only what the guide's commands printed, told apart by what
  `/v1/whoami` says of each (watched failing with clara's block deleted: "the
  guide mints no clerk token for tenant 1");
  the server and the minter can read the secrets their settings name and no
  other (watched failing, before `secrets.sh` handed each consumer its own,
  with every secret the two could read and had no use for listed by path);
  every script and stylesheet the studio and the host page name is served
  from the one origin with its type (watched failing with the web image built
  without `--base`: "/studio/ names /assets/index-B7LnlkcG.js, which answered
  404 text/html, not 200 JavaScript or CSS");
  the journey over HTTP through the web port, on PostgreSQL and then SQL
  Server, with `journey.json`'s values: a proposal as `formancy_writer` with
  `amount` written on create only, a publish (watched failing with the
  Dockerfile's `mkdir` removed: "POST /v1/forms/pg-order/versions answered
  500, not 201: EACCES ... mkdir '/var/lib/formancy-data/pg-order'"), a lookup
  of "Muster", a create, the same create sent again with its write id and
  answered with the same record (watched failing with `proxy_set_header
  formancy-write-id ""` in `nginx.conf`: "expected "k1:1", got "k1:2""), a
  read of `5.0000`, an update, the same update at the old version 409
  `stale`, and tenant 2's clerk finding neither the record nor any customer;
  section 7's commands against the running stack, with `ps` listing every
  service that ran (watched failing with `ps` where the guide now says `ps
  -a`: "does not list every service that ran: secrets, seed-postgres,
  seed-sqlserver"); on Linux, the server answering at its container address,
  which section 8 says a local process reaches;
  no secret and no token in any service's log, compose's configuration or a
  container's inspect (watched failing with `seed-postgres` echoing its
  password: "the secret pg-writer-password is in the logs of seed-postgres",
  the value itself printed nowhere; and, with PostgreSQL told by the gate to
  log every statement before the second start, against the seed as it was
  before `postgres-accounts.sql` existed: "the secret pg-writer-password is
  in the logs of postgres");
  each create's audit event in the server's log; then the guide's `down` and
  its start again, every container made anew: every token still accepted,
  both forms and both orders still there, and the audit events of before gone
  (watched failing with the store's volume left unmounted: "GET
  /v1/forms/pg-order answered 404", and with the signing key lost across the
  recreate: "the admin token is refused (401) after `down` and a start",
  every check before it passing); then the leak check again, and after `down
  -v` no volume of the project left. Once the stack has started, no
  container mounts a volume its configuration does not name, which would
  carry no project label and outlive every `down` (watched failing against
  `compose.yaml` before `secrets` and `seed-postgres` had a tmpfs over the
  postgres image's data directory: "secrets mounts a volume at
  /var/lib/postgresql/data that its configuration does not name, which the
  guide's `down` leaves behind for good", and the same of `seed-postgres`).
  Under Compose 2.19.1 it stops at
  `config`: "services.web.healthcheck Additional property start_interval is
  not allowed".
  `scripts/getting-started/steps.test.mjs` (`pnpm test:repo`, without
  Docker) — the guide's two generated tables are what `journey.json` renders
  (watched failing with `pg-order` changed to `pg-orders` in `journey.json`
  and not rendered again: the form id, the host table's header and the
  publish message in the diff); the guide's steps are one start, the three
  tokens, and a `down` that keeps the volumes before a last `down -v`, with
  only clone and cd skipped; a command holding a character sh, PowerShell and
  cmd read differently is refused, in a block or in running text (each case
  watched failing before the check existed); every name sections 4 and 5 set
  in bold or italics is one `walk.mjs` keeps, and every one it keeps is in
  them (watched failing with a name edited in the guide); section 0 names the
  Compose release CI and the release pin, and the two pins agree (watched
  failing against "Compose v2 or later"); every paragraph with an address
  names `FORMANCY_DATA_WEB_PORT` and uses compose's default port, read from
  `compose.yaml` (watched failing against sections 4 and 5 before they named
  it); the gate's copies of `EMPTY_PRESENTATION` and of the studio's "Fill
  every field from the operations" agree with the originals.
  `scripts/getting-started/stack.test.mjs` — the gate's pure checks, without
  Docker: the configuration check refuses an `env:` reference for a secret
  (watched failing while it accepted one) and a restart policy, the
  bind-mount check, the volumes a container mounts and its service does not
  name (watched failing with the check removed, and with every volume
  refused), the audit-log reader, the leak check naming a place and never a
  value, the page and stylesheet references, and the tokens'
  classification. The pure checks in `steps.mjs`, `journey.mjs` and
  `stack.mjs` were broken on purpose twenty ways, one at a time, and each
  break failed a named case.
  `scripts/mint-token.test.mjs` (`pnpm test:repo`, after `pnpm build`) — the
  minter run against the built server: the token verifies under the server's
  own `createIdentityVerifier`, with the tenant under the claim
  `FORMANCY_DATA_ATTRIBUTES` names, every role and an hour's lifetime; stdout
  is the token alone, and stderr the sentence section 3 shows; it refuses a
  short secret, a public-key identity, an unknown flag, a lifetime out of
  range, a missing subject, a tenant with no claim configured and a secret
  pasted where its reference belongs, each in a sentence that never holds the
  secret, which the cases check by wording, not exit status alone (all
  failed before the minter existed; each watched failing again with its own
  break -- the secret read raw, newline kept: `ERR_JWS_SIGNATURE_VERIFICATION_FAILED`;
  the tenant under `tid` whatever the setting; a second line on stdout; no
  length check; a public key accepted; unknown flags ignored; no range on
  `--minutes`; the reference echoed in an error; a default of 120 minutes; no
  refusal of a tenant without a claim; no `--subject` check).
  `apps/studio/src/guide.test.tsx` and `apps/host/src/guide.test.tsx` — section
  4's table row by row in the studio on both engines, and section 5 on the
  host page, PostgreSQL in React and SQL Server in Angular, with otto's "No
  such record.", by the names `walk.mjs` keeps (each watched failing with a
  control renamed in the app and in its own test, which stayed green).
  `apps/studio/src/connect.test.tsx` — no root is offered while another
  connection's discovery is out, nor after it is refused (both watched
  failing first).
  The `container` job in `ci.yml` — `/var/lib/formancy-data` is writable by
  the server's user (watched failing, run locally under a container name of
  its own, with the Dockerfile's `mkdir` removed:
  "::error::/var/lib/formancy-data is not writable by the server's user").
  `scripts/source-size.test.mjs` counts `deploy/` against the 600-line budget
  (watched failing before `deploy` was one of its roots).

## Context

Plan release gate 9 asks for clean-install documentation that works with
both database examples, and phase 5 for an operator's side of the product.
Before this record:

- `compose.yaml` started two bare databases, with SQL Server's password typed
  into a `.env` file, and nothing else;
- nothing served the studio or the host page beside the server: 0024 and 0029
  say "one reverse proxy in a deployment", and there was none;
- nothing loaded the fixture but testcontainers, and the only way to see the
  product whole was a script over testcontainers, which an operator does not
  have.

What the design rests on, read in the code: both apps call root-absolute
`/v1/...` URLs and nothing else in them is root-absolute; the server sends no
CORS headers and has no setting to trust a proxy's forwarded address; its
image runs as `node`, and no directory in it is `node`'s for the store;
`.gitattributes` makes every text file LF, so the `.sh` files survive a
Windows checkout; the restricted fixture's SQL has the reader's and writer's
passwords as constants; and the end-to-end suite already runs the whole
journey as `formancy_writer`, the order form's own account, on both engines.

**What was measured** (2026-10-09, in a Docker Sandbox VM, Linux x86_64 with
20 CPUs and 15.6 GiB, on the user's Windows 11 workstation; Docker Engine
29.8.1 with the containerd image store; Compose 5.5.1 unless a version is
named):

- **M1.** `up --wait` accepts the one-shot `secrets` and seed services that
  exit 0, and exits 1 naming the service when a seed fails. Not checked on
  Docker Desktop, nor on CI's Compose.
- **M2.** `docker compose run --rm token` turns the `tools` profile on by
  itself; without a terminal, stdout is the token alone and compose's
  progress goes to stderr.
- **M3.** Compose 2.19.1 refuses `compose.yaml`, at `config` and at a bare
  `docker compose up -d` alike: "services.web.healthcheck Additional
  property start_interval is not allowed". main's `compose.yaml` passes 2.19.1's
  `config`. Under 2.20.3 the whole guide passed the gate.
- **M4.** A new named volume mounted on a path the unchanged server image
  does not have comes up `root:root 0755`, and `node` cannot write it.
- **M5.** sqlcmd turns `QUOTED_IDENTIFIER` off unless given `-I`, and
  `sqlserver.sql`'s computed columns then refuse to be created ("CREATE
  TABLE failed because the following SET options have incorrect settings").
- **M6.** nginx builds an absolute redirect from its own port, 8080, which is
  not published; an `add_header` inside a `location` drops the server's
  headers there; and it resolves `server` once, at start.
- **M7.** The web image built with the checkout copied before the install
  reinstalled on every edit anywhere, and left another 760 MB copy of the
  dependency tree in Docker's build cache each time (`docker buildx du`); four
  such builds helped fill this machine's 9.8 GB Docker disk.
- **M8.** On Linux the server answers `/health` at its container address on
  compose's network, past nginx, though nothing publishes it.
- **M9.** With `log_statement = 'all'`, the seed's `ALTER ROLE ... PASSWORD`
  put the writer's password in `docker compose logs postgres`, as
  PostgreSQL's own documentation warns; so did a failing statement at the
  default `log_min_error_statement`, tried by hand.
- **M10.** Sizes. Unpacked, summed from `docker history`, at 18:54 UTC:
  `mssql/server:2022-latest` 1,717,919,744 bytes, `postgres:17-alpine`
  305,987,584, `formancy/data-server:compose` 252,375,040 and
  `formancy/data-web:compose` 65,941,504, of which the `nginx-unprivileged`
  base is 64,454,656 -- the studio and the host page add 1,486,848.
  `docker image inspect`'s `.Size` on this store counts the compressed layers
  too (2,343,854,438, 423,189,986, 318,836,468 and 91,889,083), so it is not
  comparable with another machine's. To download, for linux/amd64,
  compressed, summed from the registries' manifests at 17:23 UTC: SQL Server
  625,930,571 bytes, PostgreSQL 117,190,808, Node 54,905,428 and nginx
  25,542,982. The two builds' dependency installs leave 708.1 MB and
  762.5 MB in the build cache (`docker buildx du`).
  Measured on another machine, and not comparable with these: on 2026-10-09
  with `docker image inspect` on Docker Desktop for Windows (Compose
  2.39.2), the server image built from main as `formancy/data-server:local`
  was 213,024,861 bytes, SQL Server's 1.69 GB and PostgreSQL's 297 MB.
- **M11.** Times, the gate's own step table. At 18:54 UTC, with every base
  image pulled, both images current and the build cache warm: the first
  start 16.5 s, the start again 3.8 s, each token about 2 s, `down` 11.2 s,
  the start after it 16.5 s, `down -v` 11.2 s, the journey 0.3 s on
  PostgreSQL and 0.5 s on SQL Server, each leak check 5.2 s, and the whole
  gate 80.5 s. With images to rebuild from the cache, the first start took
  39.7 s at 17:32 UTC and 44.8 s at 19:07 UTC, both images each time -- the
  server's copies `scripts/`, so a change to the gate rebuilds it too -- and
  32.0 s at 19:09 UTC with only the web image's to rebuild, in a run of the
  whole gate, every check of this record included, that took 96.6 s.
  Earlier the same day, building both images with
  `--no-cache`, the base images present and npm's downloads included, took
  42.2 s, and rebuilding the web image after a source edit 18.0 s.

- **M12.** `postgres:17-alpine` declares `/var/lib/postgresql/data` a
  `VOLUME`. `secrets` and `seed-postgres`, which use the image for sh and
  psql, each got an anonymous volume per container with no project label:
  the guide's `down` kept them, `down -v` after the next start removed only
  the newest, and every run of the stack that stopped and started it left
  two empty ones on the machine -- found in pairs created the same second,
  one pair per such run from 17:04 UTC on. A `--tmpfs` over that path gives
  a container no volume there at all; with one under both services, the gate
  run at 19:09 UTC stopped and started the stack and left none.

Not measured: anything on CI's runner, where the job's summary prints the
same table with the Compose it ran; Docker Desktop on Windows or macOS;
the commands in PowerShell or cmd; the seeds' bind mounts on Docker
Desktop's file sharing.

## Decision

A clean install is `docker compose --profile stack up`: both databases with
the sample fixture loaded, the data server, and one nginx in front serving
the studio, the host page and `/v1` on one origin. `docs/getting-started.md`
walks an operator from Docker and git to a published form on both engines,
and CI runs that guide's own commands from a clean checkout, then drives
what it has the operator do over HTTP and fails if a secret or a token
reaches a log.

- **One proxy, built locally.** `deploy/web/Dockerfile` builds both apps
  from the checkout with `--base=/studio/` and `--base=/host/` as build
  flags, so neither vite config nor either browser gate changes, and serves
  them from `nginxinc/nginx-unprivileged` at an exact release, as uid 101 on
  8080. `deploy/web/nginx.conf` serves `/studio/` and `/host/` with no SPA
  fallback -- an unknown file is 404 -- and hashed assets as immutable, and
  passes `/v1/` and `/health` to the server with `proxy_next_upstream off`,
  because a write whose answer was lost is never the proxy's to send again
  (0031). Everything else is 404. It sends no-sniff, no-referrer and
  no-framing headers, the body limit is the server's `BODY_LIMIT`, and there
  is no Content-Security-Policy: React and Angular add inline styles at run
  time, and a policy no gate has seen working in a browser would be a claim
  nobody checked. The server publishes no port; the browser's way in is
  `web`. The web image is never pushed: the studio is private (0024) and the
  host page an example (0029). It carries `LICENSE.md` and `NOTICE`.
- **Secrets in a volume, generated.** A one-shot `secrets` service writes
  each password and key once into `formancy-data-secrets` -- `Fd1-` and
  random letters and digits, which meets SQL Server's policy and passes every
  shell and T-SQL literal it crosses -- keeps whatever is there, refuses an
  empty file by name, and prints names only. Each consumer is handed only the
  secrets it reads, copied into a volume of its own on every start: the
  server and the minter cannot read a database administrator's password. A
  database shares its volume with its seed. Every setting names a file:
  `file:` references and `_FILE` settings with absolute paths, and the
  allowlist `deploy/connections.json` holds references only. Neither `.env`
  nor compose's file secrets hold one.
- **Seeds through each engine's own image and client**, running the fixture
  files unchanged, byte for byte what every suite runs against (0005); only
  the principals' credentials differ. PostgreSQL's load is one transaction
  with the accounts' passwords, which are set with statement, duration,
  sampling and error-statement logging off for that transaction. SQL
  Server's loads into a database of its own, renamed only once complete,
  since CREATE DATABASE and a fixture split at GO cannot share a transaction.
  Every start gives the writer the volume's password and shuts the reader
  out. Both seeds run as root, which reads the checkout whatever its mode.
  The one-shot services that use the postgres image for its tools mount a
  tmpfs over the data directory it declares a volume, so none leaves a
  volume behind that no label ties to the project (M12).
- **The order form's own account is the connection**, `formancy_writer` on
  both engines: least privilege, with row-level security on `sales.customer`
  applying to it (0027), as the end-to-end suite already proves (0003).
- **A token minter inside the server's image**, `deploy/mint-token.mjs`, run
  as `docker compose run --rm token`, with the server's identity settings
  from one YAML anchor. It reads the key with the server's own
  `resolveSecret` and checks it with the server's own
  `createIdentityVerifier`, so a trailing newline and the shortest key are
  each decided once. HS256 only, an hour by default and twelve at most;
  stdout is the token and nothing else.
- **The image owns its store directory.** The server's Dockerfile makes
  `/var/lib/formancy-data` and gives it to `node` before `USER node`, because
  Docker gives a new named volume the owner of the directory it is mounted on
  (M4). No `VOLUME` instruction.
- **The guide is run, and its values generated.** Its `sh` blocks are the
  gate's steps; a command in one, or in section 7's running text, may hold
  only letters, digits, spaces and `- _ . / : =`, which sh, PowerShell and
  cmd read alike. Its two tables are written by `steps.mjs` from
  `journey.json`, which the gate's journey sends, and the names of the
  studio's and the host page's controls from `walk.mjs`, which both apps'
  guide tests drive them by. The gate runs on Node's built-ins and Docker
  alone.
- **Compose 2.20 or later**, because the web front's health check uses
  `start_interval` to look every two seconds while starting and every thirty
  after (M3). CI runs the gate with that oldest release as well as the
  runner's.
- **Nothing restarts on its own**, and the gate refuses a restart policy:
  an evaluation stack that came back after every reboot would keep SQL
  Server running and the ports held on a machine whose operator may have
  finished with it. Starting it again is the operator's act, as starting it
  was.

Found on the way and fixed: the studio offered **Choose a root** for the
connection discovered before while another's discovery was still out, so
Choose opened on the old connection and switched under the operator when the
new one answered; a discovery on its way now clears the one before it.

## Consequences

**What it buys.** An operator with Docker and git gets from an empty machine
to a published form on both engines with one command and a guide that is run
on every pull request, and before every release, as written. The studio and
the host page are served the way 0024 and 0029 assumed, by a proxy whose
configuration a deployment can read and copy. A secret or a token that
reaches a log, the configuration or a container's inspect fails a job, and so
does a guide whose command, value or control name stopped being true.

**What it costs.**

- **Two images, a proxy configuration and the scripts under `deploy/` to keep
  true**, and a gate of its own: `scripts/getting-started.mjs`, its helpers
  under `scripts/getting-started/`, their tests, and a guide test in each
  app.
- **Disk.** About 2.3 GB of images unpacked, SQL Server's 1.7 GB of it, and
  about 1.5 GB of build cache from the two dependency installs (M10). A first
  start on a new machine downloads about 824 MB of images, compressed, and
  the npm packages both builds install.
- **Time.** On the machine above, 16.5 s for a start with the images current,
  and from 32.0 s to 44.8 s with one or both to rebuild from the cache (M11).
  On CI's runner, not
  measured yet: the job's summary prints the first start's time and the
  image sizes for each of its runs, and the first green run's table is the
  number to quote here, with its run id. A job on every pull request and
  before every release, run with the runner's Compose and again with 2.20.3,
  each on a runner of its own for up to 35 minutes.
- **A developer's `docker compose up -d` changed.** Its passwords come from
  the volume rather than `.env`, read with `docker compose exec`; a database
  volume made before holds the old password and needs `docker compose down
  -v`; and it now needs Compose 2.20 or later, where main's file ran on
  2.19.1 (M3).
- **The guide's clicks are held by the apps' suites, not by the stack.** The
  gate does over HTTP what sections 4 and 5 have the operator do, and the
  studio's and the host page's guide tests do every row by its control's
  name against the real server in jsdom; nothing clicks through the composed
  stack in a browser, and the host page's test cannot show the composed
  stack's row-level security, which the gate shows over HTTP.
- **Shell neutrality is a character rule, not a run.** The commands run
  through sh, on Linux, and nowhere else. Docker Desktop, Windows and macOS
  are not run by any gate, and neither are the seeds' bind mounts there.
- **Not a production deployment**, and the guide's section 8 says so: no TLS
  and loopback only; HS256 with a minted token where a deployment verifies
  its identity provider's tokens with a public key; one replica, a file store
  on a local volume and write ids remembered in one process (0031); one
  rate-limit bucket for everybody behind the proxy, since the server has no
  trust-proxy setting; SQL Server's Developer edition; fixture data, loaded
  with the databases' administrator accounts by seeds that run as root;
  fonts from Google; no Content-Security-Policy; secrets as plain files that
  anybody who can run `docker` on the machine can read; every service
  reachable at its container address by a local process on a Linux host,
  the server past nginx and its headers; the audit trail in the server's
  log, removed with its container by `down` (0023); nothing restarted after
  a reboot.
- **`down -v` destroys the secrets too**, and with them every token signed
  by the old key.
- **Found and left as it is: the server's 500 for a store it cannot write
  names the path**, an `EACCES` and the directory, as the run with the
  `mkdir` removed showed. The image now owns the directory, so the stack does
  not reach it, and `packages/data-server/src` is unchanged here.

**What it forecloses.** Nothing published. The web image is never pushed,
the studio stays private, and the server, its package and its released image
are unchanged but for the store's directory. That no workflow pushes the web
image is held by review: nothing fails if one did.

## Alternatives considered

- **The server serves the apps' directories**
  (`FORMANCY_DATA_STUDIO_DIR`, `_HOST_DIR`). Rejected: a dependency and a
  route surface added to a published package for a demo; either the released
  image carries the private studio, against 0024, or the operator mounts
  builds they cannot make without pnpm; the host page is an example, not
  product; and a static route's failing closed becomes the server's problem.
- **Caddy.** A shorter configuration, but it turns on automatic HTTPS unless
  told not to; nginx's states everything, and every operator reads it.
- **Separate origins with CORS, or the studio and the host page on two
  ports.** Two origins; rejected by 0024 and 0029.
- **`vite preview` in a container.** A development server on the deploy
  path, with the whole workspace in the image.
- **Secrets in `.env` or compose's file secrets.** An interpolated value
  shows in `docker compose config` and `docker inspect`; a host file must be
  readable by the container users that read secrets -- node 1000, postgres
  70, mssql 10001 -- which no host account matches, so on Linux it is either
  readable by everybody or root's, and the operator cannot delete it.
- **One secrets volume mounted with a subpath per service.** Needs Docker
  Engine 26 or later, which the guide would then require; copying each
  consumer's files into a volume of its own needs nothing new.
- **`env:` references accepted for a secret.** An `env:` reference is only as
  safe as the variable it names, which can hold the key itself under a name
  nothing reads as a secret's, and shows in `docker inspect`.
- **PostgreSQL's initdb scripts.** They run only on an empty volume, have no
  counterpart on SQL Server, and could never give the writer a new password.
- **A Node seed image with `@formancy/data-fixtures`.** Testcontainers'
  loading code in an image, and fixture code shipped.
- **Connecting as the owner.** A superuser bypasses row-level security, so
  the demo would show what production must not do.
- **The seeds as each image's own user.** Reading the checkout through a bind
  mount then needs it readable by others, which a clone under a strict umask
  is not; root reads it whatever its mode. The server and the minter still
  read two files from the checkout as `node`, which the gate checks before
  starting anything.
- **Dropping `start_interval`**, so older Compose reads the file. The web
  front would be checked every thirty seconds from the start, and what the
  oldest working Compose then is was not measured.
- **`restart: unless-stopped`.** Rejected for the reason under Decision; the
  guide says to run the start again after a reboot.
- **Prose with a separately written gate.** Drifts silently: the commands,
  the values and the control names are each held to one source instead.
- **Driving the studio in Chromium in this job.** Needs pnpm and a browser,
  so the clean checkout is lost, and repeats 0024's gate.
- **Classifying tokens by decoding them.** The gate asks `/v1/whoami`, so a
  token is what the stack it was minted for says it is.

## Older records

Extended, not edited away: 0024's and 0029's "one reverse proxy in a
deployment", which `deploy/web/nginx.conf` now is in the composed stack,
with `proxy_next_upstream off` for 0031's rule that nothing here sends a write
twice. Applied and unchanged: 0023's audit trail, whose default sink is the
server's log, which the composed stack keeps only as long as the server's
container; 0013's store, now on a named volume the image's own directory
makes the server's.
