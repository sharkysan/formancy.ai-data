# 0031 — An answer lost after a write is unknown, carried to the host as such, and never replayed by anything here

- **Status:** accepted; extended by [0040](0040-instants-and-times-are-read-to-the-shape-and-an-unedited-one-is-never-written.md): an update's read, plan and membership checks run inside its sending, so a resend asks the database nothing; extended by [0041](0041-the-runtime-refuses-what-drift-blocks.md): a write's description is read inside its sending, and a create's plan and membership checks moved into it
- **Date:** 2026-10-09
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-fixtures/src/tcp-hop.test.ts` — the hop, with no database: it
  forwards both ways byte for byte, and passes a close on only after every
  byte before it, in both directions, keeping the other half open after one
  side ends its own (watched failing against the first hop, which tore both
  sockets down on the first close: 393216 of 4194304 bytes arrived); it drops
  a connection's answers from the read in which the marker completes, across
  a split and through one gap of exactly eight bytes, and a gap of seven or
  nine does not match (watched failing with the completing read forwarded,
  with a gap of seven, and with no tail kept between reads); it counts the
  marker the client sends across a split; a lost answer's `cut()` ends only
  the connections that swallowed and the hop's ends every one, after which
  the next is forwarded (watched failing with the lost answer's cut ending
  every connection).
  `packages/data-core/src/records/token.test.ts` — `intendedRecord` is the
  token of a typed key and a pinned tenant, null for a key the database
  numbers, a NULL or non-text value, a timestamp key and a key too long for a
  token, and equal to the token `toFormAnswers` gives the stored row for a
  composite key and a `char(2)` key (watched failing with it returning null,
  and with a refused encoding spelled anyway).
  `packages/data-server/src/routes/runtime.test.ts` — an unknown create is
  502 with `record: 'k1:1,8'` and the create sentence, a create whose key the
  database numbers names no record, an unknown update names the record and
  version it sent, each from exactly one call to the adapter (watched failing
  with the route asking the adapter again); the audit event of an unknown
  create names its record by the keyed hash (watched failing with `null`
  passed as the record); a read that reports `unknown-outcome` is a 500, not
  "may have been saved" (watched failing as a 502). A create or an update
  that arrives again with its write id is answered with the first sending's
  answer and the adapter is asked once -- also when the second arrives while
  the first still waits on the database, and when the first was unknown;
  the same id with another body, and an id that is not one, are 400 before
  anything is asked; another form, or no id, is another write; the second
  sending is audited as `repeated` (all but "another form" watched failing
  against the routes before the write id, which applied every sending).
  `packages/data-server/src/e2e-lost-answer.integration.test.ts` — release
  gate 6, on both engines, through a TCP hop in front of each database, the
  owner's own connection polled until the write was visible before the cut:
  an order create is 502 with no record, the marker crossed the hop towards
  the database once -- counted as the 502 arrives and again after one more
  round trip through the same pool -- and one order exists; an order update
  is 502 with its record and version, the change is stored, and a resend
  with that version is 409 `stale`; a customer create is 502 with
  `k1:1,<no>`, that token reads the customer back and a second create is 422
  `unique-violation`; the audit trail names the lost writes and the reads
  that settle them by equal references (all six watched failing with the
  route asking the adapter again on `unknown-outcome`: 201, 409 and 422
  instead of 502). Its teardown awaits the registry's close, which the
  PostgreSQL adapter bounds.
  `packages/data-sqlserver/src/records-failures.integration.test.ts` — a
  trigger that commits the write's transaction, or commits it and begins
  another, or rolls it back, and then raises an error of its own, is
  `unknown-outcome`, and only the commits are stored; a trigger that only
  raises is still `refused`, nothing stored (watched failing against the
  batch before this record: `refused` over a stored row).
  `packages/data-client/src/transport.test.ts` — against a `node:http`
  server: the server's 502 is an unknown write from the database, from one
  request; a socket destroyed after the request arrived and a 201 cut short
  are unknown writes from the transport, from one request each (P5); a
  proxy's 502 and 504, another JSON 502, a 500 and a 2xx without a record are
  unknown on a write, while a non-JSON 502 on a read is still `unexpected`;
  422 `refused`, 409 `stale`, 503 `unavailable`, 403 and a 429 with a
  sentence and no code are refusals (all watched failing against the client
  before this record, and the refusals with a 4xx required to carry a code);
  every create and update carries a write id of its own and a read none
  (watched failing against the client without one).
  `packages/data-client/src/reconcile.test.ts` — `unchanged`, `changed`,
  `present`, `absent` on the read's 404, `unverifiable` with no request, and
  the read's own refusal (watched failing with every refusal taken for
  `absent`, and with `unchanged` reported as `changed`).
  `packages/data-client/src/lost-answer.integration.test.ts` — on both
  engines through hop-backed connections: an update lost after the commit is
  an unknown write from the database, sent once, and reconciles to `changed`;
  an order create is unknown with no record, sent once, and reconciles to
  `unverifiable` without a request (watched failing with the 502 read as a
  refusal); a create the browser sends twice, as Chromium does, is stored
  once and the second answer is the first (watched failing with the client
  sending no write id: two orders).
  `apps/host/src/session.test.ts` — on both engines: a create lost after the
  server stored it is `unknown`, the order exists, a press sends nothing
  (`held`), `check()` is `unverifiable` with no request, and `allowAgain()`
  lets exactly one create through (watched failing with no hold); New clears
  the hold (watched failing with the hold kept across forms); an update lost
  after it was stored keeps its version and checks as `changed`; saved again
  as its sentence invites, it is stale by its own doing and stays unknown,
  and checks as `changed` (watched failing as a plain `stale`); an update
  lost before it was sent checks as `unchanged`, and Save then sends the
  same version and is stored (watched failing with an update held too);
  `absent` lifts the hold (watched failing with the hold kept).
  `apps/host/src/page.test.tsx` — on both engines: the notice is a focused
  region named "React It may have been saved", not an alert and not "Not
  saved"; a held press says it sent nothing; the check, "Enter it again
  anyway", its confirmation with the keyboard on its answer and Cancel taking
  it back, and the create it allows; axe's floor in the notice and in the
  confirmation (watched failing against the pane before this record, which
  showed no such region, and with Cancel leaving the keyboard nowhere). A
  second unknown save draws the notice afresh, with nothing of the first's
  check or confirmation, and "Enter it again anyway" takes the keyboard to
  its answer every time, a check in between included (watched failing with
  the notice kept across saves, which still said "Press Save to enter it
  again." over a held create, and with the keyboard left on the page). An
  update lost after it was stored and saved again is still the unknown
  notice, never "Not saved"; it checks as changed and "Load the saved
  record" replaces the draft, says so and leaves the keyboard on the pane's
  heading (watched failing with the button doing nothing); an update lost
  before it was sent, checked while the database is out of reach, says the
  outcome is still unknown, then checks as unchanged, and Save saves it
  (watched failing with the failed check worded as "not in the record").
  `apps/host/src/unknown-notice.test.ts` — `present` says a record with this
  key is stored, not that this save stored it, and `absent` that this form
  cannot find it, not that it is not stored (watched failing against "It was
  saved" and "It is not in the record"). No host suite reaches either
  through the page: no form the host's plane publishes names its own key.
  `apps/host/scripts/browser-test.mjs` (`pnpm test:browser`) — in Chromium,
  at every width: an update the real server stored and whose connection
  Playwright then reset, with the keyboard on the notice and the save sent
  once, and the same notice after its check, with "Load the saved record";
  a create whose answer a TCP hop between Chromium and the page dropped
  after the server stored it, the connection then closed -- Chromium sent it
  again on its own, the marker crossing the hop twice, one order is stored
  and the page says what was created (watched failing with the server
  applying every sending: two orders); a create lost on the way, checked,
  and "Enter it again anyway" with the keyboard on "Allow saving it again";
  each state with no sideways scroll, and contrast and target size measured
  (watched failing against the page built before this record).
  `packages/data-postgres` and `packages/data-sqlserver`'s
  `records-lost-answer.integration.test.ts`, through the same hop, hold each
  adapter's classification of a lost answer, and on SQL Server the
  `RequestError` wrapping 0017 read in mssql's source.
  `packages/data-postgres/src/adapter.integration.test.ts` — `close()`
  returns after a connection was cut in the middle of a statement, and lets
  a statement still running finish first (watched failing with `end()`
  unbounded, still waiting at 10 s, and with a grace of 0).

## Context

Plan DATA-11 and release gate 6: a write whose answer is lost must be
reported as unknown and never replayed by the product. 0015 decided the
adapters report `unknown-outcome` and nothing retries; what happened after
that had never been followed through or proved.

**What happened today.** The server answered `502 {code: 'unknown-outcome',
message: '… It may have been saved: reload before trying again.'}`. The
client passed it to its refusal reader and returned an ordinary `Refusal`;
the host's session called it `refused`, and the pane showed it under the
heading "Not saved", with "It may have been saved" beneath -- a
contradiction. A `fetch` that rejected was `unreachable`, and a proxy's 502
or a 2xx cut short was `unexpected`: both "Not saved" too. The session kept
its record and version, so pressing Save again resent an update with the
same version, which is safe, and a second create, which, with a key the
database numbers, is a second record. The renderer owns the Save button.

**What no test showed.** Every existing cut happened while a write waited on
a lock, and every kill or timeout stored nothing. No test showed a write that
committed and whose answer was then lost, on either engine; on SQL Server a
TCP cut was untested, and 0017's sentence that every failure arrives as a
`RequestError` was read in mssql's source.

**What was measured** (2026-10-09, Windows 11, Node 22.12.0, Docker 28.3.3,
`postgres:17-alpine` and `mssql/server:2022-latest`, postgres.js 3.4.9,
mssql 12.7.4, tedious 20.3.3, Playwright's Chromium, through the built
adapters and a probe hop):

- **P1.** A TCP cut while a SQL Server write waits on `tablockx`: five runs,
  `unknown-outcome`, a `RequestError` whose `code` and `number` are the
  string `'ECONNRESET'`, the session gone within 300 ms, nothing stored after
  the lock was released. SQL Server ends a session whose client went away;
  PostgreSQL's orphaned write commits after the lock goes (an existing case).
- **P2.** `pg_terminate_backend` of a waiting insert or update:
  `CONNECTION_CLOSED`, `unknown-outcome`, nothing stored.
- **P2b.** A deferred unique constraint with `returning`: the server sent
  `1 t T 2 D C E Z` -- the row and CommandComplete before the ErrorResponse at
  Sync. A text in an answer is not proof of a commit.
- **P2c.** `statement_timeout` while waiting: 57014, `unavailable`, nothing
  stored.
- **P3.** SQL Server's answer swallowed with `requestTimeout` and
  `cancelTimeout` at 1000 ms: `unknown-outcome` after 2009 ms, a
  `RequestError` with `'ETIMEOUT'`, and the committed row kept. The commit's
  answer reached the hop 40 ms after the send, which is why the suite's
  timer is five seconds: an attention that reached the server first would
  cancel the batch.
- **P4.** The answer dropped once it carried the write's marker: three runs
  per engine, the row visible from a direct connection at the match, then
  `unknown-outcome`, one row; on updates the stored value was the marker and
  the version had moved once. The marker went towards the database exactly
  once on each engine, through the adapters' own pools.
- **P5.** Node's `fetch` with the socket destroyed after the request, before
  and after reading, fresh and kept alive, and after `201` headers: the
  server saw exactly one POST every time; the first cases reject with
  `UND_ERR_SOCKET`, the last resolves and fails reading the body.
- **P6.** After a cut through a disarmed hop, a pooled PostgreSQL query issued
  within about 1 ms failed `CONNECTION_CLOSED`; from 10 ms all succeeded. SQL
  Server's pool recovered at once.
- **P7.** Chromium is not undici. A page that made a GET and then a `fetch`
  POST on the same kept-alive connection, which the server closed -- or reset
  -- after reading the POST and before any byte of an answer: the server saw
  the POST twice, and the page saw only the second answer. Through the hop,
  with the server storing the create and answering 201, the hop dropping the
  answer and closing the connection: two records stored, and the page told
  `201`. The same with the server answering `Connection: close` on every
  response: one POST. Chromium resends any method on a reused connection
  that fails before response headers, and the host's write nearly always
  travels on one, because the form, the record and the lookups come first.
- **P8.** On SQL Server, a trigger that commits the write's transaction, or
  commits it and begins another, and then raises an error, stores the row
  and reached the batch's CATCH like any refusal: `refused`, "nothing was
  written". In that CATCH, `current_transaction_id()` was no longer the one
  the batch began after either, and after a trigger's ROLLBACK and raise; it
  still was after a constraint's error and after a trigger that only raises.
- **P9.** postgres.js's `end()` does not return after a connection was cut
  under a query: the connection keeps the failed query as its current one,
  and `end()` without a timeout waits for it. In the e2e suite the
  PostgreSQL adapter's `close()` had not returned after 15 s; SQL Server's
  returned at once.

## Decision

A write whose answer is lost is `unknown-outcome` at every layer, carried to
the host as unknown and never as refused, and nothing in this repository
sends it again; what the browser sends again on its own is answered, not
applied. The host reconciles an unknown write by reading, and holds a create
that nothing can find until the person decides.

- **Which failures are ambiguous**, per engine:

  | Failure | PostgreSQL | SQL Server | Code for a write |
  |---|---|---|---|
  | Nothing sent | `ECONNREFUSED` … `CONNECTION_ENDED` | pool `ConnectionError`; tarn `TimeoutError` | `unavailable` |
  | Answer lost after commit | `CONNECTION_CLOSED` (P4) | `RequestError`, `number` the string `'ECONNRESET'` (P4) | `unknown-outcome` |
  | Cut while the write waits on a lock | the orphan commits after release | the session ends, nothing stored (P1) | `unknown-outcome`; over-reports on SQL Server |
  | Session ended by the server while waiting | terminate: `CONNECTION_CLOSED`, nothing stored (P2) | KILL: 596 or 21, nothing stored | `unknown-outcome`; over-reports |
  | Timeout | server 57014, rolled back (P2c) | client `ETIMEOUT`, which may follow a commit (P3) | `unavailable` on PostgreSQL; `unknown-outcome` on SQL Server |
  | Commit-time refusal | the row, then the error at Sync, rolled back (P2b) | TRY/CATCH and `xact_abort`, rolled back | that refusal's code |
  | Completion unknown, or the transaction ended by a trigger | 40003 | 3609; the transaction replaced; or ended and then an error raised (P8) | `unknown-outcome`; over-reports a trigger's ROLLBACK and raise |
  | Lost between the page and the server | — | — | `unknown-outcome` in the client, origin `transport`; undici never resends (P5) |
  | Sent again by the browser (P7) | — | — | the first sending's answer, from the server, once per write id |

- **The 502 body** (`UnknownOutcome` in `data-core`) carries `operation`,
  `record` and `version`. An update's are what it sent. A create's `record` is
  `intendedRecord(request)`: the token of the key the insert names -- a key
  the person types and a tenant pinned from the context -- or null when the
  database numbers it. The sentence never names a value (0011), and says what
  is safe next: an update "Saving again with the same version is safe: it is
  stored at most once"; a create with a record "read it before entering it
  again"; one without "only a search of your own can tell". The audit event
  names the create's record by the keyed hash (0023). A read that reports an
  unknown outcome is a 500. Each route asks the adapter once.
- **A write id names one sending.** The client sends a new
  `formancy-write-id` (`WRITE_ID_HEADER` in `data-core`) with every create
  and update. The server acts on an id once per person, form and operation:
  a request that arrives again with it gets the first sending's answer --
  awaited while that is still with the database -- and the adapter is not
  asked. The same id with another body, or an id that is not one, is 400
  `invalid-request` before anything is asked. A repeat is audited as
  `repeated`. Answers are kept in the process for ten minutes, at most
  10,000 and 32 MiB, oldest first. Measured on 2026-10-09 by the host page's
  browser gate, six runs: Chromium's resend reached the server 5 to 6 ms
  after the connection closed (the gate polls every 5 ms), and the order
  form's create answer was 234 to 236 bytes. Ten minutes is a margin over
  those milliseconds, not a measured client; the caps hold ten thousand such
  answers in about 2.4 MB, with room for larger records.
- **On SQL Server, the write batch's CATCH asks whether its transaction is
  still the one it began** (P8). If not, and the error is not 3609 or the
  batch's own replaced-transaction error, it raises its own, which is
  `unknown-outcome`: a trigger that commits and then refuses has stored the
  row.
- **The client** (`@formancy/data-client`) treats a write as known only when
  the data server says what happened: a 2xx with a record, its 502
  `unknown-outcome`, a 4xx with a sentence, or a 503 `unavailable`.
  Everything else -- a rejected `fetch`, a body that cannot be read or is not
  JSON, any other 2xx, a 500, another 502 or 504 -- is an `UnknownWrite` with
  origin `transport`, whose record and version are the update's own and null
  for a create. `UnknownWrite` has `ok: false`, so a host that checks only
  `ok` fails closed. `reconcile(formId, unknown)` reads what was addressed:
  `unchanged`, `changed`, `present`, `absent` (the read's 404),
  `unverifiable` (no token: no request), or the read's own refusal. Reads keep
  0029's rules.
- **The host's session** holds a form after an unknown create: a press sends
  nothing and says why (`held`), until `check()` finds it `absent` or the
  person confirms "Enter it again anyway". An unknown update holds nothing
  and keeps the version it sent; saved again and answered `stale` at that
  same version, it stays unknown, because the likeliest mover of the record
  is the save whose answer was lost. Load and New clear the hold, which
  belongs to the form.
- **The pane** shows a focused region named "It may have been saved", with
  the sentence, "Check whether it was saved", the result in a status line,
  "Load the saved record" for `present` and `changed`, and for `unverifiable`
  "Enter it again anyway" behind a confirmation. Each unknown save draws it
  afresh. The result says only what the read showed: "A record with this
  key is stored", "This form cannot find a record with its key". It is teal,
  the colour of what the server did, and not the warm colour of a refusal.
- **The proof** is a TCP hop in `@formancy/data-fixtures`: it drops a
  connection's answers from the read that carries a text the write's answer
  echoes, counts that text on its way to the database, and otherwise passes
  every byte and every close on. Every byte is the driver's and the server's
  (0003). A suite polls the owner's own connection until the write is
  visible before it cuts, because of P2b. The browser gate puts the same hop
  between Chromium and the page.
- **The PostgreSQL adapter's `close()` is bounded** at five seconds (P9): a
  statement still running then is destroyed, which is `unknown-outcome` for
  a write.

## Consequences

What this buys: a person is never told "Not saved" about a save that may be
stored; a create that may be stored cannot be stored again by a second press,
nor, within one server process, by the browser's own resend; an update's
resend is shown to be harmless; and gate 6 is a test on both engines that
fails if anything here replays a write, with the browser's resend measured
at the socket.

What it costs, and does not do:

- **It over-reports.** A cut while PostgreSQL is still parsing; a cut while a
  SQL Server write waits (P1); a KILL or a terminate; a SQL Server trigger
  that rolls the transaction back and then raises; a pooled PostgreSQL
  connection handed a write within about 1 ms of a network drop (P6); a data
  server that is down, or a proxy's page, on a save; a misconfigured form's
  500 on a save. Each is "it may have been saved" where nothing was.
- **The write id holds in one process.** Chromium's resend that reaches
  another replica behind a balancer, or this one after a restart -- a
  container killed while a write waited -- is applied again; so is one that
  arrives after its answer was dropped from the bounded store, and a
  request from a client that sends no id. Only HTTP/1.1 was measured;
  whether Chromium resends over HTTP/2 to a proxy was not, and the write id
  answers a resend whichever protocol carried it. Kept answers hold the
  record's values in memory for their ten minutes.
- **A create whose key the database numbers cannot be reconciled here.** A
  person who confirms "Enter it again anyway" may make a duplicate. Create
  idempotency in the database is deferred by the plan (section 12).
- **`unchanged` means "not visible yet".** On PostgreSQL an orphaned write can
  still commit after the check; a resend with the same version is then
  stale, which is the guard, and the session keeps it unknown.
- **`absent` is what the read shows.** The read goes through the person's
  read filter, and a create is under none, so a stored row the filter hides
  is `absent` too, as is a row whose key a trigger rewrote, which also
  breaks `intendedRecord`. Creating again is still safe -- the key refuses a
  second row -- and is answered as that refusal.
- **`present` is a row with that key**, which another person's create of the
  same key also is; the notice says so, and offers to load it.
- **`reconcile` needs read permission.** A person who may create and not read
  gets the read's refusal and is no wiser.
- **A transport-origin loss is audited as `ok`**: the server answered, and
  only the page did not hear it.
- **The hold belongs to the form.** New or Load clears it, and nothing stops
  the person entering the same record into the new form.
- **A 4xx with a sentence and no code is taken as a refusal**, because the
  data server's rate limit sends exactly that. A proxy that answered a write
  with a JSON 4xx carrying a `message` would be believed.
- **The hop needs the answer to echo a text marker.** A write whose answer
  carries none of what was sent cannot be proved this way.
- **A failed check repeats the read's sentence**, which for an unreachable
  database is "Nothing was saved" -- about the read. The notice adds that the
  save's outcome is still unknown; the server's sentence is not reworded.
- **The jsdom host suites prove only the transport origin**: they cannot load
  `@formancy/data-fixtures`, whose testcontainers need Node globals. The
  database origin is proved at the client and the server; the browser's
  resend by the browser gate, on PostgreSQL only.
- **A server shutting down after a cut waits up to five seconds** on
  PostgreSQL for a statement that will never answer.
- **The SQL Server timeout case races a fixed timer** against the commit,
  with a margin of two orders of magnitude; a runner slow enough to lose it
  fails the case saying the marker never appeared.
- **Measured only on PostgreSQL 17, SQL Server 2022 and Playwright's
  Chromium**, with the driver versions above.

## Alternatives considered

- **An idempotency column**, so a create could be resent safely across
  processes. Deferred by the plan; it changes the customer's schema.
- **`Connection: close` on every response**, so Chromium never reuses a
  connection and never resends (P7: one POST). Rejected: the browser's
  connection ends at the host's reverse proxy, not at this server (0024),
  and `Connection` is a hop-by-hop header a proxy does not pass on; it would
  cost every request a new connection where it did reach the browser, and
  HTTP/2 has no such header.
- **The server refusing a repeat as unknown**, instead of answering it with
  the first sending's answer. Simpler, holding no values; but the common
  case -- the network lost a 201 -- would hold a create nobody can check, and
  ask the person to decide about a record that is stored.
- **503 for an unknown outcome.** Says "try again", which invites the
  duplicate.
- **409 or 500.** 409 says the record conflicts, 500 that the server is
  broken; neither says it may have been saved.
- **A server-side reconcile route.** The client's read answers the same
  question through the same policy; a route of its own can come later.
- **A mocked driver** that drops the answer. 0003.
- **A kill timed against a sleeping trigger.** Ends the session before the
  commit (P1, P2): a different state from the one gate 6 is about.
- **toxiproxy.** Another image and its API, for what is one small file
  here.
- **Telling a SQL Server trigger's COMMIT from its ROLLBACK** by a temporary
  table made inside the write's transaction. 0017 rejected it for every
  write; a ROLLBACK and raise is over-reported instead.
- **`role="alert"` on the notice.** Announced twice with the focus move
  (0029).
- **A second "Save again" button.** A second submit path beside the
  renderer's, with its own validation to keep equal; the session's hold
  covers the renderer's button instead.

## Older records

Extended, not edited away: 0015's "never retried", now followed to the host;
0016's and 0017's classifications, now proved through a lost answer, and
0017's `RequestError` claim tested for a socket cut and a timeout; 0016's
adapter, whose `close()` is now bounded; 0023's audit record, which names an
unknown create by the record it would have made and a repeat as `repeated`.
Narrowed: 0017's documented limit that a trigger which commits and then
raises is reported as its refusal -- it is now `unknown-outcome`; 0022's
runtime plane, whose 502 now carries what was addressed and which answers a
write sent again with its first answer; and 0029's client, where a non-JSON
502 is `unexpected` on a read only, a write is classified by the rules above
and carries a write id, and `reconcile` is added.
