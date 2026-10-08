# 0020 — Administration is a separate plane, held by a role in the host's token

- **Status:** accepted
- **Date:** 2026-10-09
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-server/src/routes/admin.test.ts` — no token
  is 401 and a clerk the host vouches for is 403 (watched failing with the role
  check disabled); test and discovery reach allowlisted connections only, and a
  database that is down, or opens and then fails, is 503 without the driver's
  message; a proposal is `generateForm` over a fresh discovery; publication is
  compare-and-swap, a stale base is 409 naming the current version; a bundle
  that does not validate, belongs to another form or names an unknown
  connection is never written; a version edited on disk is 500 and not served;
  drift reports a dropped bound column as blocking; malformed requests are 400
  before they reach a database; a server without the plane answers 404 for it.

## Context

Plan section 3 separates publishing a form from writing a business record:
"distinct actions with distinct permissions". Plan section 13 lists the
endpoints an administrator needs — test a connection, read its metadata,
propose a form, publish a version, see drift. The host already says who its
people are (0014); what it needs is a way to say which of them administer.

## Decision

The administrator's routes are one Fastify plugin, registered only when the
server is given a connection registry, a configuration store and the roles
that administer. Every route requires a host token holding one of those roles.
A form's own policy (0011) never grants administration, and administration
never touches a record.

A database the server cannot reach, or that fails after opening, answers 503
with a sentence and no detail; the driver's message names hosts, ports and
logins, and goes to the operator's log.

## Consequences

**What it buys.** One identity for both planes, with the line between them
drawn by a role the host controls. A deployment that only serves forms can run
without the plane at all, and then those routes do not exist.

**What it costs.** Administration is only as granular as one list of roles:
everyone who may propose may also publish and see every connection's metadata.
A team that wants a reviewer who can propose and not publish needs a second
role, which is a later change. The 503 tells the caller nothing actionable by
design, so an administrator debugging a connection reads the server log.

**What it forecloses.** Administrators who are not users of the host
application. Formancy's own admin users and sessions (formancy.ai 0031) are a
different system and are not consulted.

## Alternatives considered

**A separate administrator credential** — an API key or a password in the
server's configuration. Rejected: a second identity system to secure and
rotate, when the host already has one and already knows who its administrators
are.

**Grant administration through form policies.** Rejected: a policy is per form
and is itself published by an administrator, so the permission to publish
cannot come from what is being published.
