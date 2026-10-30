# 0111 — A deploy pipeline checks drift with a command the image ships, which fails on a blocking change and never passes a form it could not check

- **Status:** accepted; extends [0010](0010-drift-is-classified-against-the-bindings.md): drift review is also a command a pipeline runs after its migrations, over the same route
- **Date:** 2026-10-30
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-server/src/drift-check.test.ts`, against the real
  server's administrator plane over a catalog the test changes -- a form
  the database still matches exits 0 and says so; a column the form is
  bound to dropped exits 1 and prints the blocking change, its subject
  and the server's sentence, never the token (watched failing with the
  status taken from whether the requests answered alone: 0); a review
  change, the connection's login rotated, exits 0, and 1 with
  `--fail-on review` (watched failing with `--fail-on` read and ignored);
  an unknown form, a refused token, a server that is not there and a 200
  that is not a report each exit 2, the other forms still checked and
  printed (watched failing with an unchecked form left out of the
  status: 0); a missing token, a server that is not an http or https URL,
  no form, a form id the server could not hold, and an unknown severity
  each exit 2 with the usage and ask nothing. The `image` job of
  `.github/workflows/gates.yml` runs `node dist/drift-check-cli.mjs` in
  the built image: 2 with its usage without a token, 2 against a server
  that is not there.

## Context

Drift review (0010) compares what a published form was generated from
with the database as the server's connection finds it now, and says what
each change means for the form: `blocking` when the form must not be used
as published, `review` when a person should look, `info` otherwise. It is
`POST /v1/forms/:id/drift` on the administrator's plane, and the studio's
Drift step (0024).

A deployment changes its schema in a pipeline: migrations run against a
staging database, then the application ships. A migration that drops a
column a published form is bound to is found today when somebody opens
the studio, or when the runtime refuses the form's requests as drift
(0041) -- after the deploy. The backlog asked for a drift check a deploy
pipeline can run against migrated staging, failing on `blocking`.

## Decision

**The image ships `dist/drift-check-cli.mjs`** (`drift-check.ts`), beside
`main.mjs` as the key set tool is (0059):

    drift-check-cli.mjs [--fail-on blocking|review] <server URL> <form id>...

with the administrator's token in `FORMANCY_DATA_ADMIN_TOKEN`, never an
argument, which a process list and a CI log would show. For each form it
asks the server the drift route and prints one line a form -- its
version, its count of changes and of those failing the check -- and one
line a change, its severity, kind, subject and the server's sentence, in
the server's order. It reads no database and no configuration of its own:
the server's connection, policy and bindings decide every change, as they
do for the studio.

**Its exit status is the pipeline's answer.** 0 when no form has a change
it fails on -- `blocking`, or with `--fail-on review` `review` too; 1 when
one has; 2 when a form could not be checked -- unreachable, refused,
unknown, or a 200 that is not a report -- and when it was given what it
cannot run with. A form that could not be checked is never taken for one
without drift: the others are still asked and printed, and the run is 2.

**The forms are named.** The administrator's plane lists no published
forms, and a pipeline knows the forms its deploy depends on; asking for
every form would fail a deploy on a form it does not ship.

## Consequences

**What it buys.** A migration that breaks a published form fails the
deploy that carries it, before the runtime refuses the form, with the
same classification the studio shows.

**What it costs.**
- The pipeline needs the server running against the migrated database,
  with its administrator's plane on, an administrator token, and the
  forms' ids.
- It checks the published version of each form; a draft under review is
  not checked.
- A change the server classifies `info` never fails it, and `review` only
  when asked.
- It is a command in the image, not an npm binary: a pipeline runs the
  image, or `node dist/drift-check-cli.mjs` from an installed
  `@formancy/data-server`.
- Its output is lines for a log, not a format for a machine; the route's
  JSON is the machine's.

**What it forecloses.** Nothing the route offers.

## Alternatives considered

**A check that lists and checks every published form.** It needs a
listing route on the administrator's plane, and fails a deploy on forms
it does not depend on.

**The token as an argument.** Every process list and many CI logs would
show it.

**Exit 1 for a form it could not check.** A pipeline could not tell a
broken form from an unreachable server, and a script that tolerated 1
for a known drift would pass an outage.

**A check against the database alone, without the server.** It would
need the connection's credentials and the published bundles in the
pipeline, and a second implementation of the comparison the server
already makes.

## Older records

Extended, not edited away: 0010 (drift review is also a pipeline's
command, over the same route and classification).
