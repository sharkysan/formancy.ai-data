# 0074 — A SQL Server connection may log in as an Entra managed identity or service principal, with one credential per pool asked for Azure SQL's token alone, and no test logs in as either

- **Status:** accepted
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
  `deploy/connections.json` as committed; it says at start, once per Entra
  connection, that no test logs in as one, naming the connection alone;
  its login types are data-sqlserver's `SQLSERVER_LOGINS`, none of the
  Entra ones called tested; the registry resolves a service principal's
  secret and nothing for a managed identity, and refuses a secret that
  cannot be resolved without repeating it.
  `packages/data-sqlserver/src/entra.test.ts`, which constructs the real
  classes and asks Entra nothing — a service principal is a
  `ClientSecretCredential` of the allowlist's tenant, client and secret at
  the public cloud's authority, whatever `AZURE_TENANT_ID`,
  `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_AUTHORITY_HOST` say;
  a managed identity is a `ManagedIdentityCredential` by its client id or
  none; what a pool is given is the guard, which asks the credential for
  Azure SQL's scope alone and refuses any other, or more than one, without
  calling it; a refused token rejects with the sentence and the AADSTS
  code, keeping no cause; tedious's `AggregateError` under mssql's
  `ConnectionError`, raw or from the guard, a null token, and the server's
  `ELOGIN` become fixed sentences holding no tenant, client, secret or
  trace id, and a failure before the login passes as it came; an Entra
  pool without TLS is refused before it connects.
  `packages/data-sqlserver/src/adapter.integration.test.ts`, on the
  default SQL Server image — a service principal and a managed identity
  are each refused in exactly one failed login in the server's errorlog,
  with the sentence and nothing of the principal in the message, the
  inspected error or its JSON, and no token asked for; the configuration
  mssql hands tedious for every connection of an Entra pool is one
  credential, the same object each time, with no user, no password and no
  debug output; a SQL login's pool has no debug output.
  `packages/data-sqlserver/src/records-failures.integration.test.ts` — a
  login refused after the pool opened, disabled while its idle connection
  closed, is `unavailable` for a write as for a read, and nothing is
  written. `packages/data-server/src/routes/entra.integration.test.ts`,
  through the real routes and driver on the default SQL Server image — the
  connection test, an opened form, a record read and a lookup each answer
  their fixed 503 for both principals, the log says why in the adapter's
  sentence, and no secret, tenant, client or secret path reaches the log,
  an answer or an audit event. `scripts/release-report/tested-on.test.mjs`
  (`pnpm test:repo`) — the README's *SQL Server logins* row is
  `SQLSERVER_LOGINS`, the SQL login as tested and the Entra principals as
  accepted and not tested. Each was watched failing on 2026-10-17 with
  what it holds removed: every allowlist rule in turn, the authority left
  out, tenant and client swapped, the client id dropped, the class handed
  out unguarded, the scope comparison removed, the inner error rethrown,
  the translation skipped, the TLS refusal removed, `debug: true` in the
  pool's configuration, a second connect after a failed one (two failed
  logins), a user and a password beside the credential, a credential built
  for each connection, `failureFor`'s first branch removed (the write was
  `unknown-outcome`), the principal named in the error `drivers.ts`
  rethrows, the runtime plane's connection step rethrowing (500), and the
  README row left out or rendered as tested. **Nothing verifies that an
  Entra login succeeds.**

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
- **Without `encrypt`, tedious offers the server no TLS at all**: its
  PRELOGIN says `ENCRYPT_NOT_SUP` (`prelogin-payload.js`), not
  login-only encryption.
- **tedious's debug output prints a login's password**
  (`login7-payload.js`), and mssql turns it on with its own `debug`.
- **What @azure/identity reads from the environment.** A
  `ClientSecretCredential` reads `AZURE_AUTHORITY_HOST` unless it is given
  an authority; MSAL reads the region (`AZURE_REGIONAL_AUTHORITY_NAME`,
  `MSAL_FORCE_REGION`, `REGION_NAME`), the log level `AZURE_LOG_LEVEL`, and
  @azure/core-rest-pipeline the proxy (`HTTPS_PROXY`, `HTTP_PROXY`,
  `NO_PROXY`). A `ManagedIdentityCredential` finds its platform by
  `IDENTITY_ENDPOINT`, `MSI_ENDPOINT`, `IMDS_ENDPOINT` and their kin, and
  with `AZURE_TENANT_ID` and `AZURE_FEDERATED_TOKEN_FILE` set takes AKS
  workload identity's token exchange, under `AZURE_CLIENT_ID` when it was
  given no client id.
- **A SQL Server 2022 container takes no Entra login**, measured with
  `mcr.microsoft.com/mssql/server:2022-latest` as installed here, 16.0.4295.3
  (`sha256:4402d880dd4c…`), on Docker Desktop 28.3.3: asked with a FEDAUTH
  LOGIN7 through mssql and tedious, over TLS and without, it answered
  "Login failed for user ''." in 10 to 27 ms over three attempts and sent
  no FEDAUTHINFO, so a credential that counted its calls counted none. A
  SQL login with an empty user is answered in the same words, and the
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
once, as before.

**The types.** `ConnectionConfig` gains `login`, and its `user` and
`password` become optional. `ConnectionFactory` takes the resolved secret
as `string | undefined`: a password, a client secret, or none.

**The adapter.** `connectSqlServer` takes a SQL login, `user` and
`password`, or `entra`, `{ type: 'managed-identity', clientId? }` or
`{ type: 'service-principal', tenantId, clientId, clientSecret }`: plain
strings, so no @azure type reaches the package's declarations. For an
Entra principal it builds **one credential for the pool**, which mssql
hands every connection the pool opens, as tedious's `token-credential`,
and no user or password. A service principal is a `ClientSecretCredential`
whose authority, the public cloud's, is written down, so
`AZURE_AUTHORITY_HOST` is never read; a managed identity is a
`ManagedIdentityCredential`. The pool is given a **guard** in front of it
that asks for `https://database.windows.net/.default` and refuses any other
scope before the credential is called, whatever the server names. A failed
Entra login rejects with a fixed sentence: Entra ID issued no token, with
its AADSTS code when it gave one; the server asked for another resource's
token; or the server refused the login. The guard keeps nothing of what
Entra answered, so no error in the chain holds a tenant, a client, a trace
id or a secret. An Entra pool without TLS is refused before it connects.
Neither mssql's `debug` nor tedious's is ever set. @azure/identity becomes
the adapter's own dependency, at exactly 4.13.3.

**What is said.** The server logs at start, once for each connection that
logs in as an Entra principal, "No test of this release logs in as an Entra
principal; connection erp logs in as one.", naming the connection and
nothing else. `SQLSERVER_LOGINS`, exported by the adapter, lists the SQL
login as tested and the two Entra principals as not, and the README's
*What it is tested on* table derives its *SQL Server logins* row from it.

## Consequences

**What it buys.** An Azure SQL database that takes only Entra logins can be
named in the allowlist, by an identity the host already has or by an
application registration whose secret stays a reference. A token is asked
for Azure SQL alone, so a server that is not Azure SQL cannot have the
principal's token for another service. A later release's setting in an
allowlist this one reads is refused rather than dropped.

**What it costs.**
- **A partner makes the first successful login.** No test of this release
  logs in as an Entra principal, and nothing shows any of these: an Entra
  login succeeding; Azure SQL's SPN, documented and never seen here,
  passing the guard; a token refreshed, and a pool that outlives its
  token; a managed identity's endpoint on each host that has one; and
  `original_login()` for each principal, which the snapshot's account, the
  bundle and a version file
  ([0062](0062-a-published-version-moves-between-deployments-as-its-version-file.md))
  will name. The token's path, where `getToken` is called and fails, is
  reached by `entra.test.ts` alone.
- **A new direct dependency**: @azure/identity, and MSAL beneath it, which
  tedious already brought, now named at an exact version this repository
  moves by hand.
- **An operator file with a stray key no longer starts the server**, and
  says which key: breaking for that file, and the reason for it is above.
  A `tls` setting written as a string stops it too.
- **Breaking for an embedder**: `ConnectionConfig.user` is no longer
  always a string, and a `ConnectionFactory` of their own is given
  `string | undefined`.
- **What @azure/identity reads is not all in the reviewed file**: the
  region, the proxy and the log level for any credential, and a managed
  identity's platform, workload identity's file included. `AZURE_LOG_LEVEL`
  set writes the library's lines to standard error, outside Fastify's
  logger, as it already could through tedious's copy.
- **Diagnostics-channel subscribers** of mssql get its error object; for an
  Entra pool that object holds tedious's `AggregateError` with the guard's
  sentence, and nothing of the principal.
- **Only the first connect says the sentence.** A login refused after the
  pool opened -- a grant revoked, a principal disabled -- reaches a record
  request as `unavailable`, but discovery's log line logs mssql's message,
  which for a token failure is empty.
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
Government or Azure China; a tenant by its domain name.

**What it forecloses.** An Entra login whose token crosses the network
without TLS or reaches a server whose certificate is not checked, and a
token asked for a resource the server names, for as long as this record
stands.

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

**Keeping this as a specification until a partner asks.** Nothing to
maintain until then, but an Azure SQL estate on Entra-only authentication
could not be connected at all, and a partner's first run would also be the
first time the code ran. Everything but the token exchange is tested here.

**A CI job against a real Azure SQL database**, which 0073 sets out as its
alternative B: it would show a login succeeding, and reverses 0003 for the
reasons 0073 gives.

**A fake TDS server, or a fake token endpoint.** Either would prove only
tedious or @azure/identity, which is what
[0003](0003-real-databases-in-every-test-run.md) refuses a mock for.

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
credential it logs in with, from its own copy of @azure/identity.
