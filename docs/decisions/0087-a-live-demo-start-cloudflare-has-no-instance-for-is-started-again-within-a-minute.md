# 0087 — A live demo start Cloudflare has no instance for is started again, within a minute

- **Status:** accepted; the first sign-in after it said the container exited 1 at once, not that Cloudflare had no instance, which [0088](0088-the-demo-image-makes-postgresqls-socket-directory-at-every-start-and-the-gate-runs-it-with-run-empty.md) found and fixed
- **Date:** 2026-10-19
- **Deciders:** Daniel Bacher
- **Verified by:**
  `apps/live-demo/src/worker/start.test.ts` -- `noInstance` is true for
  `monitor()`'s "There is no container instance that can be provided to
  this Durable Object, try again later" and for nothing else; a start
  that answered says how long it took, after how many probes and how
  often it was started again, and a failed wait says how often too
  (watched failing on 2026-10-19 before either existed: `noInstance is not
  a function`, `startedLine is not a function`, and no count of restarts
  in the failed line).
  `scripts/live-demo-gate/worker.test.mjs`, in `pnpm test:repo`, over the
  gate's stand-in for Cloudflare's runtime and the Worker's own built
  module: a container Cloudflare has no instance for twice, which
  `monitor()` says and which never runs, is started again and answers,
  three attempts and one start, and the start says so in the live log;
  and a container whose `monitor()` rejects otherwise is said with its
  words within seconds and not started again (watched failing on
  2026-10-19 with the Worker built from `main` at 86fe95b: both waited
  out the test's 5 s with nothing running, and the stand-in's rejections
  went unhandled).

## Context

On the live demo's first day on Cloudflare every sign-in failed after the
30 s start deadline
([0086](0086-a-failed-start-of-the-live-demo-says-why-in-the-workers-live-log.md)).
With 0086 deployed, a sign-in at 19:55:43 UTC wrote:

> live demo: a start failed: /health did not answer within 30139 ms,
> after 108 probes; the last threw Error: The container is not running,
> consider calling start()

So `start()` and `setInactivityTimeout()` returned, and for 30 s the
container never ran. `wrangler containers instances` listed each
sign-in's instance as `inactive`, with no location and no version,
created about ten seconds after its Durable Object had given up:

| Sign-in, UTC | Gave up | Instance created |
|---|---|---|
| about 19:17:57 | about 19:18:29 | 19:18:38 |
| 19:28:40 | about 19:29:12 | 19:29:22 |
| 19:55:43 | about 19:56:14 | 19:56:24 |

Cloudflare's documentation says `start()` "returns before the container
is ready to accept requests" and that `monitor()` "rejects if the
container errors"; nothing there says what a start that gets no instance
does. Cloudflare's own Container class (`@cloudflare/containers`) watches
`monitor()` after each start and starts again when it rejects with
"There is no container instance that can be provided to this Durable
Object, try again later", a sentence documented nowhere but its issue
tracker (cloudflare/containers#262, read on 2026-10-19), whose reporter
saw such a start succeed after about 20 s. The Durable Object here
called `start()` once and never `monitor()`, so a start Cloudflare had
no instance for was a wait for a container that would never run.

Whether that is what happened on 2026-10-19 is not established: the line
above cannot tell a start with no instance from one still being placed.
This record makes the next line tell.

## Decision

**After each start the Durable Object listens to `monitor()`.** A
rejection with Cloudflare's no-instance sentence, while nothing runs, is
started again at the next probe, as often as the deadline allows; any
other rejection ends the wait at once, said with its words in 0086's
line.

**The start deadline is 60 s, not 30 s,** so that starts again and a
server's own start, 5 to 14 s at the `basic` share on a workstation
(0070), fit in it.

**A start that answers says so in the live log:** how long it took, after
how many probes, and how often it was started again. The deadline is to
be set from these lines, since no gate measures a start on Cloudflare.

## Consequences

**What it buys.** A start Cloudflare could not place at once is started
again rather than waited out, and a container that failed is said at
once with Cloudflare's own words. The first starts on Cloudflare say how
long they take.

**What it costs.**

- **A visitor may wait a minute** for a start that fails, twice as long
  as before, and the page still says a first start "takes a few seconds".
- **A pending `monitor()` keeps the Durable Object from eviction** until
  the container exits or for up to 15 minutes, as Cloudflare's
  documentation says; a running visitor's object is therefore held as
  long as their container, which Cloudflare bills as Durable Object
  duration.
- **The no-instance sentence is matched by its words**, which Cloudflare
  does not document: reworded, a start with no instance is said as a
  failed container, at once, and not started again.
- **Each start again is one more start request** to Cloudflare for the
  same visitor, within the one deadline.
- **Not shown to be the cause.** The next sign-in's line says whether
  Cloudflare had no instance; if it says the container still never ran,
  this record has not fixed the demo.

## Alternatives considered

- **Cloudflare's Container class from `@cloudflare/containers`,** which
  does this already. 0070 chose the Durable Object Container API, which
  Cloudflare recommends for new applications, and no runtime package in
  the Worker; adopting the class is a larger change than the one step it
  would add.
- **Only a longer deadline.** A start with no instance never runs
  however long it is waited for.
- **The `durable_object` scheduling policy,** which names the image and
  the instance at `start()`. A change of how Cloudflare places the
  containers, not of what the Durable Object does when one is not
  placed; open if this record does not fix the demo.
