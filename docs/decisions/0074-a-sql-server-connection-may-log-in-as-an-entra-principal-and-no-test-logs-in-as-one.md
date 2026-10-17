# 0074 — A SQL Server connection may log in as an Entra managed identity or service principal, over TDS 8.0 with one credential per connection asked for Azure SQL's token alone, and no test logs in as either

- **Status:** accepted; extended by 0081
- **Date:** 2026-10-17
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-server/src/connections.test.ts` — the allowlist accepts a
  managed identity, user-assigned by its client id or system-assigned
  without one, and a service principal whose secret is a reference, with
  no user and no password; it refuses, naming the field and never its
  value, a tenant that is a domain name, a client that is not an id, a
  secret pasted where its reference belongs, a secret or a tenant beside a
  managed identity, a login type it does not take (`entra-default` among
  them), a login beside a user and a password, a login on PostgreSQL, an
  Entra entry with `tls.enabled` false or `tls.trustServerCertificate`
  true, an `authority`, and a login that is not an object; it refuses a
  key it does not read on every entry and inside `tls`, and a `tls` whose
  settings are not booleans or that is not an object, and accepts
  `deploy/connections.json` as committed; the sentence the server says at
  start for each Entra connection names the connection alone; a managed
  identity is refused while `AZURE_FEDERATED_TOKEN_FILE` is set, naming
  the variable and never its value, and a service principal is not; its
  login types are data-sqlserver's `SQLSERVER_LOGINS`, none of the Entra
  ones called tested; the registry resolves a service principal's secret
  and nothing for a managed identity, and refuses a secret that cannot be
  resolved without repeating it.
  `scripts/server-start.test.mjs` (`pnpm test:repo`, the built server as
  the image runs it) — the server says at start, at warn, once for each
  Entra connection and for no SQL login, that no test logs in as one,
  with nothing of the principal on its output; and with
  `AZURE_FEDERATED_TOKEN_FILE` set it stops before it listens for a
  managed identity, naming the connection and the variable, and starts
  for a service principal.
  `packages/data-server/src/drivers.test.ts` — for a configuration built
  without the allowlist's checks, the factories refuse, before any driver
  is asked, a connection that names no login, an Entra principal on
  PostgreSQL and a service principal given no secret; the allowlist's
  tenant, client and resolved secret become the adapter's `tenantId`,
  `clientId` and `clientSecret`, a managed identity's client its
  `clientId` and no client none; and a connection's login is one object
  while its secret is the same, and a new one when the secret changes.
  `packages/data-sqlserver/src/entra.test.ts`, which constructs the real
  classes and asks Entra nothing — a service principal is a
  `ClientSecretCredential` of the tenant, client and secret it is given
  at the public cloud's authority, whatever `AZURE_TENANT_ID`,
  `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_AUTHORITY_HOST` say;
  a managed identity is a `ManagedIdentityCredential` by its client id or
  none; what a pool is given is the guard, which asks the credential for
  Azure SQL's scope alone and refuses any other, or more than one, without
  calling it; a refused token rejects with the sentence and the AADSTS
  code, keeping no cause; tedious's `AggregateError` under mssql's
  `ConnectionError`, raw or from the guard, a null token, and the server's
  `ELOGIN` become fixed sentences holding no tenant, client, secret or
  trace id, and a failure before the login passes as it came; an Entra
  pool without TLS, or with the server's certificate trusted, is refused
  before it connects; every connection of an Entra pool is TDS 8.0,
  `encrypt: 'strict'`, with the certificate checked; a listener that does
  not speak TLS is sent a TLS ClientHello first and never a PRELOGIN, and
  no token is asked for; and a pool opened again with the same login
  object is given the same credential, another object another.
  `packages/data-sqlserver/src/adapter.integration.test.ts`, on the run's
  image of the matrix — an Entra pool is refused at TLS, the server
  resetting a connection that opens with it, with no failed login in the
  server's errorlog and no token asked for; a SQL login's pool has no
  debug output.
  `packages/data-sqlserver/src/entra.integration.test.ts`, on SQL Server
  2025 started with a certificate for `localhost` — while the client does
  not trust the certificate, a service principal and a managed identity
  are each refused at TLS with no login in the errorlog; trusted, each is
  refused in exactly one failed login, with the sentence and nothing of
  the principal in the message, the inspected error or its JSON, and no
  token asked for; the configuration mssql hands tedious for every
  connection of an Entra pool is one credential, the same object each
  time, TDS 8.0 with the certificate checked, and no user, no password
  and no debug output.
  `packages/data-sqlserver/src/records-failures.integration.test.ts` — a
  login refused after the pool opened, disabled while its idle connection
  closed, is `unavailable` for a write as for a read, and nothing is
  written. `packages/data-server/src/routes/entra.integration.test.ts`,
  through the real routes and driver on SQL Server 2025 started with a
  certificate the process trusts, the Entra entries through the allowlist
  — the connection test, an opened form, a record read and a lookup each
  answer their fixed 503 for both principals, the log says why in the
  adapter's sentence, and no secret, tenant, client or resolved secret's
  path reaches the log, an answer or an audit event; a secret file that
  cannot be read is named in the log line, and in no answer or audit
  event. `scripts/release-report/tested-on.test.mjs` (`pnpm test:repo`) —
  the README's *SQL Server logins* row is `SQLSERVER_LOGINS`, the SQL
  login as tested and the Entra principals as accepted and not tested.
  Each was watched failing on 2026-10-17 with what it holds removed: every
  allowlist rule in turn, the authority left out, tenant and client
  swapped and the client id dropped, in entra.ts and again in drivers.ts,
  the class handed out unguarded, the scope comparison removed, the inner
  error rethrown, the translation skipped, the TLS refusal and the
  trusted-certificate refusal removed, TDS 7 in the pool's configuration
  (the listener's first byte was a PRELOGIN; on the run's image the login
  reached the server with the certificate trusted, and TDS 7's TLS failed
  on the certificate without; on 2025 the login reached the server
  untrusted), `debug: true` in the pool's configuration, a second connect
  after a failed one (two failed logins), a user and a password beside
  the credential, a credential built for each connection of a pool and
  for each pool, a login object made for each open, `failureFor`'s first
  branch removed (the write was `unknown-outcome`), the principal named in
  the error `drivers.ts` rethrows, the runtime plane's connection step
  rethrowing (500), the README row left out or rendered as tested, each
  of the factories' three checks removed, the workload identity check
  made for every Entra entry and removed from main.ts, main.ts's loop
  over the start sentences removed, and resolveSecret's sentence naming
  no file. **Nothing verifies that an Entra login succeeds.**

## Context

An Azure SQL database set to Microsoft Entra-only authentication has no SQL
login to give anybody, so the allowlist
([0019](0019-a-published-form-is-checked-every-time-it-is-read.md)), which
took a user and a password, could not name it at all. Azure SQL is not
tested ([0073](0073-azure-sql-is-not-tested-and-the-release-says-so.md)),
and no container takes an Entra login, so whether to build this before a
design partner asked was a question; the answer was to build it now and say
it is not tested, with a managed identity and a service principal with a
secret, domain-name tenants refused, a line at start, and every allowlist
entry refusing a key it does not read.

Facts this record rests on, read on 2026-10-17 in the versions the
lockfile installs, mssql 12.7.4, tedious 20.3.3 and @azure/identity 4.13.3:

- **@azure/identity 4.13.3 was already installed**, as tedious's
  dependency, and resolves to the same copy from the SQL Server adapter.
  tedious's `token-credential` authentication takes any object with a
  `getToken` (`@azure/core-auth`'s `isTokenCredential` duck-types it), so
  the two-copies defect of
  [0025](0025-each-adapter-owns-its-driver.md) cannot recur through it.
- **tedious asks for a token only after the server's FEDAUTHINFO**, and for
  the resource the server names: `new URL('/.default', spn)`
  (`connection.js`, `performSentLogin7WithFedAuth`). Its own Entra types,
  `azure-active-directory-msi-*`, `-service-principal-secret`, `-default`
  and `-password`, build a new credential there, for every login. A failed
  token is an `AggregateError` with an empty message, its first error
  tedious's "Security token could not be authenticated or authorized." and
  its second whatever the credential threw; mssql wraps it in its own
  `ConnectionError`, copying the empty message and keeping the original as
  an enumerable `originalError`.
- **`encrypt: true` is TDS 7's, and whoever answers in the server's place
  can decline it.** tedious sends PRELOGIN in the clear and starts TLS only
  when the answer says ON or REQ (`connection.js`,
  `performTlsNegotiation`); answered OFF or NOT_SUP, it sends LOGIN7
  unencrypted and, after a FEDAUTHINFO naming Azure SQL's SPN, which the
  guard passes, the token. Review showed it on 2026-10-17 with a listener
  answering in the server's place, the first build of this record giving
  an Entra pool `encrypt: true`; a SQL login's LOGIN7, its password in it,
  crossed the same way. Without `encrypt` the PRELOGIN says
  `ENCRYPT_NOT_SUP` (`prelogin-payload.js`). `encrypt: 'strict'` is TDS
  8.0: TLS before the first TDS message (`wrapWithTls`), given no
  `rejectUnauthorized`, so the server's certificate is checked whatever
  `trustServerCertificate` says.
- **Which servers take TDS 8.0**, measured on 2026-10-17 on Docker Desktop
  28.3.3 on Windows 11, with tedious's strict connection and a raw TLS
  handshake offering ALPN `tds/8.0`: `mcr.microsoft.com/mssql/server`'s
  `2019-latest` (15.0.4500.2) and `2022-latest` (16.0.4295.3) reset it,
  with a certificate configured through mssql.conf or without, and on
  2022 with TLS 1.3 allowed too; `2025-latest` (17.0.5015.4) took it with
  a certificate configured, negotiating `tds/8.0`, a SQL login's session
  reporting protocol version `0x08000000`, and reset it on its self-signed
  fallback certificate. Microsoft documents TDS 8.0 for SQL Server 2022
  and later, Azure SQL Database and Azure SQL Managed Instance
  (learn.microsoft.com, *TDS 8.0*, read 2026-10-17); none of those is
  tested here, and SQL Server on Windows was not measured.
- **tedious's debug output prints a login's password**
  (`login7-payload.js`), and mssql turns it on with its own `debug`.
- **What @azure/identity reads from the environment.** A
  `ClientSecretCredential` reads `AZURE_AUTHORITY_HOST` unless it is given
  an authority; MSAL reads the region (`AZURE_REGIONAL_AUTHORITY_NAME`,
  `MSAL_FORCE_REGION`, `REGION_NAME`), the log level `AZURE_LOG_LEVEL`, and
  @azure/core-rest-pipeline the proxy (`HTTPS_PROXY`, `HTTP_PROXY`,
  `NO_PROXY`). A `ManagedIdentityCredential` finds its platform by
  `IDENTITY_ENDPOINT`, `MSI_ENDPOINT`, `IMDS_ENDPOINT`,
  `AZURE_POD_IDENTITY_AUTHORITY_HOST` and their kin; and with
  `AZURE_TENANT_ID`, `AZURE_FEDERATED_TOKEN_FILE` and a client id set it
  takes AKS workload identity's token exchange instead
  (`tokenExchangeMsi.js`): a `WorkloadIdentityCredential` as the tenant
  `AZURE_TENANT_ID` names, the client `AZURE_CLIENT_ID` names when it was
  given none, at the authority `AZURE_AUTHORITY_HOST` names. Review sent
  it to a listener named there on 2026-10-17, and with `AZURE_LOG_LEVEL`
  set the library printed the tenant id.
- **Each credential keeps its own token cache**: a
  `ClientSecretCredential` in its MSAL confidential client, whose client
  credential flow answers from the cache first, and a
  `ManagedIdentityCredential` in its MSAL managed identity application.
  The registry drops a pool whose open failed, and the next request opens
  another (0019), so a credential built for each pool would ask Entra, or
  the host's endpoint, again on every attempt.
- **SQL Server on Linux takes no Entra login**, measured with
  `mcr.microsoft.com/mssql/server:2022-latest` as installed here, 16.0.4295.3
  (`sha256:4402d880dd4c…`), on Docker Desktop 28.3.3: asked with a FEDAUTH
  LOGIN7 through mssql and tedious, over TLS and without, it answered
  "Login failed for user ''." in 10 to 27 ms over four attempts in two
  runs, and sent no FEDAUTHINFO, so a credential that counted its calls
  counted none; `2025-latest`, 17.0.5015.4, over TDS 8.0 with a
  certificate configured, answered the same in 38 ms in one attempt. A SQL
  login with an empty user is answered in the same words, and the
  server's errorlog gives both the same reason, "An attempt to login using
  SQL authentication failed". Nothing the server says tells an Entra login
  from a fallback to a SQL login.
- **A managed identity off Azure fails inside mssql's 15 s connect
  timeout**, measured by asking `ManagedIdentityCredential.getToken` for
  Azure SQL's scope, system-assigned and user-assigned, three times each:
  0.00 to 0.02 s on this Windows 11 machine under Node 24.21.0, and 4.53 to
  6.37 s in `node:22.12-alpine`, the server image's base, under Docker
  Desktop 28.3.3 with WSL 2's kernel 5.15.167.4, with @azure/identity
  4.13.3 and @azure/msal-node 6.0.1 in both. Each was
  `CredentialUnavailableError`, "Network unreachable". This is the token
  alone: through a login it is asked for only after a server sends
  FEDAUTHINFO, which no server here does, so no login off Azure was
  timed.
- **The allowlist kept an entry whole**, unknown keys and all, once its
  known fields passed, and never checked `tls`: `drivers.ts` read
  `tls?.enabled ?? true`, so `"enabled": "false"`, a string, was not false.

## Decision

**The allowlist.** A SQL Server entry logs in one way: `user` and
`password`, as before, or `login`, and never both.

```json
{"id":"erp","kind":"sqlserver","host":"erp.database.windows.net","port":1433,"database":"erp","schemas":["sales"],
 "login":{"type":"entra-managed-identity","client":"<the identity's client id; left out for the host's own>"}}
{"id":"erp","kind":"sqlserver","host":"erp.database.windows.net","port":1433,"database":"erp","schemas":["sales"],
 "login":{"type":"entra-service-principal","tenant":"<tenant id>","client":"<client id>","secret":"file:/run/secrets/erp-client-secret"}}
```

`type` is one of the two. `tenant` and `client` are ids, UUIDs, and a
domain-name tenant is refused. `secret` is an `env:` or `file:` reference,
resolved by `secrets.ts` where the connection is first opened, as a
password is (0019); a managed identity takes none. An Entra entry refuses
`tls.enabled: false` and `tls.trustServerCertificate: true`. There is no
authority: the public cloud is the only one. `login` on PostgreSQL is
refused. **Every entry refuses a key it does not read**, at its top level,
in `tls` and in `login`, naming the key and never its value, and `tls`'s
two settings must be booleans. Each problem is one line, every problem at
once, as before. **The server does not start with a managed identity
entry while `AZURE_FEDERATED_TOKEN_FILE` is set**, naming the connection
and the variable and never its value: the library would log in by
workload identity, as the environment's tenant, client and authority.
The token file alone is refused, though the library also needs the
tenant and a client id.

**The types.** `ConnectionConfig` gains `login`, and its `user` and
`password` become optional. `ConnectionFactory` takes the resolved secret
as `string | undefined`: a password, a client secret, or none.

**The adapter.** `connectSqlServer` takes a SQL login, `user` and
`password`, or `entra`, `{ type: 'managed-identity', clientId? }` or
`{ type: 'service-principal', tenantId, clientId, clientSecret }`: plain
strings, so no @azure type reaches the package's declarations. **An Entra
principal logs in over TDS 8.0**, `encrypt: 'strict'`: TLS before the
first TDS message, with the server's certificate checked, so there is no
PRELOGIN in the clear for anybody to answer. An Entra pool asked for
without TLS, or with the server's certificate trusted, is refused before
it connects. The adapter builds **one credential for each login object**
it is given, kept while the object lives, which mssql hands every
connection of every pool opened with it, as tedious's `token-credential`,
and no user or password; the server's `drivers.ts` keeps one login object
for each connection while its secret is the same, and makes a new one
when the secret changes. A pool opened again after a failed open logs in
with the credential, and the cached token, the last one had. A service
principal is a `ClientSecretCredential` whose authority, the public
cloud's, is written down, so `AZURE_AUTHORITY_HOST` is never read; a
managed identity is a `ManagedIdentityCredential`. The pool is given a
**guard** in front of it that asks for
`https://database.windows.net/.default` and refuses any other scope before
the credential is called, whatever the server names. A failed Entra login
rejects with a fixed sentence: Entra ID issued no token, with its AADSTS
code when it gave one; the server asked for another resource's token; or
the server refused the login. The guard keeps nothing of what Entra
answered, so no error in the chain holds a tenant, a client, a trace id or
a secret. Neither mssql's `debug` nor tedious's is ever set.
@azure/identity becomes the adapter's own dependency, at exactly 4.13.3.

**What is said.** The server logs at start, once for each connection that
logs in as an Entra principal, "No test of this release logs in as an Entra
principal; connection erp logs in as one.", naming the connection and
nothing else. `SQLSERVER_LOGINS`, exported by the adapter, lists the SQL
login as tested and the two Entra principals as not, and the README's
*What it is tested on* table derives its *SQL Server logins* row from it.

## Consequences

**What it buys.** An Azure SQL database that takes only Entra logins can be
named in the allowlist, by an identity the host already has or by an
application registration whose secret stays a reference. Nothing of an
Entra login crosses the network before a TLS handshake with a certificate
the host trusts, so whoever answers in the server's place sees none of it.
A token is asked for Azure SQL alone, so a server that is not Azure SQL
cannot have the principal's token for another service. A later release's
setting in an allowlist this one reads is refused rather than dropped.

**What it costs.**
- **A partner makes the first successful login.** No test of this release
  logs in as an Entra principal, and nothing shows any of these: an Entra
  login succeeding; Azure SQL's SPN, documented and never seen here,
  passing the guard; a token refreshed, and a pool that outlives its
  token; Azure SQL taking TDS 8.0, which Microsoft documents; a managed
  identity's endpoint on each host that has one; and `original_login()`
  for each principal, which the snapshot's account, the bundle and a
  version file
  ([0062](0062-a-published-version-moves-between-deployments-as-its-version-file.md))
  will name. The token's path, where `getToken` is called and fails, is
  reached by `entra.test.ts` alone.
- **Only a server that takes TDS 8.0 can be reached as an Entra
  principal.** SQL Server 2019 and 2022 on Linux, as measured above, reset
  the connection, and so does 2025 without a certificate configured; the
  login fails at TLS, with tedious's sentence naming the host and port,
  before the server sees it.
- **A new direct dependency**: @azure/identity, and MSAL beneath it, which
  tedious already brought, now named at an exact version this repository
  moves by hand.
- **An operator file with a stray key no longer starts the server**, and
  says which key: breaking for that file, and the reason for it is above.
  A `tls` setting written as a string stops it too.
- **A managed identity cannot log in where AKS workload identity is
  turned on**: with `AZURE_FEDERATED_TOKEN_FILE` set, a server whose
  allowlist names one does not start, and a service principal is the way
  in. The check is the runnable server's, in main.ts: an embedder's own
  composition root does not have it.
- **Breaking for an embedder**: `ConnectionConfig.user` is no longer
  always a string, and a `ConnectionFactory` of their own is given
  `string | undefined`.
- **What @azure/identity reads is not all in the reviewed file**: the
  region, the proxy and the log level for any credential, and a managed
  identity's platform. `AZURE_LOG_LEVEL` set writes the library's lines
  to standard error, outside Fastify's logger, as it already could
  through tedious's copy.
- **Diagnostics-channel subscribers** of mssql get its error object; for an
  Entra pool that object holds tedious's `AggregateError` with the guard's
  sentence, and nothing of the principal.
- **Only the first connect says the sentence.** A login refused after the
  pool opened -- a grant revoked, a principal disabled -- reaches a record
  request as `unavailable`, but discovery's log line logs mssql's message,
  which for a token failure is empty.
- **A connection's credential, and its cached token, live as long as the
  server**, while its secret is the same: a change to the principal in
  Entra that its token carries, its groups among them, reaches a
  connection opened again after a failure only when that token is refreshed,
  as it already reached an open pool.
- **A secret file that cannot be read is named in the log line** that
  says the connection could not be opened, as a password's is: the path
  is the allowlist's, and what the operator has to fix. A resolved
  secret's path is written nowhere.
- **A managed identity off Azure** fails in the times measured above,
  inside mssql's 15 s connect timeout. A host that drops packets to the
  metadata address rather than refusing them could wait out the timeout,
  and the login would then fail as a timeout naming the host and port,
  not in the Entra sentence; nothing measured one.
- **The public cloud only.** The guard refuses Azure Government's and
  Azure China's SQL resources, and a domain-name tenant is refused.
- **No Entra login behind a certificate the operator must trust**: an
  estate whose server's certificate is self-signed, or behind a proxy
  that re-signs TLS, cannot use one.
- **The tested-on row's "tested" is typed** in `SQLSERVER_LOGINS`. The
  release report does not say which login each test made: the fixtures
  and the server's connection factory record no login type in a server
  record, so the sentence that every SQL Server login of a run was a SQL
  login is not written, and nothing but review holds the SQL login's
  `tested`.

**What it does not do.** Workload identity and certificates, which can come
through the same credential; `default`, `password` and `access-token`,
which this record refuses (below); an Entra login to PostgreSQL; Azure
Government or Azure China; a tenant by its domain name. **A SQL login's
TLS**, which stays TDS 7: a server that answers it will not encrypt is
refused before the LOGIN7 is sent, since
[0081](0081-a-sql-login-that-asks-for-tls-is-refused-when-the-server-answers-that-it-will-not-encrypt.md);
moving SQL logins to TDS 8.0 is a decision of its own.

**What it forecloses.** An Entra login whose LOGIN7 or token crosses the
network without TLS, over TLS that whoever answered could decline, or to a
server whose certificate is not checked; and a token asked for a resource
the server names, for as long as this record stands.

## Alternatives considered

**`azure-active-directory-default`, `DefaultAzureCredential`.** One type
for every host, but it chooses a credential from the environment, outside
the reviewed allowlist (0019), and on a developer's machine picks up their
`az login`.

**`azure-active-directory-password`.** Microsoft deprecates the flow, and it
fails for any account under multi-factor authentication.

**`azure-active-directory-access-token`.** A token the operator supplies
expires while the pool lives on: the registry keeps a pool for as long as
the server runs.

**tedious's own managed identity and service principal types.** No guard
and no credential of ours, but a credential built for every login, so no
token is reused, and the scope left to whatever the server names.

**`encrypt: true`, TDS 7, with the certificate checked**, which the first
build of this record gave an Entra pool. Every SQL Server takes it, 2019
and 2022 on Linux among them, but TLS starts only when the server's answer
asks for it, so whoever answers in the server's place declines it and is
sent the token, as review showed.

**Keeping this as a specification until a partner asks.** Nothing to
maintain until then, but an Azure SQL estate on Entra-only authentication
could not be connected at all, and a partner's first run would also be the
first time the code ran. Everything but the token exchange is tested here.

**A CI job against a real Azure SQL database**, which 0073 sets out as its
alternative B: it would show a login succeeding, and reverses 0003 for the
reasons 0073 gives.

**A fake TDS server, or a fake token endpoint.** Either would prove only
tedious or @azure/identity, which is what
[0003](0003-real-databases-in-every-test-run.md) refuses a mock for. The
listener `entra.test.ts` connects to answers nothing: it shows what this
adapter's configuration makes the driver send first, which no real server
can show, since none declines TLS on purpose.

**Documenting workload identity's environment and starting anyway.** The
credential would follow `AZURE_FEDERATED_TOKEN_FILE` to another principal
at another authority than the reviewed entry names, and a sentence in a
README is read after it did.

**A pause before a connection whose open failed is opened again.** Fewer
token requests after a failure, but every engine's connection would wait,
a database restarting among them, for a length nobody measured; keeping
the credential costs nothing between attempts.

**Refusing unknown keys on Entra entries alone.** A later release's key on
a SQL login would still be dropped, and the entry log in some other way.

**Accepting a trusted certificate for Entra, and warning.** A warning in a
log is read after the token was sent.

## Older records

Narrowed, not edited away: [0003](0003-real-databases-in-every-test-run.md),
whose rule that every adapter behaviour is proved against a real server
holds for an Entra login only up to the server's refusal -- a container
shows that it refuses one, that nothing is tried again and that nothing of
the principal is written, and no server here accepts one; and
[0073](0073-azure-sql-is-not-tested-and-the-release-says-so.md), whose
sentence that the release "does not connect to an Azure database that
accepts Entra logins only" no longer holds: such a database can be named
in the allowlist, and no test logs in to one. Extended:
[0019](0019-a-published-form-is-checked-every-time-it-is-read.md), whose
allowlist takes a login, refuses a key it does not read on every entry and
holds `tls` to two booleans; and
[0025](0025-each-adapter-owns-its-driver.md), whose adapter builds the
credential it logs in with, one for each connection, from its own copy of
@azure/identity.
