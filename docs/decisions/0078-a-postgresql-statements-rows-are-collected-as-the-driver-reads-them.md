# 0078 — A PostgreSQL statement's rows are collected as the driver reads them, never taken from the array it resolves with

- **Status:** accepted
- **Date:** 2026-10-17
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-postgres/src/lookups-limits.integration.test.ts`, "a
  lookup stopped part-way through its answer": on a pool of one behind the
  fixtures' TCP hop, a statement that has sent tenant 2's customer is
  cancelled while it sleeps, and the next search, resolve and rejects on
  that connection, under tenant 1's filter, each answer exactly what they
  answered before it. `records.integration.test.ts`, "a read after a
  statement that failed part-way on its connection reads the record": a
  division by zero in the third row of a statement on a pool of one, then a
  read of customer 1001 through the record adapter answers its name.
  `spike.integration.test.ts`, "the driver's array of rows after a
  statement that failed part-way", characterises postgres.js 3.4.9: after
  such a statement the next one's array is three long and holds one key,
  `2`, its own row, and the count starts again once a statement completes.
  Watched failing on 2026-10-17, with `start` taking the driver's array as
  it did: the search and the resolve threw `TypeError: Cannot read
  properties of undefined (reading 'key')`, from `lookupPage` and
  `resolvedRows` -- CI's error -- while the rejects passed, its empty slots
  read as no key; and the read threw "The identity matched more than one
  row; it is not a key of this table." The characterisation, against a
  `connection.js` given porsager/postgres#1254's `rows = 0` in
  `ReadyForQuery`, in this checkout's copy only and put back after: the
  array was one long.

## Context

On 2026-10-17 main's CI run 39024938334 failed
`lookups-limits.integration.test.ts`'s "an abort in the same tick as the
call leaves the connection usable" on `postgres:17-alpine` -- PostgreSQL
17.11, `sha256:b0f9560a…`, the digest the green runs compared with it had,
that morning and the day before. The search after the aborted one threw
`TypeError: Cannot read properties of undefined (reading 'key')` in
`lookupPage`: its array of rows had an empty slot where its first row
belonged.

postgres.js 3.4.9 stores each row a statement returns at `result[rows++]`,
where `rows` counts for the connection, not for the statement. It is set
back to 0 when a statement completes (`CommandComplete`) and nowhere else:
`ReadyForQuery` starts a new array for the next statement and leaves the
count where it was (`src/connection.js`: `DataRow`, `ReadyForQuery`,
`CommandComplete`). A statement that ends in an error after some of its
rows were sent -- stopped by a cancel request, as 0061 stops an abandoned
lookup, or failing in a later row -- leaves the count at the rows it sent,
and the next statement on that connection has its rows placed after that
many empty slots. Upstream knows it: porsager/postgres#1119 (2025-10-02),
#1181, and #1253 (2026-10-12), with #1254, which resets the count in
`ReadyForQuery`, open and unmerged. 3.4.9 is the latest release, and
master's `connection.js` has the same lines.

What it did here, measured on 2026-10-17 on the workstation 0061 names
(Windows 11, Intel i9-10900K, Docker 28.3.3, Node 24.21.0), with postgres.js
3.4.9, by a throwaway suite beside this package's own, while other test
runs shared the machine:

- **The case CI failed, repeated.** A search aborted in the same tick as the
  call, under tenant 2's filter, then a search on the same pool of one
  under tenant 1's, through the fixtures' hop: the second search's array
  had empty slots 6 times in 1,000 on `postgres:17-alpine` (17.11, a build
  other than CI's) and 7 times in 1,000 on `postgres:18-alpine` (18.6).
  Each time one slot -- the aborted search's one row had been sent before
  its cancel landed -- followed by exactly the second search's own row.
  Under CPU load on 17, none in 1,000: the window moves with the timing.
- **Made to happen.** A statement that sends rows and is then cancelled while
  it sleeps left the next statement's array with a slot for each of them,
  20 times in 20.
- **What a reader met.** A search and a resolve read a slot as a row and
  threw, so the person whose lookup came next was answered 503
  `unavailable` (0061: a port that rejects with anything but its signal's
  reason). A rejects read the slots as no key and answered rightly: a slot
  never makes a token a member. A record read of one row counted three and
  threw that its identity is no key. By the code, and not tried: an insert
  reads its returned row as `rows[0] ?? []`, which a slot would have
  answered as a success with every value NULL, and a delete that finds no
  `rows[0]` asks why nothing was deleted, though its row was.

**Whether one statement can be handed another's rows: not by this.** The
slots hold nothing. PostgreSQL ends one statement's messages with its
`ReadyForQuery` before the next statement's rows begin, postgres.js starts
a new array there, and only the index carries over. In the 3,000 probes
above, the loaded ones included, the aborted statement read tenant 2's rows
and the next one tenant 1's, and no row of tenant 2's was in any answer,
the 13 with slots included; the spike case holds the array's keys. So rows
read under one row filter do not reach another request's answer by this
path. What it did was refuse a person's lookup, or a record read, because
someone else's statement on the same connection had ended part-way.

## Decision

**`start` in `packages/data-postgres/src/sql/statement.ts`, through which
every lookup and every record statement runs, collects a statement's rows
itself, one at a time as postgres.js reads them, with the driver's public
`forEach`, and never reads the array the driver resolves with.** A
statement's rows are exactly those the driver read while that statement
was its current one, in the order they came, whatever an earlier statement
left the count at; and rows read through `forEach` never move the count,
so these statements neither meet the slots nor leave them. The rows are
still read with `raw()`, by position, and checked as before (0016).

## Consequences

**What it buys.** A lookup or a record statement on a connection where
another statement ended part-way answers as it would have. The cancellation
0061 sends -- which ends a statement part-way whenever it lands while rows
are on their way -- no longer costs the next person on that connection an
error. The same probe after the change, the same day: no slot in 1,000
same-tick aborts on each image, nor in 30 stops made to happen.

**What it costs.**

- **The catalog reads still take the driver's array.** Discovery's reads
  and the server's version read (`server.ts`) are postgres.js tagged
  queries on the records' client. One that failed part-way would leave the
  next catalog read on its connection behind empty slots; no test shows
  what discovery then does. postgres.js reads the server's array types on
  every connection it opens, a statement that completes, so a reconnect
  starts the count again -- by its code, not tried.
- **The workaround outlives the bug.** A postgres.js that resets the count
  changes nothing here except the spike case, which then fails by name;
  whether to read the driver's array again is this record's to revisit.
- **An embedder's own statements on the same client meet the bug as
  postgres.js has it**: an integrator who hands `createPostgresRecords` a
  client its own code also queries gets this adapter's rows right and its
  own as the driver gives them.

**What it does not do.** It does not change postgres.js, the statements a
lookup or a record operation sends, the round trips they take, or what 0061
cancels and when. SQL Server's adapter is untouched.

## Alternatives considered

**Waiting for porsager/postgres#1254.** Open and unmerged since
2026-10-12, with #1119 open since 2025-10-02; and the published adapter
depends on `postgres ^3.4.9`, so a consumer runs whichever 3.x its install
resolves.

**A pnpm patch of postgres.js.** It patches this workspace's install only:
an integrator's install of the published package would be unpatched, and
the suites would prove a driver no deployment runs.

**Dropping the empty slots from the driver's array.** It reads a defect's
shape as a contract: that the slots lead and hold nothing is what the
driver's code does today, not what it promises, and a change to it would be
read as rows.

**A statement after every abort**, to complete one and start the count
again. A round trip per abort, and a statement already pipelined behind the
stopped one -- which postgres.js allows for a prepared record statement --
would still meet the slots; and a statement that fails in a later row needs
no abort to leave them.

**Pinning an earlier postgres.js.** No release resets the count.

## Older records

Extends [0016](0016-postgres-operations.md): rows are still read as the
server's text, by position, through `raw()`, and now collected as the
driver reads them. [0061](0061-a-lookup-statement-stops-when-its-request-is-abandoned-or-its-deadline-passes.md)
is unchanged: its cancel requests are what ended a lookup part-way often
enough to be seen.
