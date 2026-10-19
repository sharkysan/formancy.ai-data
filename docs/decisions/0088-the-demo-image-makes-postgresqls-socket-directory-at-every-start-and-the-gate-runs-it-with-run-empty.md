# 0088 — The demo image makes PostgreSQL's socket directory at every start, and the gate runs it with /run empty, as Cloudflare does

- **Status:** accepted
- **Date:** 2026-10-19
- **Deciders:** Daniel Bacher
- **Verified by:**
  `scripts/live-demo-gate/docker.test.mjs`, in `pnpm test:repo` -- the
  gate runs every visitor's container with `--tmpfs /run`, an empty
  `/run` (watched failing on 2026-10-19 before the flag: no `--tmpfs` in
  the arguments). `pnpm test:live-demo`, in CI's `live-demo` job, which
  starts every container of its journeys so, and so starts the image as
  Cloudflare does. By hand on 2026-10-19, Docker Desktop 28.3.3: the image
  built from `main` at df7decb, run with `--tmpfs /run`, exited 1 within a
  second, PostgreSQL's last words "could not create lock file
  "/var/run/postgresql/.s.PGSQL.5432.lock": No such file or directory";
  run without it, it served; built with this record's `start.sh`, it
  served with `/run` empty too.

## Context

With
[0087](0087-a-live-demo-start-cloudflare-has-no-instance-for-is-started-again-within-a-minute.md)
deployed, the first sign-in on Cloudflare, at 20:19:13 UTC on
2026-10-19, wrote to the Worker's live log
([0086](0086-a-failed-start-of-the-live-demo-says-why-in-the-workers-live-log.md)):

> live demo: a start failed: the container stopped after 250 ms, before
> /health answered, after 1 probe; the last threw Error: monitor()
> rejected: Container exited with unexpected exit code: 1

Not a start Cloudflare had no instance for: the container started and
exited 1 at once. The image's `start.sh`, under `set -eu`, starts
PostgreSQL first. `build.sh` had made PostgreSQL's socket directory,
`/run/postgresql`, while the image was built, and under Docker `/run` is
the image's, so `pnpm test:live-demo` and every start measured for
[0070](0070-the-live-demo-runs-the-real-server-and-postgresql-in-a-cloudflare-container-of-each-visitors-own.md)
found it. Cloudflare runs a container in a VM whose `/run` starts empty;
run so under Docker, with `--tmpfs /run`, the image exits 1 the same way,
PostgreSQL refusing to start without the directory. The official
`postgres` image makes the directory in its entrypoint at every start for
this reason; this image's `start.sh` does not use that entrypoint.

## Decision

**`start.sh` makes `/run/postgresql`, owned by `postgres`, before it
starts PostgreSQL**, on every start, whatever the image left there.

**The gate runs every container with `--tmpfs /run`**, so that a start
that relies on `/run` as the image left it fails in CI as it does on
Cloudflare.

## Consequences

**What it buys.** The demo's container starts on Cloudflare as it starts
under the gate, so far as `/run` goes.

**What it costs.** Nothing a visitor or an operator meets: the directory
is made in microseconds by the script that already runs as root. The
gate is closer to Cloudflare in one more respect and still not the same:
what else Cloudflare's VM starts differently from Docker is learned by a
start on Cloudflare, as this was.

## Alternatives considered

- **The official `postgres` image's entrypoint**, which makes the
  directory itself. It would start PostgreSQL its own way, with its own
  initialisation, around a database the build already made and filled.
- **A socket directory outside `/run`**, say under `PGDATA`. Every client
  in the image -- `pg_ctl`, `psql`, the server's connection -- would have
  to be told it; making the default directory is one line.
