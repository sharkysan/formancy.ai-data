# 0023 — The audit trail is operational, never holds a value, and is not evidence

- **Status:** accepted; extended by [0031](0031-an-answer-lost-after-a-write-is-unknown.md): an unknown create is named by the record it would have made, and a write answered from an earlier sending is `repeated`; extended by [0033](0033-the-administrator-plane-is-audited.md): the administrator's plane is audited too, every event names its plane, and a path that is not a form id is recorded as no form
- **Date:** 2026-10-09
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-server/src/routes/runtime.test.ts`, "the
  operational audit trail" — one event per request with actor, operation, form,
  published version, status and outcome, and none of the submitted answers or
  the record token (watched failing with the raw token recorded); refusals by
  the code their response carried, and an unauthenticated request with no
  actor; a record named only by a keyed hash, and not at all without a key; a
  sink that throws does not fail the request. `src/audit.test.ts` — the default
  sink writes one structured line per event.

## Context

Plan section 12 asks for operational audit events — actor, form and binding
version, operation, time, result, redacted record reference — and for complete
business records never to be copied into logs. It also says the honest part: a
separate audit sink and the customer's database are not one transaction, and
the first release must not be marketed as tamper-proof or regulated-system
compliant.

A record token spells its key: `k1:1,7` is tenant 1, customer 7. Hashing it
does not hide it, because a key is usually small enough to try every value.

## Decision

The runtime plane emits one `AuditEvent` per request, from an `onResponse`
hook, so every ending — success, refusal, a database out of reach — is recorded
without each branch remembering to. An event carries the actor, the operation,
the form, the published version it was served from, the HTTP status and the
stable outcome code. **Never a value**: no answers, no fields, no record.

A record is named by HMAC-SHA-256 of its token under an audit key the operator
supplies, truncated to 32 hex characters. Without a key, the record is `null`:
nothing rather than a reference that only looks redacted.

Where events go is a port, `AuditSink`. The default writes a structured log
line. A sink that throws is logged and does not fail the request: by then the
write it describes has committed or not, and refusing to answer would hide which.

## Consequences

**What it buys.** An operator can answer who did what to which form version,
when, and how it ended, and correlate repeated operations on one record when a
key is configured — without the trail becoming a second, unpermissioned copy of
the customer's data.

**What it costs.** It is not evidence. The event is written after the database
commits, by a different system, so a crash between the two loses the event, and
nothing stops a privileged operator editing the log. Customers needing atomic,
tamper-evident audit need a transactional outbox in their own database or their
own service (plan section 12), and this record says so in as many words. Without
an audit key, two events about one record cannot be told to be about the same
record.

**What it forecloses.** Logging submitted values for debugging. A deployment
that wants them writes its own sink, knowingly.

## Alternatives considered

**A plain SHA-256 of the record token.** Rejected: reversible by trying keys.

**Fail the request when the sink fails.** Rejected: the write has already
happened or not; the person would be told something failed that did not.

**Write the event in the customer's database transaction.** The right answer for
evidence, and out of scope for the first release, which cannot write tables the
customer did not approve.
