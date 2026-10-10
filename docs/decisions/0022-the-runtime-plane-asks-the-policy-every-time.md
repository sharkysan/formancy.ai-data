# 0022 — The runtime plane asks the policy on every request, and removes only the echo it can prove

- **Status:** accepted; narrowed by [0031](0031-an-answer-lost-after-a-write-is-unknown.md): a lost write's 502 names the record and version it addressed, a read never answers one, and a write that arrives again with its write id is answered with the first sending's answer; narrowed by [0040](0040-instants-and-times-are-read-to-the-shape-and-an-unedited-one-is-never-written.md): the planner removes an unedited instant or time the actor may write too, when it equals the record as read at the version the update names, and an update carrying one is refused with the read's own answer when that read failed
- **Date:** 2026-10-09
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-server/src/routes/runtime.test.ts` — no token
  is 401 and an actor the policy grants nothing is 403; a read returns the
  answers the generated form holds, integers as numbers; a create removes the
  empty echo of fields the actor may not write, takes the tenant from the token
  and checks a lookup selection against the database before writing; a
  submitted tenant is over-posting and nothing is written; a rejected selection
  is a field error and a lookup that cannot answer refuses the save; codec
  errors and database refusals reach the person by field, never repeating a
  value; an ambiguous write is 502 saying it may have been saved; an update
  removes an unchanged echo and refuses a changed one; a stale version is 409;
  lookups are searched and resolved under the policy for the operation the form
  is open for. Watched failing with every echo removed regardless of value.

## Context

formancy's renderers submit every field, disabled ones included. The policy
(0011) calls a submitted field the actor may not write over-posting, and the
planner (0018) refuses it. So a form saved exactly as a renderer submits it
would be refused every time — the tenant, a creation timestamp, a key — unless
something removes the echo. Removing it blindly would turn over-posting into
something silently ignored, which is the failure the policy exists to stop.

## Decision

Every runtime route verifies the host token, loads the published bundle
re-validated (0019), and asks the policy and the planner what this actor may do
— on every request; nothing is cached per actor.

**Only a provable echo is removed.** For each submitted field, the policy is
asked whether this actor may write it (`checkSubmittedFields`, one key at a
time, so the rule is the policy's and not restated). If not: on create, the
field is removed when it is empty; on update, when it equals what the record
holds now, read first. Any other value reaches the planner and is refused.

**A selection is checked against the database before any write**, and a lookup
that cannot answer refuses the save — closed, as formancy's own membership
port is (formancy.ai 0077).

**Database refusals are translated**, by field where the engine names a column
the form binds, with the server's own words: SQL Server's messages repeat what
the person typed (0017), and none of that reaches the response. An ambiguous
write is 502 and says it may have been saved; nothing retries it.

**Lookups take the operation the form is open for**, because the policy's row
filter for a lookup depends on it (0011).

## Consequences

**What it buys.** A form saves exactly as formancy's renderers submit it, and a
changed read-only value — tampering, or a client that read an old version — is
refused rather than ignored.

**What it costs.** Every update reads the record first, one extra query, to
tell an echo from a change; an actor who may update and not read gets no echo
removed and must send only writable fields. The policy is evaluated per
submitted key to decide echoes, which is linear in the form's size per request.
A lookup query must say which operation the form is open for, which a client
has to know.

**What it forecloses.** Silently dropping fields a person was not allowed to
change.

## Alternatives considered

**Ask the renderers to omit disabled fields.** Rejected: formancy's renderers
are not this project's to change, and a host's own client might not use them.

**Strip every field the actor may not write.** Rejected: a changed value there
would be ignored silently. The mutation that does exactly this fails the tests.

**Cache the policy decision per actor.** Rejected for now: a role revoked at the
host would keep working until the cache expired.
