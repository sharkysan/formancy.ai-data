/**
 * How long a test waits for Angular's previews to arrive.
 *
 * Angular bootstraps a whole application per preview, asynchronously, so a
 * test waits for the field that proves a preview mounted rather than for a
 * timer. Measured on 2026-10-09: on a Windows 11 workstation under coverage
 * all four previews arrive within a few seconds; on CI's hosted runner, with
 * the client's and the host page's suites and their databases running beside
 * this one, the Angular `sales.order` preview had not arrived after ten
 * seconds and two tests failed on main (run 37938885422) that had passed on
 * the same code in the pull request. Thirty seconds leaves room for that
 * spread and stays inside the sixty-second test timeout.
 */
export const ANGULAR_ARRIVES = { timeout: 30_000 }
