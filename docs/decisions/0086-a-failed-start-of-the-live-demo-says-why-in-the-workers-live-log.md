# 0086 — A failed start of the live demo says why in the Worker's live log

- **Status:** accepted; extended by [0087](0087-a-live-demo-start-cloudflare-has-no-instance-for-is-started-again-within-a-minute.md): a start that answers says how long it took, and a failed one how often it was started again
- **Date:** 2026-10-19
- **Deciders:** Daniel Bacher
- **Verified by:**
  `apps/live-demo/src/worker/start.test.ts` -- a wait for `/health` says
  how it ended (answered, the deadline, the container stopped), after how
  many probes and how long, and what the last probe that threw said; and
  `failedStartLine` names the step that threw with the platform's error,
  or how the wait ended, and never the start's key, cut out wherever an
  error quoted it (watched failing on 2026-10-19 before either existed:
  the wait answered `true` or `false` alone, and `failedStartLine is not
  a function`).
  `scripts/live-demo-gate/worker.test.mjs`, in `pnpm test:repo`, over the
  gate's stand-in for Cloudflare's runtime and the Worker's own built
  module: a container whose `start()` throws, whose
  `setInactivityTimeout()` throws, and that stops at its first `/health`,
  each writes one line naming that step and what it threw, and a start
  whose error quoted the container's environment writes `"<key>"` where
  the key was (watched failing on 2026-10-19 with the Worker built from
  `main` at d015175: no line at all, in all four).

## Context

The live demo's Worker was created on Cloudflare on 2026-10-19
([0070](0070-the-live-demo-runs-the-real-server-and-postgresql-in-a-cloudflare-container-of-each-visitors-own.md)).
Its page, files and headers were what 0070 says, read with `curl` that
day: the page and its files with the live policy, the notices as
`text/plain; charset=utf-8`, a missing file the Worker's own 404, the
path without its slash a 307 to it. Every sign-in failed: four from
`curl` between 19:18 and 19:29 UTC, and the maintainer's from a browser,
each `503` `unavailable` after 32 to 33 s, the Worker's 30 s start
deadline and its answer. What showed why was nothing:

- `wrangler tail formancy-data-demo` showed each `POST /data/demo/session`
  and the Durable Object's `signIn` call, outcome `ok`, with no log line
  and no exception. The Durable Object turned every failure -- a throw
  from `start()` or `setInactivityTimeout()`, a `/health` that never
  answered -- into the visitor's 503 and wrote nothing (`catch {}`).
- `wrangler containers info` showed the application
  `formancy-data-demo-demoserver` ready, its health seven instances
  healthy and none assigned or active, no errors;
  `wrangler containers instances` one instance per sign-in, each
  `inactive`, with no location and no version.
- Observability is off for the Worker and the container (0070), so
  nothing was kept, and the dashboard showed nothing either.

0070 named this cost: "a failed start is diagnosed by reproducing it, not
by reading what happened." Reproducing it said only that it failed.

## Decision

**A failed start writes one line to the Worker's live log**, through
`console.error`, which `wrangler tail` shows and, with observability off,
nothing keeps: which step failed -- `start`, `inactivity-timeout`, the
wait for `/health`, or anything else that threw -- and what the platform
said, or how the wait ended, after how many probes and how long, with
what the last probe that threw said, and a `/health` that answered other
than 200 names its status. The start's key is made before the start, so
the line cuts it out wherever an error quoted it. Nothing a visitor sent
is in it. Observability stays off.

## Consequences

**What it buys.** A start that fails on Cloudflare says which step
failed, to whoever runs `wrangler tail` while it happens: the platform's
own error where it threw one, or whether the container never answered or
stopped.

**What it costs.**

- **Only while somebody tails.** Nothing keeps the line: a failure
  nobody watched is still diagnosed by reproducing it, now with the line.
- **Whoever can tail the Worker reads it.** That is anyone with access to
  the account's Workers. The line holds Cloudflare's error text as
  Cloudflare wrote it, the key cut out of it, and no visitor's input.
- **The server's own output is still nobody's.** The container's stdout
  and stderr are not logged (0070), so a server that started and refused
  to answer says no more than the status its `/health` answered.
- **One line per failed sign-in**, so a failing demo under many sign-ins
  fills the tail.

## Alternatives considered

- **Observability on, for the Worker or the containers.** Rejected for
  0070's reason: every visitor's requests kept by Cloudflare, for a demo.
- **An endpoint that reports the last failure.** It would say a platform
  error to anyone who asked, and keep state between visitors.
- **Nothing.** The first deploy failed every start, and nothing here
  could say why.
