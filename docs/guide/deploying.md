# Deploying

How the composed stack becomes a deployment: its one proxy and the pages'
policies, Cloudflare as the edge, the host's identity keys, other origins,
proxies, publication under review and the browse role, and what follows when
the schema changes.

The composed stack of [*Get started*](../../README.md#get-started) has one proxy,
[`deploy/web/nginx.conf`](../../deploy/web/nginx.conf), which serves the studio
and the host page at `/studio/` and `/host/` beside `/v1/` and is the shape a
deployment's own proxy copies. CI runs [the getting-started guide](../getting-started.md)
as written from a clean checkout, with the oldest Compose release it names and
with the runner's
([0032](../decisions/0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)).

Each page is sent with a Content-Security-Policy of its own, the examples
page's
([0069](../decisions/0069-the-examples-page-is-served-at-formancy-ai-data-examples.md)):
scripts, styles, fonts and fetches from the stack's origin alone, nothing
inline and nothing evaluated, `data:` images only, no plugin, `<base>` or
form target, and no framing; the host page's allows inline styles too, for
the style elements AG Grid creates, which its browser gate shows refused
without it. `nginx.conf` sends them from a map that
`node scripts/web-policies.mjs --write` writes from the module that
defines them; `pnpm test:repo` fails when the map is not the module's, a
location that serves files has no policy, another location could answer
with a page, or a location's own `add_header` or a redirect inside nginx
would send a page without it, the studio's and the host page's
browser gates serve each page under its policy and fail on anything a
browser refuses under it, and the getting-started gate fails when nginx
does not send it. A deployment's own proxy copies the header with the
page, and nothing here reads what it sends; an extension or a proxy that
writes a script element into a page is refused, and a host page moved to
an origin of its own (0060) needs a `connect-src` that names the server's
([0083](../decisions/0083-the-studio-and-the-host-page-are-served-under-a-content-security-policy-each.md)).

[`docs/deploy/cloudflare.md`](../deploy/cloudflare.md) puts that stack
behind a locally-managed Cloudflare Tunnel, with Access in front of the
studio and a second hostname on which nothing but the runtime plane's routes
reaches the server. Cloudflare is the edge here, not the runtime: nothing of
a deployment runs at Cloudflare, and the [live demo](live-demo.md), whose
server and PostgreSQL run in a Cloudflare Container of each visitor's own,
is not a deployment of the product
([0070](../decisions/0070-the-live-demo-runs-the-real-server-and-postgresql-in-a-cloudflare-container-of-each-visitors-own.md)).
The tunnel's configuration is generated from
the server's own routes and checked against the pinned cloudflared, offline;
nothing has been run through a real tunnel
([0037](../decisions/0037-cloudflare-is-the-edge-not-the-runtime.md)).
Wherever it is deployed, the server answers `400` with `path-not-plain` to a
path holding a percent-escape that decodes, a backslash, an empty segment, a
`.` or `..` segment, or a character a path does not carry as itself, before
authentication: a proxy in front of it may read such a path differently, and
no name the server accepts needs one.

The host's tokens are verified offline, with a shared secret, a public key,
or a key set file the server reads again when it is sent SIGHUP: a provider's
document copied in as it is published, its keys that cannot verify the
pinned algorithm left out and named, a kid selecting its key. A file that
cannot be read, or is refused, leaves the set in force and is logged; the
image's `dist/identity-keys-cli.mjs` checks a file before it is renamed into
place, and converts the secret or public key in use into a set. The server
fetches no key from anywhere: a provider's set is the operator's own job to
copy ([0014](../decisions/0014-host-identity-is-verified-offline.md),
[0059](../decisions/0059-the-host-identity-key-is-a-set-selected-by-kid-and-read-again-on-sighup.md);
[the data server's README](../../packages/data-server/README.md#rotating-the-identity-key)
says how).

A deploy pipeline checks drift after its migrations with the image's
`dist/drift-check-cli.mjs`: it asks the server about each form it names and
exits 1 on a `blocking` change and 2 on a form it could not check, never 0
for one it could not
([0111](../decisions/0111-a-deploy-pipeline-checks-drift-with-a-command-that-fails-on-a-blocking-change.md);
[the data server's README](../../packages/data-server/README.md#checking-drift-in-a-deploy-pipeline)).

A host page on an origin of its own calls the runtime plane directly once
`FORMANCY_DATA_CORS_ORIGINS` lists that origin exactly, as a browser sends
it: each runtime route grants its own preflight, no wildcard, pattern or
credentials can be configured, and the administrator's plane, `/v1/whoami`
and `/health` answer no other origin. A token-bearing request a browser
marks cross-site is refused before its token is read unless its origin is
listed, so a grant a browser cached before its origin was removed does
nothing in any browser that sends `Sec-Fetch-Site`; an older one can still
send requests the server runs, for up to ten minutes, without reading the
answers. The list is read at start, and the composed stack lists none
([0060](../decisions/0060-the-runtime-plane-answers-the-origins-an-operator-lists-and-the-administrators-plane-none.md);
[the data server's README](../../packages/data-server/README.md#across-origins)
says what is granted, refused and logged).

Behind a proxy, the server counts and logs each client by the address the
proxy forwarded only when `FORMANCY_DATA_TRUSTED_PROXIES` names that proxy,
by its address or its range; unset, as in 0.1.0, everybody behind it is one
client to the rate limit and the log names the proxy. `true`, `*`, a hop
count, a range written with an interface's address and entries that
together cover every address of a family stop the server
([0100](../decisions/0100-a-proxy-list-whose-entries-together-trust-every-peer-is-refused.md)), and
a forwarded value that is not an address is not believed. The composed
stack names its nginx's fixed address and the one the Cloudflare overlay
gives cloudflared, never their networks, whose gateways are how a local
process reaches a container
([0071](../decisions/0071-the-server-believes-the-forwarded-address-only-from-the-proxies-an-operator-names.md);
[the data server's README](../../packages/data-server/README.md#behind-a-reverse-proxy)
says what a list too wide or too narrow does).

Publication can need a second person, from the release after 0.1.0: a
0.1.0 server ignores the setting, and every administrator there still
publishes alone. With `FORMANCY_DATA_PUBLISHER_ROLES` set, each role also
an administrator role, nobody publishes or imports a version alone, a
publisher who did not submit a draft approves it, and a restore is a
publisher's. The setting is read at start, and the composed stack sets
none, so its guide publishes as one administrator
([0065](../decisions/0065-with-publisher-roles-set-a-draft-is-published-only-when-a-publisher-who-did-not-submit-it-approves-it.md);
[the data server's README](../../packages/data-server/README.md#publication-under-review)
says what an author and a publisher may each do, and what it costs).

Reading rows is a role of its own. With `FORMANCY_DATA_BROWSE_ROLES` set,
each role also an administrator role, its holders read every row the
connection's account can read, through the studio's Browse step, and
follow a row's foreign keys there either way and filter a page by its
columns; unset, as in the composed stack, nobody does
([0099](../decisions/0099-a-browse-role-reads-any-table-or-views-rows-as-the-connections-account-does.md),
[0103](../decisions/0103-a-browsed-row-follows-its-foreign-keys-either-way.md),
[0104](../decisions/0104-a-list-and-a-browse-are-filtered-by-conditions-on-their-columns.md);
[the data server's README](../../packages/data-server/README.md#browsing-rows)
says what it reads and what it costs).

## When the schema changes

Formancy Data never changes a table. A schema migration is the job of the
tool your application already uses -- Flyway, Liquibase, EF Core
Migrations, Prisma Migrate or a similar one -- and nothing here depends on
which tool ran the DDL: the server reads the result in the catalog, as the
connection's account sees it, and that account needs no right to change a
table. What follows a migration is drift:

- **At once, at run time.** Every request reads the table's description
  again, and what drift blocks in a form's own table -- a bound column
  dropped or retyped, a key no longer unique -- is refused with `409
  drift`, never written past; the host page says nothing was saved and an
  administrator must review the form
  ([0041](../decisions/0041-the-runtime-refuses-what-drift-blocks.md)).
- **In the studio's Drift step.** The connection discovered again, each
  change is classified against what a published form's bindings and
  lookups rest on: blocking, or for review. A column that may have been
  renamed is a possible rename for a person to confirm, never a guess
  ([0010](../decisions/0010-drift-is-classified-against-the-bindings.md)).
- **Then a new version.** Generated again, the form keeps its presentation,
  carried by what each field stands for
  ([0030](../decisions/0030-presentation-is-a-patch-over-the-generated-base.md));
  a key that now names another column waits for someone to say what
  happens to its grants
  ([0039](../decisions/0039-a-publish-says-what-happens-to-the-grants-of-reassigned-keys.md));
  and a version the database can no longer serve is neither restored
  ([0030](../decisions/0030-presentation-is-a-patch-over-the-generated-base.md))
  nor imported
  ([0062](../decisions/0062-a-published-version-moves-between-deployments-as-its-version-file.md)).

A migration in two steps never stops a form: first only add -- the new
column, the new table -- and publish the forms that use them; remove what
they no longer bind afterwards. A column dropped or retyped in one step
stops each form that binds it in the form's own table until that form is
published again.

Such a tool keeps its own record of what it ran in a table:
`flyway_schema_history`, Liquibase's `databasechangelog` and
`databasechangeloglock`, EF Core's `__EFMigrationsHistory`, Prisma's
`_prisma_migrations`. In a schema approved for discovery it is a table like
any other: offered to generate a form from, and read in the Browse step by
a browse role. Where the tool lets you, keep it in a schema the connection
does not approve -- Flyway's `defaultSchema`, Liquibase's
`liquibaseSchemaName`, EF Core's `MigrationsHistoryTable(name, schema)`;
Prisma Migrate keeps it in the schema it migrates.

Nothing here checks drift before a migration reaches production. A
pipeline can: migrate a staging database first, then ask the administrator
plane's `POST /v1/forms/:id/drift` for each published form with an
administrator's token, whose answer's `blocking` says whether the change
stops it. The image's `dist/drift-check-cli.mjs` asks it for each form it
names and exits 1 on a `blocking` change, as above
([0111](../decisions/0111-a-deploy-pipeline-checks-drift-with-a-command-that-fails-on-a-blocking-change.md)).
