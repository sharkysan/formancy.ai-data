/*
 * How large a save of a record with its rows may be, and how long it may
 * take by default (0155): measured, not chosen, by each adapter's
 * `save-sized.integration.test.ts` -- an order's lines created in one save
 * on the fixture's sales.order_line, 20 runs at each of 1, 10, 50, 100 and
 * 200 lines on both engines and 500 on PostgreSQL, timed from the save's
 * first statement to its answer -- on the default images,
 * postgres:17-alpine (17.11) and mcr.microsoft.com/mssql/server:2022-latest
 * (2022 CU27), PostgreSQL on 2026-11-15 and SQL Server on 2026-11-16, on a
 * Windows 11 workstation's Docker Desktop, one run at a time.
 * Not on the CI runner: CI runs the same suites and holds that a save of
 * SAVE_MAX_ROWS lines is stored within the default deadline, not the
 * timings. What each run measured is in the suites' reports,
 * `test-results/save-sized-postgres.json` and `save-sized-sqlserver.json`.
 *
 * PostgreSQL, where every statement is two round trips through Docker
 * Desktop's network: p95 24 ms and p99 27 ms at 1 line, 392 and 449 ms at
 * 50, 808 and 816 ms at 100, 1,835 and 2,157 ms at 200, 3,715 and 3,846 ms
 * at 500. SQL Server, one batch, whose plan the 20 runs reused: p95 85 ms
 * and p99 87 ms at 1 line, 182 and 472 ms at 50, 272 and 459 ms at 100,
 * 957 and 2,063 ms at 200; and the first save of each size, a batch SQL
 * Server had not seen and compiled before it ran, 486 ms at 1 line, 1,194
 * ms at 50, 2,196 ms at 100 and 5,080 ms at 200. A batch of 500 lines did
 * not answer within mssql's request timeout of 15 s, twice, measured on a
 * fixture reused across runs the same day, so the suite saves at most 200.
 */

/**
 * The most lines one save of a together child was measured to hold (0155):
 * the largest size measured whose p95 stayed under half the default
 * deadline on both engines and whose first save on SQL Server -- a batch it
 * had not seen, compiled before it ran -- stayed under a quarter of mssql's
 * request timeout of 15 s. `TOGETHER_MAX_ROWS` is the fewer of this and a
 * list's page less one, and the page is the fewer.
 */
export const SAVE_MAX_ROWS = 100

/**
 * How long a save's every lock wait and statement may take by default, and
 * after which no statement of it starts (0155): the slower engine's p99 at
 * 50 lines, the size nearest the most a together child may hold, SQL
 * Server's 472 ms, four times over and rounded up to the 100 ms -- so twice
 * it, the longest a save holds its locks before the round trip of its
 * answer, is well below mssql's request timeout. The route will read
 * another from `FORMANCY_DATA_SAVE_DEADLINE_MS`.
 */
export const DEFAULT_SAVE_DEADLINE_MS = 1900
