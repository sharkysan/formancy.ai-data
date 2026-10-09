# 0025 — Each adapter package owns its driver, and one suite runs the whole product on both engines

- **Status:** accepted
- **Date:** 2026-10-09
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-server/src/e2e.integration.test.ts` — on
  PostgreSQL 17 and SQL Server 2022, over HTTP into the real server and through
  the real drivers: an administrator proposes the order form and publishes it
  with a policy; a clerk finds a customer through the lookup, creates an order
  at the largest `numeric(18,4)`, reads it back exactly, saves a change, and is
  refused a stale save; another tenant can neither read the order nor pick its
  customer; drift reports nothing. It failed on SQL Server with "type.validate
  is not a function" until the adapters opened their own connections.
  `adapter.integration.test.ts` in both adapters — a connection opened by the
  package's own `connect…` function carries its discovery.

## Context

The composition root has to turn an allowlisted connection into the three ports
(0019). The obvious way is for the server to import `postgres` and `mssql`,
open a client or pool, and hand it to the adapters. That is what was built
first.

The end-to-end suite found what no other test could. pnpm installed two copies
of `mssql@12.7.4`, differing only in which `supports-color` satisfied an
optional peer of `debug`. The server's pool came from one copy; the SQL Server
adapter binds every value with `mssql.NVarChar` and friends from the other.
tedious checks those type objects by identity, and refused every parameter.
Every unit and adapter suite passed, because each built its own pool from the
same copy it bound with.

## Decision

**Each adapter package opens its own connections**: `connectPostgres` and
`connectSqlServer`, from the package's own copy of its driver, so a connection
and the code that binds values on it always come from one copy. The server
imports no driver; its composition root calls those functions.

**One suite runs the whole product**, end to end, on both engines, in CI, and is
the one place a disagreement between parts is found.

The composition root turns on the runtime plane when the configuration store
and the allowlist are configured, the administrator's plane when admin roles are
too, wires the audit sink and key, and closes every pool on SIGTERM.

## Consequences

**What it buys.** The defect is gone by construction rather than by a lockfile
that happens to dedupe; the server's dependency list is shorter; and the product
has a test that exercises it the way a host will.

**What it costs.** The adapter packages' public API grows by a connect function
and its options each. The end-to-end suite starts both databases, about a minute
cold, in every CI run. A deployment that wants to build its own pool — custom
pool sizes, a different TLS setup than the options express — has to go through
the connect functions' options, which are deliberately few.

**What it forecloses.** Passing a driver object built elsewhere into the server.

## Alternatives considered

**`pnpm dedupe`, or an override pinning `supports-color`.** Rejected: it fixes
this lockfile and not the next one, and a consumer's lockfile is not ours.

**`mssql` as a peer dependency of the SQL Server adapter.** Rejected: it moves
the duplication into every consumer's install and makes them responsible for
avoiding it.
