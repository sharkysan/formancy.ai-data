# 0063 — The default lookup deadline is outside the measured product

- **Status:** accepted
- **Date:** 2026-10-15
- **Deciders:** Daniel Bacher
- **Verified by:** `scripts/performance-stale.test.mjs` — the measured product
  leaves out `packages/data-core/src/lookup/default-deadline.ts` and keeps
  `lookup/limits.ts`, where the deadline's logic is; and every file left out,
  read without its comments, is one exported integer and nothing else (watched
  failing with a function added beside the constant).
  `packages/data-performance/src/server-settings.test.ts` — the server a
  measurement runs has the longest deadline a timer holds (watched failing
  with the default given instead). `packages/data-performance/src/deadline.test.ts`,
  as before — the default equals what the committed figures derive.

## Context

0061 derives the default lookup deadline from the published figures: the
slowest timed lookup or resolve answer, rounded up. `deadline.test.ts` holds
the constant to that derivation, so a re-measurement moves it. 0034's stale
check, which the release runs first, compares a digest of every file the
server and the harness reach with the digest the figures were measured on,
and the constant's file was one of them.

The two did not compose. A measurement derived a number; setting the constant
to it changed a measured file, so the release refused the figures as stale; a
new measurement derived another number, and so on. Preparing the first release
found it: the committed default, 536 ms, came from a measurement in a Docker
Sandbox VM, and the release is measured in WSL on the same workstation, so the
derivation would move.

The constant's value does not reach a timed answer. A run starts the server
with `FORMANCY_DATA_LOOKUP_DEADLINE_MS` at the longest a Node timer holds
(0061), so no lookup in a run is ever cut by the default.

## Decision

The default lives alone in `packages/data-core/src/lookup/default-deadline.ts`,
and the measured product leaves that one file out
(`OUTSIDE_THE_PRODUCT` in `scripts/performance-product.mjs`, with its reason).
The deadline's logic stays in `lookup/limits.ts`, inside the product. The
harness's server settings are a function of their own, so a test can hold the
run to the longest deadline rather than a comment.

## Consequences

**What it buys.** A re-measurement converges in one run: it derives the
default, the constant is set to it, and the figures still describe the product.

**What it costs.** A change to the default alone no longer marks the figures
stale. What holds the default then is `deadline.test.ts`, which fails unless it
equals what the committed figures derive, so it cannot drift from them, only
follow them. A second file added to the list would be held to the same "one
integer" rule, which suits a number derived from the figures and nothing else.

**What it does not do.** It does not take anything that runs during a
measurement out of the product: a file that the harness or the server executes
with an effect on a timed answer stays in, and the guard refuses anything but
the one number in a file left out.

## Alternatives considered

**Hold the default at least, not exactly, at the derived value.** A
measurement that derived less would need no change; one that derived more
would still change a measured file and loop. Rejected: it fixes half the cases
and lets the default drift above what the figures say.

**Normalise the constant's line when hashing `limits.ts`.** No file moves.
Rejected: the digest would rest on the wording of one line, which the
repository does not let a check rest on.

**Derive the default at build time from `results.json`.** No constant at all.
Rejected for now: it makes a data file a build input of `data-core`, which has
no build step that reads one, for a number that changes only when someone
re-measures.
