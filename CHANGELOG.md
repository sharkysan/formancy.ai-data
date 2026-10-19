# Changelog

All notable changes to Formancy Data. Every package moves on one version
number. The versions of the upstream `@formancy/*` packages this repository
depends on are a separate line, and a change to one is called out explicitly.

Loosely [Keep a Changelog](https://keepachangelog.com), with reasons attached —
a line that says only *what* changed is rarely the line you need six months
later.

## Unreleased

### Added

- **A second person can review publication.** Until now one administrator
  could put a form in front of every user alone -- its policy, which says
  who reads and writes which column, included -- because one list of roles
  could propose, publish, import and restore. Comparable administration
  tools ask for a second person here; Forest Admin's approvals are one. Set
  `FORMANCY_DATA_PUBLISHER_ROLES` to roles that are also administrator
  roles, and:
  - nobody publishes or imports a version directly: 403 `review-required`,
    publishers included;
  - an administrator submits a draft, `POST /v1/forms/:id/drafts`, which
    the server keeps beside the versions, in `<store>/.drafts`, and checks
    as an import is checked, against the database as it is then;
  - a publisher who did not submit it approves it, which checks it again
    against the database and writes exactly the bundle that was submitted.
    Whoever submitted a draft never approves it, whatever roles they hold
    (403 `own-draft`);
  - a publisher rejects a draft, its author withdraws their own, and
    `GET /v1/drafts` lists the ones that wait;
  - restoring a version stays one publisher's action, alone.

  ([0065](docs/decisions/0065-with-publisher-roles-set-a-draft-is-published-only-when-a-publisher-who-did-not-submit-it-approves-it.md);
  the data server's README says what an author and a publisher may each
  do.)
- **`GET /v1/administration`** says whether the deployment reviews
  publication and what the caller may not do, each with the server's
  sentence, so a client offers only what the server will allow. It is
  there review or not.
- **The studio follows the server**: under review it submits a draft where
  it would publish or import, offers Restore only to a publisher, and a
  Review step lists the drafts, draws one on white paper, says in words
  the policy approving it grants, and approves, rejects or withdraws it as
  the server allows.
- **The examples page is served at https://formancy.ai/data/examples/**,
  by a Worker created by the steps in `.github/REPO-METADATA.md`.
  Until now it ran only from a clone, and an evaluator without one had the
  README's picture and nothing to try. It needs no server and no database,
  so a Cloudflare Worker of its own serves the built page as static files,
  with no code, routed at that path of formancy.ai and nowhere else;
  `/data` itself stays formancy.ai's, for the product's page. Workers Builds
  deploys it from `main` on every push, as formancy.ai-report's Studio is
  deployed at `/report/`; GitHub holds no Cloudflare token. `pnpm demo`
  serves the same build from a clone, and `pnpm demo:deploy` deploys it by
  hand. The deploy refuses a config that names another Worker, so it
  cannot replace formancy.ai's site or the report's Studio, and a build
  holding files the page never loads, which turbo leaves from an earlier
  build in a checkout that built before
  ([0069](docs/decisions/0069-the-examples-page-is-served-at-formancy-ai-data-examples.md)).
- **The demo is sent with a strict Content-Security-Policy**, so a script
  injected into it would not run: nothing a directive does not name,
  nothing inline, nothing evaluated, scripts, styles and fetches from
  formancy.ai's own origin -- its whole site, not only the demo's path --
  and from no other host, no form sent anywhere and no page framing it;
  with `nosniff`, `no-referrer`, a Permissions-Policy that
  denies what the page does not use, a year's cache for the hashed chunks
  alone, and the third-party notices sent as UTF-8 text, which Cloudflare
  would otherwise send as bare `text/plain` and a browser read in a
  guessed encoding. The headers are one module that the deploy writes as
  Cloudflare's `_headers` file and the browser gate serves the page with.
- **`FORMANCY_DATA_TRUSTED_PROXIES` names the proxies whose
  `X-Forwarded-For` the server believes**, so behind nginx, or nginx behind
  cloudflared, each person is a rate-limit bucket of their own and the log
  names their address. Until now everybody behind a proxy shared one
  bucket, the proxy's, so one script could spend it and every other person
  was refused with them; `FORMANCY_DATA_RATE_LIMIT` could only raise that
  bucket. Each entry is an IP address or a CIDR range; `true`, `*`, a
  prefix of 0 and a hop count stop the server, because any of them lets a
  client name its own address and choose its own bucket, and so do an
  empty entry and a range written with an interface's address,
  `172.16.238.250/24`, which trusts the whole network where one address
  was meant. A forwarded value that is not an IP address is not believed.
  Embedders pass the same list as `trustedProxies`
  ([0071](docs/decisions/0071-the-server-believes-the-forwarded-address-only-from-the-proxies-an-operator-names.md);
  the data server's README says what a list too wide or too narrow does).
- **The adapter suites run on every image of a matrix per engine**:
  PostgreSQL 15, 16, 17 and 18, and SQL Server 2019, 2022 and 2025, where
  they ran on 17 and 2022 alone. Why: passing on 17 said nothing of 16. The
  first runs on the other images met differences the defaults could not
  show -- PostgreSQL 15 and 16 have no `transaction_timeout`, and keep in a
  lookup's plan the `IS NOT NULL` tests 17 plans away; PostgreSQL 15 has no
  membership granted `WITH INHERIT`; PostgreSQL 18 runs a cascaded table's
  AFTER DELETE trigger as the table's owner, where 15 to 17 run it as the
  deleting account, refuses a delete an ON DELETE RESTRICT key forbids with
  23001 where they send 23503, and files each NOT NULL in `pg_constraint`;
  SQL Server 2019 has no `VIEW SECURITY DEFINITION` -- and each is now a
  named fact,
  `VERSION_FACTS`, which the suites assert as each version answers, with no
  test skipped. A CI job of its own, `test-images`, runs data-fixtures and
  each engine's adapter suite on every image but the default, and the
  release report holds every shared case on every image, failing a run in
  which one is missing or failed on any of them. The server, client, host,
  studio and performance suites, the browser gates and the composed stack
  stay on the defaults
  ([0067](docs/decisions/0067-the-adapter-suites-run-on-every-image-of-a-per-engine-matrix.md)).
- **A snapshot records the server it was read from**, as `server`: the
  product, the major version and, for SQL Server, the compatibility level
  of the database discovery read -- outside the fingerprint, as
  `serverVersion` is, so neither an upgrade nor a second server holding the
  same catalog reads as drift. Why: whether a release was tested on a
  server could not be said from its version string, which a Debian build of
  PostgreSQL follows with its packaging and Azure SQL Database answers as
  12, a boxed SQL Server 2014's major. `@formancy/data-core` decides it, in
  one place for both engines: `serverStanding(kind, facts)` says tested or
  not tested, with a sentence, against `TESTED_SERVERS` -- the majors of the
  matrix, and the lowest compatibility level a matrix leg's SQL Server
  fixture database answered -- and anything unknown is not tested. Nothing
  refuses a server for being untested
  ([0068](docs/decisions/0068-a-snapshot-records-the-server-it-was-read-from-and-nothing-refuses-a-server-discovery-can-read.md)).
  New exports of `@formancy/data-core`: `serverStanding`, `serverName`,
  `isServerProduct`, `TESTED_SERVERS` and `SQLSERVER_RELEASES`, and the
  types `ServerFacts`, `ServerProduct`, `ServerStanding` and
  `TestedServer`.
- **Drift review says when this release was not tested on the server**: a
  `server-untested` change, for review, naming the server, on every review
  of a form whose current snapshot was read from such a server -- the drift
  route, a regeneration, a restore, an import and a draft's submit and
  approval alike -- including a review of an unchanged catalog, since the
  server is outside the fingerprint and an upgrade in place keeps it. Why:
  nothing refuses such a server, so the review is where an administrator is
  told after publishing. It stops nothing, and the runtime is not told
  (0068).
- **The studio says it too**: the Connect step's answer and the metadata
  pane under its server line carry data-core's sentence when this release
  was not tested on the server, and nothing more when it was.
- **`FORMANCY_IMAGES`**, for a contributor's run, names at most one image
  per engine from the matrix:
  `FORMANCY_IMAGES=postgres:16-alpine pnpm exec turbo run test --filter=@formancy/data-postgres`.
  Unset, every suite runs the defaults; set, it moves the adapter suites
  and data-fixtures' alone, since every other suite names the default at
  each start; an image outside the matrix, two for one engine, or the
  variable set to nothing is refused. turbo hashes it, so a cached run on
  one image is never replayed for another.
- **A field may move to another generated section.** The generator puts
  every column the database generates or fills in a section of its own,
  Record, which for most tables leaves the identity alone, split off the
  fields a person reads first; and a buyer judges the first form by how it
  is arranged. In the studio's Presentation step each field now offers
  "Move to Record" (or to the root's section), one button per other
  section, which puts it last there and leaves the keyboard on the button
  that takes it back. The move is presentation: kept on the field's own
  entry as `section`, anchored by its column and the section's label, and
  carried through a regeneration, which reports a move it had to drop as
  `move-dropped` -- its section gone, or one it cannot tell apart, or one
  the move would leave with no field. A section keeps at least one field,
  so Record's only field stays, and a moved field lands last. The
  presentation stays version 1, and one with no move is what 0.1.0 writes;
  a 0.1.0 server refuses to read or import a version holding a move,
  naming `/fields/N/section`. Help text is not offered: `@formancy/spec`
  0.5.0 has no property for it. `@formancy/data-core`'s presentation types
  gain the `section` property, the `move-dropped` conflict and a
  `field-gone` for a section; no upstream version changes
  ([0075](docs/decisions/0075-a-field-may-move-to-another-generated-section.md)).
- **The release says that no test runs on Azure SQL**, where it said
  nothing: not on Azure SQL Database or Azure SQL Managed Instance. Why:
  the product told an administrator so once an Azure database was
  connected (0068), but the README named only the images the release is
  tested on, and a buyer on Azure read that silence as a question answered. The two Azure SQL services have no image a test
  can start, so under 0003 they cannot be tested here. *What it is tested
  on* gains a row, "Recognised, not tested", derived from
  `@formancy/data-core`'s new `UNTESTED_PRODUCTS` -- Azure SQL Database and
  Azure SQL Managed Instance -- whose cell under "Tested with" says "None"
  before it names them; and the release's register names both, and says
  that every boxed SQL Server, SQL Server on Azure Virtual Machines among
  them, is called tested on the strength of the Developer edition on Linux
  in a container
  ([0073](docs/decisions/0073-azure-sql-is-not-tested-and-the-release-says-so.md)).
  New exports of `@formancy/data-core`: `UNTESTED_PRODUCTS`, and the type
  `NamedProduct`.
- **The architecture is documented as arc42**, in `docs/architecture/`,
  entered from [`docs/README.md`](docs/README.md), in the twelve sections
  and under the file names formancy.ai's has, so that an integrator, an
  evaluator or a reviewer finds where each piece lives, what a request
  does, what holds each quality and what was accepted rather than fixed,
  each with the record that decided it, without reading every record in
  order. `scripts/architecture.test.mjs`, in `pnpm test:repo`, fails when a
  section is missing, a workspace package or app is not named in the
  building blocks, a decision record is linked from no section, a relative
  link or the heading it points at names nothing, or a path from the
  repository's root written in backticks names nothing git would commit; a
  path given from inside a package, a record named without a link, a
  package the workspace does not have, and whether a sentence is still true
  are review's
  ([0076](docs/decisions/0076-the-architecture-is-documented-as-arc42-and-every-change-updates-the-section-it-touches.md)).
- **A live demo of the product, at https://formancy.ai/data/demo/**, once
  its Worker is created by the steps in `.github/REPO-METADATA.md`; until
  then the address is formancy.ai's 404. Why: the examples page shows a
  generated form with nothing behind it, and an evaluator who wanted to see
  what the runtime does -- a page of orders searched and paged, a
  customer found with the typeahead, an order with its lines and
  deliveries in linked grids, a save, a create, a delete, another tenant's
  record refused -- had to clone the repository and run the composed
  stack. A visitor signs in as one of three people, Clara and Otto, order
  clerks of two tenants, or Vera, an auditor, and gets a data server and a
  PostgreSQL of their own, main's, in a Cloudflare Container, with sample
  sales data generated from a fixed seed. Everything they change is gone
  when their container sleeps, a little over ten minutes after their last
  request. The
  Worker starts a container only on a sign-in from the page, at most ten
  at once, each with a key made for that start, and forwards the runtime
  plane's routes to it, exactly those 0037's runtime door forwards, and
  nothing else, none of the administrator's beside them under `/v1/forms`;
  it sets one cookie, a random name for the
  visitor's container, which is that container's only credential.
  Workers Builds deploys it from `main` on every push, as the examples
  page; `pnpm live-demo:deploy` deploys it by hand, and GitHub holds no
  Cloudflare token. It needs the Workers Paid plan, and costs money while
  people use it
  ([0070](docs/decisions/0070-the-live-demo-runs-the-real-server-and-postgresql-in-a-cloudflare-container-of-each-visitors-own.md);
  the README's *Live demo* says what a visitor meets).
- **`pnpm test:live-demo`, and a CI job of its own, `live-demo`,** which
  build the demo's image and run the Worker's own code in front of it, over
  a stand-in for Cloudflare's runtime whose containers are `docker run`s of
  the image at the share of a CPU and the memory the demo's instance type
  has, and walk a visitor's journey over HTTP and then in Chromium. Why:
  Workers Builds deploys without waiting for CI, and Wrangler activates the
  Worker before it builds and pushes the image, so an image that no longer
  built would first fail on Cloudflare, beside a Worker already live; and
  `wrangler dev` runs no container on Windows, nor against Docker Desktop's
  kernel in WSL. The release report waits for the job.
- **A person can download a form's records as one CSV file**,
  `POST /v1/forms/:id/records/export`, and `exportRecords` in
  `@formancy/data-client`. Until now a person saw their records a page at
  a time in a grid and could take them nowhere, where Directus, Filament
  and AdminJS export CSV. The file is every record the list would page
  through for the same search, sort and parent, under the read right as it
  stands: whoever may list may download, since a script could page the
  list anyway, and nothing in a policy or a setting withholds one from the
  other -- drop the path at your proxy to have no exports. The server makes
  the whole file before it sends a byte, so a file is whole or refused with
  its own code, never cut short: past 16 MiB (`422 export-too-large`) or 30
  seconds (`503 export-timeout`), a memory budget and a bound derived from
  nginx's default read timeout, neither measured; while another file is
  being made through the same allowlisted connection in that server
  (`503 export-busy`); when a record would appear twice because the rows
  moved between two pages (`409 moved`); and for text UTF-8 cannot carry,
  which SQL Server can hold, or a lookup whose key is too long for a token,
  though the grid shows that row (`409 unencodable`). Each value is what a
  read holds, digit for digit, a lookup its label beside its key, NULL an
  empty cell and `''` as `""`, in UTF-8 after a byte-order mark, and a cell
  a spreadsheet would read as a formula carries one apostrophe in front,
  which taking one off every cell that has one undoes. It is not the table
  at one moment: a row deleted meanwhile can be missing. The Cloudflare
  runtime door forwards the route, and so does the live demo's Worker. The
  host page saves it with Download CSV, below
  ([0079](docs/decisions/0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md)).
  New exports of `@formancy/data-core`: `validateExportQuery`,
  `exportColumns`, `exportHeader`, `exportRecord`, `exportText`,
  `exportFileName`, `EXPORT_MAX_BYTES`, and the types `RecordExportQuery`,
  `ExportColumns`, `ExportField`, `ExportLabels`, `ExportQueryCheck`,
  `ExportQueryRefusal`, `CsvCell`, `CsvRefusal` and `CsvText`; of
  `@formancy/data-client`: `exportRecords`, `EXPORT_MAX_BYTES`,
  `exportFileName`, and the types `RecordFile` and `RecordExportQuery`.
- **The host page downloads the records a grid lists, with Download CSV.**
  The file above was there for an integrator to ask for and for nobody on
  the page to press. Beside New record in the Records panel, and beside each
  child section's New under a saved record, Download CSV asks the server
  for the file of exactly what that grid lists -- the search as submitted,
  never as typed, the grid's sort, a child section's record -- and hands it
  to the browser to save as `<form id>.csv`, through an object URL and a
  clicked `<a download>`, because the token travels in a header and a link
  could not carry it. It is a secondary button, since New record stays the
  one primary action. Its line says while the file is made, with the
  button `aria-disabled` and a second press sending nothing; names the
  file once it is handed over; and says a refusal in the server's words,
  pressing again being the retry. Leaving the form or signing out stops a
  file in the making and says nothing, and opening another record stops
  its child sections'. It names no count of records, and does not know
  whether the browser kept the file. `@formancy/data-client` re-exports
  `exportFileName`, so a page can name the file before it arrives
  ([0080](docs/decisions/0080-a-host-downloads-the-records-its-grid-lists-and-the-browser-saves-the-servers-file.md)).
- **A SQL Server connection may log in as a Microsoft Entra principal**: a
  managed identity, user-assigned by its client id or the host's own, or a
  service principal whose client secret is a reference, as a password is.
  Why: an Azure SQL database set to Entra-only authentication has no SQL
  login to give, so the allowlist could not name it at all. **No test of
  this release logs in as either**: no container takes an Entra login and
  no test asks Entra, so the tests show only that a SQL Server 2025
  container started with a certificate refuses one, that nothing is tried
  again as a SQL login and that no secret, tenant or client reaches a log,
  an answer or an audit event. The server says so at start, once for each
  such connection, and the README's *What it is tested on* says so in a
  row of its own, derived from the adapter. **An Entra login goes over TDS
  8.0** (`encrypt: 'strict'`): TLS before the first TDS message, with the
  server's certificate checked. Why: with TDS 7's `encrypt: true`, TLS
  starts only if the server's first answer asks for it, so whoever
  answered in the server's place could decline it and be sent the token,
  as review showed. The database must take TDS 8.0, which Microsoft
  documents for Azure SQL and SQL Server 2022 and later, and of the images
  measured SQL Server 2025 with a certificate configured did and 2019 and
  2022 on Linux did not. The credential is built once for each connection,
  kept with the token it caches across a failed open, and asked for Azure
  SQL's token alone, whatever resource the server names; an Entra entry
  refuses TLS turned off, a trusted server certificate, a tenant named by
  its domain and a secret that is not a reference; the server does not
  start with a managed identity entry while `AZURE_FEDERATED_TOKEN_FILE`
  is set, under which the library would log in by AKS workload identity as
  the environment's tenant, client and authority; and a failed login says
  why in a sentence, with Entra's AADSTS code when it gave one, and
  nothing of the principal
  ([0074](docs/decisions/0074-a-sql-server-connection-may-log-in-as-an-entra-principal-and-no-test-logs-in-as-one.md);
  the data server's README has the entry's shape).
  New exports of `@formancy/data-sqlserver`: `SQLSERVER_LOGINS`, and the
  types `EntraLogin` and `SqlServerLogin`. **`@azure/identity` 4.13.3 is
  a new dependency** of `@formancy/data-sqlserver`, at that exact version;
  tedious already installed it.
- **The composed stack's studio and host page are sent with a
  Content-Security-Policy each**, so a script element written into
  either, by a flaw, an extension or a proxy, does not run: the studio
  holds an administrator's token in memory, the host page a host's, and
  memory is where such a script would read them. Each is the examples
  page's policy -- scripts, styles, fonts and fetches from the stack's
  origin alone, nothing inline, nothing evaluated, `data:`
  images only, no plugin, `<base>`, form target or framing -- and the host
  page's allows inline styles as well, for the style elements AG Grid
  creates, as the live demo's does. Why now: 0032 sent none because React
  and Angular add styles at run time and nothing had seen a policy
  working; measured in each page's browser gate under the examples page's
  policy, the studio was refused nothing and the host page only AG Grid's
  style elements. `deploy/web/nginx.conf` sends them from one map, for
  every file under `/studio/` and `/host/` and for nothing else, which
  `node scripts/web-policies.mjs --write` writes from the module that
  defines them; `pnpm test:repo` fails when the map is not the module's,
  when a location that serves files has no policy, when another location
  could answer with a page, or when a location's own `add_header` or a
  redirect inside nginx -- an `error_page`, `try_files`, `rewrite` or
  `index` out of the page -- would drop it; the browser gates serve each
  page under its policy and fail on anything a browser refuses under it;
  and the getting-started gate fails when nginx does not send it.
  **Noticed by operators:** rebuild the web image. A browser extension or
  a proxy that writes a script element into either page is refused, and
  the browser's console says so; a deployment's own proxy sends the
  policies only if it copies the header; and a host page moved to an
  origin of its own, as 0060 allows, needs a `connect-src` that names the
  server's origin
  ([0083](docs/decisions/0083-the-studio-and-the-host-page-are-served-under-a-content-security-policy-each.md)).

### Changed

- **Unset, nothing changes.** Every administrator publishes alone, as
  before, and upgrading puts no deployment under review. The composed stack
  and the getting-started guide stay that way.
- **The audit trail names drafts**: the administration and draft
  operations, and a `draft` field on every administrator event. Who
  approved a version is recorded only there, as the `draft-approve`
  event's actor; the version file is still the bundle alone.
- **For embedders**: `ConfigurationStore` has a new method, `drafts()`,
  which a store of your own must provide, and `AdminAuditEvent` has
  `draft` and the administration and draft operations. `createDataServer`
  takes `admin.publisherRoles`.
- **The examples page is built with a relative base**, so one build is
  right at the root of `vite preview` and under `/data/examples/`, and it
  writes `THIRD-PARTY-NOTICES.txt` as the studio and the host page do,
  because it is now served to anyone (0046). Its header says that no server
  and no database are behind it, and links this repository.
- **The host browser gate waits for a rendering update between the keys
  that scroll the Records grid, checks that Home shows a row's first cell
  whole, and says a bar it cannot see rather than reading it**, and 0058's
  table names why (`reportsFocusScroll`). In WebKit the page hears of a
  scroll a focus made only at the next rendering update, and AG Grid keeps
  its scrollbar in step with its grid by what it hears: Home, pressed in
  the same moment as the scroll that put a header in view, was undone by
  that scroll's echo, the grid stayed 40 px to the side, and the open row's
  bar, out of view, was read as black against black. That was CI's 1:1 in
  five of its 35 WebKit runs from 2026-10-14 to 2026-10-16. A person's keys
  are frames apart, and nothing a person sees changes; an integrator's own
  browser tests pressing keys that fast in WebKit can meet it. The gate
  also measures the row in every browser, once a run, and fails when a
  browser release changes it.
- **The examples browser gate serves the page where the demo is**, under
  `/data/examples/` with the demo's headers over the types Cloudflare
  gives each file, and fails on anything the browser refuses under the
  policy, on any console error, on a fetch from anywhere but the page's
  path, when an inline script put in the page runs or
  goes unheard, and on notices not sent as UTF-8 text. Its axe audits run
  without axe's preload, which was measured to change no rule's outcome on
  the page; a stylesheet from another origin is the policy check's failure,
  not axe's.
- **The studio's and the host page's browser gates serve each page under
  the policy nginx.conf sends it**, and fail in every browser on a state in
  which the browser refused anything under it -- an event the document
  heard or a console line about the policy -- when the page was sent
  another policy or none, and when an inline script put in the page at the
  end of a pass runs or goes unheard; the host page's also fails, once a
  run, when the page under the examples page's policy no longer has AG
  Grid's style elements refused, so its allowance goes with the need for
  it. Both now load axe through Playwright's evaluate rather than a script
  element, which the policy refuses. The listener and the inline-script
  canary are `scripts/browser-gate.mjs`'s, and the examples page's gate
  uses them too, its checks unchanged
  ([0083](docs/decisions/0083-the-studio-and-the-host-page-are-served-under-a-content-security-policy-each.md)).
- **A lookup a person can search is generated as a typeahead, and the host
  page draws the control the published form names**
  ([0066](docs/decisions/0066-a-lookup-a-person-can-search-is-generated-as-a-typeahead.md)).
  The generator writes `widget: "typeahead"` on a lookup that shows a text
  or whole-number column, which is what a search matches; one that shows
  neither stays a plain select of its first page, and its note in the
  studio's Generate step says how to make it searchable. Why: a plain
  select lists one page and never reaches the rest, so on every host but
  the reference page a row past the first page could not be chosen; and
  the host page, which drew every lookup as a typeahead itself, drew the
  order line's date-only lookup as one whose every typed search the server
  refused, 400 `not-searchable`. Generated forms now carry `widget`
  (`@formancy/data-core`), and the host page no longer chooses a lookup's
  control. The generator also refuses a lookup that shows a binary,
  rowversion or unsupported column, whose list the server never could
  build, where it used to write one whose note named a control; the
  studio offers such a column disabled, and `isDisplayType`, which
  `@formancy/data-core` now exports, is the one rule the generator, the
  server and the studio read. No `@formancy/*` version changes.

  **Upgrading from 0.1.0:** a form published at 0.1.0 names no widget, so
  every host, the host page now included, draws its lookups as plain
  selects of their first page until the form is regenerated in the
  studio's Drift step and published again -- under review, submitted and
  approved. Restoring such a version brings the plain selects back. A
  version file exported from 0.1.0 is refused by this release's import as
  not what this server generates: upgrade the source deployment and
  regenerate there first, or propose the form again in the target.
- **Unset, nobody is believed about their address**, as before: a server
  that upgrades without the setting counts and logs every request by the
  peer that connected (0071).
- **The composed stack trusts its web front, and the Cloudflare overlay's
  cloudflared.** `compose.yaml` fixes the web front's address on a new
  network, `proxy`, that it shares with the server alone, and the address
  cloudflared takes on `edge`, and names both, not their networks, in the
  server's `FORMANCY_DATA_TRUSTED_PROXIES`: a network's gateway is how a
  local process reaches a container, and trusting it would let that process
  choose its own address. Behind the tunnel each visitor is therefore a
  bucket of their own, and the server's log names each visitor's address,
  which is personal data, where it named cloudflared's. The web front left
  compose's network for `proxy`. Both networks' ranges are fixed, at
  172.16.238.0/24 and 172.16.239.0/24, outside Docker's default pools, and
  Docker refuses a second network in the same range, so two stacks from
  `compose.yaml` no longer run at once on one machine, the getting-started
  gate's included; the guide's section 0 says what to do when the ranges
  are taken. The guide's Cloudflare section no longer advises the edge's
  rate-limiting rule to protect everybody's one bucket: it keeps one
  address's requests off the machine.
- **The log's request line names the forwarded address without the
  proxy's port.** Beside an address a trusted proxy forwarded, the socket's
  port is the proxy's connection, not the client's.
- **A SQL Server older than 2019 is refused at discovery, and says which
  release it is.** Its catalog has no `sys.edge_constraints`, which
  discovery and every delete read, so discovery failed as "Invalid object
  name 'sys.edge_constraints'." and said nothing of the version. It now
  refuses before reading the catalog: "SQL Server 2017 (14) cannot be
  discovered: this adapter reads sys.edge_constraints, which SQL Server has
  from 2019 (15)." The administrator's plane still answers 503, "could not
  be read", and logs the sentence. The view decides, not the major, so Azure
  SQL Database, which answers 12, is never refused (0068).
- **The connection test answers what the server is**: `product`, `major`
  and, for SQL Server, `compatibility`, beside `kind` and `version`, and
  its `standing`, `{ tested, says }`: whether this release was tested on
  that server, in data-core's sentence. A server it was not tested on is
  answered 200 as before.
- **The allowlist refuses a key it does not read**, on every entry and
  inside `tls` and `login`, naming the key and never its value, and a
  `tls` setting that is not true or false. Why: an entry was kept whole
  once its known fields passed, so a key a later release reads -- `login`
  among them -- would have been dropped by this one and the entry would
  have logged in some other way; and `"enabled": "false"`, a string, did
  not turn TLS off. **Breaking for a file with a stray key**: the server no
  longer starts, and says which key (0074). `deploy/connections.json`,
  which the getting-started guide runs, and the allowlist the performance
  stack writes hold only keys it reads.
- **For embedders**: `ConnectionConfig`'s `user` and `password` are
  optional beside the new `login`, so code that reads `config.user` as a
  string no longer compiles, and a `ConnectionFactory` of your own is
  given its secret as `string | undefined`: a password, a client secret,
  or none for a managed identity. `connectSqlServer` takes `user` and
  `password` or `entra`, refuses `entra` without `encrypt` or with
  `trustServerCertificate`, and opens an Entra pool over TDS 8.0 (0074).
- **For embedders**: `ServerIdentity` now extends `ServerFacts`, so a
  `DatabaseAdapter` of your own must report `product` and `major`, and for
  SQL Server `compatibility`, from `ping` -- a breaking change for an
  implementer, and additive for a reader. `MetadataSnapshot` has an
  optional `server`, which `createSnapshot` copies and checks. `DriftKind`
  has a new member, `server-untested`, so an exhaustive `switch` over it
  no longer compiles until it handles it. `@formancy/data-server` exports
  `ConnectionTest`, the connection test's answer.
- **For contributors**: data-fixtures' `startPostgresFixture` and
  `startSqlServerFixture` take an image, and every start that names none,
  `startPostgresContainer()` and `startSqlServerContainer()` included, runs
  the one `FORMANCY_IMAGES` chooses; only the adapters' suites and
  data-fixtures' make one, and `scripts/ci-test-jobs.test.mjs` fails on one
  anywhere else. The SQL Server fixture's server record names the
  compatibility level of the database it loaded, as the getting-started
  journey's record does of the composed one, and collect refuses a record
  without it. On Windows a server record names the file that asked for it,
  where it named data-fixtures' own `servers.ts`. The release report keys
  each shared case's cells by image, holds an image of the matrix to the
  legs that ran on it, says an image outside the matrix in a sentence of
  its own as not tested, and gives a suite a row per leg, and a report
  built on one machine passes
  `--allow-missing container,getting-started,test-images`, since a machine
  runs the defaults ([`docs/release/`](docs/release/README.md)).
- **The studio, the host page and the examples page serve their own
  fonts, and no page asks another host for anything**
  ([0072](docs/decisions/0072-the-apps-serve-their-own-fonts-and-no-page-asks-another-host-for-anything.md)).
  Archivo, IBM Plex Sans and IBM Plex Mono come from Fontsource's packages
  at 5.3.0, the release formancy.ai's site and admin install, pinned once
  in the workspace catalog and bundled into each build, where every page
  asked Google Fonts for them. Why:
  - a browser gate failed when Google did not answer: on 2026-10-16 the
    Chromium leg's first attempt failed its fonts check three times, in
    runs 38915951921, 38919378187 and 38937995522; the first and the third
    passed on a second attempt;
  - every visitor's browser told Google their address, the demo's
    included. A German court has held a website liable for that (LG
    München I, 3 O 17493/20, 2022-01-20), cited as context, not as legal
    advice;
  - the demo's Content-Security-Policy named Google's two hosts, so fonts
    Google moved would have been refused until it was edited. It is now
    `style-src 'self'` and `font-src 'self'`, derived from the faces the
    built stylesheets name.

  Each browser gate now refuses and names any request to an origin it
  does not serve, and its pass with the web fonts refused refuses every
  font file, wherever it comes from. `scripts/no-other-host.test.mjs`
  holds each app's page and build to the same, and the getting-started
  gate exempts no host. What you notice: on the examples page a visitor's
  browser fetched 6 font files, 135,548 bytes, Latin only (Chromium 153 on
  Windows 11, 2026-10-16), where Google sent 4 of 165,412 bytes and a
  stylesheet (the same Chromium on Linux, the same day); each app's build
  is 59 font files, 757,316 bytes, larger (Vite 8.3.3, 2026-10-16), so the
  web image, which holds two, and the demo's upload grow; `THIRD-PARTY-NOTICES.txt` lists the three packages with the
  SIL Open Font License's text; and IBM Plex Sans at 500 and 600 is drawn
  from static instances, so its edges are anti-aliased differently from
  Google's variable file and the README's pictures are retaken. Nothing
  moves: the advances and line heights are the same.
- **On PostgreSQL 18 a NOT NULL added NOT VALID is read as nullable, with
  an unvalidated check**, where it was read as NOT NULL. PostgreSQL 18 lets
  `ALTER TABLE … ADD CONSTRAINT … NOT NULL column NOT VALID` hold new rows
  to it without checking the old ones, and sets the flag discovery read NOT
  NULL from all the same, so a row older than the constraint could hold
  NULL in a column the snapshot called NOT NULL: its field was generated
  required, a record holding that NULL opened with a required field empty,
  and a key or a version column could rest on it. It now reads exactly as
  the same rule spelled `CHECK (column IS NOT NULL) NOT VALID` does on every
  version: the column nullable, and a check by the constraint's name,
  `(column IS NOT NULL)`, enforced and not validated, until `VALIDATE
  CONSTRAINT` makes it the column's NOT NULL. Over a composite type, or a
  domain over one, the check is `(column IS DISTINCT FROM NULL)`, the rule
  the NOT NULL keeps there, since `IS NOT NULL` would refuse a value whose
  every field is NULL, which the column takes. A request's description of
  the table reads it the same way, so the runtime agrees with review.
  PostgreSQL 15 to 17 cannot hold such a constraint, and SQL Server has
  none, so nothing else reads differently
  ([0077](docs/decisions/0077-a-not-null-added-not-valid-is-read-as-the-unvalidated-check-it-is.md)).
- **A PostgreSQL lookup or record statement after one that ended part-way
  on the same connection answers as it would have.** postgres.js 3.4.9
  numbers a statement's rows per connection and starts again only when a
  statement completes, so after one that ended in an error with rows
  already sent -- a lookup its cancel request stopped as its rows were on
  their way (0061), or a statement failing in a later row -- the next
  statement's rows came after that many empty slots
  (porsager/postgres#1119, #1253). A search or a resolve then threw, which
  answered whoever's lookup came next 503 `unavailable`, and a record read
  of one row threw that its identity was no key. CI met it on 2026-10-17,
  and a probe the same day 6 and 7 times in 1,000 same-tick aborts on
  PostgreSQL 17 and 18. The slots held nothing: in 3,000 probes no row read
  under the aborted lookup's row filter reached the next one's answer. The
  adapter now collects each statement's rows itself, as the driver reads
  them (`forEach`), so what an earlier statement left behind never reaches
  them
  ([0078](docs/decisions/0078-a-postgresql-statements-rows-are-collected-as-the-driver-reads-them.md)).
- **For contributors**: the fixtures' `holdNewConnections()` says how many
  connections it holds, `held()`, and the PostgreSQL suite's late-cancel
  case now holds exactly one cancel request. It held both of the two a
  search aborted in its parse is sent (0061), and so passed only while the
  second reached the backend before the lookup it stopped ran again, which
  under CPU load on PostgreSQL 18 it did not in 19 of 150 probe runs, nor
  once in CI. That case -- the next lookup and its one run more both
  stopped, and the lookup refused, as 0061 states -- is now a case of its
  own, each request held at a gate of its own.
- **For maintainers**: [`docs/setup.md`](docs/setup.md) says, on one page and
  in order, what is set up outside the repository's files -- GitHub's
  settings and secrets, the image's visibility, Cloudflare's plan and both
  demos' Workers -- who does each step, what was found done on 2026-10-17,
  and why billing, the Wrangler login and connecting Cloudflare to GitHub
  need a person. Until now it was spread over `.github/REPO-METADATA.md`
  and `RELEASING.md`, which it links rather than repeats.
  `scripts/setup.test.mjs` holds the Workers, scripts and Wrangler it names
  to the code, and `scripts/architecture.test.mjs` its links and paths.
- **For contributors**: `scripts/release-report/tested-on.mjs` names the
  packages whose built output it reads, `BUILT_INPUTS`, and refuses to read
  another; `scripts/release-report/workflows.test.mjs` fails when the
  report job's build, with what turbo builds before it, leaves one out.
  Why: the report read data-sqlserver's logins (0074) from a build the job
  never made, and stopped on every pull request with "is not built".
- **For contributors**: `pnpm test:pictures` and `pnpm test:browser` find
  Playwright's browsers where `PLAYWRIGHT_BROWSERS_PATH` puts them, as
  Playwright's own image does at `/ms-playwright`. turbo runs both in strict
  mode, which dropped the variable, so through turbo the pictures check
  failed to launch Chromium in that image while each app's script run
  directly passed; `turbo.json` now passes it to both, and
  `scripts/browsers.test.mjs` fails when it does not.
- **The host page has a demo build**,
  `pnpm --filter @formancy/data-host build:demo`, for the live demo
  ([0070](docs/decisions/0070-the-live-demo-runs-the-real-server-and-postgresql-in-a-cloudflare-container-of-each-visitors-own.md)).
  It asks the path it is served from for the demo's people and signs a
  visitor in as one of them, where the ordinary build asks for a token,
  and its client reaches the runtime plane under that path through
  data-client's `base`. Why a build of the host page and not a page of
  its own: the demo is meant to show the host page's workspace as it is.
  The ordinary build drops the demo's branch and `src/demo.ts`, and
  carries the persona sign-in, which it never draws without a session;
  the host page gains a development dependency on the live demo's private
  package, for the Worker's answer types.
- **The live demo's page allows inline styles**, where the examples page's
  allows none. AG Grid injects its theme as `<style>` elements, which
  `style-src 'self'` refuses: the gate watched Chromium refuse them under
  the examples page's policy. The live policy is the examples page's with
  `'unsafe-inline'` added to `style-src` and nothing else, named in the
  deploy as one allowance in one directive, so no other page's policy
  loosens with it.
- **For contributors**: the examples deploy's checks, `scripts/demo.mjs`
  and `scripts/demo-headers.mjs`, take the page, its mode, the policy and
  one named allowance, so the live demo's deploy holds the host page's
  demo build to them; and `scripts/demo.mjs` deploys only when it is run as
  itself, which it and `scripts/live-demo.mjs` judge by the program's real
  path. Why: it deployed whenever the program's name ended in
  `demo.mjs`, which `scripts/live-demo.mjs`'s does, so the live deploy
  would have deployed the examples page first; and a comparison of the
  paths as given did nothing and exited 0 when the checkout was reached
  through a link, a deploy by hand reported that never ran.
- **Every runtime audit event carries `rows`**: for an `export`, how many
  records its file held, or held when it was refused -- 0 when no statement
  ran -- so an operator can see that somebody took ten thousand rows, and
  the trail is still no copy of them; `null` for every other operation. A
  deployment's own sink sees the field on every event, and an embedder's
  `RuntimeAuditEvent` has it; `RuntimeOperation` has `export`
  ([0079](docs/decisions/0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md)).

What review costs, in 0065: every submit and approval asks the database, so
one that cannot be reached refuses both; nothing deletes a draft; nobody is
told a draft waits; a publisher sees a draft's review-level drift only once
the approval has written it; the studio shows a draft, not what it changes
from the version it replaces; a deployment under review needs two people;
and roles are still read only from the token's `roles` claim.

What the typeahead costs, in 0066: a short list is a typeahead too, and
nobody can choose a plain list for it; a lookup that shows no text or whole
number still lists only its first page; when that list's one search fails,
the renderer says that its options could not be loaded and are asked for
again each time the person moves to the field, and asks again only then,
not while they stay on it (formancy 0.6.0's words; 0.5.0 said "Type to try
again." under a control nobody can type into); a version
published before it with a lookup no label can spell still cannot list
it until regenerated; and the regeneration report does not say that a
control changed.

What the demo costs, in 0069: it is main's page, deployed without waiting
for that commit's CI; its build settings are in Cloudflare's dashboard,
and Workers Builds reads this repository through the Cloudflare Workers
and Pages GitHub app, and nothing here reads either; what Cloudflare
sends at the address -- the notices as UTF-8 text, a 404 under the path
with the policy, the redirect of the path without its slash with none of
the headers -- was read by hand once, on 2026-10-16, and nothing reads
it since, so a header a later deploy, Cloudflare or the zone changes
fails nothing; Cloudflare's bot detection puts an inline script into the
page as it serves it, which the policy refuses, so the browser's console
shows that one error on every load and Cloudflare gets no bot signal
from the demo, and turning it off would change formancy.ai's whole zone;
the Worker's compatibility date is one more date to move; `'self'` is
all of formancy.ai, the report's Studio included; and the page is on the
site's hostname without the site's bar or footer.
The Worker runs no code and none of the product -- no server, no
database, neither plane -- which stays where 0037 puts it.

What the live demo costs, in 0070: the Workers Paid plan, $5 a month, and
then money while people use it -- about $0.0037 a visit of ten minutes'
use once the plan's included amounts, about 67 such visits a month, are
spent, and at most $201.66 for ten containers running a whole 30-day month
with every CPU busy, at the prices read on 2026-10-16, beside the Worker's
and the Durable Objects' requests, storage and alarms, not computed;
anybody can start a container, one visitor can take all ten, and a rate
limiting rule on the sign-in is the operator's to add; every change
is gone when a container sleeps and on every deploy whose image changed,
which restarts every running demo at once; PostgreSQL alone; a first
sign-in that waits for a start, 5.7 to 11.7 s through the Worker at the
instance type's share on a workstation and not measured on Cloudflare, and
refused past 30 s; Cloudflare runs code on formancy.ai's zone, decrypts
every request and holds what a visitor types until their container stops;
the cookie is the container's credential, and any script can name a
Durable Object of its own; a token that lasts an hour, after which a visit
signs in again; no logs of its own, though the zone's analytics still see
its requests; a lookup may run for 3,568 ms before it is stopped, four
times the default, at a quarter of a CPU; inline styles allowed on its
page; an image of about 198 MB
compressed pushed by every deploy that changed it, deleted by hand; a
second whole build of the repository on every push; and the Durable
Object's code held by review, what the cap answers and how long a
container outlives its visitor read once, by hand, after the first deploy.
A deployment of the product is not changed: 0037 is narrowed for this demo
alone.

What the matrix costs, in 0067: more CI jobs a run, and the wait for
runners they add; some default work repeated, since every data-fixtures leg
starts both engines; more moving tags; runs that go red for a difference no
user of the defaults meets; what the routes, the client, the host page and
the studio do on another version is still not tested; PostgreSQL 14 is not
tested; and what the image legs show on CI's runners is first shown by
their first runs there. What it names and does not change: on PostgreSQL
18 a delete whose cascaded table's AFTER DELETE trigger writes where only
the table's owner may is done, where 15 to 17 refuse it,
`permission-denied`; a delete an ON DELETE RESTRICT key forbids is answered
`referenced` on every version, though 18 sends another SQLSTATE; and
discovery describes a table the same on 18 as on 17, though 18 files its
NOT NULLs in `pg_constraint` -- and a NOT NULL added NOT VALID, which only
18 has, is read as 0077 says. What
0068 does not do: refuse a server this release was not tested on, which is
generated, published and served on as before; tell a managed PostgreSQL
from PostgreSQL; or call a SQL Server database untested at a level between
the lowest tested and its release's own. What it costs: drift review lists
`server-untested` on every review against such a server, for as long as it
stays untested, and a person filling a form is never told. A snapshot taken
before it records no server until it is discovered again, and drift says
nothing of its server meanwhile.

What believing a proxy costs, in 0071: a list too wide lets a client that
connects from inside it choose its own bucket and the address the log
names, and one too narrow is one bucket again, which nothing reports; the
list is read at start, not on SIGHUP; only `X-Forwarded-For` is read, not
RFC 7239's `Forwarded`; a client is its address, so people behind one NAT
share a bucket and an IPv6 client is counted by its /64; the log holds
people's addresses where it held a proxy's; behind the tunnel the server
believes Cloudflare's edge about the visitor, which was read in
Cloudflare's documentation and not measured; and a private network route
to the tunnel would let an enrolled device name its own address.

What serving the fonts costs, in 0072: each build carries every subset of
every weight and WOFF fallbacks no browser the gates run fetches; a font
fix reaches the pages only when this repository moves the pins, and
nothing says one is due; a rule asking Archivo for a width would draw the
normal width, which the static guard refuses first; a machine with a font
installed under the name Archivo draws the headings in it; and the gates
see only the requests the states they reach make, and the static guard
reads no JavaScript.

What saying so costs, in 0073: an estate on Azure SQL is told this release
was not tested on it in the README, the register, every connection test
and every drift review; on Azure SQL nothing proves discovery, the record
operations, `rowversion`, triggers, row-level security, a lookup's
cancellation, the Redirect connection policy's ports 11000 to 11999 or the
error 40613 a paused serverless database answers while it resumes, the
last two as Microsoft documents them; what Azure answers for its
`ProductVersion` and its editions is Microsoft's documentation too, not
measured here, and what it answers for `ProductMajorVersion` is not
documented at all; every boxed SQL Server, on any host and in any edition,
SQL Server on Azure Virtual Machines among them, is called tested when its
release and its database's level are, though every test ran the Developer
edition on Linux in a container; and an Azure database that accepts Entra
logins only is reached only as an Entra principal no test logs in as
(0074).

What reading a NOT NULL added NOT VALID as nullable costs, in 0077: on
PostgreSQL 18 its column is generated optional until the constraint is
validated, so a create or an update that leaves it empty is refused by the
database, `not-null-violation`, where the form would have said a value is
required, and a key over it lists no page and it is not offered as a
version column; where no field writes it on create and it has no default
-- a type no codec reads, say -- create is offered and the database refuses
every one, where it was not offered; validating it tightens the column,
which drift review reports and which blocks the writes of a form that
writes it, and the create of a form that does not, until the form is
reviewed; a form published on 18 before this over such a column reads it
as loosened and a check as new, so one keyed by a unique key over it lists
no page until the constraint is validated, one whose version column it is
has update and delete blocked and a review cannot confirm the column again
until then, and one whose control cannot hold NULL -- a boolean shown as
a checkbox -- has its writes of the column blocked until it is reviewed;
and the check's expression is spelled by the adapter as the server spells
the hand-written check on 18, and on no other version.

What collecting the rows costs, in 0078: the PostgreSQL adapter's catalog
reads -- discovery's, and the server's version read -- still take
postgres.js's array, so one that failed part-way would leave the next on
its connection behind empty slots, and no test shows what discovery then
does; an integrator's own statements on a client it also hands the adapter
meet the driver as it is; and the workaround stays when postgres.js fixes
it, which only the spike suite's characterisation will say.

What the export costs, in 0079: no policy lets a person browse and not
download; the file is not the table at one moment, and a row deleted
meanwhile is missing unseen; each page reads every row before its offset;
16 MiB and 30 s are a budget and a derivation, and on PostgreSQL a page
past nginx's 60 s gets the person a 504 while the server works on; one
export per allowlisted connection at a time in each server; a text cell
starting `=`, `+`, `-`, `@`, TAB, CR or `'` carries an apostrophe the
database does not hold; instants to the second and times to the minute,
as a read holds them; on SQL Server an unpaired surrogate or a NUL refuses
the file; and what Excel shows of it -- the byte-order mark, a `;` locale,
17 digits -- was not tried.
What logging in as an Entra principal costs, in 0074: no test logs in as
one, so a partner makes the first successful login, and nothing shows a
token refreshed, a pool outliving its token, Azure SQL's resource passing
the guard, Azure SQL taking TDS 8.0 or a managed identity's endpoint on
any host; only a server that takes TDS 8.0 can be reached as one, so SQL
Server 2019 and 2022 on Linux, as measured, cannot; a new dependency,
moved by hand; an allowlist with a stray key no longer starts the server;
a managed identity cannot log in where AKS workload identity sets
`AZURE_FEDERATED_TOKEN_FILE`, and the check is the runnable server's, not
an embedder's; a connection's cached token outlives a change to the
principal in Entra until it is refreshed; a secret file that cannot be read is
named in the log, as a password's is;
an embedder's `ConnectionConfig.user` is no longer always a string; what
@azure/identity and MSAL read from the environment -- the region, the
proxy, the log level, a managed identity's platform -- is outside the
reviewed allowlist, and `AZURE_LOG_LEVEL` writes outside the server's
log; only the first connection of an Entra pool says why its login
failed, and a later one is `unavailable` with no reason in discovery's
log line; a managed identity off Azure failed to get a token in 0.00 to
0.02 s on a Windows 11 host and in 4.53 to 6.37 s in the server image's
base under Docker Desktop, measured on 2026-10-17, inside mssql's 15 s
connect timeout, and a host that drops packets to the metadata address
was not measured; only the public cloud, and only a tenant's id; no
Entra login to a server whose certificate the operator must trust; and
the README's row calls the SQL login tested from a value typed in the
adapter, since no server record says which login a test made. A SQL
login still goes over TDS 7; one whose server answers that it will not
encrypt is now refused before its login is sent (0081, under *Fixed*).
- **A release no longer waits for the performance figures to be measured
  again** (0084). The release workflow refused a release whose code,
  runtime dependencies or build inputs differed from what
  `docs/performance.md` was measured on, until somebody measured again:
  `pnpm performance` on a machine with nothing else running, which took
  9,756 s for 0.1.0's figures on 2026-10-15. By 2026-10-18 71 measured
  files and tedious's version had changed, and 0.2.0, with tedious 20.3.7
  in it, waited on that machine standing still. `RELEASING.md` still runs
  the check before a release, and a version cut without measuring again
  says so here, in its own section. What it costs you: the performance
  page may describe an earlier version than the one you run -- its *When
  and on what* names the commit and the drivers it measured -- and the
  default lookup deadline, derived from those figures (0063), stays what
  they derived. Rows read and round trips are still pinned on both
  engines in CI.
- **Every `@formancy/*` dependency moves from 0.5.0 to 0.6.0, upstream's
  release of 2026-10-18, adopted the day it was published, and generated
  forms stay on spec 3** (0055, 0042). Why: 0.6.0 is upstream's newest
  release, its spec version 4 is unchanged and still the newest, and it is
  the release in which a source may say its list goes on, which a lookup
  here waits for (formancy.ai#253). The 23 exact pins in six manifests and
  the eight release-age exemptions move together; the lockfile changes only
  in the eight `@formancy` entries, and nothing new is installed. What you
  notice:
  - **A plain select whose list could not be loaded** says so in the
    renderer's new words, "The options could not be loaded. They are asked
    for again each time you move to this field.", and moving to it asks
    again. 0.5.0 said "Type to try again." under a control nobody can type
    into, and asked again only when the form was drawn again (0066, whose
    test now holds the new behaviour). A typeahead still says "Type to try
    again.".
  - **A lookup a rule disables no longer searches.** It asks only for the
    label of what it holds, so a record the person may only read, or a
    field the host page fixes, sends no lookup search; `lookupSources`
    answers labels, and a token the person may not see shows as the stored
    value.
  - **A source's `resolve` may answer a page.** `@formancy/data-client`'s
    `LookupSource` still answers a list and stays assignable to both
    renderers' `OptionsSource`; code of yours that calls `resolve` itself
    narrows the answer, as the examples page's test now does, or reads it
    through `acceptRemoteAnswer`.
  - **Nothing generated meets 0.6.0's other breaking changes.** No generated
    form has a repeater, a `computed` rule or a group a rule hides: the
    generator writes `disabled` rules only. The two forms the examples page
    generates hash and canonicalize byte for byte as under 0.5.0, and the
    validator's errors are unchanged, so the administrator plane's
    `invalid-bundle` sentences are too (both compared on 2026-10-18).
  - **The studio's bundle** is 805.2 kB minified, 219.4 kB gzipped, 8.1 kB
    more than main at 0.5.0, both measured on 2026-10-18; its warning limit
    moves from 760 kB, which the studio's own code had already passed, to
    810 kB.
  - **The themes' stylesheets are byte-identical**, so the README's pictures
    keep their stylesheet digests. 0.6.0 adds `@formancy/themes/room.css`,
    the admin's palette as a file (formancy.ai 0178), which none of the
    three copies here imports yet.
- **The live demo says why a start failed, in its Worker's live log**
  ([0086](docs/decisions/0086-a-failed-start-of-the-live-demo-says-why-in-the-workers-live-log.md)).
  The Worker was created on Cloudflare on 2026-10-19, and every sign-in
  failed after 32 s, the start deadline, with nothing to say why: the
  Durable Object turned each failure into the visitor's 503 and wrote no
  line, and observability is off. Each failed start now writes one line,
  which `wrangler tail formancy-data-demo` shows and nothing keeps: the
  step that failed and what Cloudflare said, or whether the wait for the
  server's `/health` ran out or the container stopped, after how many
  probes, and what the last one was told. The start's key is cut out of
  it, and nothing a visitor sent is in it. Observability stays off.
- **The live demo starts again when Cloudflare has no instance, and gives
  a start a minute**
  ([0087](docs/decisions/0087-a-live-demo-start-cloudflare-has-no-instance-for-is-started-again-within-a-minute.md)).
  With 0086's line deployed, a sign-in said the container never ran in
  its 30 s: "The container is not running, consider calling start()".
  Cloudflare says a start it has no instance for only by rejecting
  `monitor()`, which the Durable Object never asked; Cloudflare's own
  Container class starts again then. The Durable Object now listens to
  `monitor()` after every start, starts again on that answer within the
  deadline, now 60 s, and says any other rejection at once. A start that
  answers says in the live log how long it took, which nothing measured
  on Cloudflare before. What it costs: a visitor may wait up to a minute,
  and a running visitor's Durable Object is held from eviction while its
  container runs, up to 15 minutes. Whether no instance was the cause the
  next sign-in's line says.
- **The live demo's container starts on Cloudflare**
  ([0088](docs/decisions/0088-the-demo-image-makes-postgresqls-socket-directory-at-every-start-and-the-gate-runs-it-with-run-empty.md)).
  With 0087 deployed, the next sign-in's line said what had happened every
  time: the container exited with code 1 within 250 ms. Cloudflare starts
  it with `/run` empty, where Docker keeps the image's, and PostgreSQL's
  socket directory, made under `/run` when the image was built, was gone,
  so PostgreSQL refused to start ("could not create lock file"), which
  the same image does under Docker with `--tmpfs /run`. `start.sh` now
  makes the directory at every start, and the gate runs every container
  with `/run` empty, as Cloudflare does.

### Fixed

- **A SQL login that asks for TLS is no longer sent to a server that
  answers it will not encrypt.** A SQL Server connection with TLS on --
  every allowlist entry whose `tls.enabled` is not false -- goes over TDS
  7: the data server's first message, PRELOGIN, and SQL Server's answer
  cross in the clear, and the driver, tedious 20.3.3, starts TLS only if
  the answer says ON or REQ. Answered OFF or NOT_SUP, it went on and sent
  the login unencrypted, the user and the password under TDS's reversible
  obfuscation. So anyone on the network path between the data server and
  SQL Server who could answer in SQL Server's place could strip the
  encryption the operator asked for and read the password. **This was
  true of 0.1.0**, on every connection with TLS on; the composed stack's
  connections turn TLS off, so they never asked for it, and are
  unchanged. Now the adapter withholds the server's first answer from
  the driver until it has read it whole, and on OFF or NOT_SUP ends the
  connection before the login is sent, as MS-TDS says a client that asked
  for encryption does: the connection test and the runtime plane answer
  their 503, and the log says "The server answered that it would not
  encrypt the connection, so the login was not sent." An answer it cannot
  read is refused in a sentence of its own. Every SQL Server image of the
  test matrix encrypts, and logs in as before
  ([0081](docs/decisions/0081-a-sql-login-that-asks-for-tls-is-refused-when-the-server-answers-that-it-will-not-encrypt.md)).
  tedious 20.3.7, published 2026-10-11, refuses the same answer itself,
  and the lockfile now installs it where 0.1.0's had 20.3.3. The guard
  stays: tedious left alone never settles a connect whose server sent
  part of its first answer and closed, which the guard fails at once, and
  mssql accepts tedious `^19.2.2 || ^20.0.0`, so an embedder's own
  lockfile can hold a tedious without the fix.
- **For contributors**: data-fixtures' `startPreloginStandIn` answers a
  client's PRELOGIN in a SQL Server's place with the answer it is given
  and keeps the type of every packet the client sends after it, so a test
  reads what the real driver puts on the wire.
- **For contributors**: a SQL Server container that never says it is
  ready now fails its start with how Docker says it ended -- its exit
  code, whether the OOM killer stopped it, when -- and the last 40 lines
  it wrote, after testcontainers' "Log stream ended and message ... was
  not received", which was all two failed starts of SQL Server 2025 on CI
  said on 2026-10-17 before the runner took the container away; every
  container data-fixtures starts carries the label
  `ai.formancy.data.caller`, the file that asked for it. Why not a memory
  bound, the suspected cause: measured, SQL Server 2025 starts in about
  1 GiB on 20 CPUs and 0.6 GiB on four, less than 2022, data-server's
  suite at CI's three workers peaked at 4,138 MiB of containers, and the
  first failure ran one SQL Server on a 16 GB runner. The cause is not
  established, a start that fails so still fails its job, and data-fixtures'
  suite starts one more SQL Server, killed while it starts, on every
  image
  ([0082](docs/decisions/0082-a-sql-server-container-that-never-becomes-ready-says-how-it-ended-and-is-given-no-memory-bound.md)).

What refusing costs, in 0081: a stream of the adapter's own in front of
tedious, written against what tedious 20.3.3 uses of its socket and how it
reads the answer, which a tedious release can break -- the suites through
the guard would show it -- and nothing shows tedious fixing the downgrade
itself; the adapter's own copy of tedious's `connectInSequence` for these
connections, so a later fix to it does not reach them until copied; every
byte the server sends passed through one more stream, each chunk emitted
once more and only the reads carrying its first message copied, which a
measurement on a shared machine could not tell from its own spread; a server
that cannot encrypt at all, NOT_SUP, refused where 0.1.0 logged in to it,
and reached only with `tls.enabled: false`, the login then unencrypted by
that choice; with the server's certificate trusted, whoever answers can
still complete TLS with one of its own, as before; a connection with TLS
off still sends its login unencrypted; and only a pool's first connect
says the sentence alone, a later one's refusal reaching discovery's log
after tedious's "Connection lost - ".

## 0.1.0 — 2026-10-16

**The first release of Formancy Data.** It turns an existing PostgreSQL or
SQL Server database into formancy forms, and serves their records under a
policy the server checks on every request. Self-hosted and source-available.

### Get it

- **Server image:** `ghcr.io/sharkysan/formancy-data-server:v0.1.0`,
  signed, with its SBOM attached. There is no `latest` tag.
- **npm packages, with provenance:** `@formancy/data-core`,
  `@formancy/data-postgres`, `@formancy/data-sqlserver`,
  `@formancy/data-server` and `@formancy/data-client`.
- **Try it on your machine:** the
  [getting-started guide](https://github.com/sharkysan/formancy.ai-data/blob/v0.1.0/docs/getting-started.md) starts both
  databases, the server, the studio and a host page with one command, and
  walks you to a published form. CI runs it as written.
- Built on formancy's `@formancy/*` packages at 0.5.0.

### What it does

- **Discovers** a database as the account you connect with, and says what
  that account cannot see.
- **Generates** a form from what the account may do. The result is
  deterministic, and the generator says what it inferred, made read-only or
  left out.
- **Enforces a policy on every request:** who may read, create, update and
  delete which fields and rows. Row filters come from your application's
  verified identity, never from the form.
- **Publishes without overwriting.** Versions are kept and checked on every
  read. An old version can be restored, or moved to another deployment,
  only while the database still fits it.
- **Serves records and lookups.** Records can be read, listed a page at a
  time, created, updated and deleted one at a time, each write in one
  guarded statement. A lookup offers only the rows the person may choose.
- **Reviews drift** between the database and what a published form relies
  on. The server refuses what drift blocks in a form's own table.
- **Renders in React and Angular** from one definition, through
  `@formancy/data-client`.

The studio (the administrator's application) and the host page come with
the repository and are not published as packages. The
[README](https://github.com/sharkysan/formancy.ai-data/blob/v0.1.0/README.md#what-it-does) links the decision record behind each
point, and each record names the test that fails when it stops being true.

### Licence

The Formancy Data Source-Available Licence, Version 1.1, in force from
11 October 2026. **No lawyer has reviewed it yet.**

| Use | Terms |
| --- | --- |
| Read the source and fork the repository | Free |
| Evaluate, develop and test, in companies too | Free |
| Run in production, internally or customer-facing | Paid licence |
| Redistribute inside another software product | Separate commercial agreement |
| Customer data and generated form definitions | Remain the customer's |

Ask for a production licence or a redistribution agreement at the address
in section 9 of [LICENSE.md](https://github.com/sharkysan/formancy.ai-data/blob/v0.1.0/LICENSE.md). No price is published yet.
Version 1.1 replaced Version 1 of the same day and the draft Version 0 of
8 October, and adds only where to ask for a redistribution agreement
([0048](https://github.com/sharkysan/formancy.ai-data/blob/v0.1.0/docs/decisions/0048-the-licence-is-in-force-before-a-lawyer-has-read-it.md),
[0054](https://github.com/sharkysan/formancy.ai-data/blob/v0.1.0/docs/decisions/0054-version-1-1-names-the-address-for-a-redistribution-agreement-too.md)).

### Known gaps

- The licence has not been reviewed by a lawyer.
- No performance figures yet for listing records, the menu of forms or a
  delete. [The performance page](https://github.com/sharkysan/formancy.ai-data/blob/v0.1.0/docs/performance.md) covers every
  other runtime request.
- A host page on another origin is tested in the server's suites, not yet
  in a browser.
- The [Cloudflare guide](https://github.com/sharkysan/formancy.ai-data/blob/v0.1.0/docs/deploy/cloudflare.md) is checked offline.
  Nothing has run through a real tunnel yet.
- The host page does not yet show a field that an update may not write as
  read-only ([filed](https://github.com/sharkysan/formancy.ai-data/blob/v0.1.0/docs/images/README.md#what-the-pictures-show-that-is-wrong)).

The release report attached below says what this release was tested on.
Its *Known limitations* section lists every limitation the decision records
name, one sentence each.

### Changed to make this release

- **The default lookup deadline is 892 ms** (it was 536 ms). It is
  derived from the performance figures measured for this release -- the
  slowest timed lookup, SQL Server's "Search many customers match" with 8
  in flight --
  and `FORMANCY_DATA_LOOKUP_DEADLINE_MS` still overrides it.
- **Re-measuring the performance figures now settles in one run.** The
  default deadline is derived from the figures, but its file was part of
  what the figures describe, so each new value made them stale. That file
  is now left out of the measured product, and measurements run the server
  with the longest deadline a timer holds, so the default never affects a
  measured answer
  ([0063](https://github.com/sharkysan/formancy.ai-data/blob/v0.1.0/docs/decisions/0063-the-default-lookup-deadline-is-outside-the-measured-product.md)).
- **The figures were measured in WSL 2** on 15 October, on the same
  workstation as before, and no block had to be measured again.
  The harness's calibration tolerance there is 2.41, from a worst idle-gap
  ratio of 2.407 measured on 2026-10-15. The Docker Sandbox VM used before
  measured 1.61.
- **These notes are a summary.** The full history did not fit in a GitHub
  release, which takes 125,000 characters. A test now fails any pull
  request that makes the next release's notes too long
  ([0064](https://github.com/sharkysan/formancy.ai-data/blob/v0.1.0/docs/decisions/0064-the-first-releases-notes-summarise-the-development-before-it.md)).

### Full history

Every change before this release, each with its reason, is in
[CHANGELOG.md](https://github.com/sharkysan/formancy.ai-data/blob/v0.1.0/CHANGELOG.md#development-before-010) under
*Development before 0.1.0*.

## Development before 0.1.0

Every entry from the repository's first commit to the first release, newest
first. All of it is in 0.1.0.

**A lookup statement stops when the page abandons its request or the server's lookup deadline passes** ([0061](docs/decisions/0061-a-lookup-statement-stops-when-its-request-is-abandoned-or-its-deadline-passes.md)). The renderers abort a superseded search's request, but the server passed no signal to the adapter, so the database finished every scan it started, and nothing bounded how long one ran; `docs/performance.md` measured that every search reads every row its row filter admits. Now the server notices a lookup request whose client left -- the response or its socket closing before the answer -- and stops the statement with the driver's own cancel, postgres.js's cancel request or mssql's TDS attention; and every lookup statement, a search, a resolve and each membership check inside a create or an update, stops at a deadline counted from when the adapter is asked for it, so a wait for a pooled connection counts and reading the form and opening its connection do not. `FORMANCY_DATA_LOOKUP_DEADLINE_MS` sets it, a whole number of milliseconds from 1 to 2147483647, anything else stopping the server with a sentence naming it; an embedder passes `runtime.lookupDeadlineMs`, which `createDataServer` holds to the same rule. Its default, data-core's new `DEFAULT_LOOKUP_DEADLINE_MS`, is the slowest timed lookup or resolve answer in the published figures, rounded up -- 536 ms, SQL Server's tenant search reading 100,001 rows eight at a time, measured 2026-10-10 -- and a test fails when the two differ: a slower or larger deployment than the one measured raises it. A search past it is 503 `lookup-timeout`, a new code, because `unavailable` invites another try and a contains search that timed out reads the same rows again; a resolve past it is 503 `unavailable`, since it reads by key and one that timed out waited, so trying again helps; an abandoned lookup is answered 499 `abandoned`, which nobody reads and the audit trail records; a membership check past it is 503 `unavailable`, nothing saved, as before. No minimum search length and no prefix mode: the rows a search reads do not depend on its text, the plain select asks only the empty search, and a prefix would change what a search returns. A lookup that completes is answered exactly as before. Noticed by integrators: `LookupAdapter`'s `search`, `resolve` and `rejects` take a required last `signal` (data-core's `LookupSignal`, which the platform's `AbortSignal` satisfies), and an adapter given an aborted one rejects with its reason; on PostgreSQL the server opens a second client per allowlisted database for lookups, `application_name` `formancy-data lookups`, so each may use up to twice the connections -- because a PostgreSQL cancel that arrives after its statement finished stops whatever runs next on that backend, and on their own client that is only another lookup, which then runs once more. The PostgreSQL adapter cancels a lookup once postgres.js has sent it and again once it has sent its execute, since PostgreSQL drops a cancel that arrives while the backend waits for the execute, and handles a cancel request's own failure, which `query.cancel()` would leave to end the process; it reads three of postgres.js 3.4.9's private properties to do so, which its suite pins. On SQL Server mssql's default request timeout of 15 s still cuts any deadline set above it, answered `unavailable`. Behind a proxy the abort reaches the server only if the proxy closes its upstream connection when its client goes, which nothing tests. The performance figures were measured before this change and are stale until measured again; the harness runs its server with the deadline at its longest, and its catalogue names the runtime operation each scenario addresses, which the counting pass checks. `@formancy/data-fixtures` gains `blockTable`, an owner's lock that makes a statement wait in the database, and `TcpHop.holdNewConnections()` and `refuseNewConnections()`. No upstream `@formancy/*` version changes.

**A published version moves to another deployment as its version file** ([0062](docs/decisions/0062-a-published-version-moves-between-deployments-as-its-version-file.md)). The studio downloads any version as the file the store wrote, and imports one from its Drift step; `POST /v1/forms/:id/imports`, body `{ expectedBase, bundle, keysConfirmed? }`, checks it as a publish does -- it validates, in format 2, for the form the path names, bound to a connection this deployment's allowlist has by the same name, and this server's generator writes its base and bindings -- then refuses what the target database's drift blocks, as a restore does: 422 `other-engine` for a database of another engine, 409 `incompatible` with only the blocking changes, then 0039's keys against this deployment's base and the compare-and-swap. 201 answers `{ version, drift }`, the changes to review or note, and the file is written as it came, so what was reviewed is what runs. The connection and the form keep their names, because a lookup's source name is made from the connection's. Each import is audited as `import`, with its base, its connection and the version it wrote; the export is the source's `version-read`. Why: nothing moved a version between environments, and copying the store moved every version of every form, unchecked and with no event.
- A restore over a connection pointed at another engine is 422 `other-engine`, where it was 500 `internal` with the reason in the log only: the publish checks, restore's drift gate and 0039's comparison are one module, `publishing.ts`, which publish, restore and import share.
- Costs: both deployments name the connection and the form alike and run releases that generate alike; the target serves and drifts against the source's snapshot until it regenerates, and an account narrower than the source's is drift that refuses the import, measured on both engines with the fixture's writer account; the same file imported twice is two versions; nothing proves where a file came from.

**The browser gates measure the pages in Firefox and WebKit as well as Chromium, every check in every browser, and name each fact the browsers disagree on** ([0058](docs/decisions/0058-the-browser-gates-run-in-chromium-firefox-and-webkit-and-each-fact-the-browsers-disagree-on-is-named-and-held.md)). The examples page, the studio and the host page are measured in Playwright's Chromium, Firefox and WebKit, headless on Linux, each in a CI leg of its own, which fails the run and its report and so blocks a release, as Chromium's always has -- nothing blocks a merge mechanically, as GOVERNANCE.md says of every check here: no sideways scroll down to 320 pixels, the keyboard path, axe's contrast and target size, the grids' painted colours and the host page's whole journey. The release report holds each browser to the build Playwright pins, says what each said it was and which of the runner's packages WebKit's networking came from, and fails a run in which a browser left no results, made a check, by name and pass, that another did not, or never made a check one of the named facts says holds it. Why: the people using a host's page are not all on Chromium, and 0021 and 0035 left the other browsers unmeasured. Found on the way:
- After a click on a page's corner, Firefox starts the keyboard from the caret the click left, so the next Tab goes past an off-screen skip link; the studio's gate holds that, and every gate starts from the top of the page its own way.
- What a browser does with a save whose answer was lost depends on the browser and the connection. Over HTTP/1.1, when a connection the browser reused closes after the server read the save and before any byte of an answer, Chromium and Firefox send it again on their own, and one server process answers that second sending with the first one's answer (0031); WebKit on Linux sends every save on a new connection and never sends one twice, so its page says the save may have been saved. The host page's gate holds each, through `sentOn`, new in `@formancy/data-fixtures`' test hop, which says which connection carried each sending, how many requests it carried before and how many idle kept-alive connections the browser passed over for it: a Chromium or Firefox create sent on a new connection while one stood idle fails, and so does a run in which none of their creates took a reused connection, which would have measured nothing of the resend.
- Playwright's Linux WebKit names itself Safari on a Mac, so the host page's grids take AG Grid's Safari code paths in its gate, which proves neither Safari nor a WebKit that is not Safari; its platform is Linux, so AG Grid's macOS and iOS paths stay off, and the gate checks both.
- Web fonts are checked, not printed: a pass by whose end a family the page asks for had not loaded fails, and so does the refusing pass if any arrived. A state measured before a late family swapped in is not caught.
- In WebKit a pointer press on Save sent nothing in five of about 175 presses, the document scrolling by 24 px between the press and the release, and nothing said so. What moved it was not established. The host gate now presses Save from the keyboard, as every other save of its journey already did, so no gate presses Save with a pointer in any browser, Chromium included, and what a person's click on Save meets in a real browser is not checked. The gates read colours only from a page that held still.
- The host gate decided a grid cell's contrast at the corner of its box wherever that lay: beside the grid, for a column scrolled partly out of it, and outside the window, where a screenshot has no pixel and it read black, which passed. With a row's Delete as the grids' last column (0053), End scrolled the Records grid so that, at 360 pixels, the corner of its "Created by" header lay on the panel's glass, read as 4.49:1 in Firefox and 4.47:1 in WebKit, and left of the window in Chromium. The gate now reads a cell only where the window shows it, scrolling the window -- never the grid -- to a cell outside it and back, says rather than decides a text its grid has scrolled wholly out of view or covers, and finds each cell by the element axe named rather than by axe's selector, which can name a hover class the scroll takes away.

Noticed: `pnpm test:browser` runs Chromium alone on a machine unless `FORMANCY_BROWSERS` names more, `all` for every browser; a Linux machine needs Firefox's and WebKit's downloads and their system libraries once (`playwright install --with-deps chromium firefox webkit`, with sudo); on macOS and Windows WebKit is refused. The README's pictures are checked by `pnpm test:pictures`, in Chromium, in a CI job of its own, no longer by `pnpm test:browser`. WebKit here is not Safari.

**The runtime plane answers a host page on another origin when the operator lists that origin exactly** ([0060](docs/decisions/0060-the-runtime-plane-answers-the-origins-an-operator-lists-and-the-administrators-plane-none.md)). `FORMANCY_DATA_CORS_ORIGINS` names, comma-separated, the origins a page may call the runtime plane from, each exactly as a browser sends `Origin` -- `https://app.example`, or plain HTTP on `localhost`, `127.0.0.1` or `[::1]` -- and is empty by default; embedders pass the same list as `runtime.origins`. A wildcard, a pattern, `null`, a path, a trailing slash, upper case, a default port written out, user information or another scheme stops the server with a sentence naming the entry by its place and never repeating it, and so does a list on a server without the runtime plane. Each runtime route has an `OPTIONS` route at its path that grants a preflight only from a listed origin, only for the method the runtime route has there -- GET or POST, never HEAD -- and only when that method reaches the runtime route and not another plane's at the same path, with `authorization`, `content-type` and `formancy-write-id` (data-core's new `CROSS_ORIGIN_REQUEST_HEADERS`) and `Access-Control-Max-Age: 600`, WebKit's cap; anything else is 403 `cross-origin-refused` with no CORS header. A browser may send any GET, HEAD or POST to a granted URL on that grant without asking again -- measured by hand, Chromium and WebKit did and Firefox asked -- so a server with origins does not start beside a GET, HEAD or POST route of another plane, or an embedder's, at a path any runtime route matches, and the request check below refuses the rest in every browser that sends `Sec-Fetch-Site`. Every answer of a runtime route, refusals and the limiter's 429 included, carries the listed origin back, so the page reads the server's sentence; what the router writes before any hook, its 414 and the 503 while closing, does not. Credentials, exposed headers and the private network are never offered. The administrator's plane, `/v1/whoami` and `/health` have no preflight route and carry no origin. A request carrying a token whose `Sec-Fetch-Site` is `cross-site` or `same-site` is refused 403 before its token is read unless its origin is listed and its route is the runtime plane's, on every route and with the list empty too, so a grant a browser cached before its origin was removed does no work in any browser that sends `Sec-Fetch-Site`; counted by the limiter on every route but `/health`, and audited with no actor by the plane whose route it reached, while `/v1/whoami` and `/health` write no event. A refused preflight and such a refusal are logged with their reason, naming the origin only in a form a browser sends, which holds no user information, path or query. Preflights are neither counted nor audited. Why: a host page on its own origin -- a static page whose identity provider issues the token -- needed a proxy of its own, and 0024 and 0029 had rejected CORS because its usual mistake is a wildcard, which this list cannot hold. Noticed: with origins set, `OPTIONS` on a runtime path is answered, 204 or 403, where it was 404, and every runtime answer says `Vary: Origin`; a deployment that added CORS headers at its own proxy now has those requests refused 403 until it lists their origins; a server with origins does not start beside a route of another plane, or an embedder's, that overlaps a runtime one as above, or that has a regex parameter, a wildcard or a constraint; and createDataServer grants the copy of `runtime.origins` it checked, so an embedder's array changed after the call changes nothing. No browser gate runs against it yet: that is the host page's next change. `deploy/cloudflare/doors.json` and the Cloudflare guide's generated blocks are unchanged: every new route is an `OPTIONS` at a runtime path, which the runtime door already forwards by path, so this change asks no new `tunnel-config` of an operator behind Cloudflare; what the guide says of a page on another origin comes with the edge's own change. No upstream `@formancy/*` version changes.

**The host page deletes a record, from its open detail or its grid row, after a confirmation in place** ([0053](docs/decisions/0053-a-host-deletes-a-record-from-its-detail-or-its-row-after-a-confirmation-in-place.md)). Where the server offers this person delete, the open record's header has Delete record, a child row's Delete <child>, and every grid a last column, Delete, each row a real button named for its record that the arrow keys reach inside AG Grid's cell navigation; the grid stays one Tab stop, and no key deletes. Each asks in place, with no overlay -- under the header, or under the grid that asked -- a focused region named "Delete Order k1:…?", one heading level below what it sits in, described by what the delete does and, from the server's `deleting`, what it also does -- other records deleted with it, losing their reference, or the database keeping it while others refer to it -- and by the forms of the record that hold work; Keep it is the next Tab, then Delete it, and Escape keeps it. A row's delete names the version the row was listed with, the detail's the newest it heard -- read, answered to a save, or loaded again by a pane -- as it is when Delete it is pressed, which waits while a save of the record is out. Keep it gives the keyboard back to a row's Delete by its record, or to the grid's heading once a search, a sort or a page has taken the row away; another request the person makes closes the question, and an answer that asks the guard does not. Deleted, the record goes from the page and the grid says "Deleted Order k1:…." before its page, a page left empty showing the one before, with the keyboard on that grid's heading; a 404 is "Cannot find", closed and said as "Closed", never "Deleted"; a refusal is "Not deleted" in the server's words, a stale one with Load the saved record; a lost answer is "It may have been deleted", checked by a read, and Delete it again asks again. While a deletion is out the record's forms send nothing on Save, and the unsaved-changes guard counts it -- and one that may have been done -- as work: the detail's, when it names the open record, and otherwise its grid's, which only another form, Back or Forward and Sign out ask about. In Separate views an answer that asks something of the person shows the view it is drawn in. The open form's tags now name Delete, and the route test holds the journey to every runtime route, the delete route included. Why: the person asked for delete after the workspace, in the detail and on each row, behind one confirmation (the decisions of 2026-10-11). Noticed: a grid of a form that offers delete has one more column; a row's delete of a record changed since its page was listed is refused as stale until the page is listed again or the record is opened; a deletion discarded while out is heard of again only if it was done; the README gains a picture of a row's confirmation, `host-delete`; the getting-started guide's own form still grants no delete, since the studio writes no delete roles yet. No upstream `@formancy/*` version changes.

**The studio grants delete, and asks for each foreign key a delete acts through by its own box** ([0052](docs/decisions/0052-the-studio-says-before-publication-who-may-delete-and-what-a-delete-also-does.md)). The Policy step gains "Roles that may delete", written to `operations.delete` and left out while it names nobody, and says whether the form offers delete and that a role that may delete must read. Where the form offers delete, a fieldset, "What deleting a record of sales.order also does", has one box per key that cascades, sets NULL or sets a default onto the form's table or any table a delete of it removes rows from -- for the fixture's order `fk_delivery_order`, `fk_order_line_order` and, two levels down, `fk_parcel_delivery` -- each ticked adding that key with its action to `cascades`, and never one control for them all; lists each key that only refuses, NO ACTION or RESTRICT, with no box; says in the publish check's words what no box can fix (a table the account may not DELETE from, a gap, a table outside the scope, a SET NULL another key follows); says the list is every foreign key the catalog shows onto the form's table, each table a delete removes rows from and each column it clears, or that it is not -- and then never that no key acts -- and that triggers and rules are not listed; and offers to remove an acceptance the delete does not act through. Why: 0050 and 0051 held delete and its reach on the server, and the studio's check ran `validatePolicy` alone, so a delete grant it called fitting was one the server refused at publish; now the Policy step's check and the Publish step ask `deleteProblems` too, and the order form is published deleting from the studio. The Generate step says "Delete: offered" or "not offered" with the generator's note, and the Choose step's version column and its hint say that without one neither update nor delete is offered. The Drift step says delete where the published policy grants it; where review blocks it and the runtime's verdict does not -- a key nobody accepted, DELETE revoked on a table it reaches, a gap over what refers to one -- it says the server still allows delete, as it says of a create or an update (0041), with what each delete's own statement still refuses: a key that acts and the policy does not accept, and a table it reaches without DELETE; behind a gap that hides only a key that refuses, deletes still run. `@formancy/data-core` exports `deleteReview(snapshot, root, policy)` with the types `DeleteReview` and `ReachedKey`: the walk `deleteProblems` takes, key by key, which the studio shows and decides nothing of; `deleteProblems`' words are unchanged. Noticed: one more fieldset in the Policy step, with a box per key, which grows with the schema; the list is the snapshot the form was generated from, so a key added since is asked about only once the form is generated again, while drift review reports it and, where it acts, each delete's statement refuses it; the README's Generate picture was retaken for its Delete line; an operator behind Cloudflare changes nothing, no route changed.

**The host identity key can be a set of keys, each selected by `kid`, read again from its file on SIGHUP, so a key is rotated without a restart** ([0059](docs/decisions/0059-the-host-identity-key-is-a-set-selected-by-kid-and-read-again-on-sighup.md)). `FORMANCY_DATA_IDENTITY_KEYS_FILE` names a JSON Web Key Set by absolute path, and `FORMANCY_DATA_IDENTITY_ALGORITHM` pins RS256, ES256, EdDSA or HS256 for every key in it. A key that cannot verify that algorithm, or whose `use`, `key_ops` or `alg` says it is not for it -- Keycloak's encryption key -- is left out and named in the log; a private key member, a missing or repeated kid among the keys in force, a key that does not import, an RSA key under 2048 bits or with a public exponent that is even or under 65537, an Ed25519 point of small order -- under either, a signature nobody made verifies, and `createPublicKey` imports both -- or a secret under 32 bytes refuses the whole set, in a sentence that holds no text of the file. A kid is logged, so one beside a key that is not a public key, that is its own `k` or as long as a 32-byte secret, is named by its place, and refuses the set when its key is in force: an HS256 kid of 43 base64 characters or more is refused. A token's kid selects its key and no other, an unknown kid is `ERR_JWKS_NO_MATCHING_KEY`, and a token without one is tried against each key in file order; no member of a token's header but its kid chooses a key, and nothing is fetched. On SIGHUP the server reads the file again: a valid set replaces the one in force between tokens and the log names the kids added, removed and replaced, or that nothing changed; a file that cannot be read or is refused leaves the set in force and is logged at `error`, and the same file then stops the next start until it is fixed. A path that is not a regular file is refused at once, where `readFile` on a FIFO waited for a writer and held every later SIGHUP, and SIGTERM's exit, behind it; a file on a network mount that stalls still stalls the read. The image ships `dist/identity-keys-cli.mjs`: `check <file> <algorithm>` runs the server's own reading of a file before it is renamed into place, and `convert <kid>` writes the secret or public key the server verifies with today as a one-key set -- the base64url of the secret's bytes after `resolveSecret` has taken off a trailing newline, because the secret's text is itself valid base64url and another key. `readKeySet`, `KeySet` and `openKeySetFile` are exported for an embedder, whose `key: { kind: 'key-set', keys }` must return a set the builders made; `KeySet`, its prototype and every set are frozen, and a set offers no `verify` of its own, so code that reaches the class cannot change what the verifier accepts. Why: rotating was a restart, which closes every connection and forgets the write ids 0031 keeps in the process, and a provider's rotation needs the old key and the new one at once; 0014's reasons against a URL still hold, so the operator's own job fetches a provider's set, runs `check`, renames it into place and signals. Noticed by operators: the server now handles SIGHUP instead of exiting on it, with a one-key setting too, where it logs that it read nothing; the refusal of a missing or doubled identity setting names all three; every refusal of the identity key at start -- a secret or a key file that cannot be read, a secret under 32 bytes, a public key that does not import, a refused set -- is one sentence and exit status 1 instead of a stack trace, and `createIdentityVerifier` refuses a public key that does not import with the sentence, a `KeySetRefusal`, where jose's `TypeError` was; and the composed stack's minter refuses `FORMANCY_DATA_IDENTITY_KEYS_FILE`. Not run through a Kubernetes cluster, where a `subPath` mount is never updated, by Kubernetes' own documentation; measured once and not in CI, on Docker 29.8.1, a file bind-mounted on its own kept showing the old file after a rename on the host, so the guide mounts its directory.

**The release report names the browser behind every browser gate result and observation.** Each app's browser gate now runs through one helper, `recordedPerBrowser`, once for each browser `FORMANCY_BROWSERS` names -- unset, Chromium alone; `all`, every browser the gates run in, which is Chromium; a choice that leaves no browser is refused -- and writes `test-results/browser-chromium.json` instead of `browser.json`, with the options the browser was launched with, `PWDEBUG`, and each check by name under the pass it was made in, which the report's JSON keeps in each browser's row. The helper launches the browser and fails a run in which a check failed, whether or not the gate's script threw. The CI `browser` job is a matrix of one leg, `browser (chromium)`, whose artefact is `release-results-browser-chromium`; `collect.mjs --job browser` needs `--variant <browser>` and lists a file whose browser, asked for or launched, is not the leg's; turbo passes `FORMANCY_BROWSERS` to the gates; and the report's observations gain a Browser column. The report now fails an app whose gate left no results in a browser the gates run in, a browser launched that no pin holds, a gate that made no check or no pass at a viewport width, which it counted as passed, and a Chromium launched headed, on a channel, from an executable of its own or under `PWDEBUG`, which starts the full browser Playwright pins at the headless shell's version, where it counted results per app and held Chromium's version alone to a pin. Why: a gate run in more than one browser must be reported per browser, and merged observations would credit one browser with another's values; this is the mechanism Firefox and WebKit will use, inert while the gates run in Chromium alone. The checks, by name and order, and the browser they run in are unchanged. No upstream `@formancy/*` version changes.

**A delete may reach other tables through the foreign keys its policy names, each with what it does** ([0051](docs/decisions/0051-a-delete-reaches-other-tables-only-through-foreign-keys-the-policy-names.md)). A policy's new optional `cascades` lists `{ table: { schema, name }, foreignKey, onDelete }`, `onDelete` one of `cascade`, `set-null`, `set-default`; a policy may grant delete over a table other tables' keys cascade onto, clear or default in only where it names every such key in the reach with its action -- the fixture's order form names `fk_order_line_order`, `fk_delivery_order` and, two levels down, `fk_parcel_delivery`, and its delivery form, which offers delete on both engines since 0057, `fk_parcel_delivery` -- and the account may DELETE from every table reached. Refused at publish, on every read and by the planner: a key in the reach not named, or named with another action; an entry naming a key the delete does not act through, one onto a table it only clears included; a cascade or a SET NULL into a table outside the approved schemas; a SET NULL whose cleared column another key follows ON UPDATE; a table past the root the account may not DELETE from; a `referenced-by` gap on any table of the reach; and `cascades` on a form nobody may delete with. Each engine holds the database to the reach: PostgreSQL takes the locked path for every delete past its record, locking each table it reaches ROW EXCLUSIVE first, its guard accepts exactly the named keys, and the statement asks DELETE on every table past the root under that lock -- the lock alone is taken with any grant to write, INSERT or UPDATE included -- and deletes nothing where one is refused (`permission-denied`); SQL Server's batch guard reads the whole reach and refuses, rolled back, a delete whose account may not DELETE from a table it reaches (51708, `permission-denied`). `GET /v1/forms/:id`'s `deleting.cascades` and `.clears` now come from the accepted keys. Drift compares what refers to every table of the reach. The getting-started gate deletes the fixture's order, with its line, deliveries and parcels, through a second form whose policy names the three keys. Why: the person asked that each key that deletes or clears rows be named with its action, the account be able to delete from every table reached, and anything new refuse; without it no order of the fixture could ever be deleted. Noticed: a policy that names `cascades` is refused by a server older than this release; on PostgreSQL a delete that reaches past its record now runs in a transaction that locks every table it reaches, under any isolation, and an answer lost there before the commit was sent leaves nothing deleted, where SQL Server's batch, lost after it committed, leaves everything deleted -- unknown either way; the rows a cascade reaches are asked of no form's policy, and on both engines neither the deleting account's row security nor its grants stop a cascade -- the module now asks for DELETE on every table reached itself, on both; on PostgreSQL a cascaded table's BEFORE DELETE triggers and its rules run as that table's owner, its AFTER DELETE triggers as the deleting account; a reference cleared by a delete does not move the referring row's version column, where a rowversion moves; a new key that acts on any table of the reach refuses deletes of the form until it is republished; the performance page has no delete figure; an operator behind Cloudflare changes nothing, no route changed.

**A key of one column that `gen_random_uuid()` or `newsequentialid()` fills, and no foreign key includes, counts as one the database numbers, so PostgreSQL's deliveries offer delete** ([0057](docs/decisions/0057-a-key-of-one-column-filled-by-a-never-repeating-default-counts-as-numbered.md)). 0050 offered delete over a version column the module maintains only where an identity numbers a column of the key, so a table keyed by a uuid its default fills -- the fixture's `sales.delivery` on PostgreSQL among them -- offered none. Now the whole key, one column, filled by the engine's own default that never repeats -- `gen_random_uuid()` on PostgreSQL, `newsequentialid()` on SQL Server -- counts too, recognised from the default as the snapshot spells it, compared whole and by the snapshot's own engine, where no foreign key of the table includes the key; a constant, `uuid_generate_v4()`, `newid()`, a function of another schema with the same name, a definition the account may not read, the same default beside another key column, and the same default on a key that is also a foreign key do not. PostgreSQL's discovery now reads with `pg_catalog` first in its transaction's `search_path`, before the connection's own, so PostgreSQL's own function is the one it spells bare. Drift review and the runtime stop delete when such a key's default is changed, dropped or hidden, or a foreign key comes to include it. **Why:** the person decided that those two defaults never hand out one value twice in practice, so a record deleted is never created again under its key by them, and a version column proves a record there as it does over an identity; but a lookup through a foreign key that includes the key writes the key from the record a person chooses, and any form over the table may offer that lookup; recognising the default by a part of its name would count a function anybody can name alike, and spelling it under the connection's `search_path` let whoever may CREATE in a schema named before `pg_catalog` choose which key counts. **What you will notice:** a form over such a table offers delete once regenerated and republished, and a grant of it on the fixture's delivery form is refused for the parcels that cascade from a delivery unless its policy names `fk_parcel_delivery` in `cascades` (0051); a table that shares its parent's uuid key through a foreign key offers none; the generator's note where a version column proves nothing names the engine's default and the foreign key; `versionProvesRecord` and `deleteUnoffered` take the snapshot's `kind` first, and the table where they took its columns; on PostgreSQL under a connection `search_path` that names `pg_catalog` after another schema, a snapshot spells what that schema shadowed -- a type, a function in a default -- otherwise than before, once, and where that schema holds a function called `gen_random_uuid` the runtime, which reads a request's description under the connection's path, refuses every delete over a key PostgreSQL's own fills as drift that review does not report; and that the two defaults never repeat is their design, not a measurement here.

**A record can be deleted, one at a time, by its token and the version its person read** ([0050](docs/decisions/0050-a-record-is-deleted-one-at-a-time-by-its-token-and-the-version-its-person-read.md)). `POST /v1/forms/:id/records/delete` takes `{ record, version }` and a write id, asks the policy's new `operations.delete` before any statement, and deletes in one guarded statement that removes one row or none: on PostgreSQL a CTE that refuses a second row inside itself, on SQL Server the write batch, which rolls back past one; on both while the table's definition is the one the delete was decided over and no foreign key that cascades, sets NULL or sets a default refers to it -- and on SQL Server while the account still sees every such key. It answers `{ record, deleted: true }`, the token of the row deleted and nothing of its values; 404 for a record not found or outside the person's rows; 409 `stale`, `drift` or `schema-changed`; 422 `referenced` while other rows refer to the record, naming none of them -- the log names the key -- or `refused`; and 502 `unknown-outcome` with `operation: 'delete'`, where deleting again with the same version deletes nothing else. `GET /v1/forms/:id` lists `delete` and adds `deleting: { cascades, clears, restricted }` -- `null` without delete -- for a page's confirmation. `@formancy/data-client` gains `delete(formId, { record, version })`, a deletion done only on the server's answer, and `reconcile` reads an unknown one as `absent`, `unchanged` or `changed`. Drift review stops delete for a change to the key, the token or what refers to the table, DELETE revoked, or a key the database numbers no more, and calls such a change blocking only where the policy lets somebody delete. **Why:** the person asked for delete after the workspace, and a delete cannot be taken back: it names the version its person read, is scoped as an update is, and reaches nothing another table's foreign key would do on it until a policy can name such a key. **What you will notice:** a form offers delete only once regenerated and republished from a snapshot taken since 0049, and its bindings say `delete` -- every bundle published before says nothing and offers none, where `GET` used to offer any operation not marked `false`; a table whose version column the module maintains offers delete only where the database numbers a column of its key, so PostgreSQL's order lines offer none and SQL Server's do -- PostgreSQL's deliveries, whose uuid key a default fills (0056), offer it since 0057, as SQL Server's, guarded by their rowversion, do; a policy may grant delete only to roles that may read, never on a form whose rows nothing scopes while a lookup is filtered, and never while another table's key would cascade, clear or set a default on a delete, so the fixture's orders, whose lines and deliveries cascade from them, and its deliveries, whose parcels do, cannot be deleted yet; the generator's notes say "Update and delete are not offered" where a key or a token is missing; triggers that run on a delete are the database's, an AFTER DELETE trigger that inserts the row again is reported deleted, and on PostgreSQL a rule that acts on a delete makes every delete of its table refused, a soft delete written as a rule included; on PostgreSQL under an isolation other than READ COMMITTED a delete locks every partition and inheritance child of its table before its statement, where other writes lock the table alone; `RecordAdapter` gains `delete`, the audit trail the operation `delete` -- a delete's only trace, a keyed hash of its token, or nothing without an audit key -- drift's verdicts a `delete` and two kinds, `referrer-added` and `referrer-changed`, `UnknownOutcome.operation` a `delete`, and the client's `UnknownWrite` too; the host page's workspace sends it, and tags it with the rest, from 0053; a server older than this refuses a policy that grants delete, and this release's client answers `unexpected` to `form()` against a server older than this, which sends no `deleting`, so a host upgrades its server first. The Cloudflare doors forward the new route: an operator behind Cloudflare runs `tunnel-config` again, since a tunnel keeps the configuration it was given until then, as the guide's section 8 says; until then the door does not forward a delete, which fails closed.

**The test hop no longer counts one PostgreSQL write as two** ([0031](docs/decisions/0031-an-answer-lost-after-a-write-is-unknown.md)). `startTcpHop` in `@formancy/data-fixtures` let one 8-byte TDS packet header interrupt a marker on every wire. On PostgreSQL, where nothing cuts a marker, that matched one ending in `e` a second time, through the `e` of the `sales` bound eight bytes after it, so the PostgreSQL adapter's no-replay proof failed one run in sixteen with "expected 2 to be 1" -- measured on 2026-10-11, 12 of 200 inserts through the hop, each marker ending in `e`. The hop is now told what crosses it, `startTcpHop({ kind: 'postgres' | 'sqlserver' | 'http', host, port })`, refuses to start without it, and allows the header only on SQL Server, where a packet can cut a marker. That insert case now sends a marker ending in `e` on every run. Test support only: no published package changes, and no upstream `@formancy/*` version changes.

**The host page is a workspace: the forms a person may read, a form's records in a grid, the open record in the renderer they choose, and its child rows below** ([0047](docs/decisions/0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md)). Signed in, Forms lists what `GET /v1/forms` names (0045); a form's records are an AG Grid Community 36.2.0 grid -- `ag-grid-community` and `ag-grid-react`, MIT-licensed, pinned exactly and equal, their licence texts in the page's third-party notices (0046) -- one `records/list` page at a time (0044), searched when Search is pressed, sorted where the server says a field sorts, with a line that says the range and whether more follow and never AG Grid's own words. Space opens a row beside the grid and Enter opens it and moves there; the page, not the grid, decides which row is open. The record is drawn by `@formancy/react`, `@formancy/angular` or both, React until the viewer chooses, and the choice and the split between the records and the record are kept in that viewer's browser. Each child form the menu names lists the open record's rows below it, each opened in its own form, a new one preset with the record. Side by side, stacked or separate views; the address names the form, the layout and the view, and never a record, whose token spells its key. Why: a host's people work with records, not with one token at a time, and the person asked for a master and its detail with AG Grid, a menu of tables, both on one page or apart -- and no delete, so nothing on the page deletes. Noticed: **Sign in** replaces the form id and Open the form, and the getting-started guide's section 5 says so; **leaving unsaved work asks first** -- another row, New record, Load, another form, Back, Sign out, a child row and hiding a renderer wait behind "Unsaved changes", and New while a create is out now passes through it; a record created in one renderer is opened in the other, after the same question when that one holds a draft; a record's read or a form's definition answered after the person moved on opens nothing over what they typed since, and work typed while a question waits is named before Discard drops it; Back onto an entry an earlier sign-in left in the history is asked about as an address, never read as a direction; a reload or a closed tab still does not ask; the grids' columns are sized to their content -- the first page's, and the rows shown each time the split is let go, as the person decided -- and never stretched to the lane's width; Open by record token is a disclosure before Record token and Load; `@formancy/data-server` exports `ROUTE_OPERATIONS`, the runtime plane's routes with their audit names, which the host page's suite holds itself to; the workspace's chunk, AG Grid in it, is 1,064.05 kB minified and 304.53 kB gzipped at `@formancy/*` 0.5.0, loaded after sign-in (`vite build`, 2026-10-11); and the host's README pictures are taken in the workspace at 1440 pixels, past its widest breakpoint, the save refused after drift among them, with one more, the unsaved-changes notice, in *More* after the save whose answer was lost.

**A uuid key is proven end to end on both engines; a key the database fills is never written by a form unless the person gives another part of it; and a uuid is ordered as each engine orders it** ([0056](docs/decisions/0056-a-key-the-database-fills-is-never-written-and-a-uuid-is-ordered-as-each-engine-orders-it.md)). The shared fixture gains `sales.delivery`, keyed by a uuid its default fills -- `gen_random_uuid()` on PostgreSQL, `newsequentialid()` on SQL Server -- a child of an order with a tenant of its own, and `sales.parcel`, whose foreign key is onto that uuid; the order form's own account may read and insert both, update a delivery's carrier and shipping time but never its key, tenant or order, and delete both, so a delete of an order, which now cascades through its deliveries into their parcels, reaches no table it may not delete from; a composed stack whose databases were loaded before this change has neither table nor those grants until `docker compose --profile stack down -v` loads them again. On SQL Server the delivery's key is nonclustered, so its rows are a heap as PostgreSQL's are and a lookup's tie-break on the key shows on both engines. (Not `sales.shipment`: that name is 0026's table of column facts.) New shared cases, `uuid: *`, run on both engines as that account: the key and its default discovered, one lower-case token though SQL Server prints a uniqueidentifier in upper case, a create answered with the key the database chose, an update and a stale one, another tenant's delivery not found, a list under an order, sixteen deliveries paged, and a lookup onto the uuid, whose options tied on one carrier come in each engine's order of their keys. Every suite that starts the fixture loads the two tables and five rows more: a median of 258 ms before and 264 ms after on PostgreSQL, 291 and 306 ms on SQL Server, nine loads each on 2026-10-11. Noticed by integrators: **the generator no longer writes a key column that has a default and is not generated when it is all of the key the request does not pin** -- a uuid key alone, or `(tenant_id, id)` with the tenant pinned; such a key is shown in the Record section, never written or required, as an identity is -- because a form that offered it let a person type the address of the record they were creating; a policy that grants write on such a key is now refused at publish, and a form published before keeps its stored base until it is regenerated; a key the person gives another part of, `(order_id, id)` unpinned, still writes its uuid. And **a list ordered by a uuid key, or a lookup whose labels tie, comes in another order on each engine**: PostgreSQL compares a uuid's bytes in turn, SQL Server the bytes it stores, group by group from the last, its first three groups stored little-endian -- measured on both, not a collation as 0012 and 0044 said, and left as each engine's own because ordering by the text would sort every row for every page; each order is total and stable, so paging stays consistent. And on SQL Server a `newsequentialid()` key rises across every tenant of the server, so a record token tells a tenant that keys were handed out between its own creates; `gen_random_uuid()`'s say nothing of the kind.

**Every `@formancy/*` dependency moves from 0.4.0 to 0.5.0, upstream's release of 2026-10-11, adopted the day it was published, and generated forms stay on spec 3** ([0042](docs/decisions/0042-generated-forms-stay-on-spec-3-after-spec-4-is-released.md), [0055](docs/decisions/0055-an-upstream-release-is-adopted-the-day-it-is-published.md)). Why: 0.5.0 is upstream's newest release, nothing this repository calls changed shape, and its version 4 is still the newest spec version, so moving costs no generated form anything; it brings the renderers' own words from one catalogue in the form's language, a layout that places a group whole, and `runScenarios` reading an example's `absent` through its path. The 23 exact pins in six manifests move together, and the lockfile changes only in the eight `@formancy` entries, `@formancy/expressions` beneath the others; nothing new is installed, and their third-party dependencies and peers are 0.4.0's. pnpm 12 refuses a package published less than a day before, a lockfile's included, so `pnpm install --frozen-lockfile` -- run by every job of the gates workflow, itself or in building the composed stack's two images, and by the release's check -- refused the eight with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`, watched with pnpm 12.4.2 on 2026-10-11; `pnpm-workspace.yaml` now exempts each of them by its exact version, as pnpm wrote them, and `scripts/upstream-deps.mjs` refuses an exemption for a package outside upstream, a name or pattern without an exact version, or a version the lockfile no longer installs, which the next bump therefore removes -- watched refusing all three. No package's code changed. Generated forms stay on spec 3: 0.5.0 reads it as 0.4.0 did, version 4 is unchanged and still has nothing a column gives besides `step`, and a renderer at 0.3.0 still refuses a spec 4 form, so 0042 holds as written, and data-core's generate suite still fails if the generator writes another version. What a user or integrator notices: no generated form changes, and both snapshot captures, run again on 2026-10-11, came back byte-identical, so every committed snapshot keeps its fingerprint under 0.5.0's `schemaHash`. The renderers on the host page, the studio's preview and the examples page say what they said: their own words -- Next, Back, Submit, the required hint, the error summary's heading, what a lookup says while it searches -- now come from `@formancy/core/words` in the form's language, and nothing here generates a form with a catalogue or builds an engine with a locale, so they stay English, the same English as at 0.4.0 wherever these pages show it, and "Save" and "Validate" are still the pages' own `submitLabel`. The Angular renderer's markup gains one empty comment for each placed field, the anchor of 0.5.0's new branch for a group placed whole, which neither the accessibility tree, axe nor the layout sees: the Angular forms of the examples and host pages, compared in Chromium against main at 0.4.0 on 2026-10-11, differed otherwise only in section ids that already differ from run to run at 0.4.0, and React's markup did not change. An integrator whose host builds its engine in German or French gets German or French buttons, accessible names and announcements once its own renderers are at 0.5.0, and a test of theirs that finds those controls by their English names stops finding them; that is upstream's breaking change, and nothing in this module's API moved with it. `@formancy/data-client`'s types are now `@formancy/spec` 0.5.0's: a host whose engine is at 0.4.0 compiles `createFormEngine({ schema: published.form })` against them, and one at 0.3.0 still fails with TS2322 and casts the form, both measured on 2026-10-11 with TypeScript 6.0.3 and `skipLibCheck` off. The administrator plane's `invalid-bundle` sentences are the validator's, and none of 0.4.0's changed; 0.5.0's validator adds one that can reach them, `layout.placedInGroup`, refusing a layout that places a group whole beside one of its own fields, which no generated form does, and its other new code, `version.property`, is said like every `version.*` code in this server's own sentence that the form needs a later spec (`packages/data-server/src/served-schema.ts`), never in the validator's. The bundles grow, measured with `vite build` on 2026-10-11 against the same tree at 0.4.0: the studio's one chunk from 730.1 kB to 754.7 kB minified, 198.1 kB to 205.2 kB gzipped, under its 760 kB warning limit, with the renderers' words in English, German and French now in it; the host page's main chunk from 431.9 kB to 445.4 kB and its Angular chunk from 224.8 kB to 229.5 kB; the examples page's from 460.1 kB to 473.5 kB and 220.9 kB to 225.8 kB; each app's stylesheet by 0.2 kB. Still true at 0.5.0, each read again in upstream's source or tested again: neither renderer holds the form while a save is out, nor has an option to hold it or to leave out its submit button; the engine checks a disabled field; an answer is checked only once `validate()` has run; `TEMPORAL_SHAPES` is unchanged, so formancy's instant is to the second and its time to the minute (0040), and React's datetime control saves the local minute; a renderer's option contract has nowhere for `hasMore`; the lookups' 250 ms debounce; and React draws a sentence without `aria-required` where a lookup's options cannot be filled, so the studio preview's Customer field still loses its required marker. The three copies of the admin's palette -- the examples page's `app.css` and the studio's and host page's `styles/room.css` -- follow upstream's `apps/admin/src/admin.css` at 0.5.0, whose `--display` stack now names `'Archivo Variable'` after `'Archivo'`; the pages load Archivo from Google Fonts under the first of those names, and 0.5.0's new `--wb-caution` is a builder pane's colour, which none of them copies. The README's pictures were retaken on 0.5.0's themes and on that stylesheet and came out byte-identical, so only `docs/images/readme/captured.json`'s stylesheet records moved. Noticed by operators who build the composed stack from a checkout: its images install with this repository's `pnpm-workspace.yaml`, so on the day a release is adopted they install it without the wait too (0055). Noticed by whoever releases next: `node scripts/performance-stale.mjs` now also names `@formancy/spec`, measured at 0.4.0 and installed at 0.5.0, and `packages/data-server/src/served-schema.ts`, whose comment moved, so the published figures were measured with the schema validator one release older than the server now runs, and `pnpm performance` (RELEASING.md, step 2b) is due before a release, as it already was. Upstream `@formancy/*` 0.4.0 → 0.5.0.

**A snapshot says whether its account may delete from each table, and every foreign key that refers to it** ([0049](docs/decisions/0049-a-snapshot-says-whether-its-account-may-delete-and-what-refers-to-each-table.md)). Each table and view now carries `access: { delete }`, the database's own DELETE check (on PostgreSQL with USAGE on the schema), and `referencedBy`, every foreign key the catalog shows that refers to it -- from a table in any schema, named there and nowhere else, with its columns, actions and enforcement. A key between two tables of a snapshot is said at both ends, and `createSnapshot` refuses the two disagreeing. On SQL Server an account without database VIEW DEFINITION, or with a VIEW DEFINITION or CONTROL deny on any object or schema, cannot establish that it sees every such key, and its snapshot carries a new `referenced-by` gap, by the same rule as the row-security gap. What a delete reaches through something not listed is a `referenced-by` gap on the table for every account: on PostgreSQL a key declared onto one of its partitions or onto a table that inherits from it, which the catalog records there alone and a delete from the parent still fires; on SQL Server a graph edge constraint that connects a node table, which is not a foreign key and still cascades or refuses a delete. `enforced` on a key that refers to a table says less on PostgreSQL than on SQL Server: a PostgreSQL key whose referring checks are disabled reads not enforced and still acts on a delete. Nothing deletes yet: nothing decides by either fact in this release, and drift review only asks whether a snapshot records them. **Why:** a delete is to be offered only where the account can make it and where what it also does to other tables -- a cascade, a cleared reference, a refusal -- can be seen and reviewed before publication, and the keys that decide that are on other tables, some outside the approved schemas. **What you will notice:** a snapshot taken from now on hashes differently from one taken before, so drift review compares a form published before this change family by family instead of taking the fingerprint's fast path, with the same report, until it is republished; a snapshot taken before keeps validating with the fingerprint it was stored with, and drift does not report the new gap against one; a partitioned or inherited PostgreSQL table with a key onto a partition or a child, and a SQL Server node table with an edge constraint, now shows a `referenced-by` gap, the owner's snapshot included; the captured snapshots of the studio and the examples page were recaptured, and the studio's Connect picture retaken, because the SQL Server reader now shows one gap more; the fixture's writer, and so the composed stack's, holds DELETE on `sales."order"` and `sales.order_line` -- a stack whose databases were loaded before this change keeps the grants it was loaded with until `docker compose --profile stack down -v` loads them again; a server from before this change refuses a snapshot with a `referenced-by` gap, and a form published from one.

**The README leads with what the module does and how to try it, its visible pictures show each part at work, and three new ones picture a save the runtime refuses after drift, the grants of a moved key and order lines reached through their order** ([0038](docs/decisions/0038-readme-pictures-are-taken-by-a-script-and-held-to-the-text-they-show.md)). The README now opens with the pitch, the hero, a Status paragraph that describes one point in time -- nothing released, and what is not there yet: a release, a page that draws a list of records, a host page that draws a field an update may not write as read-only, a run through a real Cloudflare tunnel, a licence a lawyer has reviewed -- then *Try it*, which points at the getting-started guide CI runs, and *What it does*, for the administrator, the person filling in a form and the operator, each line linking the decision records that hold it and saying the costs they state where a reader would otherwise assume more: that a child table is kept to its parent's tenant only when its policy names the parent's lookup in `through`, which nothing requires, one hop, never over a text key, and on PostgreSQL not against a concurrent move of the parent ([0043](docs/decisions/0043-a-child-forms-rows-are-reached-only-through-a-parent-its-policy-admits.md)); that a moved key's grants are confirmed in the publish over the version they were written in, over a version the server still serves, and that grants removed and given back are not asked about ([0039](docs/decisions/0039-a-publish-says-what-happens-to-the-grants-of-reassigned-keys.md)); that what Chromium resends after a lost answer is answered, not applied, within one server process ([0031](docs/decisions/0031-an-answer-lost-after-a-write-is-unknown.md)); that the notices miss what Vite folds in as text ([0046](docs/decisions/0046-a-built-app-carries-the-licence-and-notice-texts-of-everything-it-bundles.md)); and that row-level security is said per table, not per column ([0027](docs/decisions/0027-a-snapshot-says-what-its-account-may-do.md)). Sentences that told the history of a step rather than the present, and two that nothing checks -- that the form operates without any AI dependency, and an undated size of the SQL Server image -- are gone; the studio's section is what the studio is, and its pictures' captions say the rest; the host page's is short paragraphs, and says that it draws read-only fields as editable, which was filed only beside the pictures, and that of its suites and checks only host-drift's check, on PostgreSQL, holds it to showing a drift refusal; the packages table says what `@formancy/data-core` and `@formancy/data-fixtures` hold now; the Cloudflare guide and the server's `400` `path-not-plain` are under *Deploying*; the notices are two sentences, with the detail left to 0046; and that generated forms stay on spec 3 after 0.4.0, and that a TypeScript host on 0.3.0 casts the form or moves to 0.4.0, is said where the README relates to formancy.ai ([0042](docs/decisions/0042-generated-forms-stay-on-spec-3-after-spec-4-is-released.md)). **The pictures.** Outside a `<details>` now are the policy's tenant pin and the conflicting publish in the studio, so connecting, generating, governing, publishing and reviewing drift each show one, and in the host page the typeahead offering clara her tenant's customer alone, which also introduces her, and the stale save; the lost answer moved into *More*, beside the new save after drift. Three pictures are new. `host-drift`: clara's save refused with 409 `drift` after the capture script narrowed `sales.order.status` through the database's owner, the row unchanged and drift review saying writes stop ([0041](docs/decisions/0041-the-runtime-refuses-what-drift-blocks.md)); the act reads the column's width from the catalog before and after, so the caption's `varchar(20)` and `varchar(8)` are held (watched failing with 9 for 8). `studio-keys`: the Policy step asking about a key that a regeneration gave to another column, with the Publish step's button held disabled (watched failing with it left enabled for undecided keys). `studio-through`: a form over `sales.order_line` whose rows are reached through its order list, the step's note that nothing scopes them seen before the box is ticked (watched failing with the note taken out), taken as the fixture's owner, a connection the studio's pictures plane now has because the order form's own account may not read the lines. Captions are shorter; the policy picture's no longer explains the box under its Customer list, the restored picture's says the script put the snapshot back without the rename, the moved key's says that nothing can tell a renamed column from another, and the lost answer's says the page sends nothing again rather than that nothing does; the preview's alt no longer says Customer is marked required, which it is not. Two copy defects the pictures show are filed beside the read-only fields: a restore's help line already names the version after the one just made, and the moved key's two column names differ by a space set in proportional type. 0038's Status line says which of its lists describe 2026-10-10 and what extends them, and its limitations entry was read again and stamped. Every picture was retaken; `studio-regenerated` and `studio-restored` came back with the same text and pixels that differ from the committed ones by at most 28 of 255 levels in a channel (decoded and compared in Chromium on 2026-10-11), and main's own studio and script retake them to the same bytes as this branch, so they had drifted before this change, where `--check`, which compares text, cannot see. **Why:** a reader should see in seconds what the module does today, see each part do it, and find the way to try it, and the Status paragraph had become the history of every step since the first. **What it costs:** the `order_date` rename `studio-keys` shows is made by `renamedColumn`, which the adapters' discovery suites hold to a real rename of `notes` alone; *Try it* names the guide's command without repeating it, so it adds no copy that could drift; and GitHub's column width is still unmeasured, its assets held for approval on 2026-10-11 by the machine the pictures were taken on, so whether the hero's digits can be read at the width GitHub scales it to is for the pull request's first review to say. No package's code changes, and no upstream `@formancy/*` version changes.

**A person is shown the forms they may read, and the children under each** ([0045](docs/decisions/0045-the-runtime-plane-lists-the-forms-a-person-may-read-and-nothing-about-the-others.md)). `GET /v1/forms` answers `{ forms: [{ id, title, operations, children: [{ form, field }] }] }`: every published form whose policy lets this person read, in codepoint order of its id, with its title, the operations the policy grants them of what it offers as published, and the forms whose rows a page may list below one of its records -- and nothing about any other form, so publishing one a person may not read leaves their answer the same to the byte. A form they may only create with is not named: the menu opens grids, and a grid reads. A child is derived from the published bundles, never declared: a lookup of another form on the same connection onto this form's identity, column for column in order and of the same normalized types in each form's own snapshot, so this form's record token is a value the child's field takes and a page hands it to the child's list as its `parent` (0044), which holds the rows that reference that record by the database's own equality -- under a collation that ignores case or trailing spaces, rows of a text key can spell it otherwise than the token does; it is named only where this person is offered that list and may read that field. Every request reads and validates every published form's newest version, and a form whose version no longer validates, does not parse or cannot be read, whose connection the allowlist does not have, or whose bindings a hand edit left in a shape the menu cannot read, is left out with the server's log saying so, where a 500 would let one bad file hide every form from everybody and answer with the error's message; a store that cannot list its forms is a 500 `store-unavailable` that names no path. The menu asks no database: opening a form (`GET /v1/forms/:id`) still decides what the database allows now (0041), starting from the same `grantedOperations`, so a form the menu names can still be refused as drift, and a child it names offered no list then. `@formancy/data-client` gains `forms()`, which takes an answer only in the server's shape. **Why:** a host's workspace opens with a choice of forms, and a host had only the form ids it already knew; a list of every id would have handed every person the name of every form. **Noticed by integrators:** the audit trail has a new operation, `form-list`, which names no form, version or record; data-core exports `menuForm`, `formMenu`, `grantedOperations` and `childFields`, the types `MenuBundle`, `MenuForm`, `PublishedTable`, `ParentKey` and `ChildLookup`, and the wire types `FormMenu`, `FormMenuEntry` and `FormMenuChild`, which data-client re-exports; `validateBundle` no longer throws on bindings of another shape than it reads -- fields or a root that are `null`, say -- so such a version is 500 `corrupt-bundle` on `GET /v1/forms/:id` with its problem in the log, and a publish of one 422 `invalid-bundle` with the problem named, where each was a 500 carrying the exception's message. Release gate 5, server permissions that hold whatever the page does, counts the menu route's suite as evidence. **Measured once, not published:** the menu is in none of the published performance figures; in-process on 2026-10-11 it took about 2 ms a published form -- 180 ms over a hundred of the fixture snapshot's size -- for a person granted nothing as for one who reads them all, work any host token can ask for and only the server's one rate limit bounds; 0045 says how it was measured, and what a published measurement and a remedy would need. No upstream `@formancy/*` version changes. Noticed by operators behind Cloudflare ([0037](docs/decisions/0037-cloudflare-is-the-edge-not-the-runtime.md)): the runtime door's pattern, generated from the server's router, now forwards `GET /v1/forms`, and the runtime door's server in `deploy/web/nginx.conf` passes it to the server by a location of its own -- without one, nginx answered `/v1/forms` itself with a redirect to `/v1/forms/` -- so rebuild the web image, and run `tunnel-config` again, since a tunnel keeps the configuration it was given until then, as the guide's section 8 says; until both, the door does not forward the menu, which fails closed.

**The licence names where a redistribution agreement is asked for: Version 1.1** ([0054](docs/decisions/0054-version-1-1-names-the-address-for-a-redistribution-agreement-too.md)). `LICENSE.md` is Version 1.1, in force from 11 October 2026, replacing Version 1 of the same day and Version 0. Section 9 adds one sentence: the separate commercial agreement that Redistribution requires, which section 3 describes, is requested at the same address as a production licence, info@formancy.ai. Nothing else in the terms changes, no legal term is added, and Version 1.1, like Version 1, says at the top that no lawyer has reviewed it. **Why:** Version 1 told anyone shipping the module inside a product of their own that they needed a separate agreement, and not where to ask for one -- a cost 0048 listed. **What it costs:** an address is not terms: the agreement's terms and price are not published, and whether a managed service you run for a client needs it or a production licence is as unsettled as 0048 says; one mailbox now carries both, and nothing checks that it is read; and whether Version 1.1 changes anything for a copy received under Version 1 is a lawyer's question, open. **Noticed by contributors:** `scripts/licence-status.mjs` reads a version line numbered N or N.N and keeps the number as written, so the README's and the Cloudflare guide's generated block say Version 1.1; it still refuses a draft's line, a reviewed licence's and any other, and a section 9 naming two addresses. Watched failing with the test changed first, against the old whole-number pattern. No package's code changes, and no upstream `@formancy/*` version changes; every tarball carries the new `LICENSE.md` from the next build.

**The licence is in force: Version 1, from 11 October 2026, which no lawyer has reviewed** ([0048](docs/decisions/0048-the-licence-is-in-force-before-a-lawyer-has-read-it.md)). `LICENSE.md` stops being a draft: Version 1 replaces Version 0, the draft of 8 October 2026, and says plainly that it has not been reviewed by a lawyer. Version 0's sentence granting the free rights and nothing beyond them until a reviewed version replaced it is gone, so a production licence can now be had; section 9 says production licences are requested from info@formancy.ai, and still that no price is published: it is to be set after the first design partners. A new last section, 10, says the licence is governed by Swiss law, excluding its conflict-of-laws rules, and that the place of jurisdiction is the Rightsholder's domicile in Switzerland, and adds no other legal term. The terms table and sections 1 to 8 are unchanged. **Why:** under Version 0 a design partner could evaluate the module and could not run it in production, so the price 0001 says design partners test could not be tested, and waiting for a lawyer's review would have held every production use until it happened. **What it costs:** terms nobody reviewed now bind both sides, and 0048 lists where they can be read two ways -- what Production Use and Redistribution cover, termination, and the table naming the customer where section 5 names the licensee as the owner of generated definitions -- and what Version 1 leaves open, each a lawyer's question: which court the Rightsholder's domicile in Switzerland names and whether it is exclusive, what "replaces Version 0" does for a copy received under Version 0 and what a later version does for one received under Version 1, whether section 10 governs a production licence, and whether the UN sales convention applies. Where a redistribution agreement is asked for, Version 1 does not say; Version 1.1, above, does. Gate 10's legal review of `LICENSE.md` is still open, and a release made before it ships under the version in force as it is. **Noticed by contributors:** the README's sentence about the licence -- its version, the day it is in force from, that no lawyer has reviewed it, and the address -- is now a block `scripts/licence-status.mjs` renders from `LICENSE.md`, and `pnpm test:repo` fails when any tracked document's block differs, naming `node scripts/licence-status.mjs --write`; when `LICENSE.md`'s version line is not one of a licence in force that no lawyer has reviewed, a draft's included, which the script refuses rather than renders; or when gate 10 is given evidence. Watched failing with section 9's address changed and with `LICENSE.md` put back to Version 0. No package's code changes, and no upstream `@formancy/*` version changes; every tarball carries the new `LICENSE.md` from the next build.

**A form's records can be listed a page at a time** ([0044](docs/decisions/0044-a-forms-records-are-listed-a-page-at-a-time-under-its-read-policy.md)). `POST /v1/forms/:id/records/list` answers `{ rows, hasMore }`: the records the person may read, each exactly what `records/read` returns for its token, with the fields they may read, searched as a lookup is searched -- the same validator and, on each engine, the same LIKE spelling, so `%`, `_` and `[` match themselves -- sorted by any readable column field the server offers, with NULLs last and the key ending every order, from an offset of a page no longer than a lookup's, and no total. A `parent` narrows it to the rows whose lookup field names one row, the token decoded as that lookup decodes a saved answer; it adds no permission. A list is a read: `operations.read`, the read filter and every `through`, from its first statement, so another tenant's order lines are never listed where the line form's policy names its order lookup in `through`, and no grant of its own. The policy is asked first, so a person it does not let read is told only that. A list is then offered only when every key column cannot be NULL and is in a field the person may read or pinned by their tenant filter, because every listed row's token spells its key, and only when something scopes the rows wherever a lookup's options are filtered: a policy with no row filter and no `through` while a lookup's options are filtered -- what every child form had to be before `through` -- is refused a list, which would hand every tenant's rows out in one request. Otherwise the route is 403 and `GET /v1/forms/:id`'s new `list` is `null`, and where offered `list` says which fields may be searched and sorted. Each page is one statement that carries the description of the table it read, decided over as a read is (0041), and also refused 409 `drift` when that description no longer holds the key unique and NOT NULL -- a key column made nullable, which drift review reports only as a note, or a key dropped, which it reports as stopping update -- because over either a page would hold a record twice or rows with no token in no defined order; `GET` then offers no list, and the server's log says `list`, as the audit does. `@formancy/data-client` gains `list()` and re-exports `LIST_PAGE_SIZE`, and its `form()` answers `unexpected` for a reply without `list`. **Why:** a host's grid needs a form's records, not one token at a time, and a list that handed out tokens for a hidden key, or listed a child table unscoped, would undo what the read policy and `through` keep. **Where the engines differ:** text, and a uuid on SQL Server, is ordered by each engine's collation, and a search folds case as a lookup's does; a parent over a text foreign key is compared with the database's equality, so `k1:ch` names `CH`'s rows on SQL Server under a case-insensitive collation and none on PostgreSQL under its default one (`list: text-parent`); a column outside the key made nullable since the form was published places its NULLs as each engine does until drift is reviewed; on SQL Server a list that outlives mssql's default request timeout, which this module does not set, is expected to be 503 `unavailable` as a read is -- inferred from the read's test, not tested for a list -- and on PostgreSQL nothing ends it. **Noticed by operators:** a child form published before `through`, with `rowFilters: []` and its parent lookup filtered, offers no list until it is republished with that lookup in `through` -- and until then any tenant's row is still read by a guessed token (0043); a form whose rows are meant to be shared while a lookup's options are filtered has no way to say so and gets no grid. **Noticed by integrators:** `RecordAdapter` has a method more, `list`, that every implementation and test double adds; the audit trail has a new operation, `list`, which names no record and never the search, the sort or the parent; `PublishedForm` has `list`; `driftRefusal` takes `'list'`, and `unscopedLookups` and `LIST_REFUSED` are exported, the studio's note on unscoped rows now asks `unscopedLookups` and says the server offers no list of them; the lookups' search and order spellings moved to each adapter's `sql/search.ts` and `sql/order.ts`, unchanged for every configuration the validators accept, but for two refusals now made before anything is sent -- PostgreSQL's lookup search over no column throws where it sent an empty `()`, and SQL Server's lookup order throws on a NULL placement other than first or last, where it placed one last -- and SQL Server's describe and read select the description as `[f].[facts] as [facts]`, the same column; `MAX_SEARCH_LENGTH` is exported from `lookup/search.ts`. Release gate 5, server permissions that hold whatever the page does, counts both adapters' list suites as evidence. **Not measured:** a list is in none of the published performance figures, and what a page reads -- every row before its offset, and every row its filters admit when no index serves its sort -- is how both engines run an offset and a sort, not a measurement of this module's; 0044 names what a measurement of lists needs. Noticed by operators behind Cloudflare ([0037](docs/decisions/0037-cloudflare-is-the-edge-not-the-runtime.md)): the runtime door's pattern, generated from the server's router, now forwards `POST /v1/forms/:id/records/list`, and a tunnel keeps the configuration it was given until `tunnel-config` writes it again, as the guide's section 8 says; until then the door does not forward the list, which fails closed.

**Formancy Data behind Cloudflare, and a server that refuses a path a proxy could read differently** ([0037](docs/decisions/0037-cloudflare-is-the-edge-not-the-runtime.md)). `docs/deploy/cloudflare.md` puts the composed stack behind a locally-managed Cloudflare Tunnel, with Cloudflare Access in front of the studio's hostname and nothing of the product running at Cloudflare. `deploy/cloudflare/compose.yaml` adds `cloudflared`, pinned by tag and digest, on a network it shares with the web front alone, and three tools built from Node's image with that image's own cloudflared binary copied in: `tunnel-setup` logs in, creates the tunnel, stops at a private network route to it, routes its hostnames without ever overwriting a DNS record, and writes the tunnel's configuration from the server's own routes; `tunnel-config` writes it again without a login or a network; `doors-check` asks the live hostnames, from outside, whether Access answers first, plain HTTP is redirected, and the runtime door brings runtime routes to the server and nothing else to a route or a file, and says "no answer" with the reason where there was none. The configuration replaces the one in use only after that binary calls it valid and matches every probe -- every route on each door, the pages, a trailing slash, a query string -- to the rule `deploy/cloudflare/doors.json` gives; setup and `tunnel-config` refuse arguments that would close a door the configuration in use opens, unless `--drop` names its hostname. The account login setup needs is written to a tmpfs that goes with its container when cloudflared fetches it; when it cannot, cloudflared says the browser will download it instead, and setup says to delete that file and revoke its token; past its first step the login is unmeasured. Setup ends by saying how to revoke the login, which nothing checks. Access is required in the tunnel's configuration, with the team and the application's AUD tag, as Cloudflare documents it; not yet measured through a tunnel. A second hostname, for a host application, forwards only paths matching a pattern generated from the built server's router, to a second server of `deploy/web/nginx.conf` that serves no file and passes only `/v1/forms` and what is below it to the server; `pnpm test:repo` fails when doors.json or the guide's generated blocks are not what that router registers. Why: a guide was asked for, and the honest answer is that Cloudflare can be this product's edge and not its runtime -- Workers, Hyperdrive and Containers do not run it as built, having no lasting file store, no single process for a write's id, and no SQL Server -- which the guide says first, with what Cloudflare decrypts and that anybody with Tunnel edit permission can stream every request header, host tokens included. Review found the runtime door on nginx's origin serving the studio's files to a path cloudflared and nginx read differently, cloudflared beside the server and both databases on compose's network, and a private network route to the tunnel as a door no configuration closes; each is closed or stated, and 0037 says which. On Cloudflare's Free plan the edge's rate-limiting rule cannot answer with the JSON body the guide gives it, which needs Pro or above, so there a write it blocked reads as one that may have been saved.

Noticed by integrators: **the data server now answers `400` with `path-not-plain`** to a path holding a percent-escape, a backslash, an empty segment, a `.` or `..` segment, or a character a path does not carry as itself, before authentication and before any route's work, where a route used to answer 401, 404 or 400. cloudflared 2026.10.0 was measured matching `/v1/forms/a/versions/..%2F..%2Fb` to a door meant for the runtime route `/v1/forms/b`, while the server routed it to the administrator's version read; no name the server accepts needs any of those characters, and the studio and data-client send names through `encodeURIComponent`, which leaves a valid name as it is. The refusal counts against the rate limit and, on a path that names a route, is that plane's one audit event with status 400. **Every answer the server's hooks run for now says `Cache-Control: no-store`**, so no cache that honours the origin keeps a form or a record from one: a form id may end in `.js`, which a CDN caches by extension. The router's own refusals, written before any hook, carry neither, nor do Node's parser's or nginx's own error pages, and the data server's README says so; none of them holds a form or a record. Noticed by operators: `compose.yaml`'s web front now also joins a network `edge`, which Docker makes for the getting-started stack too, and its nginx listens on 8081 besides 8080, published nowhere. Noticed by whoever releases next: the two hooks run on every request, so `docs/performance.md` was measured before them and `node scripts/performance-stale.mjs` now names `paths.ts` and `app.ts`; `pnpm performance` on a quiet machine, RELEASING.md's step 2b, is due before the release, which the release's `check` job otherwise refuses. A new CI job, `cloudflare`, with Compose 2.20.3 and the runner's, builds the tools, runs the configure step with a random fake tunnel, asks the pinned cloudflared what the result means, starts cloudflared as the overlay does with no network, and sends a corpus of paths cloudflared reads differently from the router or from nginx through cloudflared and on to the built server, which must refuse each, and through nginx.conf's runtime-door server in front of it, which must end each at that refusal or its own 404; the `container` job and the getting-started gate check both answers on a sample, through the image and through nginx. Nothing is measured through a real tunnel yet; 0037 lists what is not. No upstream `@formancy/*` version changes.

**A child table's rows are reached only through a parent the policy admits** ([0043](docs/decisions/0043-a-child-forms-rows-are-reached-only-through-a-parent-its-policy-admits.md)). A policy's new optional `through` names lookup fields whose filter on their target also scopes the form's own rows: a read and an update find a record only while the row each such lookup references is one its filter admits, in the same statements that decide "not found" -- the update's WHERE and the read that tells `stale` from `not-found` included -- so another tenant's order line is `not-found` whatever version is sent, though `sales.order_line` has no tenant column. A create must name a parent, checked as every selection is under the same filter, and an update may not clear one; a through over a lookup that offers every row, or over a text key, is refused at publish, the text key until a snapshot records collations. A form is not offered for an operation whose through the person's context cannot resolve: `authorizeOperation` refuses it `missing-attribute`, so `GET /v1/forms/:id` lists only what every request could then be scoped by. A key a through names is a grant for 0039's check, with or without a role on its field, so a regeneration that re-points it to another foreign key is refused until confirmed: the same filter through another parent can admit rows the old scope hid. The studio's Policy step offers the box under every filtered lookup over a key it accepts, and notes a form whose rows nothing scopes though a lookup's list is filtered. **Why:** a child form could be published only with `rowFilters: []`, and then a read by a guessed `k1:<order>,<line>` reached every tenant's lines, on both engines; the e2e suite showed tenant 2's clerk reading tenant 1's line with the form published without `through`. An update would have reached them too on a child with a version column; the fixture's lines had none until this change, so no update of one was offered. **Where the engines differ:** an update that waits for its row while another transaction moves the row's parent out of the scope is written on PostgreSQL, which reads the parent from the statement's snapshot, under READ COMMITTED and REPEATABLE READ, and is `not-found` on SQL Server, with READ_COMMITTED_SNAPSHOT off and on; a row filter on the row itself is `not-found` on both. Measured in the shared case `through: moved-parent`; locking the parent closes it on PostgreSQL, also measured, and is not done, because it needs UPDATE privilege on the parent and locks its row on every write of a child. **Noticed by integrators:** `sales.order_line` gains `row_version` -- application-maintained on PostgreSQL, a `rowversion` on SQL Server, as `sales.order`'s -- and every captured snapshot that sees it was recaptured; `ReadRequest` and `UpdateRequest` carry `through` (`[]` for none), and each adapter throws on a request without it before anything is sent, as on one without its filters; SQL Server's record statements alias their table `[r]`, `update [r] set … from <table> as [r]`; and a server older than this refuses a policy that uses `through`. Each through is one EXISTS more in every read and update, whose cost is not measured. Release gate 5, server permissions that hold whatever the page does, counts both adapters' through suites as evidence.

**The studio and the host page carry the licence and notice texts of every package they bundle** ([0046](docs/decisions/0046-a-built-app-carries-the-licence-and-notice-texts-of-everything-it-bundles.md)). Each app's build writes `THIRD-PARTY-NOTICES.txt` beside its `index.html`, which the composed stack serves at `/studio/THIRD-PARTY-NOTICES.txt` and `/host/THIRD-PARTY-NOTICES.txt`: every package whose module or file the page bundles, once, by name and version with the licence its `package.json` declares, followed by the full text of every file it ships whose name begins `LICENSE`, `LICENCE`, `COPYING` or `NOTICE` and is not a script or data by its extension, at its root and in any directory between there and a bundled file of it, where a package keeps code it vendors under that code's licence; so `rxjs`'s and `tslib`'s `LICENSE.txt` are there and so is upstream formancy's `NOTICE`. **Why:** the bundles keep no licence comment, so the code of React, Angular and upstream formancy reached every browser with none of the texts MIT and Apache-2.0 ask to go with it, and Vite's own `build.license` reads one licence file per package and never a NOTICE (both read with Vite 8.3.3 on 2026-10-11). A bundled package with no licence text at its root stops the build, naming it (a `license.js` is not one); so does a licence file that is not UTF-8, a module from neither node_modules nor this repository, one a plugin writes that is not among the bundler's reviewed helpers, a worker, whose code Vite bundles in a build of its own that this plugin does not see, and a file written from no source Vite names. This repository's own code, a workspace package included, is not listed, nor are the helpers Vite and Rolldown write into the chunks themselves, nor what Vite folds into a chunk or a stylesheet as text: a package stylesheet that a stylesheet `@import`s, a package's file under Vite's inline limit named by `url()` or `new URL()`, and a module whose only export is a boolean or a number. Because the notices take a workspace package's dist as this repository's own, every package's tsdown build now refuses to inline anything from node_modules (`deps.onlyBundle: []`), where before it inlined, with no more than a hint, a dependency a package imported at run time without declaring it as one of its dependencies or peers, a devDependency among them; no dist changed. **Noticed by operators:** the web image's nginx now says `charset=utf-8` for the pages, their scripts and the notices, and the getting-started gate fails unless both notices answer 200 `text/plain; charset=utf-8`; the notices name the exact version of every bundled package to anyone who reaches the web front, and this repository's own `LICENSE.md` and `NOTICE` are in the image, not served. **Noticed by contributors:** an edit to `scripts/third-party-notices.mjs` alone builds both apps again, since each app's new `turbo.json` names it among the build's inputs, which turbo otherwise takes from the app's own files. No chunk of either app changed, and no upstream `@formancy/*` version changes.

**Performance is measured through the shipped server, and published with what it was measured on** ([0034](docs/decisions/0034-performance-is-measured-through-the-shipped-server-and-held-without-a-clock.md)). `docs/performance.md` gives latency percentiles, CPU per request and database round trips for every runtime-plane request a host sends -- opening a form, opening the customer lookup, a search that matches many customers, one or none, resolving one stored value and the most one request may ask, reading, creating and updating an order -- one request at a time and several at once, on PostgreSQL and SQL Server, and what each request gains when every database answer is delayed. The requests go through `@formancy/data-client` and real HTTP to `dist/main.mjs`, configured as an operator configures it, against a `sales.customer` filled with generated customers behind the order form's own least-privilege account. Beside the figures are the database's size, the machine as its hypervisor presents it, the network path and the date. A block is run again, and a run refused, when a CPU probe on a worker thread ran slower than on the quiet machine in the idle gaps before and after the block -- only there, because review measured the probe slowing under the run's own load as well as under anybody else's, so contention during a block's own load is not seen and the page says so -- and the database's CPU per request is printed with the container's idle rate in those gaps taken off and the rate beside it, because its container works on its own too. Why: plan release gate 11 asks for exactly that, and the plan's fixture list asks for a lookup table large enough to expose loading the whole referenced table. What holds it without a clock, on both engines: a lookup hands the server at most a page and one row; with the tenant filter it reads only that tenant's rows, and every search reads all of them, because no index serves a contains search, as the page says; a form with no tenant filter reads the whole table on every search, and a test pins that cost; and the database round trips each operation makes are counted through a TCP hop and pinned. Today that is two per statement on both engines, because mssql checks each pooled connection with `SELECT 1` before using it and postgres.js has the server describe an unprepared statement before running it; with 0041's description of the form's table, opening a form is one statement and a create three. A create and an update on a form whose table changed so that drift review stops both writes are counted the same way and never timed: each must be answered 409 `drift` and send nothing past the description it was decided over (0041), over the shared `narrowed-decimal` case of `DRIFTING`. The page names both, and this release changes neither. CI never measures time, because its runners are shared. A release is refused while a source file the measurement runs, an installed dependency of the server or the client, or a build input differs from what the figures were measured on: `node scripts/performance-stale.mjs` names each difference, and the release workflow runs it in its `check` job, which publishing waits for, so a release re-measures and a rehearsal says so first; CI does not run it, so no pull request waits for a quiet machine. The release report (0035) shows gate 11 as stated by `docs/performance.md`, never as passed in a run. `@formancy/data-server`'s composition root now reads `FORMANCY_DATA_RATE_LIMIT`, requests a minute per client address, 600 by default as before: the measurement runs the shipped binary, and an operator behind a proxy needs the setting too, as app.ts already said; anything but a whole number of at least one stops the server with a sentence naming it, and the gates' container job checks both in the image. `@formancy/data-fixtures` exports the sized customer set, its generator and loaders, and its fixtures report their container; it also exports `connectDocker()`, which reads the daemon, the running containers and a container's limits and counters and starts nothing, because only that package may declare testcontainers (0035) and the harness reads Docker through it; its TCP hop counts round trips, can delay answers, and turns Nagle's algorithm off on both its sockets, as tedious and docker-proxy do on theirs: left on, review measured a 100-key resolve on SQL Server at 92 ms through the hop against 13.7 ms direct, a stall the product does not have, so the added-latency table prints the direct figure beside the hop's and a published result is refused when the hop alone adds more than its delay. Noticed by developers: the fixtures, PostgreSQL and SQL Server suites each load the sized table, about 35 s on PostgreSQL and 15 s on SQL Server on a Docker Sandbox VM on a Windows 11 workstation (2026-10-09) and 19.9 s and 9.5 s on GitHub's hosted runner (2026-10-10), and a new package, `@formancy/data-performance`, private, runs the measurement harness briefly on both engines in a job of the gates' test matrix, checking answers, round trips and the audit trail and never timings, and its results reach the release report as every package's do. `pnpm performance` measures on a quiet Linux machine and rewrites the page. No upstream `@formancy/*` version changes.

**The runtime refuses what drift review blocks in the form's own table** ([0041](docs/decisions/0041-the-runtime-refuses-what-drift-blocks.md)). Every read, create and update, and opening a form, is decided with drift review's own rules over the form's table as the database's catalog describes it in that request: its kind, columns, keys and foreign keys, read by discovery's own conditions and row functions on each engine. A read and an update by someone who may read carry that description in the read they already make; creating, opening a form and an update without that read make one statement for it. A write it stops, and a read it can no longer answer faithfully, are 409 `drift` ("an administrator must review the form"): no insert or update is sent, and a refused read's values never leave the server. `GET /v1/forms/:id` lists only what is still allowed, and is 409 `drift` when nothing is left. Every write carries a digest of the definition the decision read, and each adapter runs it only while the table still has it -- PostgreSQL inside the statement, SQL Server after it and in CATCH -- so a change landing in between is 409 `schema-changed` and the record is not written. **Why:** reproduced on PostgreSQL 17 and SQL Server 2022 on 2026-10-10. After an ALTER drift review called blocking, with update stopped, every update still reached the database: a narrower scale and a retype to `real` were stored rounded and answered 200 (`1234.5678` as `1234.57` and as `1234.5677490234375`), a column no ALTER touched committed, and reads answered 200 over a column the form could no longer read. No error was raised that could be translated. The reproduction is now the regression test, over a table of changes both adapters and the server run (`DRIFTING` in `@formancy/data-fixtures`), and watched failing on main on both engines. **What it costs**, counted with a TCP hop between the real server and both databases, PostgreSQL under READ COMMITTED: opening a form 0 round trips to 2, a create 4 to 6, an update by someone who may not read 2 to 4, a create the database refuses 4 to 8 on PostgreSQL and 4 to 6 on SQL Server, a read and a reader's update unchanged at 2 and 4, and a write refused as drift 2, its description. And time, measured once on a shared machine outside the suites: every PostgreSQL describe, read and write plans and runs a walk of the table's catalog inside its statement, 3.3 to 6.2 ms of the server's time where main's statements took under 0.3 ms, and SQL Server spends 1.4 to 2.6 ms of CPU where main spent 0.1 to 0.8 ms (the record has the method). On PostgreSQL a write that wrote nothing or failed asks the definition once more, on any connection of the pool -- the write's own reserved connection, measured, crashes the process when its backend is gone, and so does postgres.js's own `begin` unless nothing in the transaction settles once its connection is lost, which the lock-first path now ensures, each such step a promise of its own so that what the lost transaction held is collected -- and under a default isolation other than READ COMMITTED every read and write locks the table first: counted on the PostgreSQL adapter alone, a write statement 5 round trips where it is 2 and a read 7, and through the server a read 7, a create 9 and a reader's update 12; and an account granted only columns of the table cannot take that lock, so the isolation now changes an answer, which 0016 promised it would not. **Noticed by integrators:** opening a form asks the database, so an unreachable one is 503 where the form used to open; `RecordAdapter` gains `describe`, `read` answers the description beside a record or `null`, and every insert and update request carries a `definition`; `planCreate` and `planUpdate` take the description as a new last argument, and `planUpdate`'s record as read is no longer optional; `DriftReport` gains `readable` and `runtime`, and the studio's Drift step shows Read and says which blocked operations the server still allows. **Review changed in one place:** a confirmed concurrency token out of sight behind a new gap now breaks reads, as the token dropped does, and the token and the gap are one change, the token's, where they were two quoting the same words -- found by the test that holds the runtime never stricter than review. **Not compared at runtime:** a lookup's target, privileges, row security and the account. Drift review still finds them, and the database still enforces privileges and row security. Nor is SQL Server's dynamic data masking, which drift review does not see either: a column masked after publication reads as its mask to an account without UNMASK, and a save that sends every field writes the mask back. **On SQL Server**, an account denied VIEW DEFINITION on the form's table is refused `schema-changed` for every request, where its reads were answered and its writes refused as `refused`. No upstream `@formancy/*` version changes.

**Every `@formancy/*` dependency moves from 0.3.0 to 0.4.0, upstream's release of 2026-10-09, and generated forms stay on spec 3** ([0042](docs/decisions/0042-generated-forms-stay-on-spec-3-after-spec-4-is-released.md)). Why: 0.4.0 is upstream's newest release; its error summary names a problem by its field's label, which the host page did by hand, it adds `runScenarios` and spec 4's `step`, and it freezes spec version 4, so a version this repository's forms might move to is now a released one. The 23 exact pins in six manifests move together, and the lockfile changes only in the eight `@formancy` entries, `@formancy/expressions` beneath the others; nothing new is installed. Nothing this repository calls changed shape; the host page drops its own map of field labels for the error summary, because both renderers' summaries now read the label from the document, and `apps/host`'s `problems.test.tsx` still finds "Customer: …" in the summary in both renderers on both engines, and fails when either renderer's summary is handed the keys, watched in each, once per engine. Generated forms stay on spec 3: 0.4.0 still reads it, a renderer at 0.3.0 refuses a spec 4 form outright, and spec 4's `step` is the one thing in it a column would give, so 0009's whole-number rule stays the server's, now by choice; data-core's generate suite fails if the generator writes another version, and shows a whole-number field taking `1.5` in the engine, in the browser's mode and the server's. The server holds every stored version to that version, which `@formancy/data-core` now exports as `GENERATED_SPEC_VERSION`: `validateBundle` refuses a form or base in another spec version, or with a construct of a later one, on publish and on every read, which a restore reads through, because 0.4.0's validator accepts spec 4, and a version edited on the volume to spec 4, base and form alike, was served and restored where at 0.3.0 it was refused as corrupt -- found in review, and watched: read with 200 and restored with 201 before the check. A spec 4 construct in a spec 3 bundle is refused as `form: /model/fields/0/step needs spec "4", and this server publishes and serves only spec "3", the version it generates (0042)` rather than with the validator's advice to change the document to "4"; every other `invalid-bundle` problem on the administrator plane is still the validator's sentence, and those changed with 0.4.0 -- a bad option value no longer adds an `Unknown property "options"` line after its own, measured on 2026-10-10. What a user or integrator notices: no generated form changes, and every committed snapshot keeps its fingerprint, recomputed with 0.4.0's `schemaHash`; both snapshot captures came back byte-identical. At runtime a reader at 0.3.0 still reads these forms: on 2026-10-10 every form generated from the committed snapshots validated under `@formancy/spec` 0.3.0 and opened in `@formancy/core` 0.3.0's engine, in a scratch check, and nothing here runs a 0.3.0 renderer. In TypeScript it does not hold: `@formancy/data-client`'s types are now `@formancy/spec` 0.4.0's, so a host whose renderer is at 0.3.0 does not compile `createFormEngine({ schema: published.form })` (TS2322 on `specVersion`, TypeScript 6.0.3, `skipLibCheck` off) and casts the form to its own `FormSchema`, or moves to 0.4.0 -- found in review. `@formancy/angular` 0.4.0 declares `@angular/material` and `@angular/cdk` as optional peers, needed only for `@formancy/angular/material`, which nothing here imports. The bundles grow, measured with `vite build` on 2026-10-10 against the same tree at 0.3.0: the studio's one chunk from 659.5 kB to 720.7 kB minified, 177.6 kB to 195.4 kB gzipped, past its 660 kB warning limit, which is now 760 kB with the measurement beside it; the host page's main chunk from 416.8 kB to 431.1 kB and its Angular chunk from 208.9 kB to 224.8 kB; the examples page's from 445.4 kB to 459.8 kB and 203.2 kB to 220.9 kB; and each app's stylesheet by 5.4 kB of the themes' rules for the new controls. The themes now carry one `:dir(rtl)` rule, a date or time input's icon on iOS WebKit only, and each app's Vite build rewrites it into `:lang()` selectors, the rewrite upstream's 0123 warns a host about; nothing here renders a right-to-left form, so the apps keep Vite's default CSS target and that rule is untested. Still true at 0.4.0, each measured or tested again: neither renderer holds the form while a save is out, nor has an option to hold it or to leave out its submit button; the engine checks a disabled field; an answer is checked only once `validate()` has run; formancy's instant is to the second and its time to the minute (0040), and React's datetime control saves the local minute; a renderer's option contract has nowhere for `hasMore`; the lookups' 250 ms debounce. The README's pictures were retaken on 0.4.0's themes and came out byte-identical, so only `docs/images/readme/captured.json`'s stylesheet record moved. Upstream `@formancy/*` 0.3.0 → 0.4.0.

**An instant or a time the person may read is never written back unchanged, and both engines read them alike** ([0040](docs/decisions/0040-instants-and-times-are-read-to-the-shape-and-an-unedited-one-is-never-written.md)). formancy's instant has whole seconds and its time has minutes, and the engines store more. On SQL Server, which read them cut to that shape, every save through the host page where the person may write them wrote the cut values back -- a `datetimeoffset(7)` from `sysdatetimeoffset()` lost its seven digits, a value stored at +02:00 came back at +00:00, a `time(7)` lost its seconds -- edited or not, and the page said "Saved.". On PostgreSQL, which read them faithfully, the renderers refused the unedited value, so a record whose `created_at` came from `now()` could not be saved unedited through the page, also where the person may not write the column. Each was reproduced on both engines, through the runtime plane and through the page in both renderers, before anything changed. Now the PostgreSQL adapter reads an instant to the second, in UTC, and a time to the minute, cut and never rounded, as SQL Server's does -- `infinity`, a BC or five-digit year, `24:00` and a NaN keep a spelling the codec refuses -- and on update `planUpdate` removes an instant or a time the person may write and read when it equals the record as read at the version the update names, as the server already removed an unchanged field the person may not write (0022). A changed value is written, to the second or the minute the field holds. The rule is the planner's, not the server's: `planUpdate` takes the record as read as a new last argument and refuses an update carrying such a field without it as `record-not-read`, because a caller of the planner and an adapter outside the data server would otherwise write the cut value silently where it was refused before -- found in review. Decided with it: a create compares nothing and leaves an untouched instant to the column's default; a field the person may write and not read has nothing removed, because comparing it would tell them whether they had guessed a value withheld from them; a form whose only change was an unedited instant and time is 400 `nothing-to-update`, which the host page shows under "Not saved"; an update carrying one is refused with the read's own answer when the read before it failed, whatever the failure -- 503, 404, 403 -- rather than risk writing the cut value (found in review: refusing only `unavailable`, as first written, left every other failure to write it); a read that comes back as another record's token is 409 `record-not-read`, never compared; and the update's read, plan and membership checks now run inside the sending its write id names, so a resend of a stored update is answered with the first answer before anything is asked, its read included, and a resend of a refused one with that refusal (0031): it was read again before, and with the refusal above a resend whose own read failed would have been told "Nothing was saved." about a save that was -- found in review. Costs: PostgreSQL now shows an instant to the second and a time to the minute, as SQL Server did; a value that differs from the stored one only below the second or the minute cannot be written through a form; an instant the person changes is written in UTC, so SQL Server stores +00:00 whatever offset the row held; a caller of `planUpdate` must pass the record as read for an instant or a time; and an instant changed in `@formancy/react` 0.3.0's datetime control is saved as the local minute the control holds. `@formancy/data-fixtures` exports the shared case `TEMPORAL_PARITY`, both adapters' parity suites holding a time and an instant with milliseconds to one cut answer. The two reproductions are now regression tests in `apps/host`, each watched failing on main. No upstream versions changed.

**The server refuses a publish whose keys now name other columns, unless it says what happens to their grants** ([0039](docs/decisions/0039-a-publish-says-what-happens-to-the-grants-of-reassigned-keys.md)). Until now only the studio held a regeneration's `keysReassigned`: on 2026-10-10, on PostgreSQL and SQL Server alike, a plain HTTP client published a regeneration whose two colliding keys had renumbered onto other columns, with the policy as version 1 wrote it, and a clerk's grant written for `customer_note` then wrote the column `"customer note"`, which version 1 made read-only to the clerk. `POST /v1/forms/:id/versions` now reads the version it replaces and refuses, 422 `keys-reassigned` with the `keys` and a sentence for each, a policy that gives a role, read or write, on such a key unless the body's new `keysConfirmed` lists the key as the regeneration reported it: the same field, the column or lookup it stood for, and the one it stands for now, so a decision never follows a key to a column nobody was shown. A key with no role needs nothing, which is how its grants are removed, a lookup's filter, which every lookup field has, being no grant by itself; a `keysConfirmed` that is not a list of `{ field, was, now }`, each a column or a lookup, is 400; a stale base is still 409 `conflict` first, a base below 1 included; a version the server no longer serves, because its file does not parse or does not validate, is not compared, because publishing over it is how it is replaced, while a base the store fails to read for another reason refuses the publish; and a restore is not asked, because it brings a policy back with the bindings it was written for. `@formancy/data-core` exports `grantsOnKey` and `describeReassigned`, the test and the sentence the server and the studio now share, and `@formancy/data-server` exports `UnparsableVersionError`, which the file store's `read` throws for a version that does not parse. The studio sends every key kept in the Policy step, and none it removed; asks again about a removed key given a role again, by hand or by filling every field; carries the decisions through "Generate again"; and no longer says the server would publish the grants. What it costs: a client that ignored `keysReassigned` is now refused when its policy gives a role on such a key; the confirmation is kept in neither the version nor the audit trail; the check compares with the version replaced and by column name only, so grants removed in one version and given back in the next, or carried to another table by a publish that moves the form there, are not asked about; and the studio offers Keep and Remove only for a regeneration's keys, so a draft proposed afresh over a version whose keys renumbered, whose policy gives a role on such a key, is refused with the server's sentences. No upstream `@formancy/*` version changed.

**The README shows the product, in pictures a script takes and the browser job holds to what the pages say** ([0038](docs/decisions/0038-readme-pictures-are-taken-by-a-script-and-held-to-the-text-they-show.md)). The studio's journey from discovery to drift and restore, the host page's form in React and Angular with its customer typeahead, its stale, refused and unknown saves and another tenant's refusal, and the examples page's two renderers, each a state the product reaches. `pnpm pictures` takes them in Chromium from the built pages against the real data server: the studio over its committed captured snapshots, the host page over PostgreSQL as the order form's own account, with its row-level security. A picture is whole elements found by role and name; the capture refuses fallback fonts, text in the picture outside those elements, and a token in the text. Each app's `pnpm test:browser` now also walks the same states and fails when a picture's elements say something else; it compares accessibility-tree text, never pixels, because the pictures are taken on one machine and CI runs on another, with whatever font version Google serves. Why: a reader should see in seconds what the module does and where it is careful, and a picture nobody retakes goes stale silently. The pictures are WebP at twice their CSS size, 1,556,970 bytes together on 2026-10-10; a change to a stylesheet alone is not caught, and [`docs/images/README.md`](docs/images/README.md) says what else is not. No upstream `@formancy/*` version changes.

**After a conflicting publish, the studio's Publish step says which version is published now, and waits for the rebase.** When somebody else had published while an administrator worked, the step showed the server's conflict and still said, above it, that the version it had read was the published one, beside an enabled "Publish version 2" that the server would refuse again. Until the person rebases, it now says that version 2 is published and is somebody else's, the Publish button is disabled and names no version, and the keyboard goes to "Rebase on version 2". Why: the step contradicted what it had just learned, at the moment it asks for a decision (0013); the README's picture of that moment showed it. No upstream `@formancy/*` version changes.

**A release says what it was tested on, from the run that tested it** ([0035](docs/decisions/0035-a-release-report-is-derived-from-the-run-that-gated-it.md)). Every CI run, and a release before anything is published, ends in a report built from that run's own results: which run and commit it is, and each job's machine; every database image a test started, with the version and edition each server answered and its image digest, and the version each of the getting-started job's composed databases answered through the server's own adapter, which reports no edition; every runtime dependency's published range, the version the suites loaded and what a clean `npm install` resolved; upstream `@formancy/*`; Node, Chromium and axe as launched; each package's tests, wall time and coverage, reported and never gated; the browser, install and container gates; every shared parity, model and edge-value case on both engines; the build identity of every published package; the release gates by number, as passed in the run, stated in a document or open; and the limitations, those the run shows and those the decision records state. The run fails when a job ended other than success, a job's results are missing, twice or another run's, a test was skipped or failed, a shared case passed through one adapter only, an engine's default image never answered, the getting-started job recorded no composed database for a connection of its journey, a tarball is at another version than data-core, no job recorded the `dist/` of a published package, or two builds of one package differ. A release refuses to publish unless that report is green and is of its own commit, run, release and version, and it publishes exactly the tarballs the install gate installed and ran, checked byte for byte with their licence files and their version, beside an SBOM held to the versions the suites loaded of every runtime dependency, tedious under mssql included, and of upstream. Those checks run in a job that holds `contents: read` and no secret, which pins by sha256 what it checked -- the report and the tarballs before cdxgen runs, whose dependencies nothing locks, the SBOM after -- because every job of a run can write to the run's artefacts; everything permanent -- signatures, the image, npm, the GitHub release -- runs in one job behind one condition, which refuses anything it downloaded that is not what was pinned, before it signs and again before npm, and publishes npm second to last because nothing can take a version number back. The npm token is read only by the two jobs that name the `npm` environment, whose deployment policy, a repository setting, is to admit only `v*` tags; and a release restores no Actions cache, which a main-branch run could have saved. It attaches the report, signed, beside the SBOM, and its body is the version's changelog section with the report's summary, built and measured before anything is published. `workflow_dispatch` rehearses a release, the body included, in jobs that cannot publish, sign or push. Why: plan item DATA-17 asks for a report that identifies versions, limitations and results, and one typed by hand would describe a run nobody can find. Noticed by contributors: CI's jobs moved to `.github/workflows/gates.yml`, which CI and the release both call, so the release now runs each package's suite on its own runner, where it ran them all on one, and runs the browser, install and container gates it skipped; the check names become `gates / verify`, `gates / test (…)` and so on; a test asserting a shared case declares it with `covers()`; a new or edited decision record needs its entry in `docs/release/limitations.json` read and stamped; `docs/release/gates.json` names each release gate's evidence and none of the plan's wording; every suite writes `test-results/`; the README's *What it is tested on* table is generated, pnpm's version among it; a local report, built after `collect.mjs --local --since`, refuses a turbo summary or a coverage summary from before that time and says when the tree held uncommitted changes; and the Codecov action is pinned by commit. Found on the way: SQL Server's parity test of `filter: fixed_code = "AB "`, a case declared on both engines, checked only that data-core refuses the filter, where PostgreSQL's also checks that its adapter throws a forged term before sending anything; SQL Server's now does too, and was watched failing with the adapter's check removed. The publish job has never run: its shape is held by a test, and the first tag is the first time it runs. No upstream `@formancy/*` version changes.

**A column renamed in the database is discovered as the same column under its new name, and the studio's browser gate, which stands a snapshot edit for a rename, now uses the edit that is checked against one.** `renamedColumn(snapshot, table, from, to)` in `@formancy/data-fixtures` renames one column in place, keeping its ordinal, type and access, and takes the fingerprint `createSnapshot` gives the result. Both adapters' discovery suites rename `sales.order.notes` to `memo` as the owner -- `alter table ... rename column` on PostgreSQL, `sp_rename` on SQL Server -- and hold what the order form's account then discovers to that edit, fingerprint and the column's own UPDATE grant included; each was watched failing with an edit that dropped the column's access and with one that gave it a new ordinal. It refuses a column that a key, a foreign key or a check names, because no suite compares that case with a real rename. `carry.test.ts` and `regenerate.test.tsx` in the studio still rename with helpers of their own. Why: the studio's drift gate renamed columns inside a captured snapshot, which nothing had compared with a real rename; both adapters' discovery suites now do. No upstream `@formancy/*` version changes.

**The generator's notes read as written.** A note's description went through `labelFor`, the function that turns column names into labels, so the studio and the examples page showed "java script", "floating point", "utc" and "uuid" and lost the commas; it is now the generator's own sentence with its first letter raised, and data-core's generate suite holds the `bigint`, `numeric` and `timestamp with time zone` notes to that wording. Why: the notes are the product's account of what it chose ([0009](docs/decisions/0009-generation-is-deterministic-and-says-what-it-chose.md)), and [0021](docs/decisions/0021-generated-forms-preview-in-both-frameworks.md) recorded the defect as unfixed. No upstream `@formancy/*` version changes.

**From an empty machine to a published form on both engines, with Docker and git alone** ([0032](docs/decisions/0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)). `docker compose --profile stack up -d --build --wait` now generates every password and key into a volume and hands each service only the ones it reads, loads the sample fixture into PostgreSQL and SQL Server with each engine's own client, connects the server through the order form's own account, builds and runs the server image with both planes on, and serves the studio at `/studio/` and the host page at `/host/` through one nginx on `127.0.0.1:4394`, so both are same-origin with `/v1` as 0024 and 0029 require; nginx never sends a write a second time (0031), and its image is built from the checkout and never published. A token minter runs inside the server's image as `docker compose run --rm token`, reading the key with the server's own `resolveSecret`. `docs/getting-started.md` walks an operator through it, and a new `getting-started` job, on every pull request and before every release, runs that guide's own commands from a clean checkout with Node and Docker alone -- once with the runner's Compose and once with 2.20.3 -- then does over HTTP what the guide has the operator do in the studio and on the host page, on both engines: propose, publish, look up, create, the same create sent again, update, a stale update and another tenant's refusal; starts the stack again after the guide's `down` and finds the tokens, forms and orders kept; and fails if a secret or a token reaches a log, compose's configuration or a container's inspect. The values the guide has the operator type are generated from the file the job sends, and the names it gives the studio's and the host page's controls come from the file both apps' new guide tests drive them by. Why: plan release gate 9 asks for clean-install documentation that works with both databases, and a guide nothing runs is a claim nobody checked. Measured on 2026-10-09 in a Docker Sandbox VM (Linux x86_64) on a Windows 11 workstation: the four images unpack to about 2.3 GB, SQL Server's 1.7 GB of it, summed from `docker history`, and a start with the images current took 16.5 s; on CI's runner, not measured yet. Noticed by developers: a bare `docker compose up -d` still starts only the two databases, after the one-shot service that makes their passwords, and they take those from that volume instead of `.env`, which nothing needs any more (`.env.example` lists only the port overrides), so a database volume made before needs `docker compose down -v`; and `compose.yaml` now needs Compose 2.20 or later, where main's ran on 2.19.1, because the web front's health check uses `start_interval`. The server image now owns `/var/lib/formancy-data` for the store, and the container job checks it, because a new named volume takes the owner of the directory it is mounted on and the first publish failed with `EACCES`. Found on the way: the studio offered **Choose a root** for the connection discovered before while another's discovery was still out, so Choose opened on the old connection and switched under the operator when the new one answered; a discovery on its way now clears the one before it. Not a production deployment: no TLS, a minted HS256 token, one replica, the audit trail in the server's log, nothing restarted after a reboot -- 0032 and the guide's section 8 list the rest. No upstream `@formancy/*` version changes.

**The administrator's plane is audited** ([0033](docs/decisions/0033-the-administrator-plane-is-audited.md)). Every request that reaches a route of the administrator's plane now emits one event, from a connection test to a restore, refusals included: a clerk's 403 names the clerk, a stale publish is a 409 naming the base it was sent with, and a request with no token, or over the rate limit, names nobody -- nor does a body Fastify refuses before the token is read (400, 413, 415, or a client gone mid-body), whatever token it carried: authenticating before the body would run ahead of the rate limit, or, measured, leave a request whose client left during it unanswered, heard only by `onRequestAbort`, with no status to record. Each event names the actor, the operation, the connection, the form and the version it read or wrote, and for a restore the version it copied; it never holds the bundle, the policy, a snapshot or a message. Why: a publish and a restore left no trail (0030), so "who published version 3" had no answer, and a restored version was on disk exactly the version it copied. A connection is recorded only when the allowlist knows it, and a form id only when it has a form id's shape -- on the runtime plane too, whose `form` was whatever the path held -- because anybody who can reach the port, token or none, could otherwise write a connection string, password included, into the trail; the review of the first build found exactly that. The shape still admits a bare host name, an IP address or a lower-case word that is a password, which are recorded as typed. An event is written once however a request that reached a route ends, a client that disconnected while the route ran included, and one whose request was pipelined behind another on a connection that closed: on Fastify 5.12.5 `onResponse` runs for neither, which was measured, and a publish in either case committed with no event. The trail now also writes from `onSend` and from the connection's `close`, with one listener on a connection however many requests a client pipelines on it, and tests over a real socket fail when such a publish leaves no event, a finished one leaves two, or a connection holds a listener per request: the first fix for the pipelined case did, and forty requests pipelined behind a held one made Node warn of a leak. What is answered before any route -- a path no route matches, a parameter past the router's limit or one that does not decode, Fastify's own 503 while the server closes, and what Node's HTTP parser refuses, headers past its limit or a request it cannot parse -- runs no hook and is not audited. Every event carries `plane: 'runtime' | 'admin'`, and `AuditEvent` is now the union of `RuntimeAuditEvent` and `AdminAuditEvent`, both exported, so a TypeScript sink narrows on `plane` before reading `record`; the runtime's `form` is `string | null`. The administrator's plane now requires `audit: { sink }`. A route on either plane without an audit name stops the server from starting, and one registered above the plane's hooks, where that check cannot see it, is refused 500 `unaudited-route` instead of answering unaudited. The runnable server writes both planes to one log, told apart by `audit.plane`, and its request log now names the route a request matched instead of the path, the query and the Host header it was sent with: Fastify's default wrote those as sent, so the connection string the trail leaves out reached the operator's log a line above it, which the second review found. `createDataServer`'s `logger` also takes a stream. Not tamper-evident, not atomic with the store write, and every studio page load is now a log line, a volume not measured. No upstream `@formancy/*` version changes.

**Each package is tested in a CI job of its own.** The suites ran as one `pnpm test:coverage` on one four-CPU runner until nine of them at once -- five starting PostgreSQL and SQL Server, three mounting Angular and React into jsdom -- made a studio test that takes two seconds alone pass its sixty-second limit on main, and data-core's pure suite take 51 s. Each package now runs on a runner of its own, and `scripts/ci-test-jobs.test.mjs` fails when the job list and the workspace's packages with a suite disagree, so a new package cannot go untested by being left off it. The first run on separate runners also showed a studio bug the old timing had hidden: after a restore the version list is read again, and a selection left at its default moved to the newest older version under the focused button, so pressing it again would have restored a different version than the one shown a moment before. A restore now keeps the version pressed as the choice.

**A write whose answer is lost is reported as unknown, all the way to the host, and nothing replays it** ([0031](docs/decisions/0031-an-answer-lost-after-a-write-is-unknown.md)). Until now the server's 502 reached the host page as an ordinary refusal, shown under "Not saved" with "It may have been saved" beneath it, and pressing Save again sent a second create -- with a key the database numbers, a second record. The 502 now names what was addressed: the token and version an update sent, the token a create will have when the insert names its key (`intendedRecord` in `@formancy/data-core`), or nothing when the database numbers it; its sentence says what is safe next, and a read can no longer answer one. The audit event names that record by its keyed hash. `@formancy/data-client` treats a write's answer as known only when the data server says what happened -- a record, its 502, a 4xx with a sentence, a 503 `unavailable` -- and every other answer, a rejected fetch or a proxy's page included, as an `UnknownWrite` (still `ok: false`, so a host that checks only `ok` fails closed); it never resends one, and adds `reconcile()` and `isUnknownWrite()`. `create()` and `update()` now return `WriteOutcome`. The host page says "It may have been saved" instead of "Not saved", offers "Check whether it was saved", and holds a create -- a press sends nothing and says why -- until a check finds it absent or the person confirms entering it again. Proved on both engines through a TCP hop that drops the database's answer after the commit (`startTcpHop` in `@formancy/data-fixtures`), including SQL Server, where a lost socket had until now only been read in mssql's source. Its review found what the first version still got wrong, each fixed with a test that failed first. Chromium itself sends a write again, below the page, when the connection it reused closes before any answer -- measured: a create whose answer was lost after the commit was stored twice, and the page told `201` -- so every create and update now carries a `formancy-write-id` from the client, and the server answers a sending that arrives again with the first one's answer instead of applying it, awaiting it if it is still with the database; the browser gate measures the resend at the socket, through the hop, and fails on a second order. That guard holds in one server process: a resend that reaches another replica, or a restarted one, is applied again. On SQL Server a trigger that commits the write's transaction and then raises an error was reported `refused`, "nothing was written", over a stored row; the batch now sees its transaction gone and says `unknown-outcome`, which over-reports a trigger that rolls back and then raises. A second unknown save on the host page inherited the first's notice -- "Press Save to enter it again." over a create held again, with no way to confirm; an update saved again after a lost answer was shown "Not saved" when it was stale by its own doing; "Enter it again anyway" pressed twice around a check left the keyboard on the page; and a check said "It was saved" and "It is not in the record", which a read cannot know. The hop tore both sockets down on the first close and lost what it had not yet written; it now passes a close on after every byte. postgres.js's `end()` does not return after a connection was cut under a query, so the PostgreSQL adapter's `close()` now gives a running statement five seconds and then destroys the connection. No upstream `@formancy/*` version changes.

**A host renders a published form through `@formancy/data-client`** ([0029](docs/decisions/0029-a-host-renders-a-published-form-through-one-client.md)). A new source-available package with one function per runtime route — the definition, read, create, update, and a lookup's query and resolve — and option sources both formancy renderers take. The token is the host's, asked for on every request and sent in the Authorization header only; a form id or a source name is one encoded path segment, and `.` or `..` is refused before anything is sent, since `fetch` would resolve it to a different route; a refusal is the server's code and sentence, verbatim, and `fieldProblems` gives a refusal's field errors as the server's sentences, because the 0.3.0 renderers print an error entry as it is. Nothing is cached and nothing is retried. Why: nothing outside the server called the runtime plane, and every host would otherwise re-decide where the token goes, how a document's name becomes a route and what a refusal says. What it does not do: a lookup's `hasMore` and `omitted` do not reach the person, since the renderers' 0.3.0 contract has nowhere to put them, and records are addressed by token only.

**`apps/host`: one published form under React and Angular side by side** ([0029](docs/decisions/0029-a-host-renders-a-published-form-through-one-client.md)), on the runtime plane and nothing else: open a form with a host token, load a record into both panes, edit, save, search a customer through the typeahead, have a stale save keep the person's draft and say so, and see a field problem from a 422 on the field and in the error summary. A save the server has not answered yet keeps what the person types meanwhile and says it is not saved, a second press says it sent nothing rather than sending the same create twice, and an answer that arrives after Load or New is said on the pane's line — a created record's token, a "may have been saved" — rather than dropped, because neither 0.3.0 renderer holds the form during a submit. Its suites run against the real server on PostgreSQL and SQL Server in jsdom, with axe and a name on every control in every state, and a Chromium gate measures layout, focus and colour against the real server on PostgreSQL. This is plan section 21's steps 4 to 7 and release gate 2. The examples page keeps its in-memory customer list, because it has no server, and now says where a host gets the list instead. The page draws each lookup as a typeahead on its own copy of the form: since 0030 the server publishes only the generated form with presentation applied, and a widget is not presentation there.

**data-core exports the runtime plane's wire types** — `PublishedForm`, `RuntimeRefusal` and `ResolvedLookup` — and the server's replies are checked against them. No behaviour changes. Why: one declaration that the server and the client both compile against, so a changed shape is a type error on both sides before it is a blank form.

**The CI browser job starts PostgreSQL**, through testcontainers on the runner's Docker, for the host page's gate; layout, focus and colour do not depend on the engine, so one is enough. No upstream `@formancy/*` version changes.

**Presentation survives regeneration** ([0030](docs/decisions/0030-presentation-is-a-patch-over-the-generated-base.md)). A published version now keeps, beside the form it serves, the generation request, the generated base and the presentation chosen over it — bundle format 2 — because plan section 9 keeps presentation as a concern of its own and a regeneration used to start again from the generator's document, losing every label and order a person had set. The presentation is exactly the studio's four edits: a field's label, a section's label, a field's place within its own section's grid, and full width; every other difference from the base, including what builder-core accepts — a numeric span, a move between sections, help text, translations, `required` — is refused at publish, naming its JSON path. `POST /v1/forms/:id/regenerations` rediscovers, regenerates from the stored request, and carries labels, order and full width to the new base by the column or lookup each was chosen for, never by key, because keys renumber when a colliding column comes or goes. It reports what it could not carry: a field gone, a field under a new key, a field the generator put in another section, a section gone, a label the generator also changed (the person's is kept). A section is matched by its label and which of the sections with that label it is; for a root whose own label is `Record`, whose main and system sections are both labelled Record, a change in their number means occurrence no longer says which is which, so their overrides are reported dropped rather than put on the wrong section. It also reports lookups the runtime would now refuse, tried through the runtime's own `buildLookupConfig` so 0028's typed lookups are included, keys that now name another column, whose grants need confirming, and what the published policy no longer fits; it writes nothing. `GET /v1/forms/:id/versions` and `GET /v1/forms/:id/versions/:n` list and read versions, each validated as the latest is. `POST /v1/forms/:id/restorations` republishes an older version as the next one — the same document, written as the store writes every version, so the same bytes for a version this store wrote — only when drift against it blocks nothing; it brings back that version's policy and is not a database rollback. Publishing refuses format 1, and a base or bindings this server's generator would not write from the stored snapshot and request; that check runs at publish only, so a later generator never makes a stored version corrupt. Every read checks what the stored request alone decides against its base and bindings — the title, the root, a confirmed version column, a pin over a field the form writes, the lookups — because a regeneration generates from that request and its draft is checked at publish against the same request, so a request edited on the volume would otherwise reach the next version unannounced; a pin taken out by hand is the one such edit no check short of the generator can see, and format-1 versions are still served and can be restored, though not regenerated. The proposal route returns the request it generated from as `generation`, and the store's port gains `versions(id)`. `@formancy/data-core` exports `presentationOf`, `applyPresentation`, `rebasePresentation`, `reassignedKeys` and their types; `@formancy/data-server` exports `BundleV1`, `BundleV2`, `Regeneration` and `Restoration`. Measured on both servers first: SQL Server refuses to drop a column a foreign key uses, so the step-8 suite drops `fk_order_approved_by` first there, and neither engine's column grants or auto-created statistics blocked the ALTERs. The stored base adds about 3.1 kB, 7.6 %, to a version of `sales.order`. The studio regenerates from the Drift step and shows the regeneration in the server's words; its Presentation step lists each conflict, with “Use the generator's label” and “Give this label to…” where a choice exists, each one command that Undo takes back; the Policy step's “Generate again” carries the draft's presentation through the same rebase and keeps reporting what a regeneration before it dropped; publishing waits until each reassigned key's grants are kept or removed — the studio holds that, not the server; and the Drift step restores older versions, offered too when the newest version is not served. A restore, like a publish, writes no audit event and no log line. No upstream versions changed.

**Row filters, labels and refusals mean the same on both engines** ([0028](docs/decisions/0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md)). A row filter now carries its column's type and compares the column's canonical value exactly — case, accents and trailing spaces count, and the collation is not consulted — because the two engines answered one tenant filter differently, in opposite directions, measured on both servers: on SQL Server tenant `acme` also read `acme `'s rows, since every SQL Server collation, the binary one included, ignores trailing spaces, and the filter never used its index; on PostgreSQL, under a case-insensitive collation, tenant `acme` also read `ACME`'s rows, since the filter was an untyped parameter compared under the column's collation. An `nvarchar` or `nchar` tenant column now uses its index on SQL Server; `char` and `varchar` under a `SQL_` collation still scan, as before. The lookup route handed the policy's text to the adapter unscoped, so a trusted tenant of `042`, which a record request refuses, listed tenant 42's rows; it now scopes its filter as a record request does and refuses the same values. A filter on a column it cannot compare — a boolean, a float, a time or a timestamp, or one the table lacks — is refused at publish, and the studio no longer offers one as a filter column or a pin. `char(n)` reads unpadded on SQL Server, as on PostgreSQL, so a `char` key has one token, and the codec drops a fixed-length value's trailing spaces, so a write does not read back as a change. Lookup labels are spelled once, from the value each adapter's record reader returns, whatever the session's TimeZone, DateStyle, float digits or language: a boolean as `true`, a uuid in lower case, a real as `0.1`, an instant in UTC to the second and a time to the minute, cut and never rounded. A new failure code, `refused` (422, "Sending it again will be refused the same way"), names a refusal the port has no code for — a trigger's own error, a write a trigger declined, an error the adapter does not recognise — where PostgreSQL said `check-violation` and SQL Server `unavailable`; `unavailable` (503) now means only what passes, an allowlist per engine, and writing a generated column is `schema-changed` on both. API changes: `lookupFilters` is replaced by `scopeRowFilters` and `rowFilterColumnProblem`, `RowFilterTerm` has a `type`, `LookupConfig`'s display and search columns are typed, `FoundRow.display` holds canonical values, `lookupPage` and `resolvedRows` take the config, `displayText` is new, and `diffSnapshots` takes the published policy as a fourth argument. `@formancy/data-fixtures` ships a `parity` schema outside the fixture's scope, and the expectations — `FILTER_PARITY`, `DISPLAY_PARITY`, `REFUSAL_PARITY` — both adapters' parity suites run. Every probe the record cites ran on both servers first, and the design changed where they disagreed with it. Its review found what the first version still got wrong, each fixed with a test that failed first: drift compared only the root's types, while the runtime now reads a lookup's display and filter columns by the published ones, so a display column retyped to `bit` labelled every row by the old reader and a filter column retyped to `varchar` failed every PostgreSQL search with nothing in the report — drift is now given the policy, and any change to the type of a lookup's key, display or filter column blocks the lookup, a widening included; a filter value with an unpaired surrogate was accepted, and postgres.js sends U+FFFD where tedious sends the unit, so one tenant read another's rows on one engine — it is refused like the codec's; a filter on PostgreSQL's unconstrained `numeric` compared numbers, so `12.5` also admitted `12.50`, and now compares the text as well; SQL Server's 13536 and 13537, writing a column that became a system-versioning period's, were `refused` where they are `schema-changed`, and its 3906, a read-only database, was `refused` where PostgreSQL's 25006 is `unavailable`. The parity data now catches what it let through: a `char(3)` row of `ab`, which a SQL Server filter compared under the column's collation alone admitted, and floats whose text `extra_float_digits` changes — and the PostgreSQL suite's hostile session had never set `extra_float_digits`, because postgres.js drops a startup parameter whose value is `0`, so it now asks the session what it has. The PostgreSQL suite also plants a case-blind `public."C"` and a `public.bpchar` under the exact filter, and shows that a terminated backend or a `transaction_timeout` reaches the adapter as a closed connection, `unknown-outcome` for a write, where the comment had said class 57 made it `unavailable`. No upstream versions changed.

**A snapshot says what its account may do, and whose it is** ([0027](docs/decisions/0027-a-snapshot-says-what-its-account-may-do.md)). Every column carries what the discovering account may SELECT, INSERT and UPDATE, every table whether row-level security applies to that account, and every snapshot the account it was taken as, whose user is part of the fingerprint — because a snapshot described what the catalog showed, not what the account could do: a table it could read and not write looked writable, a column denied SELECT failed at the first read, row security was invisible, and the same database read by another principal could hash alike. The generator uses these: a column the account cannot read gets no field; one it cannot update is read-only on update, and says why; an operation it cannot perform is not offered; row security on a table the form reads is an `access` note. Drift reports a revoked grant as a privilege change, not a dropped table; row security that starts applying as something to review; and another account as such, blocking while row security is in play. Gaps say whether they are about the scope, a schema or an object, where `object: null` meant both of the first two. PostgreSQL now describes every table in scope, where it used to replace the unusable ones with gaps. On SQL Server, establishing that no security policy applies needs VIEW DEFINITION on the database, and a column denied SELECT shows in the snapshot instead of at the first read. Bindings are version 2 (`writes: { create, update }` replaces `writable`), because one flag could not say that a field is written on create only; forms published earlier must be republished. The shared fixture gains a policy on `sales.customer` that shows the new `formancy_writer` tenant 1 only, on both engines. Probed first on both servers, and the spec changed where they disagreed with it — `update … set c = c` needs SELECT, SQL Server's column check needs `QUOTENAME`, and VIEW SECURITY DEFINITION alone shows no policy. Its review found what the first version still got wrong, each fixed with a test that failed first: drift said a confirmed concurrency column that lost SELECT, or was dropped, stopped update only, though both adapters name it in every read and every create's RETURNING or OUTPUT, so both now block the form; the fixture's access comparator checked only the columns an adapter reported, so one reading a privilege-filtered catalog passed for the writer; publishing accepted a row filter on a column the account may not INSERT, which every create writes; the studio offered lookups over unreadable root and display columns that the generator then refused; SQL Server's block predicate refusal (33504) was `unavailable` where PostgreSQL's row security refusal is `permission-denied`, and is now `permission-denied` too; and a VIEW DEFINITION deny made to `public` was counted against `sa` and `dbo`, whom no DENY binds, so the owner's snapshot read `unknown` behind a gap. One cost is written down rather than removed: a PostgreSQL view reads its tables with its owner's privileges, or the reader's when `security_invoker`, which discovery does not follow, so a view whose columns say SELECT can still refuse every read; the generator's note on a view says so, and a test pins it. The studio's and the examples page's snapshots are captured again. No upstream versions changed.

**The contract names what the engines disagree on about a column** ([0026](docs/decisions/0026-name-every-column-fact-the-engines-disagree-on.md)). A text column says what its length counts: characters in a UTF8 PostgreSQL database, UTF-16 code units for `nvarchar` under any collation, bytes for a `varchar` — of UTF-8 under a UTF-8 collation or in a SQL_ASCII PostgreSQL database, of its code page or encoding otherwise. The codec checks in that unit, so a UTF-8 `varchar` overflow is refused before SQL Server's 2628, and PostgreSQL takes the emoji its column holds; the generator says, per field, how the browser's `maxLength` relates to it. Text with an unpaired surrogate is refused, because PostgreSQL stored U+FFFD in its place and reported success. `binary(n)` says it pads. Numbering says whether it is ALWAYS or BY DEFAULT, and BY DEFAULT now includes a default that is exactly a sequence's next value — `serial`, `nextval()`, SQL Server's `NEXT VALUE FOR` — because all three take a hand-chosen number and collide with it later (measured: 23505, 2627); all are read-only in a form, and a published form that wrote a `serial` column reports that as drift. A check says whether it is enforced, so a disabled SQL Server check no longer reads like a `WITH NOCHECK` one, and PostgreSQL 18's `NOT ENFORCED` is read, proved on `postgres:18-alpine`. A `real` is canonical on both engines, the shortest decimal naming its float — `0.1` reads back `0.1`, not `0.10000000149011612` — so an unchanged echo is unchanged, and a value a real would store as zero or infinity is refused, where SQL Server stored 0 silently. A zoneless timestamp reads with its fraction on both engines, where SQL Server truncated it. The shared fixture gains `sales.shipment`: smallint, time, a zoneless timestamp, uuid, double, real, a UTF-8 varchar, fixed and variable binary, a composite unique key, by-default numbering on both engines, and an untrusted and a disabled check. A snapshot in the old shape — a bundle published before this, the examples page's capture, now taken again — is refused, never trusted. Two reviews of the change found what its first version still got wrong — the sequence default left writable on SQL Server, the surrogate accepted, PostgreSQL's database encoding and 18's unenforced checks unread, a `real` a digit longer than its shortest at a power of two, and several sentences that claimed more than the engines do — and each is fixed with a test that failed first. No upstream versions changed.

**The studio: an administrator goes from a connection to a published form and its drift** ([0024](docs/decisions/0024-the-studio-speaks-only-the-admin-plane.md)). `apps/studio` is a private React app on the examples' toolchain that speaks only the server's administrator plane and `/v1/whoami`. Sign in with a host token, shown back as whoami names it and held in the tab's memory only; test and discover a connection, with what it could not see listed before its tables, so "no relationship" and "cannot tell" stay different; choose a root, its lookups and their display columns, the columns the policy pins to trusted context — which are the policy's row filters, one list — and a version column where there is no rowversion; generate, with the generator's notes by kind; write the `FormPolicy`, judged on every change by `validatePolicy` in its own words; relabel and reorder through `@formancy/builder-core`'s session with controls of the studio's own, because the released builder's property panel discards a refused command's reason and offers the lookup's source and the column's constraints as presentation; preview in Blueprint on white paper; publish against the version read, with a conflict shown as the version somebody else published and a way onto it, and a refused bundle shown with every reason; and review drift with each change's severity and what it stops. Its suite runs the real server in the test, over snapshots captured from the shared fixture on both engines, so a change to a response shape fails the studio rather than blanking it, and `pnpm test:browser` now walks the whole journey in Chromium at every width, against that server on the studio's own origin. Two things it found: the server's router refused a path parameter longer than 100 characters before any route ran, so a form id between 101 and the store's 128 could be generated and never published — the router now takes the store's limit, and the studio's own check agrees with the server's answers at every length; and a label pointing at `id="root"` named index.html's mount point in the browser while jsdom passed it, so the suite now mounts the studio where the page does. Its review found three more, fixed with tests: discovering another connection threw away the generated form, its presentation and its policy, though the Connect step invites comparing connections — they now stay until a root is chosen on the other one, and the root says what choosing replaces; removing a filter or a stale entry, offering every row and rebasing took the button pressed out of the page and dropped the keyboard to its top — the focus now goes to the next entry, the list's Add, the policy check or Publish; and `studio.css` styled bare elements, which reached into the preview's paper — a label's size, a fieldset's margin and background — so the preview could differ from the published form, and every such rule is now kept off the paper, which the browser gate checks against every rule of the file. And four smaller ones: the Policy step's "Generate again" now says it starts the presentation afresh, as the Choose step did; after a rebase the button reads "Publish over version N" and the page says their version is replaced, not merged, and with a base it could not read the button names no number; the test for a server without the plane gets its 404 from a real server started without one; and the stylesheet, past a thousand lines while the size guard counted only scripts, is split by reason to change and the guard now counts stylesheets. The upstream `@formancy/*` versions are unchanged at 0.3.0, with `@formancy/builder-core` newly depended on.

**The server runs the whole product, and one suite proves it on both engines** ([0025](docs/decisions/0025-each-adapter-owns-its-driver.md)). The composition root turns on the runtime plane when `FORMANCY_DATA_STORE_DIR` and `FORMANCY_DATA_CONNECTIONS` are set, the administrator's plane when `FORMANCY_DATA_ADMIN_ROLES` is too, wires the audit sink and `FORMANCY_DATA_AUDIT_KEY`, and closes every pool on SIGTERM. A new end-to-end suite runs plan section 3's journey over HTTP into the real server and through the real drivers on PostgreSQL 17 and SQL Server 2022: propose, publish, find a customer, create an order at the largest `numeric(18,4)`, read it back exactly, save a change, be refused a stale save, and see another tenant's order not exist. It found a defect no other test could: pnpm installed two copies of `mssql`, the server built the pool from one and the adapter bound parameter types from the other, and SQL Server refused every parameter. Each adapter package now opens its own connections — `connectPostgres`, `connectSqlServer` — and the server imports no driver. A host embedding the server gets the same factories as `DRIVER_FACTORIES`, and the install gate now proves the published server resolves both adapters.

**SQL Server answers lookups and records** ([0017](docs/decisions/0017-sqlserver-operations.md)). `createSqlServerLookups(pool)` and `createSqlServerRecords(pool)` implement both halves of the operations port, so both engines now do. Values are bound as text and converted by the server — `tedious` would round a decimal parameter through a JavaScript number — and read back as text, as `nvarchar(max)` and exact decimal text so a column widened since publication is not truncated. `IN` lists split at 2098 parameters, the real budget once `sp_executesql` takes its own two. Tenant filters compare under a binary collation, because the fixture's case-insensitive one let tenant `acme` read `ACME`'s rows. Two independent reviews found high-severity write-outcome defects, all fixed with tests against a real server: a trigger's `RAISERROR` does not honour `XACT_ABORT`, so a committed write was reported as refused and a retry would duplicate it — every batch now rolls back on any error; an `INSTEAD OF` trigger made `OUTPUT` report a write that never happened — such writes are refused, and a trigger that swaps the transaction is `unknown-outcome`. The version token now comes from the row as triggers left it. Two limits are written down rather than hidden: a trigger that commits and then raises an error, and an AFTER trigger that deletes its own row.

**An operational audit trail** ([0023](docs/decisions/0023-the-audit-trail-is-operational-not-evidence.md)). Every runtime request emits one event — actor, operation, form, the published version it was served from, status and outcome code — refusals and unreachable databases included, and never a value: no answers, no fields, no record. A record is named by an HMAC of its token under an audit key the operator supplies, or not at all, because a record token spells a key that is usually small enough to guess from a plain hash. The sink is a port; the default writes a structured log line, and a sink that fails does not fail the request. It is an operational trail and not evidence: written after the commit, by another system, and the record says so.

**Generated forms render and validate the same in React and Angular, and there is a page that shows it** ([0021](docs/decisions/0021-generated-forms-preview-in-both-frameworks.md)). `apps/examples` is a private Vite app on formancy.ai's playground toolchain: it checks a snapshot of the shared fixture — captured from a real PostgreSQL container by `scripts/capture-snapshot.mjs`, never typed — against its fingerprint, runs `generateForm` in the browser for `sales.order` and `sales.customer`, and renders each with the released `@formancy/react` and `@formancy/angular` 0.3.0 side by side, on white paper in Blueprint, with the generator's notes beside each. Its suite holds both renderers to the same fields by accessible name, read from the accessibility tree, the same `required` and `pattern` codes at the `numeric(18,4)` edge, the same customer tokens, and axe in `@formancy/conformance`'s configuration. It arrives with the guards `CLAUDE.md` asks of a first UI: a starter-demo test that the page shows what it says it shows; `pnpm test:browser`, a CI job that measures in Chromium what jsdom cannot — no sideways scroll down to 320 pixels, the skip link first and the first preview after it, colour contrast and target size, clean and after a failed submit; and a repository guard that refuses a source file past 600 lines. The customer lookup is an in-memory source using the server's token encoding, and the page says so, until the lookup route exists. Two things it found: the released engine checks answers only once a form has been submitted, then live, so the page and its tests take that path; and the generator's note sentences are de-snaked like labels ("java script"), which the page shows as written. New development dependencies: the Angular toolchain, `@angular/build` among it, and `axe-core` and `playwright` in the catalog at formancy.ai's versions; the upstream `@formancy/*` versions are unchanged at 0.3.0, with `@formancy/conformance` newly depended on.

**PostgreSQL answers lookups and records** ([0016](docs/decisions/0016-postgres-operations.md)). `createPostgresLookups(sql)` and `createPostgresRecords(sql)` implement both halves of the operations port. Every value is read as canonical text converted in SQL and read by position, so neither the driver's parsers nor how the composition root configured it change an answer; every bind is text cast to the column's exact type. An update is one statement guarded by key, trusted filters and expected version, moving the version in the same statement; a lost race is `stale`, under READ COMMITTED and REPEATABLE READ alike. The review found two high-severity defects, both fixed with tests: every function, operator and type was resolved through the `search_path`, so a role able to create in `public` could shadow `=` and make a stale update succeed — every name is now `pg_catalog`-qualified; and row filters were parsed through a NULL row of the table, which trips NOT NULL domains on columns the filter does not touch. A medium one too: a BEFORE trigger returning NULL skips a write silently, and that is now reported, never `ok`.

**The runtime plane** ([0022](docs/decisions/0022-the-runtime-plane-asks-the-policy-every-time.md)). `GET /v1/forms/:id`, `POST /v1/forms/:id/records/read`, `/create` and `/update`, and `POST /v1/forms/:id/lookups/:source/query` and `/resolve`, for the host application's people. Every request verifies the host token and asks the published policy and the planner; nothing is cached per actor. A formancy renderer submits every field, and the policy refuses a field the actor may not write, so the route removes only an echo it can prove — empty on create, unchanged against the record read first on update — and anything else is refused, never silently dropped. A lookup selection is checked against the database before any write, and a lookup that cannot answer refuses the save. Database refusals reach the person by field, in the server's own words, because SQL Server's messages repeat what was typed; an ambiguous write is a 502 that says it may have been saved.

**The generator knows which columns the policy pins.** `generateForm` takes `pinned` — the root columns a policy fills from trusted context, typically the tenant — and makes each a read-only field that is never required, and never the version column. Before this, a pinned NOT NULL column was a required field of the generated form that the policy then refused as over-posting, so no submission could pass both formancy's replay and the planner; the planner found it. `POST /v1/form-proposals` passes `pinned` through. A test keeps the old conflict visible for a form generated without it.

**One planner turns answers into requests** ([0018](docs/decisions/0018-one-planner-turns-answers-into-requests.md)). `planRead`, `planCreate` and `planUpdate` are the one place the policy, the codecs, the lookup tokens and the bindings meet, so both adapters receive identical requests: over-posting is refused, every answer goes through its column's codec, a lookup token becomes its foreign-key columns, the tenant comes from trusted context, an omitted field is unchanged on update and left to its default on create, and an update that changes nothing is refused rather than left to each engine. `toFormAnswers` turns a record back into what the generated form holds — a safe integer as a number, because the released engine reports the canonical string as out of range. Another tenant's lookup token is refused up front when the foreign key carries the tenant, and otherwise returned as a membership check the caller must run against the database before writing. Found in review and fixed: a version column that was the key, a field, generated or pinned was accepted. Found while building, and still open: the generator marks a pinned tenant column as a required field while the policy refuses it as over-posting, so the generator has to learn which columns a policy pins.

**The administrator's plane** ([0020](docs/decisions/0020-administration-is-a-separate-plane.md)). `GET /v1/connections`, `POST /v1/connections/:id/test`, `GET /v1/connections/:id/metadata`, `POST /v1/form-proposals`, `POST /v1/forms/:id/versions`, `GET /v1/forms/:id/versions/latest` and `POST /v1/forms/:id/drift`, each requiring a host token with an administrator role — publishing a form and writing a record are different permissions, and nothing here touches a record. A proposal is the generator over a fresh discovery; publication is compare-and-swap, and a stale base is a 409 naming the current version; a version edited on disk is refused, not served; drift compares the published snapshot with the database now. A database that is down answers 503 without the driver's message, which names hosts and logins.

**A published form is one bundle, and connections are an allowlist** ([0019](docs/decisions/0019-a-published-form-is-checked-every-time-it-is-read.md)). A bundle carries the form, its bindings, its policy and the snapshot they came from; `validateBundle` checks it on publish and on every read from the store, recomputing the snapshot's fingerprint so a hand-edited column type is refused rather than trusted by the planner. Connections are a file the operator writes — host, database, user, a secret reference for the password, the approved schemas — and `createConnectionRegistry` is the only place a name becomes a database, opening it on first use through a factory the composition root supplies and retrying a failed open on the next request. The image now copies `data-core`: the Dockerfile guard failed the moment the server depended on it and the COPY list did not say so, which is what it is for.

**Drift review** ([0010](docs/decisions/0010-drift-is-classified-against-the-bindings.md)). `diffSnapshots(base, current, bindings)` compares the snapshot a form was generated from with the database now, through that form's bindings, and classifies every change by what it means for that form: a new nullable column is for review, a new NOT NULL column with no default stops create, a dropped or retyped bound column blocks the form, a tightened one stops writes of that field, a column the published control can no longer hold — an integer past 2^53 in a number field — blocks it, a changed foreign key behind a lookup blocks the lookup, and the concurrency column gone stops update. An apparent rename is two changes and a hint matched on definition, never on names. Something that vanished behind a gap is an access problem, never a deletion. The review found two fail-opens, both fixed: a column vanishing behind a new gap could leave create writable when the gap alone would have blocked it, and foreign keys were compared through `schema.name` strings, so a retargeting between `a.b`.`c` and `a`.`b.c` went unnoticed. Bindings that could not have come from the base snapshot are now refused even when nothing changed.

**`DatabaseAdapter` discovers, and the record port is defined** ([0015](docs/decisions/0015-a-record-operation-is-one-guarded-statement.md)). Both adapters now answer `discover(scope)` through the port, with the same fingerprint as calling their discovery directly. `RecordAdapter` — `read`, `insert`, `update` — is a port of its own beside the lookup port: values in and out are canonical text, never the driver's numbers or dates; an update is one statement guarded by key, trusted filters and expected version; another tenant's record is `not-found`, never `forbidden`; a database refusal is a stable failure code and PostgreSQL's `40001` is `stale`; a write whose result was lost in transit is `unknown-outcome` and is never retried. SQL Server's version query moved into its own module, so discovery no longer imports the adapter that imports it.

**The database-neutral half of lookups** ([0012](docs/decisions/0012-a-lookup-token-is-a-reference-not-a-permission.md)). A referenced key, composite or not, is encoded as the string a formancy `select` stores: `k1:` and the values, with every character outside `A-Z a-z 0-9 - . _` escaped as `~` and four upper-case hex digits, so each key has exactly one spelling and the decoder refuses every other. A key whose token would exceed formancy's 200 characters is refused, never truncated. `validateLookupQuery` bounds the page and the search; `buildLookupConfig` derives a lookup from the bindings and checks it against the snapshot's actual foreign key. Row filters for a lookup are `unrestricted` or `restricted` with at least one equality — an empty list cannot mean every row — and `lookupFilters` converts what the policy's `lookupRowFilter` returned, the one place an empty list may become unrestricted. The review found a lookup config not checked against its foreign key, key values not checked by type, NULL ordering unspecified, and an empty filter that would have meant every row; all four are fixed. Nothing implements the lookup port yet: the adapters do next.

**Access policy** ([0011](docs/decisions/0011-every-operation-carries-a-trusted-policy-context.md)). A `FormPolicy` grants operations and fields to roles and pins root and lookup rows to trusted attributes such as the tenant; a `PolicyContext` comes from the verified host identity and nothing else. Every function fails closed: a missing tenant attribute is a refusal, never an empty filter that would mean every tenant; a field with no entry is readable by nobody; roles match exactly; the tenant column is over-posting on create and on update; a lookup over the tenant column must pin its target to the same tenant. The adversarial review found the read path failing open — an actor with field grants and no read grant got a filter and a column list — and every function that returns data now authorises the operation it serves. Nothing calls these yet; the record and lookup routes will, on every request.

**SQL Server discovery** ([0007](docs/decisions/0007-sqlserver-discovery-and-what-it-hides.md)). `discoverSqlServer(pool, scope)` reads the catalog views with every join to something a restricted account might not see written as a left join, so a blind spot becomes a gap instead of a dropped row. What the restricted reader sees of a foreign key into a table it cannot read: the key, its columns and its flags, and a target whose name resolves to NULL — so `fk_order_customer` is reported with a gap, never as "no relationship". Defaults and checks are visible as objects with NULL definitions. A user-defined alias type the account cannot see would drop the column from an inner join. `VIEW DEFINITION` on the schema, with no `SELECT` at all, is the minimum for complete discovery; a `DENY VIEW DEFINITION` or `DENY CONTROL` on one table, to the account or a role it is in, removes it from `sys.objects` while the schema grant still says yes, so discovery counts its own deny rows and says something is hidden. Driver traps for the read path: `tedious` returns `decimal(18,4)` as a JavaScript number (99999999999999.9999 reads as 100000000000000) and `date` as midnight UTC, so every value is converted to text in SQL. Rowversion concurrency holds between two connections: the stale update affects 0 rows. `nvarchar(n)` counts UTF-16 code units and a UTF-8 `varchar(n)` counts bytes, which the contract does not yet say.

**PostgreSQL discovery** ([0006](docs/decisions/0006-postgres-discovery-reads-pg-catalog.md)). `discoverPostgres(sql, scope)` reads `pg_catalog`, never `information_schema`, in one read-only repeatable-read transaction, with schema names bound. To a SELECT-only account `information_schema` hides every constraint on a table — not only foreign keys, but the primary key and checks too — while `pg_catalog` hides none. An object the account may not use is a gap naming it rather than an omission. Found on the real server and pinned by tests: a stored generated column files its expression where defaults live; a foreign key to a partitioned table appears once per partition unless `conparentid = 0`; `DISABLE TRIGGER ALL` stops a key being checked while `pg_constraint` still says validated, including through partition clones; unique indexes that are not constraints are valid foreign-key targets; since PostgreSQL 15 a numeric scale may be negative. Two driver traps for the write path: a `bigint` key bound as a JavaScript number addresses a different row, and `sql('a.b')` quotes a dotted table name as two identifiers.

**Values are checked exactly on their way to the database.** `codecFor(column)` validates and canonicalises one API value from metadata alone ([0008](docs/decisions/0008-exact-values-travel-as-strings.md)). Decimals are strings only — a JSON number has been through a double before anything can look at it — canonicalised to the column's scale and never rounded; an extra digit is refused. Integers past 2^53 are strings. Text length is counted in UTF-16 code units, as formancy's `maxLength` counts it in the browser, so the two agree. Dates must be real days, in formancy's own shapes read from `@formancy/spec`. A test proves every decimal the generated form's pattern accepts, the codec accepts too.

**The server ships as an image, and CI proves it starts.** `packages/data-server/Dockerfile` follows formancy's: two stages, an explicit COPY list, `--ignore-scripts`, an unprivileged runtime, a health check against `/health`. `src/dockerfile.test.ts` derives the COPY list from the dependency graph, so adding a workspace dependency without telling the Dockerfile fails a test instead of the container. A new `container` job builds the image on every pull request and checks that unconfigured it names the setting it needs, configured it serves `/health` and answers an unauthenticated request with 401, and it runs as `node` with its licence. The release workflow pushes it to GHCR, signs it by digest and attaches the SBOM, as formancy's does; there is no `latest` tag.

**`@formancy/data-server` exists, with its foundations and two routes.** A configuration store keeps published bundles as immutable, versioned files, and decides concurrent publishes with a hard link: of twenty publishes from one base, exactly one wins ([0013](docs/decisions/0013-published-configuration-is-files-with-link-based-swap.md)). Ids are lower case only, because on Windows and macOS `Order` and `order` are one directory and one form would silently read another's bundle — the suite found that on Windows. The host application's JWT is verified offline, with the algorithm pinned per key kind, and becomes an actor, roles and attributes such as the tenant; nothing else in a request contributes ([0014](docs/decisions/0014-host-identity-is-verified-offline.md)). Secrets are referenced as `env:` or `file:`, and no error repeats one. The server answers `/health` and `/v1/whoami` and nothing else yet: the record and lookup routes arrive with the operations behind them.

**A form can be generated from a snapshot.** `generateForm` turns a discovered table into a formancy document, its database bindings and a list of notes saying what was inferred, excluded, read-only or blocked ([0009](docs/decisions/0009-generation-is-deterministic-and-says-what-it-chose.md)). It is deterministic, and it targets spec 3, which every released `@formancy/spec` from 0.3.0 reads. Exact decimals and integers past 2^53 become text with an exact pattern, which formancy's engine checks identically in the browser and on the server; a JavaScript number would round them. A composite foreign key becomes one lookup. Update is offered only with a `rowversion` or a version column an administrator has confirmed, because a column that merely looks like one is how a lost update happens. **The one rule checked on one side only:** a `number` field for an integer column accepts `1.5` in the browser, and the server's codec refuses it; spec 4's `step` would close it, and generated forms stay on spec 3 ([0042](docs/decisions/0042-generated-forms-stay-on-spec-3-after-spec-4-is-released.md)).

**The metadata contract exists, and so does the database both adapters will be held to.** `@formancy/data-core` now describes what discovery returns: objects as schema and name, columns with a normalised type beside the database's own spelling, ordered primary, unique and foreign keys, checks, comments — and **gaps**, the things the connection could not establish. A catalog filtered by permissions looks exactly like a complete one with fewer things in it, so a foreign key whose target an account cannot see is reported with an unknown target and a gap, never dropped ([0004](docs/decisions/0004-a-snapshot-says-what-it-could-not-see.md)). Every snapshot is made by `createSnapshot`, which sorts by codepoint, refuses structures no catalog could produce, and fingerprints with `@formancy/spec`'s canonical hash — the first upstream dependency, at exactly 0.3.0.

**`@formancy/data-fixtures`** is one business model written for both engines — a composite key, a foreign key to a unique key, a reserved word as a table and a column, a self-reference added over a row that breaks it, an exact decimal at its limit, an integer past 2^53, an identity, a computed column, a view and a type nobody supports — plus a restricted reader who may read `sales.order` only, the containers that load it, and a comparator that reports every way a snapshot differs from the expected model ([0005](docs/decisions/0005-one-fixture-written-twice.md)). The one place the engines are deliberately different, the version column, is written down per engine. Private, never published.

**The repository exists, with the pipeline formancy.ai runs and nothing that
generates a form yet.** Three packages: `@formancy/data-core` holds the adapter
port; `@formancy/data-postgres` and `@formancy/data-sqlserver` each implement
it far enough to reach a real server and say which version answered. The point
of starting there rather than with generation is the gate: on every pull
request, both adapters run against a real PostgreSQL 17 and a real SQL Server
2022 through testcontainers, and there is no mocked driver to pass without them
([0003](docs/decisions/0003-real-databases-in-every-test-run.md)).

**The pipeline is formancy.ai's, adapted.** `verify` builds, type-checks, runs
coverage against both databases, checks packaging with publint and attw, checks
that every tarball carries its licence, and runs the repository's own guards.
`install` packs the tarballs into a plain npm project and type-checks that
project with `skipLibCheck` off — the gate that found upstream's package with no
`exports` map after four releases. CodeQL and dependency review are unchanged.
The CLA check is unchanged in mechanism and matters more here. The release
workflow publishes with provenance and a signed SBOM, refuses a tag that
disagrees with the manifests, and refuses an SBOM that omits either database
driver. There is no browser job and no container job, because there is no page
and no server; both return with the packages that need them.

**The licence is written down and marked a draft.** `LICENSE.md` states the
terms in one table — read and fork free, develop and test free including in
companies, production paid, redistribution by agreement, customer data and
generated definitions the customer's — and says at the top that it has not had
legal review. That was Version 0; Version 1 replaced it, in force and still
unreviewed ([0048](docs/decisions/0048-the-licence-is-in-force-before-a-lawyer-has-read-it.md),
above). Why a paid module exists beside an Apache-2.0 project, and why in
its own repository, is
[0001](docs/decisions/0001-a-paid-module-in-its-own-repository.md). Every
publishable manifest declares `SEE LICENSE IN LICENSE.md`, and
`scripts/verify-licenses.mjs` refuses one that says anything else — the
realistic mistake being a manifest copied from upstream, which is how every
manifest here started.

**Upstream is depended on and never copied, at exact versions.** No package
here depends on `@formancy/*` yet; when one does, `scripts/upstream-deps.mjs`
refuses a range, a `workspace:` link or a path, because the package APIs
upstream are not frozen before 1.0 and a minor is allowed to break this
repository ([0002](docs/decisions/0002-depend-on-upstream-never-copy-it.md)).

**What is not here**: discovery, metadata, codecs, generation, lookups, writes,
a server, a studio, examples. The next step is the both-database spike the plan
calls phase 1: composite foreign keys, exact decimals and large integers,
restricted-account metadata, and a concurrency strategy — demonstrated on both
engines before anything is generated from them.
