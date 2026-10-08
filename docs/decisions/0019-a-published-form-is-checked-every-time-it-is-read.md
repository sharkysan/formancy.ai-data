# 0019 — A published form is one bundle, checked every time it is read; a form reaches only allowlisted databases

- **Status:** accepted
- **Date:** 2026-10-09
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-server/src/bundle.test.ts` — a generated
  bundle validates; a snapshot edited after it was taken is refused because it
  no longer hashes to its fingerprint (watched failing with the check
  disabled); bindings from another snapshot, a policy that does not fit, a
  form formancy rejects, a binding to a field the form lacks, and impossible
  shapes are each refused with a reason. `packages/data-server/src/connections.test.ts`
  — an allowlist with secret references parses; every mistake is reported at
  once and a password where its reference belongs is never repeated; only
  allowlisted ids open, once, with the resolved password; a failed open is
  retried on the next call; a kind with no driver and an unresolvable secret
  both fail loudly; shutdown closes each open connection once.
  `src/dockerfile.test.ts` failed when `data-core` became a dependency and the
  Dockerfile did not copy it, which is the guard working.

## Context

The configuration store keeps published versions as files on a volume (0013),
so a version can be edited by hand between publish and the next request. The
request planner trusts the snapshot it reads column types from; a widened
`varchar` in an edited file would let through values the database refuses, and
a narrowed one would refuse values it accepts. Separately, a form names the
connection it is bound to, and plan section 11 requires allowlisted connections:
a form must not be able to name a database the operator did not list.

## Decision

A **published bundle** carries the form, its bindings, its policy and the
snapshot the bindings were generated from, plus the connection's name.
`validateBundle` checks it on publish **and on every read from the store**: the
form against formancy's own validator, the snapshot by recomputing its
fingerprint, the bindings against the snapshot and the form, and the policy
against the bindings.

**Connections are an allowlist** the operator writes: id, kind, host, port,
database, user, a secret reference for the password, and the approved schemas.
`createConnectionRegistry` is the only place a connection's name becomes a
database. It opens a connection on first use through a factory the composition
root supplies, so nothing in the server's core imports a driver. A failed open
is retried on the next call, not cached as broken.

## Consequences

**What it buys.** A hand edit to a published file is refused with a reason at
the next request, rather than becoming a planner that trusts a lie. A form
document cannot reach a database by naming it. A database that restarts does not
need the server restarted too.

**What it costs.** Recomputing a fingerprint on every read hashes the whole
snapshot each time — cheap for a form's tables, worth caching once a request
profile says so. Storing the whole snapshot in every version makes versions
larger than they strictly need to be. The registry holds one pool per
connection for the server's lifetime; a deployment with many rarely used
connections pays for idle pools.

**What it forecloses.** Connections created at runtime through the API. Adding
a database is a change to a reviewed file and a restart.

## Alternatives considered

**Trust the store.** Rejected: the store is files somebody can open, and
0013 already decided a hand-edited version is refused rather than served.

**Sign bundles instead of re-validating them.** Possible later; it proves who
wrote a bundle, not that it is consistent, and the consistency checks are the
ones the planner depends on.

**Connection strings in the form or the bundle.** Rejected for the reason
formancy refuses addresses in documents (formancy.ai 0077): a deployment detail
frozen into a portable artefact, and a way to make a server reach somewhere it
should not.
