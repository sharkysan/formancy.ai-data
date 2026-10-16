/**
 * How long a lookup statement may run before the server stops it, unless
 * `FORMANCY_DATA_LOOKUP_DEADLINE_MS` says otherwise (0061).
 *
 * Measured, not chosen: the slowest timed lookup or resolve answer in
 * `docs/performance/results.json`, across both engines, every block and every
 * form, rounded up to the millisecond, so no lookup or resolve answer the
 * measurement timed would have been refused. Its untimed warm-ups, which
 * open the pool's connections, and the membership checks inside writes are
 * not in it (0061 says what that costs). `@formancy/data-performance`'s
 * `lookupDeadlineFrom` derives it, and its `deadline.test.ts` fails when this
 * differs from what the committed figures derive: a re-measurement moves it.
 *
 * In a file of its own, holding this number and nothing else, because the
 * measured product leaves this file out (0063): a run gives the server the
 * longest deadline a timer holds, so this value reaches no timed answer, and
 * counting it in made every re-measurement stale the moment it set the
 * number it derived. `scripts/performance-stale.test.mjs` fails if anything
 * but the number is added here.
 */
export const DEFAULT_LOOKUP_DEADLINE_MS = 892
