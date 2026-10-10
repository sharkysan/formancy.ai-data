# Getting started: from an empty machine to a published form

This guide takes you from a machine with Docker and git to an order form,
generated from a sample database, published in the studio and used on a host
page, on PostgreSQL and on SQL Server. It is the operator's side of Formancy
Data, and every command in it after the clone is one CI runs: each `sh` block
as a step, in order, and the commands section 7 names in running text against
the running stack.

**How this guide is kept true.** Every command in a `sh` block below is run, in
order and as written, by `node scripts/getting-started.mjs`, in a CI job on
every pull request and before every release
([0032](./decisions/0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)).
The job then does over HTTP what sections 4 and 5 have you do in the browser,
with the values in this guide's tables, on both engines; the tables are
generated from the same file the job reads. What the job does not do is click
through the studio and the host page. Their own suites do: each goes down
section 4's or section 5's table by the names this guide gives every control,
and the studio's journey test proves it makes exactly the requests the job
makes ([0024](./decisions/0024-the-studio-speaks-only-the-admin-plane.md)).

## 0. What you need

- **Docker with Compose 2.20 or later**: Docker Desktop, or Docker Engine
  with the compose plugin. Compose 2.19.1 refuses `compose.yaml` (its web
  healthcheck's `start_interval`), and the gate passed with 2.20.3 and with
  5.5.1: measured on 2026-10-09 on Docker Engine 29.8.1, in a Docker Sandbox
  VM (Linux x86_64) on a Windows 11 workstation. The CI job runs the guide
  with 2.20.3 and with the runner's own Compose, and its summary names the
  versions each run used. No older Engine is tested.
- **A checkout other users can read**, which is what `git clone` makes under
  the usual umask, 022. The server and the minter read
  `deploy/connections.json` and `deploy/mint-token.mjs` from it as their
  image's `node` user, not as you, so on Linux a clone made under a stricter
  umask stops them; the gate refuses such a checkout before it starts
  anything.
- **git.**
- **Disk.** The four images the stack runs unpack to about 2.3 GB, SQL
  Server's 1.7 GB of it: summed from `docker history` on 2026-10-09, on the
  machine above, where `node:22.12-alpine`, which the server's image is built
  on, is counted once. Docker's containerd image store also keeps each image's
  compressed layers, which made 3.2 GB there by `docker image inspect`. The
  two builds leave about 1.5 GB of build cache, nearly all of it their two
  dependency installs (`docker buildx du`, the same day); `docker builder
  prune` frees it once the images are built, and the next build installs
  again.
- **Three free ports on 127.0.0.1**: 4394 for the studio and the host page,
  5440 for PostgreSQL and 1434 for SQL Server. If one is taken, set
  `FORMANCY_DATA_WEB_PORT`, `FORMANCY_DATA_PG_PORT` or `FORMANCY_DATA_MS_PORT`
  in a `.env` file beside `compose.yaml`; `.env.example` lists them. Nothing is
  published on any other interface.
- **Microsoft's SQL Server EULA.** Starting the stack runs SQL Server's
  Developer edition, which is not licensed for production, and accepting its
  EULA is your act; `compose.yaml` says so where it sets `ACCEPT_EULA`.

Formancy Data is source-available, not open source: evaluating it, as this
guide does, is free, and running it in production takes a paid licence. The
[licence table](../README.md#licence-in-one-table) says what is free and what
is not.

## 1. Get the code

<!-- not run by the gate: CI already has the checkout -->
```sh
git clone https://github.com/sharkysan/formancy.ai-data.git
cd formancy.ai-data
```

## 2. Start it

```sh
docker compose --profile stack up -d --build --wait --wait-timeout 900
```

This:

1. generates every password and key the stack needs into a Docker volume,
   `formancy-data-secrets`, logs their names, never their values, and hands
   each service only the ones it reads, in a volume of its own;
2. starts PostgreSQL and SQL Server;
3. loads the sample fixture into each, with each engine's own client, and
   gives the order form's own account, `formancy_writer`, a password from
   that volume -- the server connects as that account, which may do what an
   order form needs and nothing more;
4. builds the data server's image and an nginx image holding the studio and
   the host page, from this checkout, and starts them.

The command returns when everything is healthy. On 2026-10-09, on the machine
in section 0, with every base image pulled, both images already built from
this checkout and the build cache warm, the gate's first start took from
26.6 s to 39.6 s over three runs (Compose 5.5.1 twice, 2.20.3 once); with
5.5.1, its second start took 3.9 s both times, and the start after section 6's
`down`, which makes every container anew, 16.5 s and 16.7 s. A first start on
a new machine also downloads the images,
about 824 MB compressed for linux/amd64 -- SQL Server 626 MB, PostgreSQL 117
MB, Node 55 MB and nginx 26 MB, summed from the registries' manifests the same
day -- and the npm packages the builds install; the CI job's summary has the
first start's time for each of its runs.

Running it again keeps the data, the secrets and every published form: the
seeds see the fixture is there and only set the account's password again.

## 3. Get tokens

The server trusts a token signed by the host application's identity
provider. Here, a small minter in the server's image signs them with the
stack's own key. Mint three: an administrator for the studio, and a clerk in
each of the fixture's two tenants for the host page.

```sh
docker compose run --rm token --subject ada --role data-admin
```

```sh
docker compose run --rm token --subject clara --role clerk --tenant 1
```

```sh
docker compose run --rm token --subject otto --role clerk --tenant 2
```

Each prints the token, one line of three dot-separated parts starting with
`eyJ`, and a sentence saying whom it is for, such as:

```text
A token for clara with roles clerk, tenant 1, valid until 2026-10-09T18:16:46.000Z.
```

A token is valid for an hour; mint another when one expires. The studio and
the host page keep it in the page's memory only, so a reload asks for it
again.

## 4. Publish the order form in the studio

Open <http://127.0.0.1:4394/studio/> -- or the port you set in
`FORMANCY_DATA_WEB_PORT` -- paste ada's token into **Host token** and press
**Sign in**. The studio lists its steps under **Steps**, and the
table below is every control you use, by the name the studio gives it, in the
order you use them. Go down it for the PostgreSQL connection first, then again
for SQL Server's.

- **1. Connect** lists the connections the server allows. **Discover** shows
  what one connection's account can see.
- **2. Choose** takes the table the form is generated from, the form's id and
  title, the lookup, the column pinned to the signed-in person's tenant, and,
  on PostgreSQL, the column that versions a row. **Generate the form** takes
  you to **3. Generate**, which shows the form and **What the generator
  chose**.
- **4. Policy**, from the list of steps, says who may do what. When the
  policy is complete, its **Policy check** says *The policy fits this form.*
- **7. Publish** publishes it.

For the second connection, go back to **1. Connect**. Choosing a root there
replaces the form the studio holds, and its policy; the first form is
published already and stays so.

<!-- generated by scripts/getting-started/steps.mjs from scripts/getting-started/journey.json: studio; do not edit -->

| Step | Control | PostgreSQL (`pg`) | SQL Server (`ms`) |
| --- | --- | --- | --- |
| 1. Connect | **Discover**, in the group named | `pg`, then wait for **What pg can see** | `ms`, then wait for **What ms can see** |
|  | **Choose a root** | press it | the same |
| 2. Choose | **Root table or view** | `sales.order` | the same |
|  | **Form id** | `pg-order` | `ms-order` |
|  | **Title** | `Order` | the same |
|  | **Offer fk_order_customer as a lookup** | tick it; under **Columns to show for fk_order_customer** keep `name` ticked | the same |
|  | **Pin tenant_id** | tick it; **Attribute tenant_id is pinned to** says `tenant` | the same |
|  | **Version column** | `row_version` | nothing to choose: the studio says the table has a rowversion column |
|  | **Generate the form** | press it; it opens **3. Generate**, which shows **What the generator chose** | the same |
| 4. Policy | **Roles that may read** | `clerk` | the same |
|  | **Roles that may create** | `clerk` | the same |
|  | **Roles that may update** | `clerk` | the same |
|  | **Fill every field from the operations** | press it | the same |
|  | **Row filters on sales.order** | `tenant_id` = `tenant`, from the pin | the same |
|  | **Rows the Customer list may offer** | `tenant_id` = `tenant`, filled in from the pin | the same |
|  | **Policy check** | says *The policy fits this form.* | the same |
| 7. Publish | **Publish version 1** | press it; the studio says *Published version 1 of pg-order.* | press it; the studio says *Published version 1 of ms-order.* |

On both engines, **What the generator chose** says that **Amount** is read-only on update, because the order form's account may not UPDATE `amount`, so it is written on create only; and that row-level security applies to this connection on `sales.customer`, which section 5 shows.

<!-- end generated -->

## 5. Use it on the host page

Open <http://127.0.0.1:4394/host/> -- or the port you set in
`FORMANCY_DATA_WEB_PORT` -- paste clara's token into **Host token**, type the
first form id in the table below into **Form id** and press **Open the
form**. The page shows the same form twice, under React and under
Angular; use either. Press **New record**, and fill in:

<!-- generated by scripts/getting-started/steps.mjs from scripts/getting-started/journey.json: host; do not edit -->

| Field | `pg-order`, then `ms-order` |
| --- | --- |
| **Customer** | type `Muster` and choose **Muster AG** |
| **Order date** | `2026-10-01` |
| **Status** | `placed` |
| **Amount** | `5` |

Then **Save**. The form says **Created record**, and the record token after it is the order's. **Amount** now shows `5.0000`, as the database stores it. Set **Status** to `shipped` and **Save** again: the form says **Saved.**

<!-- end generated -->

Now press **Sign out**, open the same form with otto's token, paste the record
token into **Record token** and press **Load**: the page says *No such
record.*, because it is tenant 1's. The **Customer** list offers otto nothing at
all: the database's row-level security shows the order form's account tenant
1's customers only, whoever the clerk is.

Then do the same with the second form id.

## 6. Stop, and start again from nothing

```sh
docker compose --profile stack down
```

stops everything and keeps the data, the secrets and the published forms;
section 2's command starts it again as it was. The server's log goes with its
container, and with it the audit trail (section 8).

```sh
docker compose --profile stack down -v
```

deletes the volumes too: the data, the published forms and the secrets.
Every token signed with the old key stops working, and the next start
generates new secrets and loads the fixture again.

## 7. When something is wrong

- `docker compose --profile stack ps -a` says which service is not running
  or not healthy -- a seed that failed has exited, and only `-a` lists it --
  and `docker compose --profile stack logs server` (or `web`,
  `seed-postgres`, `seed-sqlserver`) says why.
- A setting the server refuses stops it with a sentence that names the
  setting.
- A seed that fails leaves nothing half-loaded: PostgreSQL's load is one
  transaction, and SQL Server's loads into a database of its own that is
  renamed only once the fixture is complete. Run section 2's command again.
- A database volume made before the secrets volume existed holds the old
  password; `docker compose --profile stack down -v` starts it afresh.
- To read a password, for a client of your own:
  `docker compose exec sqlserver cat /run/formancy-secrets/mssql-sa-password`
  (or `postgres-owner-password` on `postgres`).

## 8. What this is not

This is an evaluation stack on your own machine, not a production deployment:

- **No TLS, loopback only.** The server's connections to the databases and
  the browser's to nginx are plain, which is acceptable only because neither
  leaves the machine.
- **A minted token.** The server verifies HS256 tokens signed with a key in
  the secrets volume, and `token` signs them. A deployment verifies its
  identity provider's tokens with its public key, and nothing in it mints
  any; the [data server's README](../packages/data-server/README.md) says how
  it is configured.
- **One replica, a file store on a local volume.** A write's id is remembered
  in the server's process only, so a resend that reached another replica would
  be applied again ([0031](./decisions/0031-an-answer-lost-after-a-write-is-unknown.md)).
- **One rate-limit bucket.** Every request reaches the server from nginx, and
  the server has no setting to trust a proxy's forwarded address, so everybody
  shares one limit. The server reads how many requests a minute that limit
  allows from `FORMANCY_DATA_RATE_LIMIT` in its own environment, which in
  this stack is the `server` service's `environment` in `compose.yaml`;
  [the data server's README](../packages/data-server/README.md) has its
  default. It raises the one bucket and does not split it.
- **SQL Server's Developer edition**, which is not licensed for production.
- **Fixture data**, loaded with the databases' administrator accounts.
- **Fonts from Google.** The studio and the host page load their fonts from
  Google, so every load asks Google for them; nothing here is set up to work
  offline.
- **Secrets as plain files.** Each service reads its own from a volume that
  holds only those, so the server and the minter cannot read a database
  administrator's password, and the gate fails if they can. Anybody who can
  run `docker` on this machine can read every one, as section 7 shows.
- **Reachable past nginx, on Linux.** Nothing is published off loopback, but
  on a Linux host a local process can reach each service at its address on
  compose's network: the server directly, without nginx and its headers, and
  both databases. The gate reaches the server that way on every run.
- **The audit trail is the server's log.** The server writes an audit event
  for each runtime request to its standard output, which `docker compose
  --profile stack logs server` shows and `down` removes with the container
  ([0023](./decisions/0023-the-audit-trail-is-operational-not-evidence.md)).
  A deployment sends it to a store it keeps.
- **Nothing restarts on its own.** After a reboot, or a restart of Docker, run
  section 2's command again.
- **No Content-Security-Policy.** nginx sends no-sniff, no-referrer and
  no-framing headers, and no CSP.

What a real deployment changes:

- its identity provider's public key instead of the shared secret, and no
  minter (`FORMANCY_DATA_IDENTITY_PUBLIC_KEY_FILE`, which
  `packages/data-server/src/main.ts` documents);
- TLS at its own proxy, which takes the place of `deploy/web/nginx.conf` and
  keeps the studio, the host application and `/v1` on one origin, as 0024 and
  0029 require;
- its own database accounts, granted what each form needs, in
  `connections.json`, with TLS to the database;
- its own secret store, mounted as files the settings name with `file:`.
