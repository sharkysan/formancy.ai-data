# 0079 — A person downloads the records a list shows them as one CSV file, made whole or not at all

- **Status:** accepted; extended by [0080](0080-a-host-downloads-the-records-its-grid-lists-and-the-browser-saves-the-servers-file.md): the host page's Records panel and each child section under a saved parent download the file with Download CSV, the page sends the export route, and `@formancy/data-client` re-exports `exportFileName`; extended by [0104](0104-a-list-and-a-browse-are-filtered-by-conditions-on-their-columns.md): an export takes a list's filter, and the file holds the records it admits; extended by [0108](0108-a-forms-list-pages-after-the-last-row-it-showed-found-again-by-its-key.md): each page of a file is the list's after the last row of the page before, so a record deleted before a page is no longer left out, and the row a page continues after, gone, refuses the file `moved`
- **Date:** 2026-10-17
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/records/csv.test.ts` -- a comma, a quote, CR, LF
  and CRLF in a value each quoted and a quote doubled (watched failing with
  quoting on a comma alone: the value holding line breaks read back as four
  records instead of one); NULL an empty cell and `''` as `""` (watched
  failing with `''` unquoted: `,,x` where `,"",x` was expected); CRLF after
  every record, the byte-order mark first; `=1+1`, `+41 44`,
  `-2+3+cmd|' /C calc'!A0`, `@x`, a leading TAB and CR each behind one
  apostrophe, a header too (watched failing with the header left out of the
  rule: `=SUM(A1)` came back bare); `-1.00`, `-5` and `-1.5e+21` as they
  are (watched failing with every leading `-` prefixed: `'-1.00`); taking
  one leading apostrophe off every cell that has one gives back every value
  (watched failing with a cell already starting with `'` given none more:
  `'a` did not come back); an unpaired surrogate and a NUL refused, naming
  the header and not the value, and a surrogate pair written -- these last
  watched failing only while the module was missing.
  `records/export.test.ts` -- the readable fields in the form's order, a
  lookup as its label and `<label> (key)` (watched failing in the bindings'
  order: Id, Customer… where the rearranged model's Paid, Approved by… was
  expected); a field the policy hides has no column and no header (watched
  failing with every bound field exported: the auditor got twelve headers);
  a label that is a `{ $t }` reference heads its column with the key
  (watched failing with the grid's `String(label ?? key)`); `2^53 + 1`,
  `99999999999999.9999`, `0.30000000000000004`, a real's `0.1` and
  `2026-10-08T12:34:56.5` written as read (watched failing with timestamps
  through `displayText`, which cut the half second, with integers through
  `Number()`, `9007199254740992`, and with the answers written as the
  controls hold them, which `canonicalValue` undoes); `exportText` is
  `displayText` for every kind but time and timestamp; a lookup whose key
  fits no token refuses the file `unencodable` (watched failing with it
  written empty: a record that looked whole); no labels resolved for a
  lookup throws naming it (watched failing as a TypeError).
  `records/list-query.test.ts` -- `validateExportQuery` refuses `offset`,
  `limit` and anything else `malformed` (watched failing with them
  allowed: `{"offset":0}` accepted).
  `packages/data-fixtures/src/exports.test.ts` -- each hand-spelled cell
  of `EXPORT_ROWS` reads back as its name and none as a formula (watched
  failing with a formula cell's apostrophe removed, and with an
  apostrophe's doubling removed); their numbers collide with no other rows
  of tenant 1 (watched failing with one changed to 2001); `EXPORT_PARITY`'s
  lines are `FIRST_SHIPMENT`'s and `SECOND_SHIPMENT`'s values (watched
  failing with the columns reordered). `cases.test.ts` -- the `export:`
  family is in `sharedCases()` (watched failing with it left out). Both
  adapters' `list.integration.test.ts`, shared case `export: shipments`
  against `postgres:17-alpine` and `mcr.microsoft.com/mssql/server:2022-latest`
  -- the shipments listed through the adapter and written by data-core are
  `EXPORT_PARITY`'s bytes (watched failing on both with data-core built to
  cut timestamps: `2026-10-08T12:34:56` for `…56.5`).
  `packages/data-server/src/routes/runtime-exports.test.ts`, over fake
  ports -- the whole file, with `content-type: text/csv; charset=utf-8`,
  `content-disposition: attachment; filename="customer.csv"`, a
  `content-length` Fastify sets for the `Buffer` and `cache-control:
  no-store`; the list's own request at offsets 0, 50 and 100 with the
  body's search, sort and parent on every page (watched failing with every
  page at offset 0: 409 `moved`, and with the sort dropped after the first
  page); one resolve per page under the lookup's read filter (watched
  failing with the resolve unfiltered, and with the create filter: a person
  who may read and not create was refused 403); 401, 403
  `operation-denied`, `missing-attribute` from the row filter and from a
  lookup's, `field-denied`, `operation-unavailable` and 404, the port never
  asked; an offset, a limit or anything else in the body 400 `malformed`;
  past `EXPORT_MAX_BYTES` 422 `export-too-large` with nothing of the file
  and the trail's `rows` 16 (watched failing with a 200 of what fit); past
  `EXPORT_DEADLINE_MS` 503 `export-timeout` before the next page and before
  a page's labels, with nothing of the file (watched failing with the check
  before each page removed: the second page was asked); drift on the third
  page 409 with nothing of the first two; a record on two pages 409
  `moved` (watched failing with the tokens kept per page only), a record
  whose key fits no token among them (watched failing with the check kept
  on tokens: a 200 holding that record twice); text UTF-8
  cannot carry, in a value or in the form's own label, 409 `unencodable`
  naming the column; a second export from the same connection meanwhile,
  of the same form or of another on it, 503 `export-busy`, the first
  whole, another connection's not held up (watched failing without the
  gate: both ran; and with the gate kept per form: the other form's file
  200); labels past the lookup deadline 503 `unavailable` (watched failing
  with a failed resolve written as empty labels: a 200); a resolve given
  only what is left of the export's deadline, and the file then 503
  `export-timeout` (watched failing with the lookup's own deadline given:
  the resolve's signal said 60000 ms where 40 were left); a client that
  leaves stops the export before its next page, audited 499 `abandoned`
  (watched failing with the check removed: the second page was asked for
  nobody), and the page still running keeps the gate until it returns
  (watched failing with the gate given back when the client left: another
  form's file 200 beside it); a client that leaves while a resolve waits
  stops it, audited 499 `abandoned` (watched failing with the abandonment
  left unasked after a resolve: 503 `unavailable`); a format-1 bundle edited
  where it is stored to bind a binary column is accepted, its list
  answered, and its file 500 with nothing of it; the event is `export`
  with `rows` and no record, and holds nothing the person sent (watched
  failing with `rows` left null). `export-limits.test.ts` -- the deadline
  and a statement in flight end before every forwarding location's
  `proxy_read_timeout` in `deploy/web/nginx.conf` -- its own, its
  server's or the http block's, which is what the file sets outside every
  block -- or nginx's default (watched failing with `proxy_read_timeout
  30s` written into `/v1/`: `[ { location: '/v1/', ms: 30000 } ]`, and
  with it written above the map: all four forwarding locations at 30 s;
  the reading watched failing with what stands outside a block skipped).
  `runtime-lists.test.ts`, `runtime-menu.test.ts`, `runtime.test.ts` and
  `audit.test.ts` -- every other runtime event carries `rows: null`
  (watched failing before the field existed). `routes/admin-audit.test.ts`
  -- the export route is one the router holds, and emits exactly one
  event under its name.
  `e2e.integration.test.ts`, on both engines through the real server and
  drivers -- tenant 1's file of orders is tenant 1's list of them, in its
  order, and holds none of tenant 2's, whose own file is theirs, with
  `2^53 + 1` and `99999999999999.9999` digit for digit and the customer as
  `Muster AG` beside `k1:1,1001` (watched failing on both with the pages
  planned without the row filter: tenant 2's order in tenant 1's file);
  tenant 1's file of lines holds no line of tenant 2's order, with or
  without that order as the parent (watched failing on both with the
  throughs dropped); `EXPORT_ROWS`' customers written as their hand-spelled
  cells, the formula behind its apostrophe and quoted, `-1.00` as it is,
  `""` beside NULL's empty cell, and `999999999999.99` digit for digit; and
  on SQL Server alone an `nvarchar` holding an unpaired surrogate, and one
  holding a NUL, each refuse the file 409 `unencodable`.
  `packages/data-client/src/exports.integration.test.ts`, on both -- the
  `Blob` is the server's bytes under `<form id>.csv`; exactly the search,
  the sort and the parent travel in a POST body, the token in the header
  only (watched failing with the whole object sent: 400 `malformed`); a
  refusal is the server's code and sentence; an abort rejects with the
  AbortError. `transport.test.ts` -- a 200 that is not `text/csv` is
  `unexpected` (watched failing with the type unchecked: a file of `{}`);
  a body cut off before its announced length is `incomplete` (watched
  failing with a failed read taken for an empty file); `exportRecords` is
  among the calls that send only headers the server grants across origins.
  `scripts/install-fixture/consume.ts`, run by `pnpm test:e2e:install` --
  `exportRecords`, `RecordFile` and `EXPORT_MAX_BYTES` through the
  published entry points, the file read from a stub as the server answers
  (watched failing with the packed client's content-type check inverted:
  "exportRecords() did not read the file").
  `scripts/getting-started/journey.mjs`, run by `pnpm test:getting-started`
  on both engines, exports the orders as both tenants and fails when tenant
  2's file holds the order tenant 1 created; `journey.test.mjs` holds that
  check against a stand-in (watched failing with tenant 2's file left
  unread: a leak passed). `scripts/cloudflare/doors.test.mjs`, in
  `pnpm test:repo` -- `deploy/cloudflare/doors.json` is what the built
  server registers, so the runtime door forwards the route (watched failing
  with `main`'s doors.json: "run node scripts/cloudflare/doors.mjs
  --write"), which `pnpm test:cloudflare` then holds the tunnel's
  configuration to; `scripts/live-demo.test.mjs`, in `pnpm test:repo` --
  the live demo's Worker forwards exactly the routes that door does
  (watched failing once this branch met main's Worker: its pattern
  without `records/export`).
  **Not mechanically enforced:** what Excel or any other program shows of
  the file -- its byte-order mark, its comma in a `;` locale, the
  apostrophe, a 17-digit number -- none of it tried; that the composed
  stack's nginx is the only proxy in front (an operator's own is held by
  nothing); and how long an export of a given size takes, which nothing has
  measured.

## Context

A person could list a form's records a page at a time (0044) and see them
in the host page's grid (0047), and could take them nowhere else. The
competitor review behind this repository's plan names it: Directus,
Filament and AdminJS export CSV, and Forest Admin gates export per role.

Every row a list shows is already the person's: a list is a read, under the
read filter and every through (0043), and whoever may list can page
`records/list` from a script with the token the host gave their browser --
50 rows a request, under 600 requests a minute (`rate-limit.ts`). 0044
rejected a list grant separate from read because it "would claim to
withhold what `read` already gives".

A list is offset-paged, one guarded statement a page (0015), with no
snapshot between pages; a record's answers are what its controls hold, not
canonical values -- a whole-number field a JavaScript number, a nullable
boolean's radio `'true'` or `'false'` (`records/answers.ts`); a label is
cut by `displayText` (0028, 0040), and a zoneless timestamp read with its
fraction. Nothing reaches nginx before a buffered answer is whole, and
`deploy/web/nginx.conf` sets no `proxy_read_timeout`: nginx's default is 60
s, by its documentation. A list statement takes no signal (0044), and on
SQL Server ends at mssql 12.7.4's default request timeout, 15000 ms (read
by 0044). postgres.js 3.4.9 and mssql 12.7.4 each pool ten connections
unless told otherwise -- `max: … 10` and `pool.max || 10`, read in
`node_modules` on 2026-10-17 -- and neither adapter tells them.

## Decision

**`POST /v1/forms/:id/records/export` answers one CSV file of every record
the list would page through for the same search, sort and parent, under the
read right as it stands and no new one, made whole on the server before a
byte is sent: a 200 is the complete file, anything else a JSON refusal with
its own code.**

- **Who.** `listable` decides, as for a list, and a page offers the file
  exactly where it offers a grid (`PublishedForm.list !== null`).
  `FormPolicy`, the bundle formats, the studio's Policy step and older
  servers are untouched. An operator who wants no exports drops the path
  at the proxy; the server has no setting for it.
- **The body.** `validateExportQuery`: a list's `search`, `sort` and
  `parent`, read by the same checks, each optional; an `offset`, a `limit`
  or anything else is `malformed`. A POST, so the search is in no URL.
- **The pages.** The first page is planned by `planList` before anything
  else, so every refusal of the policy comes before a statement; each page
  is that request at the next offset, `LIST_PAGE_SIZE` long, one guarded
  statement decided over the description it carried as a list page is
  (0041, 0044), until a page says nothing follows. None is retried: a page
  that fails ends the file with that page's refusal.
- **The columns.** Every readable field, in the order of the published
  form's `model.fields` -- the grid's order -- headed by the field's label
  where it is a string and by its key otherwise, never by a column's name.
  A field the policy hides has no column. A lookup is two: its label under
  the field's header, then its token under `<header> (key)` -- exact,
  unambiguous for a composite key, the same on both engines. The labels
  come from one resolve per lookup field per page, under the person's
  `read` filter for that lookup (`lookupScope`, which the lookup routes now
  call too), the lookup deadline cut to what is left of the export's; a
  label the resolve does not give is an empty cell beside its token, and a
  lookup filter the policy refuses this person refuses the file.
- **The values.** `exportText` over the canonical value a read returns
  (`canonicalValue` undoes what a control holds): `displayText`'s spelling,
  one for both engines, except a time and a timestamp, written as read --
  a zoneless timestamp with its fraction. NULL is an empty cell and `''`
  is `""`. A record with no token is written; a lookup whose key fits no
  token refuses the file, since written empty it would read as NULL.
- **The text.** `csv.ts`: RFC 4180, a comma between cells and CRLF after
  every record, UTF-8 after a byte-order mark; a cell quoted when it holds
  `"`, `,`, CR or LF or is empty; a cell -- header, value or label -- that
  starts with `=`, `+`, `-`, `@`, TAB or CR and is not a number gets one
  apostrophe in front, and so does a cell that starts with an apostrophe,
  so taking one off every cell that has one gives back every cell. Text
  UTF-8 cannot carry -- an unpaired surrogate -- and a NUL refuse the file
  `409 unencodable`, naming the column and never the value.
- **Three bounds, each on what it protects.** `EXPORT_MAX_BYTES`, 16 MiB of
  UTF-8 with the byte-order mark, in data-core so server and client share
  it, counted as each record is added: past it, `422 export-too-large`. A
  budget for the memory one export holds -- the text, then the bytes sent,
  and the browser's `Blob` -- not a measurement and not a row cap.
  `EXPORT_DEADLINE_MS`, 30000, in `packages/data-server/src/export-limits.ts`,
  checked before every page and every resolve: past it, `503
  export-timeout`. Derived, not measured: nginx's 60 s default, less a SQL
  Server statement in flight that runs on to its 15 s, less 15 s of margin
  chosen. One export at a time per allowlisted connection in each server
  process: another meanwhile is `503 export-busy`, before any statement --
  so an export holds at most one of the pool's ten connections, and that
  only while a page runs.
- **Abandoned.** A client that leaves stops the export before its next
  statement, `499 abandoned`, which nobody reads and the trail records;
  the statement in flight finishes in the database. The bundle and the
  token are read once, at the start.
- **Not a snapshot.** A key already written refuses the file, `409
  moved` -- "The records changed while the file was made. Try again." --
  so no file holds a record twice. A record is known by its key's values
  as the page read them, not by its token, so one whose key fits no token
  is held to it too. A row deleted before the offset between
  two pages is skipped, unseen, and the file is sent.
- **The answer.** `content-type: text/csv; charset=utf-8`,
  `content-disposition: attachment; filename="<form id>.csv"`
  (`exportFileName`, no date), a `content-length`, and the `no-store`
  every answer gets. Its refusals: 400 `malformed` and the list's 400s;
  401; the list's 403s; 404; 409 `drift`, `moved`, `unencodable`; 422
  `export-too-large`; 499; 503 `export-timeout`, `export-busy`,
  `unavailable`. The Cloudflare runtime door forwards it, and so does the
  live demo's Worker, which forwards exactly the routes that door does
  (0070).
- **The client.** `exportRecords(formId, query?, signal?)` resolves to an
  `Outcome<RecordFile>`, `{ file: Blob, name }`, `name` from
  `exportFileName` and never from `content-disposition`, which a page on
  another origin cannot read (0060). Exactly the three keys travel; the
  answer is asked for as `text/csv, application/json`, an `accept` value
  CORS counts as safelisted, so the preflight a cross-origin export sends
  anyway, for its `authorization` and its JSON `content-type`, need not
  grant it, and `CROSS_ORIGIN_REQUEST_HEADERS` is unchanged. A 200 that
  is not `text/csv` is `unexpected`; a body that did not arrive whole is
  `incomplete`, never a file; a refusal is read as every read's; an abort
  rejects with the AbortError. `EXPORT_MAX_BYTES` and `RecordExportQuery`
  are re-exported.
- **The audit.** One event per export, operation `export`, with no record
  and nothing the person sent. Every runtime event gains `rows`: for an
  export the records the file holds, or those written into it before it
  was refused, 0 when no statement ran; `null` for every other operation.

Where the design this was built from and the code disagreed, the code won:
the answers a read returns are a control's values, so the file goes
through `canonicalValue`; a lookup whose key fits no token is a refusal the
design did not name; the client does not compare `content-length` with
what arrived, since behind a compressing proxy it counts other bytes, and
relies on `fetch`, which refuses a body cut short of it; a resolve is
checked against the export's deadline too, so a page whose labels cannot be
fetched in time is not written; and the design's check on tokens passed a
record whose key fits no token, which the export writes, so the check is on
the key's values instead. Two facts the design left open are settled:
a `{ $t }` label a presentation gives is refused by formancy's validator,
which `validateBundle` runs, because neither the generator nor a
presentation writes the `i18n` section it needs, while a form stored at
format 1 with one is served as stored, and its column is headed by the key
(`export.test.ts`); and a format-1 bundle edited where it is stored can bind
a binary column, which `validateBundle` accepts, and its file is then a 500
with nothing of it (`runtime-exports.test.ts`). The host page's button is
not here: it is the next pull request's, with a record of its own. Until
it is, `apps/host/src/plane.test.tsx`, which holds the host's journey to
send every runtime route, names the export as one the page cannot send
yet, and fails the moment the page sends one, so the exception goes with
the button, as 0050's for the delete route went with 0053's.

## Consequences

**What it buys.** A person takes the rows they may read into a spreadsheet
in one press, under the policy, the throughs and the parent the grid has,
in a file that is whole or not sent, whose cells are the database's values
on both engines and run nothing when a spreadsheet opens them.

**What it costs.**

- **No way to let somebody browse and not download.** Forest Admin can; a
  policy here cannot, and only the proxy can drop the path for everybody.
- **The file is not the table at one moment.** A row deleted meanwhile
  before an offset is skipped, unseen; a row inserted there refuses the
  file `moved`. In the default order -- key ascending -- a key the database
  numbers puts new rows past every offset.
- **Offsets read everything before them.** By how both engines run an
  offset, not measured here: page *k* reads every row before *k* × 50, about
  *n*²/100 rows for a file of *n*, and a sort no index serves reads every
  admitted row on every page; each page reads the table's catalog in its
  own statement too (0041).
- **Refused past 16 MiB or 30 s**, neither of which measures what an export
  finishes: one is a memory budget, the other a proxy's default less a
  driver's. On PostgreSQL nothing bounds a list statement, so a page that
  runs past nginx's 60 s gets the person nginx's 504 while the server makes
  a file for nobody. Cloudflare waits 100 s by its documentation; not
  tried.
- **One export per connection at a time, per server process.** Of two
  people exporting from one database, one is refused and learns that
  somebody else is exporting; replicas each have a gate of their own; the
  worst case in memory is the allowlisted connections times about twice
  16 MiB, and besides that every file still on its way to a slow client,
  since the gate opens once a file is handed to its socket.
- **A page still running keeps the gate.** An export refused at its
  deadline, or left by its client, gives the gate back only once the
  statement in flight returns, since that statement still holds one of the
  pool's connections; until then every other export through that
  connection is refused `export-busy`, "Try again in a moment". On SQL
  Server that is at most mssql's 15 s; on PostgreSQL nothing bounds it, so
  a page waiting on a lock keeps every export of that database refused for
  as long as it waits.
- **An apostrophe the database does not hold.** A text cell starting with
  `=`, `+`, `-`, `@`, TAB, CR or `'` -- `+41 44 …`, `@handle`, PostgreSQL's
  `-Infinity` -- carries one more, which a spreadsheet may show (not
  tried); the stored text needs the rule. A cell starting with a space or a
  full-width `＝`, which OWASP's list does not name, is not neutralised.
- **Instants to the second and times to the minute**, as a read holds them
  (0040); the file holds no more than a read does.
- **On SQL Server an unpaired surrogate or a NUL** in any text the file
  would hold refuses the file; the JSON list carries both.
- **A lookup whose key fits no token refuses the file**, `409
  unencodable`, where the grid shows the row: the record holds no token
  for it, and written empty the cell would read as NULL. One such row
  stops every file of the form that would hold it, until the search, the
  parent or the data leave it out.
- **What a spreadsheet does with it, not tried.** Excel shows
  `9007199254740993` to 15 significant digits, which the file does not; a
  reader that does not expect a byte-order mark glues U+FEFF to the first
  header; Excel in a `;` locale opens it as one column, and no `sep=,` line
  is written because it is a data row to everything else; Excel cannot
  tell `""` from NULL.
- **A header can repeat a label**, which pandas renames and some importers
  refuse.
- **A lookup filter the policy refuses this person refuses the file**,
  where the grid shows the tokens.
- **A form that binds a column with no text** -- only a format-1 bundle
  edited where it is stored can -- gets a 500 and no file.
- **Every runtime audit event gains `"rows": null`**, which a deployment's
  own sink sees. `outcome: 'ok'` says the server sent the whole file, not
  that the browser kept it.

**What it does not do.** No streaming, no snapshot, no keyset paging, no
column choice, no other format, no raw file without the apostrophe, no
nested child rows -- a child grid exports the child form with its parent --
and no button on the host page yet.

**What it forecloses.** A file that is the table at one moment without a
transaction across pages, and a policy that grants listing and withholds
the file.

## Alternatives considered

**`operations.export?: string[]`, optional as `delete` is (0050).** A
server older than the record refuses a policy naming it (`unread` in
`policy/inputs.ts`), and `validateBundle` runs on every read (0019), so a
downgrade stops every request of such a form; absent would have to mean
nobody, so every form published before loses export until republished; and
it would hide a button while `records/list` serves the same rows to a
script -- a rule nothing enforces, which 0011 and upstream's 0022 refuse.

**A deployment setting, `FORMANCY_DATA_EXPORTS=off`.** Honest, since it
stops the route for everybody; not until an operator asks.

**Streaming the file.** A 200 leaves before page two runs, and a cap, a
deadline or a move after that has no status to say it with: only a
connection cut before the last chunk, which `fetch` rejects without saying
why, and a "truncated" last line would be a data row. The browser holds the
whole file anyway.

**One transaction across every page.** On PostgreSQL a read-only REPEATABLE
READ transaction sees one snapshot, but holds a records connection and
VACUUM's horizon for the whole export and needs a port method running many
statements in one transaction, against 0015. On SQL Server SNAPSHOT needs
`ALLOW_SNAPSHOT_ISOLATION ON`, which this module cannot assume, REPEATABLE
READ blocks every writer of a row read until the end, and
READ_COMMITTED_SNAPSHOT is per statement.

**`GET /v1/forms/:id/records` with `Accept: text/csv`, or negotiation on
`records/list`.** No such GET exists and 0044 chose a POST to keep the
search out of URLs; one route answering a page or a file would give two
operations one audit name, and its body takes the offset and limit a file
refuses.

**The token alone for a lookup** -- no resolve, no new refusal, `k1:` in
front of a person -- or **the label alone**, neither exact nor unique.

**A file without the apostrophe for a caller that asks.** A program has
the JSON list; a raw file is the injection the rule exists to prevent,
one query parameter away.

**One export per person rather than per connection.** It bounds nothing
the pool cares about: ten people at once still hold every connection.

**A row cap.** It bounds neither memory, since a row can be wide, nor time,
since a page's cost grows with its offset.

**Measure first, then set the bounds** -- `perf/record-pages`: time a page
of records, and an export of the sized `sales.customer`, on both engines,
and derive the deadline from what an export finishes in rather than from a
proxy's default less a driver's. Not taken now: a page of records is
unmeasured (0044), and the measurement would hold the export back without
changing what the deadline protects -- that the proxy in front is still
waiting when the answer leaves -- which the proxy's own timeout sets and
`export-limits.test.ts` holds. A measurement that shows exports of a
realistic size need more than 30 s, or far less, is the record that
changes the number.

## Older records

Extends [0008](0008-exact-values-travel-as-strings.md): a file's cells are
the canonical values, digit for digit. Extends
[0015](0015-a-record-operation-is-one-guarded-statement.md): an export is
many statements, each a list page's, each guarded, none retried. Extends
[0023](0023-the-audit-trail-is-operational-not-evidence.md): the operation
`export`, and `rows` on every runtime event, a count and never which.
Extends [0028](0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md):
a file's labels are the resolve's, under the read filter, the same on both
engines. Extends [0040](0040-instants-and-times-are-read-to-the-shape-and-an-unedited-one-is-never-written.md):
the file inherits the read's cut of an instant and a time, and keeps a
zoneless timestamp's fraction that a label drops. Extends
[0043](0043-a-child-forms-rows-are-reached-only-through-a-parent-its-policy-admits.md):
every page carries the throughs. Extends
[0044](0044-a-forms-records-are-listed-a-page-at-a-time-under-its-read-policy.md):
the file pages the list, and adds no grant. Extends
[0060](0060-the-runtime-plane-answers-the-origins-an-operator-lists-and-the-administrators-plane-none.md):
no header is exposed, so the client names the file from the form's id.
Extends [0061](0061-a-lookup-statement-stops-when-its-request-is-abandoned-or-its-deadline-passes.md):
a file's resolves stop when the client leaves or a deadline passes, and an
export stops before its next statement when the client leaves. Within
[0070](0070-the-live-demo-runs-the-real-server-and-postgresql-in-a-cloudflare-container-of-each-visitors-own.md)'s
rule, unchanged: the live demo's Worker forwards the route, as it forwards
every route the runtime door does.
