# 0081 — A SQL login that asks for TLS is refused when the server answers that it will not encrypt, before its login is sent

- **Status:** accepted
- **Date:** 2026-10-17
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-sqlserver/src/encryption.test.ts`, with no container.
  Through `connectSqlServer`, the real mssql and tedious against
  data-fixtures' PRELOGIN stand-in: a SQL login with `encrypt: true`
  answered NOT_SUP, and answered OFF, is refused with the sentence and
  `EENCRYPT`, the stand-in hears its PRELOGIN and nothing after it, and
  neither the user nor the password is in the error's message, its whole
  inspected graph or its JSON; answered with no ENCRYPTION option, it is
  refused with the unreadable sentence and sends no LOGIN7; the guarded
  connector is given to a SQL login with `encrypt: true`, its certificate
  trusted or not, and to no pool without `encrypt` and no Entra pool. The
  parser: ON and REQ pass with the answer's length, OFF and NOT_SUP are
  refused, every proper prefix of an answer in one packet and in two
  decides nothing, an answer in three packets is read as one message, the
  bytes after an answer are not part of it, ten unreadable answers are
  refused, a first message longer than any PRELOGIN payload can be is
  refused from the header that makes it so, and every answer the guard
  passes is one tedious's own parser reads as ON or REQ. The stream, over
  a loopback socket: nothing of an answer split across two reads and two
  packets passes until it is whole, then all of it; an answer with bytes
  after it in one read passes whole, and everything after passes both
  ways; each chunk after the answer is passed on as the socket's own
  memory, not a copy; NOT_SUP ends the connection with the sentence and
  passes nothing; an answer that came before the client wrote is decided
  on only once it has; and a server that ends before its answer is whole
  ends the stream without an error.
  `packages/data-sqlserver/src/adapter.integration.test.ts`, on the run's
  image of the matrix (0067) -- a SQL login with `encrypt: true` and the
  container's certificate trusted logs in through the guard, its pool's
  tedious configuration holds the guarded connector, and the server calls
  the session encrypted (`sys.dm_exec_connections.encrypt_option`).
  `packages/data-server/src/routes/unencrypted.integration.test.ts`,
  through the real routes and driver, the form published over the default
  image's SQL Server and then served with the same connection, through the
  allowlist with TLS on, at the stand-in's address answering NOT_SUP --
  the connection test, an opened form, a record read and a lookup each
  answer their fixed 503; every connection the server opened ended after
  its PRELOGIN; each log line that says the connection could not be
  opened says the adapter's sentence; and neither the password nor the
  user reaches the log, an answer or an audit event.
  `packages/data-fixtures/src/prelogin.test.ts` -- the stand-in answers
  only after a PRELOGIN, keeps each packet's type in order, keeps a LOGIN7
  a close cuts short, closes at a LOGIN7 and at a TLS record, and settles
  only once every connection it accepted has closed.
  Each was watched failing on 2026-10-17 with what it holds removed: the
  refusal (the stand-in heard `[PRELOGIN, LOGIN7]` from mssql answered
  NOT_SUP, OFF or no ENCRYPTION option, the stream passed the answer on and
  kept the connection open, and the server's log said tedious's
  "Connection lost - socket hang up"); the withholding (the first read of
  a split answer passed on alone, and part of an answer cut short); the
  wait for the client's first write (the error came before it); the
  connector left out of a SQL login's options; an unreadable answer passed
  on (eight of the ten passed, and the stand-in heard LOGIN7); the
  end-of-message bit ignored; a packet read before its length had
  arrived; the bytes after an answer dropped; the length limit removed;
  `connectSqlServer`'s translation skipped (tedious's "Connection lost - "
  before the sentence, code `ESOCKET`); OFF read as encrypting (tedious's
  parser read OFF); every answer refused (on SQL Server 2022 every SQL
  login with `encrypt: true` in `adapter.integration.test.ts` failed
  with the unreadable sentence); nothing passed after the answer (on 2022
  the TLS handshake never finished, and the connect timed out at 15 s); the refusal naming
  the user and password (both leak checks); each chunk after the answer
  passed on as a copy (five chunks of 30,000 bytes, none the socket's
  own memory); and in the stand-in, an answer on accept, `settled()`
  resolving at once, LOGIN7 not kept, and a packet's type kept only once
  the packet was whole (part of a LOGIN7 and then a close was kept as
  `[PRELOGIN]`, which review found).

## Context

[0074](0074-a-sql-server-connection-may-log-in-as-an-entra-principal-and-no-test-logs-in-as-one.md)
put an Entra login on TDS 8.0 because review showed, on 2026-10-17, that
TDS 7's TLS can be declined by whoever answers in the server's place, and
recorded as a cost that a SQL login, its password in its LOGIN7, still
went over TDS 7. Facts, read and measured on 2026-10-17 in the versions the
lockfile installs, mssql 12.7.4 and tedious 20.3.3, on Node 24.21.0:

- **What tedious does.** With `encrypt: true` it sends PRELOGIN in the
  clear, saying ENCRYPT_ON (`prelogin-payload.js`), reads the server's
  first message whatever its packet type, and starts TLS only when that
  answer's ENCRYPTION option says ON or REQ (`connection.js`,
  `performTlsNegotiation`). Any other answer falls through, and it sends
  LOGIN7 next, unencrypted: the user and the password under TDS's
  reversible obfuscation. The probe that showed it, a listener answering
  ENCRYPT_NOT_SUP, saw `PRELOGIN` and then `LOGIN7`; the characterisation
  this record's tests replaced showed the same for NOT_SUP and for OFF
  through `connectSqlServer`, passing against 0.1.0's code.
- **What MS-TDS says.** [MS-TDS]'s PRELOGIN section (learn.microsoft.com,
  read 2026-10-17): a client that sent ENCRYPT_ON and is answered
  ENCRYPT_OFF or ENCRYPT_NOT_SUP ends the connection, "Error (connection
  terminated)"; a server set to OFF answers a client's ON with ON. So no
  server that follows the protocol and can encrypt answers what this
  record refuses.
- **What 0.1.0 exposed.** `drivers.ts` turns TLS on unless the operator
  turns it off, so every SQL Server connection with TLS left on went over
  TDS 7 with `encrypt: true`, and whoever could answer in the server's
  place could be sent its login. The composed stack's connections turn
  TLS off, so they never asked for it.
- **TDS 8.0 is not the way out for a SQL login.** As 0074 measured,
  `mcr.microsoft.com/mssql/server`'s `2019-latest` and `2022-latest` on
  Linux reset a connection that opens with TLS, and `2025-latest` takes it
  only with a certificate configured; tedious's strict connection is
  given no `rejectUnauthorized`, so a certificate the operator trusts
  rather than checks cannot be used with it.
- **What tedious uses of its socket.** Read in `connection.js` and
  `message-io.js`: a custom `options.connector`, which mssql passes
  through, is called as `connect({ host, port, localAddress }, dns.lookup,
  signal)` on every connection, a redirect's and a retry's included
  (`connectOnPort`), though tedious's declaration says it takes nothing;
  of what it returns, tedious calls `setNoDelay` and `setKeepAlive`, pipes
  it into its incoming message stream and its outgoing one into it,
  unpipes both and repipes it through TLS when TLS starts, destroys and
  ends it, and listens for `error`, `close` and `end`. mssql's socket
  validation, which nothing here turns on, reads `destroyed` and
  `writable`.
- **What the servers answer.** Every image of the matrix took TLS from a
  SQL login asking ENCRYPT_ON through the guard, the session encrypted by
  the server's own account of it (results under *Consequences*).

## Decision

**A SQL login with `encrypt: true` is never sent to a server that did not
say it encrypts.** `sqlServerConfig` gives such a pool a connector,
`encryption.ts`'s, which opens each TCP connection as tedious's own
`connectInSequence` does -- every address the given lookup answers, asked
for all, tried in turn, each attempt abandoned when the signal aborts, the
local address kept -- and hands tedious a stream in front of the socket.
The stream withholds the server's first TDS message until it holds all of
it -- packets of type 0x04, each read whole by its header's length, to the
one marked last, however the reads split them and whatever follows -- and
has read its ENCRYPTION option, walking the option table as tedious walks
it. ON or REQ: the message and everything after it, the TLS handshake TDS 7
wraps in PRELOGIN packets included, pass through unchanged, so tedious
decides on exactly the bytes the guard read. OFF or NOT_SUP: the connection
is destroyed with "The server answered that it would not encrypt the
connection, so the login was not sent." An answer that is not one --
another packet type, an option table that does not close or reaches past
its payload, no ENCRYPTION option or two, a value MS-TDS does not name or
tedious does not know, a first message past 0xFFFF + 0xFFFF bytes of
payload, which no option can reach -- is destroyed with "The server's first
answer was not a PRELOGIN response this adapter could read, so the login
was not sent." Both carry `EENCRYPT`, tedious's code for a refused
negotiation of encryption, and name nothing of the login;
`connectSqlServer` rejects with the sentence alone, without tedious's
"Connection lost - ". Nothing is decided before tedious has written its
PRELOGIN, by when it listens for the stream's errors.

**Where it applies.** Only to a SQL login that asked for TLS. An Entra
pool is TDS 8.0 already (0074), with no PRELOGIN in the clear. A
connection the operator set unencrypted, `tls.enabled: false`, sends its
login unencrypted as before: that is the operator's choice, the composed
stack's among them, and nothing here second-guesses it.
`multiSubnetFailover`, for which tedious would connect to every address at
once, is not kept: nothing here sets it and no allowlist entry can.

**Why a stream in front of the socket.** tedious holds no reference to the
TCP socket, so nothing it does can read the server's answer except through
the guard: if tedious or Node read a socket another way, the guard still
stands between, and the suites fail rather than the password crossing.
Overriding the socket's `push`, or listening to its `data` beside tedious,
would let the answer through unread the day either changed how a socket
is read.

## Consequences

**What it buys.** Whoever answers in a SQL Server's place can no longer
strip TLS from a connection the operator asked to encrypt and be sent its
login: the connection ends after the client's PRELOGIN, as MS-TDS says it
should. The operator reads why in the log, in a sentence of its own. Every
SQL Server that encrypts is reached as before, over the TDS 7 every
version of the matrix takes.

Run on 2026-10-17 on Docker Desktop 28.3.3 on Windows 11 under Node
24.21.0, one image at a time, data-sqlserver's whole suite, 24 files and
359 tests, passed on each image of the matrix with the guard in place:
`mcr.microsoft.com/mssql/server:2022-latest`, the default, 16.0.4295.3;
`2019-latest`, 15.0.4500.2; and `2025-latest`, 17.0.5015.4. On each,
the SQL logins with `encrypt: true` in `adapter.integration.test.ts`
logged in through the guard, the server calling the session encrypted.
data-server's SQL Server integration files ran once, on the default, one
file at a time: nine of the ten passed, 144 tests, and the tenth,
`routes/admin-keys-reassigned.integration.test.ts`, whose container did
not say it had recovered within the fixtures' 120 s while other suites
shared the machine, passed alone, its 2 tests, when run again.

**What it costs.**

- **A private stream in front of tedious**, written against what tedious
  20.3.3 uses of its socket and how it reads the PRELOGIN answer. A tedious
  release that used more of the socket, read the answer another way, or
  started TLS before reading it would break it or make it beside the
  point. The suites would show the first two: every SQL login with
  `encrypt: true` in `adapter.integration.test.ts` goes through the guard
  on each image, and the parser is held to tedious's own on every answer
  it passes. Nothing would show tedious fixing the defect itself: the
  guard refuses first, and the tests pass either way.
- **tedious's connector is ours for these pools.** A later fix to
  tedious's `connectInSequence` -- its DNS handling, an order of
  addresses -- does not reach a SQL login with `encrypt: true` until it
  is copied here, and nothing says one was made.
- **Every byte the server sends passes through one more stream**, the
  guard's, for the life of each connection: each chunk the socket reads
  is queued and emitted once more, the same memory and not a copy, and
  only the reads that carry the server's first message are copied, into
  the buffer it is withheld in (`encryption.test.ts` fails when a chunk
  after the answer is passed on as a copy). Measured on 2026-10-17 on the
  default image, on the machine above while other suites shared it, seven
  rounds each, alternating, after one warm-up: reading 200,000 rows of 100
  bytes over TLS took 1,097 to 3,340 ms through `connectSqlServer`'s
  guard, median 1,907, and 1,036 to 3,224 ms through mssql's own pool with
  the same TLS settings, median 1,539. Each spread is wider than the
  difference between the medians, so this gives no figure for the cost;
  a quiet machine was not tried.
- **A server that cannot encrypt at all is refused.** One that answers
  NOT_SUP, which 0.1.0 logged in to unencrypted, now refuses every
  connection; the operator sets `tls.enabled: false` to log in to it, and
  the login then crosses unencrypted by that choice. No server here
  answers so: every image of the matrix encrypts.
- **The guard checks that TLS starts, not with whom.** With
  `tls.trustServerCertificate` true, whoever answers ON can complete the
  handshake with a certificate of their own and read the login, as
  before: trusting the certificate is the operator's choice, and the
  register says what it costs.
- **Only `connectSqlServer`'s pools.** An embedder's own mssql pool is not
  guarded, which 0025 already tells them not to open.
- **A later connection's refusal is said as tedious says it.** Only the
  pool's first connect rejects with the sentence alone; a connection the
  pool opens later and the guard refuses reaches a record request as
  `unavailable`, and by the code, not tried, discovery's log line as
  tedious's "Connection lost - " before the sentence.
- **The length limit is derived, not measured**: 0xFFFF + 0xFFFF bytes,
  from two-byte offsets and lengths, far past any answer a server sends.

**What it does not do.** Move SQL logins to TDS 8.0; check the server's
certificate where the operator trusts it; protect a connection the
operator set unencrypted; or report the defect to tedious, which is still
to be done and is the maintainer's.

**What it forecloses.** A SQL login whose LOGIN7 crosses the network
unencrypted after the operator asked for TLS, for as long as this record
stands.

## Alternatives considered

**TDS 8.0, `encrypt: 'strict'`, for every SQL login**, as 0074 did for an
Entra principal. No PRELOGIN in the clear at all, and the certificate
always checked; but SQL Server 2019 and 2022 on Linux reset such a
connection, and 2025 takes it only with a certificate configured, so every
tested server but one would be cut off, and a server whose certificate the
operator trusts rather than checks could not be reached at all.

**TDS 8.0 where the server takes it, TDS 7 where it resets.** A fallback
is the downgrade again: whoever answers resets the TLS handshake and is
offered the TDS 7 connection this record guards.

**A patched tedious**, `performTlsNegotiation` throwing when `encrypt`
was asked and the answer is neither ON nor REQ. Three lines where the
defect is, but a pnpm patch applies only in this workspace: the published
`@formancy/data-sqlserver` installs tedious unpatched, so every integrator
would have the defect the tests here said was gone.

**Reporting it upstream and waiting.** Right to do, and still due; but
until a tedious release refuses it and this repository adopts it, every
SQL login with TLS on sends its password to whoever answers that it will
not encrypt.

**Checking what tedious writes instead**, refusing a LOGIN7 written before
TLS started. Independent of how tedious reads the answer, but it reads
every packet the client writes, has to tell where TLS began in a stream
that turns into raw TLS records, and refuses after tedious decided rather
than before; the answer is one message MS-TDS defines.

**A hook on the socket** -- its `push`, or a `data` listener beside
tedious's. No stream of our own, but the guard is bypassed, failing open,
the day Node or tedious reads a socket another way.

**Trusting the network**, as 0.1.0 did and the register said. A sentence
in a README is read after the password was sent.

**A fake TDS server for the tests**, which
[0003](0003-real-databases-in-every-test-run.md) refuses for database
behaviour. The stand-in answers one message, the one whoever is on the
path writes, and proves only what the real client sends after it, which
no real server shows, since none declines TLS on purpose; every server
behaviour this record rests on -- TLS taken, a login over it -- is proved
against the real servers of the matrix.

## Older records

Extended: [0074](0074-a-sql-server-connection-may-log-in-as-an-entra-principal-and-no-test-logs-in-as-one.md),
whose cost that a SQL login's TLS can be declined by whoever answers no
longer holds for a SQL login that asks for TLS: it is refused instead,
and still goes over TDS 7. Consistent with, and not changed:
[0025](0025-each-adapter-owns-its-driver.md), whose adapter now also opens
the TCP connection each of those pools runs on.
