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
 * timings. Not on the oldest images of the matrix, PostgreSQL 15 and SQL
 * Server 2019, nor on any image but the default; and how long a save holds
 * its record's row was not measured apart from the save's whole time. What
 * each run measured is in the suites' reports,
 * `test-results/save-sized-postgres.json` and `save-sized-sqlserver.json`.
 *
 * Each pair below is the p95 and the p99 by nearest rank, which over 20
 * runs is the 19th and the 20th: the "p99" is the slowest run of the 20.
 * PostgreSQL, where every statement is two round trips through Docker
 * Desktop's network: 24 and 27 ms at 1 line, 392 and 449 ms at 50, 808 and
 * 816 ms at 100, 1,835 and 2,157 ms at 200, 3,715 and 3,846 ms at 500. SQL
 * Server, one batch, whose plan the 20 runs reused: 85 and 87 ms at 1
 * line, 182 and 472 ms at 50, 272 and 459 ms at 100, 957 and 2,063 ms at
 * 200; and the first save of each size, a batch SQL Server had not seen
 * and compiled before it ran, 486 ms at 1 line, 1,194 ms at 50, 2,196 ms at
 * 100 and 5,080 ms at 200. A batch of 500 lines did not answer within
 * mssql's request timeout of 15 s, twice, measured on a fixture reused
 * across runs the same day, so the suite saves at most 200.
 *
 * What was measured is one shape: one child's creates, every run of a size
 * the same batch text. A batch's text on SQL Server follows the save's
 * shape -- how many deletes, updates and creates of each child, which
 * columns each update sets -- so a host whose people change different
 * things sends texts SQL Server has not seen, each compiled before it runs
 * and each leaving a plan in its cache: the first saves above are what a
 * new shape costs, and the reused plans' timings are a lower bound. A save
 * of several together children, a child's deletes and creates together,
 * up to twice its `max` steps, and updates or deletes at any size were not
 * measured.
 */

/**
 * The most lines one together child's creates were measured to hold in one
 * save (0155): the largest size measured whose p95 stayed under half the
 * default deadline on both engines and whose first save on SQL Server -- a
 * batch it had not seen, compiled before it ran -- stayed under a quarter
 * of mssql's request timeout of 15 s. `TOGETHER_MAX_ROWS` is the fewer of
 * this and a list's page less one, and the page is the fewer. It bounds
 * one child's rows; nothing bounds the steps of a save across its
 * children, which the measurement does not cover.
 */
export const SAVE_MAX_ROWS = 100

/**
 * How long a save may wait for a lock by default, and after which no step
 * of it starts (0155): the slower engine's slowest of 20 runs at 50 lines,
 * the size nearest the most a together child may hold, SQL Server's 472 ms,
 * four times over and rounded up to the 100 ms. On PostgreSQL it bounds
 * each statement too, its lock waits included, so a step that outlasts it
 * is cancelled there; on SQL Server it does not, and a step slow for
 * another reason than a lock -- a trigger's work, a scan in a count --
 * runs to its end, holding its locks (SAVE_PARITY's `slow-statement`), as
 * the batch's compile before any step does: both are bounded only by
 * mssql's request timeout of 15 s, which is `unknown-outcome`. The server
 * reads another from `FORMANCY_DATA_SAVE_DEADLINE_MS`, and refuses to
 * start where twice it is not below that timeout and a SQL Server
 * connection is allowed (data-server's `save-deadline.ts`).
 */
export const DEFAULT_SAVE_DEADLINE_MS = 1900
