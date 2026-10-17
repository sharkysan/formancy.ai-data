# Formancy Data behind Cloudflare

This guide puts the composed stack of
[getting-started](../getting-started.md) behind Cloudflare: a Cloudflare
Tunnel from your machine, with no inbound port, Cloudflare Access in front of
the studio's hostname, and, when a host application goes live, a second
hostname on which nothing but the runtime plane's routes reaches the data
server, and no file is served.

The plain answer first. **Cloudflare can be this product's front door, but it
cannot run it.** The data server, its file store and the databases stay on a
Linux machine you control, unchanged from the composed stack; Cloudflare
terminates TLS, carries the tunnel and asks Access who may reach the studio.
Section 0 says why Workers, Hyperdrive, Containers and Pages do not run the
product as built, and what Cloudflare sees on the way through
([0037](../decisions/0037-cloudflare-is-the-edge-not-the-runtime.md)).

**How this guide is kept true.** Nothing here has been run through a real
tunnel: no Cloudflare account was available, and section 10 lists what that
leaves unmeasured and how you can measure it. What is checked, and where:

- **In CI, on every pull request**, the job `cloudflare` (`pnpm
  test:cloudflare`), with Compose 2.20.3 and the runner's own:
  - the routes and the runtime door's path pattern are generated from the
    built server's router, and `pnpm test:repo` fails when
    `deploy/cloudflare/doors.json` or a generated block below is not what
    the server registers;
  - the tunnel's configuration, written by the real configure step in the
    tools image, is read by the pinned cloudflared: valid, and every probe
    matched to the rule it must match;
  - a corpus of paths cloudflared reads differently from the server's
    router or from nginx -- built from every administrator route's
    parameters and from every location of `deploy/web/nginx.conf` that
    serves files, with the paths measured -- goes through cloudflared and,
    where cloudflared forwards it, to the built server, which must refuse it
    before any route's work, and again through the server nginx.conf keeps
    for the runtime door, in the web front's own nginx, which must end it at
    the server's refusal or its own 404, never at a file; a path outside
    the corpus is covered by the same refusal and the same 404, and nothing
    tries it;
  - the overlay changes no service of `compose.yaml`, pins cloudflared by
    tag and digest, gives it no token and the flags section 4 names, keeps
    it on a network with the web front alone, and the cloudflared it runs
    reads the files configure writes;
  - every command in a `sh` block below names both Compose files and only
    services and profiles they have;
  - what `@formancy/data-client` makes of Cloudflare's own error answers, of
    an Access redirect and of nginx's 504 (`scripts/cloudflare/answers.test.mjs`);
  - and, in the `container` job and the getting-started gate, that the
    server's image and the composed stack's nginx give a proxy the two
    answers it relies on, on the answers they sample -- `/health`, a
    refusal and a published form: `Cache-Control: no-store`, and 400
    `path-not-plain` for `/v1/forms/a/versions/..%2F..%2Fb` sent as
    written. The data server's own suite holds `no-store` on every answer
    its hooks run for; the router's own 400 and 414, what Node's parser
    refuses, and nginx's own error pages carry none, and none of those holds
    a form or a record.
- **On your machine**, before the tunnel runs: setup and `tunnel-config`
  check your own configuration file with the same cloudflared binary that
  runs it, and replace the one in use only when it passes.
- **Nothing checks your account**: the Access application and its policy,
  who holds Cloudflare Tunnel edit permission, the zone's settings in
  section 5, that the tunnel has no private network route after setup
  looked once, and that you revoked the login's token.
- **`doors-check`** (section 7) checks what it can observe of that from
  outside, against your live hostnames.

Every `sh` block is one command that names both Compose files, made of
characters sh, PowerShell and cmd read alike, with example values --
`formancy.example.com`, `example-team`, an example AUD tag -- that you
replace with your own.

## 0. What Cloudflare does here, and what it cannot

```text
 browser --TLS, Cloudflare's certificate--> Cloudflare's edge
                                              | Access on formancy.<zone>: the people your policy names
                                              | WAF; no challenge on /v1/; optional rate-limiting rule (429)
                                              v
                                tunnel: outbound from your machine, port 7844, no inbound port
+------------------------------------ your machine: Docker ---------------------------------------+
| cloudflared, on the network `edge` with the web front alone, at a fixed address                 |
|   (configuration generated from the server's routes, checked before it runs)                    |
|   formancy.<zone>              -> web:8080, everything; refused without a valid Access token    |
|   <app host> + runtime pattern -> web:8081; any other path: 404, or the host application's own  |
| web (nginx), on `edge`, and on `proxy` at a fixed address:                                      |
|   8080: /studio/ and /host/ files; /v1/ and /health --plain HTTP--> server:4390                 |
|   8081: no file; /v1/forms and /v1/forms/ --plain HTTP--> server:4390; anything else 404        |
| server, on compose's network and `proxy`: refuses a path a proxy could read differently;        |
|   verifies the host token; roles pick the plane; no-store on its answers; a rate-limit bucket   |
|   per visitor's address, believed from cloudflared and nginx alone; store on a volume; its log  |
|   is the audit                                                                                  |
|   --TLS to your databases (plain only for the composed stack's own)--> PostgreSQL, SQL Server   |
+-------------------------------------------------------------------------------------------------+
```

| Part | Where it runs |
| --- | --- |
| TLS for the browser, the tunnel's far end, Access, the WAF, the optional rate-limiting rule | Cloudflare |
| cloudflared, nginx with the studio and the host page, the data server, its file store, the audit trail (its log) | your machine, in Docker |
| PostgreSQL and SQL Server | your machine, or wherever your databases are, reached from it and not through Cloudflare -- as long as the tunnel has no private network route (section 5) |

What runs nowhere else, and why:

- **Workers do not run it as built.** A Worker cannot share a socket across
  requests, and the server keeps a pool per connection; it has no lasting
  file system, and the published forms are files
  ([0013](../decisions/0013-published-configuration-is-files-with-link-based-swap.md));
  many isolates are no single process to remember a write's id
  ([0031](../decisions/0031-an-answer-lost-after-a-write-is-unknown.md)); and
  neither SQL Server's driver nor Fastify has been run on Workers. That
  would be a port, not a deployment.
- **No Cloudflare runtime connects to SQL Server.** Hyperdrive, which pools
  database connections for Workers, does not support it, and its query
  cache is on by default and not invalidated by a write *[survey, not
  re-read]*. SQL Server works here because the server runs on your machine.
- **Containers lose the store**: their disk does not outlive the container,
  the write ids go with a sleep or a rollout, and they need a Worker in
  front, which is code this repository does not have *[survey, not
  re-read]*.
- **Pages, for the apps**, would put the studio and the host page on another
  origin than `/v1/`, which the studio and data-client do not allow
  ([0024](../decisions/0024-the-studio-speaks-only-the-admin-plane.md),
  [0029](../decisions/0029-a-host-renders-a-published-form-through-one-client.md)).
- **The store, the audit trail and the databases stay on your machine.**
  Cloudflare holds no copy of any of them.

**What Cloudflare sees, and who can read it.** Cloudflare decrypts every
request and answer at its edge: the host tokens in `Authorization`, the
values in every record, every published form. Its cache can hold copies of
the studio's and the host page's hashed bundles, which nginx marks `public,
immutable` and Cloudflare caches by their extension. And **anybody with Cloudflare Tunnel edit permission in your
account can stream the tunnel's log at debug level** with `cloudflared tail`
or the dashboard, which Cloudflare documents as every request's headers --
every host token. No setting of cloudflared stops that stream. So Tunnel
edit permission is as sensitive as reading host tokens. If your data may not
be decrypted at Cloudflare, Cloudflare is not this deployment's edge.

**Who reaches what.**

- Through a public hostname, the studio and the administrator's plane are
  on `formancy.<zone>` only, and only for the people your Access policy
  names. The server then still requires a host token with an
  administrator's role
  ([0020](../decisions/0020-administration-is-a-separate-plane.md)): Access
  with a clerk's token is refused. A private network route to the tunnel
  would be a way round Access (below and section 5).
- **An administrator's token without Access reaches no administrator
  route's work, and no file.** On the runtime door, a plain path to an
  administrator's route ends at cloudflared's catch-all, 404 -- or, in
  shape (a) of section 8, at the host application's own service, which then
  receives the request's headers, the token among them. What cloudflared
  forwards there goes to the web front's server for that door, 8081, which
  serves no file and passes only `/v1/forms` and what is below it to the
  server. A path
  cloudflared reads as a runtime route and nginx or the router reads
  otherwise -- cloudflared decodes `%2F` and `%5C`, counts a backslash as a
  slash and resolves `..` before it matches; nginx keeps a backslash; the
  router does none of it -- is nginx's 404 there, or the server's 400
  `path-not-plain` before the token is read, one audit event with status
  400 when it names a route.
- On the machine itself, nothing changes: the web front on loopback, port
  4394, without Access, and on Linux the containers' addresses, as
  getting-started's section 8 says.
- Access and the host token are independent. Access says whether a person
  may reach the door; the host token, verified offline with a pinned key
  ([0014](../decisions/0014-host-identity-is-verified-offline.md)), says who
  they are and with what roles. The server never reads Access's
  `Cf-Access-Jwt-Assertion` header or its `CF_Authorization` cookie, and its
  log writes no header.
- Anybody who can edit your Zero Trust organisation, the zone's DNS or the
  tunnel can change the doors. Nothing here reads your account. cloudflared
  joins compose.yaml's network `edge`, on which the web front is the only
  other container of the stack -- and your host application in shape (a) of
  section 8 -- so a changed door reaches the web front -- both its
  ports, 8080 without Access -- and not the server past nginx or the
  composed stack's databases. It still reaches what any container on
  Docker's bridge reaches: your machine's own addresses and whatever your
  machine routes to.
- **A private network route to the tunnel is a door too.** cloudflared
  proxies the traffic of enrolled Cloudflare One (WARP) devices whenever the
  account routes a private network to the tunnel, and no setting of
  cloudflared turns that off (cloudflared's `CHANGES.md`, 2023.9.0: for a
  locally-managed tunnel, "guarantee that tunnel has no Private Routes").
  Such a route would reach what cloudflared reaches, above, without
  Access, and since the server believes the visitor's address cloudflared
  passes on (below), such a device could name an address of its own choice
  in `X-Forwarded-For` and so choose its own rate-limit bucket and the
  address the log gives it. Setup looks for one once, while its login
  lasts, and stops if it finds one; nothing looks again.

**Whose address the server counts.** cloudflared passes on the
`X-Forwarded-For` Cloudflare's edge sends, which ends with the address that
connected to Cloudflare: Cloudflare appends it to whatever the visitor sent
(Cloudflare's `fundamentals/reference/http-headers`, read 2026-10-16), and
cloudflared 2026.10.0 adds only `X-Forwarded-Host`, and that only with
`httpHostHeader`, which this configuration does not use
(`ingress/origin_proxy.go` at that tag; a search of its repository for
"Forwarded" found no other place that sets one, the same day). nginx appends
cloudflared's own address, and the server believes both proxies, because
compose.yaml's `FORMANCY_DATA_TRUSTED_PROXIES` names the web front's address
on `proxy` and the one the overlay gives cloudflared on `edge`
([0071](../decisions/0071-the-server-believes-the-forwarded-address-only-from-the-proxies-an-operator-names.md)). So
the rate limit counts each visitor's address on its own, and the server's
log names it. That Cloudflare's edge sends the header as documented was not
measured: nothing here has an account.

Formancy Data is source-available: its
[licence](../../LICENSE.md) makes evaluation free and production use paid.

<!-- generated by scripts/licence-status.mjs from LICENSE.md; do not edit -->

[`LICENSE.md`](../../LICENSE.md) has the terms. It is Version 1.1, in force from 11 October 2026, and says at the top that no lawyer has reviewed it. A production licence is requested from [info@formancy.ai](mailto:info@formancy.ai), as its section 9 says.

<!-- end generated -->

Nothing is released, so every image here is built from your checkout, and
SQL Server's Developer edition, which the composed stack runs, is not
licensed for production.

## 1. What you need

- **The machine getting-started's section 0 describes**: Linux x86_64, Docker
  Engine with Compose 2.20 or later, a checkout other users can read, and
  its disk, and about 157 MB more of it for this guide's two images:
  cloudflared's, 97,568,695 bytes, and the tools image, Node's image with
  cloudflared's binary copied in, 282,731,700 bytes, of which 223.3 MB is
  the Node image the data server is built on already (`docker image
  inspect` and `docker system df -v`, on Docker Engine 29.8.1 with the
  containerd image store, Linux x86_64, 2026-10-11). Another image store
  counts otherwise.
- **Outbound connections** to Cloudflare on TCP 443 and on TCP and UDP 7844,
  which the tunnel uses *[survey, not re-read]*. No inbound port.
- **A Cloudflare account with your zone active**, its DNS on Cloudflare.
  The hostnames here are first-level, `formancy.<zone>`, which the zone's
  free certificate covers *[survey, not re-read]*.
- **A Zero Trust organisation.** Its plans and seat limits are on
  [Cloudflare's pricing page](https://www.cloudflare.com/plans/zero-trust-services/),
  which could not be read when this guide was written, so it states none.
- **Permission to create an Access application and to log cloudflared in**
  to the account.

## 2. Open Access first

Create the Access application before the tunnel: setup needs its AUD tag,
and the administrator's door refuses every request without a valid Access
token for exactly that application.

1. In the Cloudflare dashboard: **Zero Trust → Access controls →
   Applications → Create new application → Self-hosted and private → Add
   public hostname**. Click paths are Cloudflare's and can move; these are
   its documentation's at cloudflare-docs `0d35c2c`
   (`partials/cloudflare-one/access/self-hosted-app/generic-public-app.mdx`).
2. Hostname `formancy.<zone>`, with no path, so the whole hostname is
   covered: the studio, the host page, both planes and `/health`.
3. A policy with **Action: Allow** and **Include**: the emails of the
   people who administer forms, or a group from your identity provider.
4. A login method: your organisation's identity provider, or one-time PIN.
5. The session lasts 24 hours by default; section 6 says what a lapsed one
   looks like. Set no CORS settings: everything is one origin.
6. Leave **Managed OAuth** off, as it is unless enabled: it replaces
   the 401 answer of the application behind Access, and the data server
   sends its own, with `WWW-Authenticate: Bearer`
   (`docs/cloudflare-one/access-controls/applications/http-apps/managed-oauth.mdx`).
7. Copy the application's **AUD tag** -- **Configure → Additional settings →
   Application Audience (AUD) Tag**
   (`…/authorization-cookie/validating-json.mdx`) -- and your **team
   name**, under **Settings → Team name and domain → Team name**
   (`partials/cloudflare-one/find-team-name.mdx`), as in
   `<team>.cloudflareaccess.com`.

The AUD tag "will never change unless you delete or recreate the Access
application" (`validating-json.mdx`): an application deleted and created
again has a new one, and the tunnel's configuration keeps the old one until
you run `tunnel-config` with the new tag and start cloudflared again
(section 8): until then, by the check below, the administrator's door
refuses everybody.
Cloudflare documents that with Access required in the tunnel's
configuration, cloudflared validates the Access token before it forwards a
request; that it refuses one without a valid token for that AUD tag, so
that deleting the application closes the door rather than opening it,
follows from that and has not been observed. Section 10 says how to observe
it.

## 3. Create the tunnel and its door

```sh
docker compose -f compose.yaml -f deploy/cloudflare/compose.yaml run --rm --build tunnel-setup --admin formancy.example.com --team example-team --aud 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

With your hostname, team name and AUD tag. Setup checks every input first
and does nothing when one is wrong: a hostname in lower case, without a
scheme or a path; a team name of lower-case letters, digits and hyphens; an
AUD tag of 64 lower-case hexadecimal characters. Then:

1. **It logs cloudflared in.** cloudflared prints a URL: open it in any
   browser, sign in to Cloudflare and choose the zone -- the one that holds
   every hostname you give setup, since it routes them all in that zone.
   The login leaves a `cert.pem` that can create, delete and manage **every
   tunnel of the account**, valid until its token is revoked. When
   cloudflared fetches it, it lands in a tmpfs and goes with the tools'
   container. When cloudflared cannot fetch it, it says your browser will
   download it instead (its `login.go`), and setup stops: that file is the
   same account-wide login, in your downloads, and setup cannot use it, so
   delete it, revoke its token as below, and run setup again. Only the
   start of the login has been seen (0037); whether the browser then
   downloads the file has not.
2. **It creates the tunnel `formancy-data`**, unless the `formancy-data-tunnel`
   volume already holds its credentials. If a tunnel of that name exists in
   the account without its credentials here, setup stops and says so:
   delete it under **Networking → Tunnels** and run setup again.
3. **It looks for private network routes to the tunnel**, while the login
   lasts, with `cloudflared tunnel route ip show`: one would let enrolled
   devices reach what cloudflared reaches, without Access (section 0), and
   setup stops, naming it, until you delete it under **Networking →
   Routes**. When cloudflared cannot list them, setup says so and goes on.
   The shape of that list is read from cloudflared's source, not seen from
   an account; and a route added later, or a private hostname route, which
   this command does not list, is checked by nothing.
4. **It routes the hostname in DNS**, a CNAME to the tunnel, for each
   hostname the volume's configuration does not route yet. It never
   overwrites a record: an existing one stops setup with cloudflared's
   message, and you delete it or choose another name.
5. **It writes the configuration and checks it** with the cloudflared binary
   of the image that runs the tunnel, with no further call to Cloudflare:
   `ingress validate` must say it is valid, and every probe -- each route's
   sample on each door, the pages, a trailing slash, a query string, a
   hostname the tunnel does not serve -- must match the rule
   `deploy/cloudflare/doors.json` says. Only then does it replace the
   configuration in use. The tunnel's credentials and its configuration are
   made cloudflared's (user 65532), readable by it alone. Setup and
   `tunnel-config` remember no earlier argument, so they refuse, before
   anything else, arguments that would close a door the configuration in
   use opens, unless `--drop` names its hostname.
6. **It prints** the tunnel's id, the hostnames it routed, and the step it
   cannot take for you.

**Then revoke the login.** In the Cloudflare dashboard: **My Profile → API
Tokens → "Cloudflare Tunnel API Token"** (or "Argo Tunnel API Token") **→
Delete**. A running tunnel needs only its credentials. Nothing checks that
you did this, and each run of setup makes another such token.

The configuration it writes, for the example names, with a host
application's hostname as section 8 adds it, and a tunnel id of zeros:

<!-- generated by scripts/cloudflare/doors.mjs from deploy/cloudflare/doors.json: config; do not edit -->

```text
# generated by deploy/cloudflare/configure.mjs from deploy/cloudflare/doors.json; do not edit
tunnel: 00000000-0000-0000-0000-000000000000
credentials-file: /etc/formancy-cloudflare/credentials.json
ingress:
  - hostname: formancy.example.com
    service: http://web:8080
    originRequest:
      access:
        required: true
        teamName: 'example-team'
        audTag:
          - '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  - hostname: app.example.com
    path: '^(?:/v1/forms|/v1/forms/[^/]+|/v1/forms/[^/]+/lookups/[^/]+/query|/v1/forms/[^/]+/lookups/[^/]+/resolve|/v1/forms/[^/]+/records/create|/v1/forms/[^/]+/records/delete|/v1/forms/[^/]+/records/export|/v1/forms/[^/]+/records/list|/v1/forms/[^/]+/records/read|/v1/forms/[^/]+/records/update)$'
    service: http://web:8081
  - service: http_status:404
```

<!-- end generated -->

Every route the server registers, and what each door does with it. The
draft routes are registered only when the server reviews publication
([0065](../decisions/0065-with-publisher-roles-set-a-draft-is-published-only-when-a-publisher-who-did-not-submit-it-approves-it.md)),
which the composed stack does not; the doors are generated from a server
that does, so they hold either way:

<!-- generated by scripts/cloudflare/doors.mjs from deploy/cloudflare/doors.json: doors; do not edit -->

| Method | Path | Plane | Administrator’s door | Runtime door |
| --- | --- | --- | --- | --- |
| `GET` | `/health` | shared | behind Access | not forwarded |
| `GET` | `/v1/administration` | administrator | behind Access | not forwarded |
| `GET` | `/v1/connections` | administrator | behind Access | not forwarded |
| `GET` | `/v1/connections/:id/metadata` | administrator | behind Access | not forwarded |
| `POST` | `/v1/connections/:id/test` | administrator | behind Access | not forwarded |
| `GET` | `/v1/drafts` | administrator | behind Access | not forwarded |
| `POST` | `/v1/form-proposals` | administrator | behind Access | not forwarded |
| `GET` | `/v1/forms` | runtime | behind Access | forwarded |
| `GET` | `/v1/forms/:id` | runtime | behind Access | forwarded |
| `POST` | `/v1/forms/:id/drafts` | administrator | behind Access | not forwarded |
| `GET` | `/v1/forms/:id/drafts/:draft` | administrator | behind Access | not forwarded |
| `POST` | `/v1/forms/:id/drafts/:draft/approval` | administrator | behind Access | not forwarded |
| `POST` | `/v1/forms/:id/drafts/:draft/rejection` | administrator | behind Access | not forwarded |
| `POST` | `/v1/forms/:id/drift` | administrator | behind Access | not forwarded |
| `POST` | `/v1/forms/:id/imports` | administrator | behind Access | not forwarded |
| `POST` | `/v1/forms/:id/lookups/:source/query` | runtime | behind Access | forwarded |
| `POST` | `/v1/forms/:id/lookups/:source/resolve` | runtime | behind Access | forwarded |
| `POST` | `/v1/forms/:id/records/create` | runtime | behind Access | forwarded |
| `POST` | `/v1/forms/:id/records/delete` | runtime | behind Access | forwarded |
| `POST` | `/v1/forms/:id/records/export` | runtime | behind Access | forwarded |
| `POST` | `/v1/forms/:id/records/list` | runtime | behind Access | forwarded |
| `POST` | `/v1/forms/:id/records/read` | runtime | behind Access | forwarded |
| `POST` | `/v1/forms/:id/records/update` | runtime | behind Access | forwarded |
| `POST` | `/v1/forms/:id/regenerations` | administrator | behind Access | not forwarded |
| `POST` | `/v1/forms/:id/restorations` | administrator | behind Access | not forwarded |
| `GET` | `/v1/forms/:id/versions` | administrator | behind Access | not forwarded |
| `POST` | `/v1/forms/:id/versions` | administrator | behind Access | not forwarded |
| `GET` | `/v1/forms/:id/versions/:version` | administrator | behind Access | not forwarded |
| `GET` | `/v1/forms/:id/versions/latest` | administrator | behind Access | not forwarded |
| `GET` | `/v1/whoami` | shared | behind Access | not forwarded |

The runtime door forwards a path only when it matches this pattern, which setup writes into the tunnel’s configuration and checks against cloudflared:

```text
^(?:/v1/forms|/v1/forms/[^/]+|/v1/forms/[^/]+/lookups/[^/]+/query|/v1/forms/[^/]+/lookups/[^/]+/resolve|/v1/forms/[^/]+/records/create|/v1/forms/[^/]+/records/delete|/v1/forms/[^/]+/records/export|/v1/forms/[^/]+/records/list|/v1/forms/[^/]+/records/read|/v1/forms/[^/]+/records/update)$
```

<!-- end generated -->

Both doors go through nginx, never straight to the server: its body limit,
its headers, and its rule that a lost answer is never sent again
([0031](../decisions/0031-an-answer-lost-after-a-write-is-unknown.md)) stay
in the path. The administrator's door goes to the web front's origin,
8080; the runtime door to the server `deploy/web/nginx.conf` keeps for it,
8081, which serves no file and passes only `/v1/forms` -- the menu of
forms ([0045](../decisions/0045-the-runtime-plane-lists-the-forms-a-person-may-read-and-nothing-about-the-others.md)),
which nginx would otherwise answer itself with a redirect to
`/v1/forms/` -- and what is below `/v1/forms/`, where every other runtime
route is. On 8080 a path cloudflared reads as a runtime route could
be the studio's page to nginx: cloudflared counts a backslash as a slash
and nginx does not, so `/studio/..%5Cv1%5Cforms%5CZ/%2E%2E/index.html` is
`/v1/forms/index.html` to one and `/studio/index.html` to the other
(measured 2026-10-11, and repeated by the CI job). The planes share the
prefix `/v1/forms/:id` and cloudflared chooses a rule by hostname and path,
never by method, so no prefix could separate them; the pattern is
generated from the router instead.

## 4. Start it

```sh
docker compose -f compose.yaml -f deploy/cloudflare/compose.yaml --profile stack --profile cloudflare up -d --build --wait --wait-timeout 900
```

This is getting-started's section 2 with the tunnel added: `cloudflared`
starts once the web front is healthy, and its health check asks
cloudflared's `/ready`, which answers only once the tunnel holds a
connection to Cloudflare's edge, so `--wait` should fail naming it when the
tunnel cannot connect; neither has been seen with a real tunnel. Its health
check's timings are the web front's, copied: how long a tunnel takes to
connect has not been measured.
`docker compose -f compose.yaml -f deploy/cloudflare/compose.yaml --profile stack --profile cloudflare logs cloudflared`
shows what it says. It runs with these flags, each for its reason:

- `--loglevel info`: at debug, cloudflared writes every request header to
  its log, host tokens included;
- `--metrics 127.0.0.1:20241`: by default its metrics listen on every
  interface, here the network it shares with the web front;
- `--management-diagnostics=false`: by default it serves pprof and metrics
  over Cloudflare's management service;
- `--no-autoupdate`, from its image: the binary that runs is the one that
  checked the configuration.

It joins compose.yaml's network `edge` and no other, beside the web front
alone (section 0).

**Every command for this stack names both files**, and a third, yours, in
shape (a) of section 8. One naming
`compose.yaml` alone changes no service, because the overlay only adds
services; but it sees `cloudflared` as an orphan, and its `down` leaves
`cloudflared` running. Nothing restarts on its own after a reboot
([0032](../decisions/0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)):
run this section's command again.

## 5. The zone's settings

None of these is checked by anything here, except what `doors-check`
observes (section 7). Each is a setting in your account, and Cloudflare can
rename or move it.

- **SSL/TLS.** Any encryption mode but Off *[survey, not re-read]*.
  **Always Use HTTPS** on, which
  `doors-check` observes. Minimum TLS version 1.2. **HSTS** is
  Cloudflare's recommendation and your zone's call: with
  includeSubDomains it binds every subdomain of the zone.
- **Bots and security.**
  - **Bot Fight Mode off**, on Free. It is zone-wide and cannot be skipped
    by any rule, and it can challenge the apps' requests and `doors-check`.
  - **Super Bot Fight Mode**, on Pro and above, which Cloudflare says "may
    challenge API or mobile app traffic"
    (`partials/bots/about-plan-considerations.mdx`): **Definitely automated
    traffic** and **Likely automated traffic** set to **Allow** -- Cloudflare
    asks for Definitely automated on Allow wherever a Tunnel runs, or it may
    block the tunnel's connections (`docs/bots/get-started/super-bot-fight-mode.mdx`)
    -- and **JavaScript detections** off. Unlike Bot Fight Mode it can be
    skipped by a custom rule with the Skip action, if you would rather keep
    it for the rest of the zone. Not checked against an account.
  - One **Configuration Rule** for these hostnames, with the settings
    Cloudflare's documentation lists for one at cloudflare-docs `0d35c2c`
    (`docs/rules/configuration-rules/settings.mdx`): **I'm Under Attack**
    off, **Browser Integrity Check** off, **Email Obfuscation**, **Rocket
    Loader** and **Fonts** off, and **Disable Zaraz** and **Disable Real
    User Monitoring (RUM)** on. Each answers, injects into or rewrites what
    the web front sends, and nothing re-checks the pages behind Access.
    There is no Security Level among them any more: in the new dashboard it
    is I'm Under Attack, on or off (`docs/waf/tools/security-level.mdx`).
  - No challenge -- Under Attack, Managed Challenge, Non-Interactive
    Challenge, Interactive Challenge -- on `/v1/`: a challenge answers the
    apps' requests with a page, which data-client reads as an answer it does
    not understand, and a write as one that may have been saved.
  - **Managed rules on.** If a person's text trips one, Security Events
    shows the rule and the path; add an exception for that rule on the
    write routes. Values reach the database as bound parameters, so text
    that looks like SQL is not the risk.
- **Managed Transforms.** "Add security headers" off: nginx already sends
  `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`, stricter than
  its `SAMEORIGIN` and `same-origin`.
- **Caching.** The defaults. No Cache Rule with an Edge TTL that ignores the
  origin may cover `/v1/`. Every answer the data server's hooks run for
  says `Cache-Control: no-store`, which Cloudflare does not cache in either
  Origin Cache Control mode; only such a rule overrides it. The router's
  own 400 and 414, what Node's parser refuses, and nginx's own error pages
  -- a 413, a 504 -- say nothing, and none of them holds a form or a record.
- **Zero Trust roles.** Give Cloudflare Tunnel edit permission only to
  people who may read host tokens (section 0).
- **No private network route to the tunnel**, under **Networking →
  Routes**, by CIDR or by hostname: either would let enrolled devices reach
  what cloudflared reaches, the web front's 8080 without Access among it
  (section 0). Setup looked once; nothing looks again.
- **The rate-limiting rule, optional on either door.** The server counts
  each visitor's address on its own (section 0), so one anonymous script on
  the runtime door, which has no Access in front of it, spends its own
  bucket and not everybody's; what the rule adds is that the script's
  requests stop at the edge and never reach your machine. On the Free plan
  there is one such rule, matched on the path alone, counted per IP address
  over 10 seconds, so it also counts the administrator's door; Pro adds the
  hostname to what it can match
  (`partials/waf/rate-limiting-availability-by-plan.mdx`). **What its block
  says depends on the plan.** A custom response is "only available on Pro
  plans and above" (`docs/waf/rate-limiting-rules/create-zone-dashboard.mdx`,
  at `0d35c2c`), and Custom Errors are not on Free either. So on Free a
  blocked request is answered with Cloudflare's own error 1015, which has no
  `message`, and data-client reads a blocked write as one that may have
  been saved, though nothing reached your machine
  (`scripts/cloudflare/answers.test.mjs` holds that); without the rule, the
  server refuses that address with its own 429, which data-client reads as
  a refusal. On Free the rule keeps that address's requests off your
  machine at the price of its writes reading as unknown: turn it on when
  that is the better trade, and say so to the host application's people.
  Its settings:

<!-- generated by scripts/cloudflare/doors.mjs from deploy/cloudflare/doors.json: rate-limit; do not edit -->

| Setting | Value |
| --- | --- |
| When incoming requests match | URI Path starts with `/v1/` |
| With the same characteristics | IP |
| When rate exceeds | Requests: your threshold; Period: 10 seconds |
| Then take action | Block |
| With response type | Custom JSON, on Pro and above; Free has no custom response, and Cloudflare answers with its own error 1015 |
| With response code | `429`, on Pro and above |
| Response body | the JSON below, on Pro and above |
| For duration | 10 seconds |

The data server counts each visitor's address on its own, as Cloudflare's edge reported it, and refuses that address, with 429, once it passes 600 a minute unless `FORMANCY_DATA_RATE_LIMIT` says otherwise, which is 100 per 10 seconds. The edge counts each address too, per Cloudflare location, so with a threshold at or below 100 it blocks an address sending steadily before the server would refuse it, and those requests never reach your machine; above 100, the server's own 429 comes first.

<!-- end generated -->

  On Pro and above, its response body, with the response type **Custom
  JSON**:

<!-- generated by scripts/cloudflare/doors.mjs from deploy/cloudflare/rate-limited.json: rate-limit-body; do not edit -->

```text
{"code":"rate-limited","message":"Too many requests from your address reached the edge, so this one was not sent to the data server. Wait a moment and try again."}
```

<!-- end generated -->

  With its `message`, data-client reads the block as a refusal: nothing was
  written, which is true, since a blocked request never reaches your
  machine. Without it -- and on Free, where there is no body to set -- a
  blocked write reads as one that may have been saved. The threshold is
  yours; Cloudflare says the count is not designed to
  be precise. The server's bucket is one per address because it believes
  nginx and cloudflared about the visitor's
  ([the data server's README](../../packages/data-server/README.md#behind-a-reverse-proxy));
  `FORMANCY_DATA_RATE_LIMIT` sets how many requests each address may send.

## 6. Use it

Mint tokens on the machine, as getting-started's section 3 does, and hand
each to its person as you would a password. A token lasts an hour unless
`--minutes` says otherwise, and twelve hours at most.

```sh
docker compose -f compose.yaml -f deploy/cloudflare/compose.yaml run --rm token --subject ada --role data-admin
```

Then open `https://formancy.<zone>/studio/` and `https://formancy.<zone>/host/`:
Access asks who you are first, then the page asks for the token.

**When the Access session lapses** (24 hours by default), Access answers the
pages' requests with a redirect to its login. This is read from the code,
not measured: the studio's request follows the redirect, the browser's
cross-origin rule stops it, and the studio says "The data server could not
be reached from this page."; the host page says a save may have been saved.
Nothing reached the server. Reload the page, sign in at Access, and paste the
token again.

## 7. Check the doors

```sh
docker compose -f compose.yaml -f deploy/cloudflare/compose.yaml run --rm --build doors-check --admin formancy.example.com --team example-team
```

It sends each request with no token and no cookie, asking for JSON as
data-client does, follows no redirect, prints one line each and the count,
and exits 1 when any answer is not the one expected, or when a request got
no answer at all, which it prints as `no answer` with the reason -- a name
that does not resolve (`ENOTFOUND`), a refused connection, a TLS error, a
timeout. Every path on the administrator's door must be answered by Access
first -- exactly a redirect to
`https://<team>.cloudflareaccess.com/cdn-cgi/access/login/` -- and plain
HTTP must be redirected to the same host and path over HTTPS. When every
answer is the expected one, it prints, for the example names, the block
below; that block is rendered from the check's own code and has never been
seen from a live account:

<!-- generated by scripts/cloudflare/doors.mjs from deploy/cloudflare/doors.json: check-output; do not edit -->

```text
doors-check: formancy.example.com (administrator), team example-team
pass  GET https://formancy.example.com/studio/  Access answered first
pass  GET https://formancy.example.com/host/  Access answered first
pass  GET https://formancy.example.com/health  Access answered first
pass  GET https://formancy.example.com/v1/administration  Access answered first
pass  GET https://formancy.example.com/v1/connections  Access answered first
pass  GET https://formancy.example.com/v1/connections/erp/metadata  Access answered first
pass  POST https://formancy.example.com/v1/connections/erp/test  Access answered first
pass  GET https://formancy.example.com/v1/drafts  Access answered first
pass  POST https://formancy.example.com/v1/form-proposals  Access answered first
pass  GET https://formancy.example.com/v1/forms  Access answered first
pass  GET https://formancy.example.com/v1/forms/order  Access answered first
pass  POST https://formancy.example.com/v1/forms/order/drafts  Access answered first
pass  GET https://formancy.example.com/v1/forms/order/drafts/1  Access answered first
pass  POST https://formancy.example.com/v1/forms/order/drafts/1/approval  Access answered first
pass  POST https://formancy.example.com/v1/forms/order/drafts/1/rejection  Access answered first
pass  POST https://formancy.example.com/v1/forms/order/drift  Access answered first
pass  POST https://formancy.example.com/v1/forms/order/imports  Access answered first
pass  POST https://formancy.example.com/v1/forms/order/lookups/customer/query  Access answered first
pass  POST https://formancy.example.com/v1/forms/order/lookups/customer/resolve  Access answered first
pass  POST https://formancy.example.com/v1/forms/order/records/create  Access answered first
pass  POST https://formancy.example.com/v1/forms/order/records/delete  Access answered first
pass  POST https://formancy.example.com/v1/forms/order/records/export  Access answered first
pass  POST https://formancy.example.com/v1/forms/order/records/list  Access answered first
pass  POST https://formancy.example.com/v1/forms/order/records/read  Access answered first
pass  POST https://formancy.example.com/v1/forms/order/records/update  Access answered first
pass  POST https://formancy.example.com/v1/forms/order/regenerations  Access answered first
pass  POST https://formancy.example.com/v1/forms/order/restorations  Access answered first
pass  GET https://formancy.example.com/v1/forms/order/versions  Access answered first
pass  POST https://formancy.example.com/v1/forms/order/versions  Access answered first
pass  GET https://formancy.example.com/v1/forms/order/versions/1  Access answered first
pass  GET https://formancy.example.com/v1/forms/order/versions/latest  Access answered first
pass  GET https://formancy.example.com/v1/whoami  Access answered first
pass  GET http://formancy.example.com/studio/  redirected to HTTPS
33 requests, 33 as expected, 0 not.
```

<!-- end generated -->

It cannot see the zone's other settings, who is in the Access policy,
whether the tunnel has a private network route, or whether you revoked the
login. A `FAIL` names what it saw. It may be a setting of yours, or a
behaviour of Cloudflare's nobody here has measured (section 10), among
them:

- the HTTPS line answered by Access, not by a redirect to HTTPS: Access
  answering plain HTTP before Always Use HTTPS does;
- an Access line on a `POST` answered otherwise than with a 302: what
  Access answers a request that is not a page's;
- every line challenged or blocked: Bot Fight Mode, Super Bot Fight Mode or
  a challenge in front of the hostname;
- the runtime routes' lines failing as "not as the data server through the
  web front": an edge feature rewriting nginx's headers, such as "Add
  security headers";
- a hostile path on the runtime door answered otherwise: the edge changing
  a path before the tunnel sees it.

## 8. When a host application goes live: the runtime door

The host application's people are not in your Access policy, so their
door has no Access. On a hostname of its own -- never the administrator's
-- nothing but the runtime plane's routes reaches the data server through
it, and no file, and the host token is what the server checks there. Both
hostnames must be in the zone you choose when setup logs in, which is where
it routes them.

**Shape (a): the host application runs on this machine,** in a container
of your own Compose file, a third one after the two, on compose.yaml's
network `edge`, where cloudflared can reach it -- and from where it reaches
the web front and nothing else of the stack. Its hostname then serves both:
the runtime routes to the data server, everything else to the application,
which receives each such request's headers, a host token among them. For
example, as `hostapp.yaml` beside `compose.yaml`:

```text
services:
  hostapp:
    image: <your host application's image>
    networks: [edge]
```

and then every command of this guide that starts or stops the stack names
it too, after the two files, so that `down` stops it and `up` starts it:

```text
docker compose -f compose.yaml -f deploy/cloudflare/compose.yaml -f hostapp.yaml --profile stack --profile cloudflare up -d --build --wait --wait-timeout 900
```

The CI job checks neither: the file is yours. Setup and the other tools
need only the two:

```sh
docker compose -f compose.yaml -f deploy/cloudflare/compose.yaml run --rm --build tunnel-setup --admin formancy.example.com --team example-team --aud 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef --app app.example.com --app-service http://hostapp:3000
```

**Shape (b): the host application's backend calls the runtime plane server
to server** ([0029](../decisions/0029-a-host-renders-a-published-form-through-one-client.md)
allows a host with a backend to): the same command without `--app-service`,
and every other path on that hostname is 404. Access Service Auth can stand
in front of that hostname for the backend alone; on Zero Trust
organisations created on or after 2026-10-05 Cloudflare always checks a
service token strictly *[survey, not re-read]*. The edge's rate-limiting
rule counts the backend as one visitor, and so does the server: every person
behind the backend shares its one bucket. On Free a path-only rule cannot
leave it out: with shape (b), leave the rule off or set its threshold at the
server's limit.

Setup logs in again for the new hostname's DNS record, and leaves the
tunnel and the administrator's hostname as they are. Revoke the login's
token again. Then start cloudflared again, which reads its configuration
when it starts, and wait until it holds a connection to Cloudflare:

```sh
docker compose -f compose.yaml -f deploy/cloudflare/compose.yaml --profile stack --profile cloudflare up -d --wait --no-deps --force-recreate cloudflared
```

and check both doors:

```sh
docker compose -f compose.yaml -f deploy/cloudflare/compose.yaml run --rm --build doors-check --admin formancy.example.com --team example-team --app app.example.com
```

On the runtime door, every runtime route must reach the data server, which
asks for a token; every other route, the studio, the host page and some of
the paths cloudflared reads differently from the router or from nginx must
reach no route and no file: cloudflared's 404, the host application's own
answer, the server's `path-not-plain` refusal, or nginx's own 404 from the
runtime door's server. A host application whose answers carry nginx's three
headers exactly as `deploy/web/nginx.conf` sends them, other than a 404,
would be read as the web front, and fail.

**Never forward `/v1/` as a prefix on this hostname**: half of what is under
it is the administrator's.

**When the server's routes change**, after an upgrade, `doors.json` changes
with them, and the tunnel keeps the configuration it was given until you
write it again, without a login, with exactly the arguments you gave setup.
For shape (a):

```sh
docker compose -f compose.yaml -f deploy/cloudflare/compose.yaml run --rm --build tunnel-config --admin formancy.example.com --team example-team --aud 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef --app app.example.com --app-service http://hostapp:3000
```

and for shape (b):

```sh
docker compose -f compose.yaml -f deploy/cloudflare/compose.yaml run --rm --build tunnel-config --admin formancy.example.com --team example-team --aud 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef --app app.example.com
```

`tunnel-config` remembers nothing of what setup was given: arguments that
would close a door the configuration in use opens -- shape (b)'s command
run on shape (a), which would leave the host application's hostname with
the runtime routes alone -- are refused, and the configuration stays as it
was, unless `--drop` names that door's hostname. Then start cloudflared
again as above. Until you do, a new route is not forwarded on the runtime
door, which fails closed; nothing reminds you.

## 9. From evaluation to production

- **The licence:** a production licence, requested as section 0 says.
- **Identity:** your identity provider's key set in
  `FORMANCY_DATA_IDENTITY_KEYS_FILE`, read again on SIGHUP, or one public
  key in `FORMANCY_DATA_IDENTITY_PUBLIC_KEY_FILE`, and no minter; the
  [data server's README](../../packages/data-server/README.md#rotating-the-identity-key)
  says how a key is rotated.
- **The rate limit:** `FORMANCY_DATA_RATE_LIMIT`, in the server's
  environment in your own override, for what each address may send.
- **Your own databases**, with TLS, reached from this machine and not
  through Cloudflare, in `connections.json`: cloudflared, on `edge`, does
  not reach compose's network, but it reaches what your machine routes to,
  so a private network route to the tunnel (section 5) could reach a
  database elsewhere.
- **No production Compose file ships.** Without it, cloudflared's
  configuration names your own web front's addresses instead of `web:8080`
  and `web:8081` -- and your web front needs a server for the runtime door
  that serves no file, as `deploy/web/nginx.conf`'s does -- and cloudflared
  can run as a host package; the tools' checks are then yours to run. The
  server's `FORMANCY_DATA_TRUSTED_PROXIES` then names the address your web
  front connects to it from and the one cloudflared connects to the web
  front from, each alone and never the network around it: a network's
  gateway is how a local process reaches a container, and trusting it lets
  that process choose its own address. Name one too few and everybody
  behind it shares one bucket again.
- **Back up** the volumes `<project>_formancy-data-store` and
  `<project>_formancy-data-tunnel`, where `<project>` is Compose's project
  name, the checkout's directory name unless you set one. Cloudflare holds
  no copy of either. **The tunnel's backup is a secret**: it holds the
  tunnel's credentials, which do not expire, and whoever has them can run
  this tunnel from anywhere.
- **The audit trail is the server's log**
  ([0023](../decisions/0023-the-audit-trail-is-operational-not-evidence.md)):
  ship it to your collector. Docker's default log driver does not rotate.
- **nginx's log holds visitors' addresses.** Its image's `main` format
  writes `$http_x_forwarded_for` -- where cloudflared passes the visitor's
  address -- and every request line with its query, to the web front's
  log. That is personal data on your machine; "Remove visitor IP
  headers" removes the address only from a request another CDN proxied
  first. This deployment adds the runtime door's server to nginx's
  configuration and leaves its log format as it is. **So does the server's
  log**, the audit trail's: each request line names the visitor's address
  where it named cloudflared's
  ([0071](../decisions/0071-the-server-believes-the-forwarded-address-only-from-the-proxies-an-operator-names.md)).
- **One server process** (0013, 0031): a write's id is remembered by one
  process, so a second replica would apply a resent write again. One
  cloudflared is enough; more would change nothing for the server.

## 10. Costs, limits, and what nobody has measured

**What it costs.**

- **Cloudflare decrypts everything**, and anybody with Tunnel edit
  permission can read every header, host tokens included (section 0).
- **It goes against Cloudflare's recommendation.** Cloudflare recommends a
  remotely-managed tunnel "for most use cases" and "when working with
  Docker", and calls a locally-managed one for "local development, testing,
  or legacy configurations". This one is locally managed so that its two
  security-relevant settings -- the runtime door's pattern and Access on the
  administrator's door -- are generated and checked by the binary that runs
  them, never typed into a dashboard; the price is that routes cannot be
  edited in the dashboard.
- **Every setup run makes an account-wide token** that you must revoke by
  hand, and, when cloudflared cannot fetch it, may leave it in your
  browser's downloads (section 3).
- **Whoever changes the tunnel reaches the web front without Access.**
  A changed ingress, a configuration pushed by somebody with Tunnel edit
  permission, or a private network route reaches what cloudflared reaches:
  the web front's both ports, your machine's addresses and what your
  machine routes to; not the server past nginx or the composed stack's
  databases, which are on compose's network, where cloudflared is not.
  Setup looks for private network routes once; nothing looks again.
- **Rate limiting is coarse.** The server's buckets have a fixed window,
  so up to twice a bucket can pass across a window's boundary; a bucket is
  the address Cloudflare reported, so visitors behind one NAT or one proxy
  of their own share one, and an IPv6 visitor is counted by its /64; the
  edge's count is per Cloudflare location and imprecise; and shape (b) is
  one visitor to the edge and to the server. On Free the edge rule's block carries no sentence,
  so a write it blocked reads as one that may have been saved; only Pro and
  above can answer with the body that reads as a refusal (section 5).
- **What a lapse looks like.** A lapsed Access session reads as "could not
  be reached" in the studio and "may have been saved" on the host page.
  Cloudflare's own errors -- a 52x, a 530 with error 1033 when the tunnel is
  down, a WAF block, Free's rate-limiting block -- carry no `message`, so data-client reads a write that
  met one as unknown and a read as an answer it does not understand.
  Nothing reached the server, so nothing is audited. For a 524 or nginx's
  504 that is exactly right: the server may have committed after the edge
  gave up. nginx gives up at its default 60 seconds, before Cloudflare's
  125 *[nginx's and Cloudflare's documentation; not measured here]*.
- **The server refuses a path that is not plain**, with 400
  `path-not-plain`, before authentication, where a route used to answer
  401, 404 or 400. No name the server accepts needs such a path.
- **One server process, nothing restarts, nothing is released**: every
  image is built from your checkout.

**Not supported:** Workers, Hyperdrive, Containers, Pages, D1, R2, KV or
Durable Objects as the runtime or the store; SQL Server from any Cloudflare
runtime; the Access identity as the host token (its keys rotate on
Cloudflare's schedule, and the server fetches none: 0014, 0059); and a trusted proxy's
forwarded address, which the server does not read.

**What nobody has measured**, because no account was available:

- anything through a real tunnel, and the added latency;
- whether the edge forwards `..%2F` and dot segments as sent;
- what cloudflared answers to a request without a valid Access token on a
  door that requires one;
- whether `cloudflared tail --level debug` shows `Authorization`;
- whether anything at Cloudflare sends a POST to the origin twice;
- the body of Access's answers, whether Always Use HTTPS answers before
  Access, what Access answers a `POST`, where it sends a person with Instant
  Auth, and whether it lets through a request that carries the host token
  in `Authorization` beside its own cookie;
- the login inside a container beyond its first step, among it whether the
  browser downloads `cert.pem` when cloudflared cannot fetch it, and what
  `route dns` does with an existing record;
- what `cloudflared tunnel route ip show` prints from an account, which
  setup reads as cloudflared's source says;
- what status Free's rate-limiting block carries, and its body;
- how long cloudflared takes to become ready.

**What you can measure with an account**, in this order, and what each tells
you:

1. Run setup end to end, then setup again: what `route dns` says the second
   time, and how long `up --wait` takes until cloudflared is healthy. That
   time is what the health check's timings should be.
2. `doors-check` passing. Then make it fail, and put each back: turn Always
   Use HTTPS off; turn Bot Fight Mode on; and delete the Access application,
   noting what cloudflared answers. That last one is the only way to see
   cloudflared's own check of the Access token, and putting it back is more
   than a click: the application you create again has a new AUD tag, so run
   `tunnel-config` with it, and the arguments you gave setup otherwise, and
   start cloudflared again (section 8). Until then the administrator's door
   refuses everybody.
3. Send `GET /v1/forms/a/versions/..%2F..%2Fb` and
   `GET /studio/..%5Cv1%5Cforms%5CZ/%2E%2E/index.html` to the runtime door
   with `curl --path-as-is`, which doors-check sends too. Whatever the edge
   does with them, the answer must be the server's `path-not-plain` 400,
   nginx's own 404, or no web front's at all -- never the studio's page.
4. Set the Access session to a few minutes, let it lapse, and look at the
   studio and the host page.
5. The rate-limiting rule's block, with a low threshold on a test path: on
   Pro and above its custom JSON 429, on Free Cloudflare's own 1015.
6. `cloudflared tail --level debug` against the tunnel while you send a
   request with a test token: whether `Authorization` appears. Then revoke
   the login it needed, and the test token's key if it was a real one.

## 11. Take it down

```sh
docker compose -f compose.yaml -f deploy/cloudflare/compose.yaml --profile stack --profile cloudflare down
```

stops everything and keeps every volume.

```sh
docker compose -f compose.yaml -f deploy/cloudflare/compose.yaml --profile stack --profile cloudflare down -v
```

**deletes every volume**: the published forms, the secrets, both databases
and the tunnel's credentials. Then, in Cloudflare's dashboard, delete the
DNS records setup created, the Access application, any private network
route to the tunnel (**Networking → Routes**), and the tunnel
(**Networking → Tunnels**).
