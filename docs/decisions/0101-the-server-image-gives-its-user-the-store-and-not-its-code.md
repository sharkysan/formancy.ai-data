# 0101 — The server image gives its user the store, and not its code

- **Status:** accepted; extends [0032](0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md): the image's code is root's, and the server starts on a read-only root
- **Date:** 2026-10-22
- **Deciders:** Daniel Bacher
- **Verified by:** `.github/workflows/gates.yml`'s `container` job, on every
  pull request: configured, the running server's user, `node`, owns nothing
  under `/app` and finds nothing there anybody may write -- a link passed
  over, since its own mode means nothing -- and its write to
  `/app/dist/main.mjs` is refused (watched failing on 2026-10-22 against the
  image built from `d37dae9`: `/app/pnpm-workspace.yaml`, `/app/LICENSE.md`
  and `/app/README.md` were `node`'s, and the write went through); and *On
  a read-only root, it starts and serves health*, with the store's directory
  a volume, answering `/v1/whoami` 401. `scripts/live-demo-gate.mjs`'s
  check *the server cannot write its own code*, the same question asked of
  the live demo's image, `deploy/demo/Dockerfile`, while a visitor's
  container runs. **Not mechanically enforced:** what an operator mounts;
  the composed stack does not run the server read-only, and nothing here
  asks it to.

## Context

The server image runs as `node`, unprivileged, and writes one place: the
configuration store's directory, `/var/lib/formancy-data`, which the
Dockerfile makes and gives to `node` so that a named volume mounted on it is
writable ([0032](0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)).
Its code, though, was copied into `/app` with `COPY --chown=node:node`, so
the same user owned every file the server runs: a flaw that let a request
write a file -- through a path the store resolves, say -- could replace
`dist/main.mjs` or a dependency, and the next start would run it. The live
demo's image, which serves visitors on the internet, copied its `/app` the
same way. Found by the formancy.ai-report repository's review of its own
server, whose image copies its app as root and whose gate asks the running
server whether it can write its own code.

Measured on 2026-10-22 in the image built from `d37dae9`: the server's user
owned `/app`'s files and wrote `/app/dist/main.mjs`; the same image started
and served `/health` with `docker run --read-only`, so the server writes
nothing outside its store.

## Decision

- **Both images copy the server's tree as root's**: `COPY --from=build /app
  /app`, every file readable by everybody and writable by root alone. The
  store's directory stays `node`'s.
- **The `container` job asks the running server** whether its user owns or
  may write anything under `/app`, and whether a write to its entry point
  goes through; and **it runs the image on a read-only root**, with the
  store a volume, and has it serve.
- **The live demo's gate asks its image the same**, as the server's user,
  in a visitor's running container.

## Alternatives

- **Keep `--chown` and rely on the server writing only the store.** That is
  true of the code today; ownership makes it true of whatever a flaw
  reaches.
- **Run the composed stack's server read-only too.** Worth doing for an
  operator who copies the stack, but it changes what `docker compose`
  runs, which the getting-started gate holds; a record of its own if it is
  wanted.

## Consequences

**What it buys.** The server cannot change the code it runs, in the
released image and in the live demo, and an operator may mount its root
read-only and give it only the store's volume.

**What it costs.** `pnpm deploy` leaves three files root may read and
nobody else: `/app/pnpm-workspace.yaml`, `/app/pnpm-lock.yaml` and
`/app/node_modules/.pnpm-workspace-state-v1.json`, pnpm's own records,
which the server does not read; they were `node`'s before. An operator who
wrote into `/app` from inside a running container, which nothing here
documents, now cannot.
