# 0014 — Host identity is a token verified offline, with a pinned algorithm

- **Status:** accepted
- **Date:** 2026-10-09
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-server/src/identity.test.ts` — a valid token
  becomes an actor, roles and mapped attributes; a numeric tenant claim becomes
  its decimal string; a missing claim leaves the attribute absent; a wrong
  signature, issuer, audience, an expired token, one with no expiry, one with no
  subject and an unsigned `alg: none` token are each refused; a secret under 32
  bytes is refused at construction; an HS256 token signed with an ES256 public
  key's text does not verify. `packages/data-server/src/app.test.ts` — a
  missing, bad or malformed token is the same 401. `secrets.test.ts` — no error
  ever repeats a secret reference's value.

## Context

Plan section 11: every read, lookup and write starts by authenticating and
verifying the host identity, then resolves a trusted tenant and policy context.
The people filling in a generated form are the host application's users, not
formancy's: the host already knows who they are and which tenant they belong
to. What it needs is a way to say so that the browser in between cannot forge.

## Decision

The host signs a short-lived JWT; the server verifies it and builds a
`HostIdentity` from exactly the claims the operator mapped — `sub` as the actor,
a roles claim, and named attribute claims such as the tenant. Nothing else in
the request contributes.

- **Two key kinds, each with its algorithm pinned**: a shared secret (HS256, at
  least 32 bytes) or a public key (RS256, ES256 or EdDSA). A token cannot choose
  its algorithm, so `none` and key confusion are refused by construction.
- **Offline.** No JWKS URL. A URL would be an outbound request from inside a
  customer's network on every cold start, an SSRF surface in configuration, and
  a key set that changes under a running server.
- **`sub` and `exp` are required.** A token with no expiry is a credential
  forever.
- **Errors carry jose's code, never the token.** A token in a log is a
  credential in a log.

## Consequences

**What it buys.** The tenant a row filter uses comes from a signature, not from
the browser. A host on any stack can issue the token with a standard library.

**What it costs.** Key rotation is a restart with a new key, not a fetched key
set; a host rotating weekly will feel it. A host with no backend of its own — a
purely static single-page application — cannot hold a signing secret and so
cannot use this module directly. Roles and attributes are only as fine-grained
as the host's token; the server cannot ask anybody anything else.

**What it forecloses.** Sessions and passwords in this module. It verifies
somebody else's identity and never manages one.

## Alternatives considered

**Reuse formancy's own server sessions.** Rejected: those identify formancy
administrators, and the actors here are the host application's users.

**JWKS from a URL.** Rejected above. If a deployment needs it, a host-side
proxy that pins the set is the place, and a later record can revisit it.

**A host callback per request** ("is this user allowed?"). Rejected for the
first release: a network round trip per lookup keystroke, and the availability
of every form tied to an endpoint the module does not control.
