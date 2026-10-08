# 0011 — Every operation carries a trusted policy context

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/policy/evaluate.test.ts` — a
  missing or empty tenant attribute is refused by `rowFilter`,
  `lookupRowFilter`, `forcedValues` and `authorizeOperation` rather than giving
  an empty filter; forged context shapes, among them a role list that is one
  string and a tenant that is a number or a list, are refused by every
  function; an actor with no roles may do nothing, see nothing and search
  nothing; an actor whose roles hold field grants and no operation grant is
  refused by `readableFields`, `rowFilter`, `lookupRowFilter`, `forcedValues`
  and `checkSubmittedFields`, and each authorises the operation it serves
  rather than any; a field with no entry is readable by nobody; the tenant
  column is refused as over-posting on create and on update, and by its column
  name on a form that has no field for it; a lookup the policy does not name
  offers nothing; `lookupRowFilter` refuses a lookup over the tenant column
  whose target is not pinned, as the write check does; a field or attribute
  called `constructor` is not found on
  `Object.prototype`. `packages/data-core/src/policy/validate.test.ts` — a
  policy that lists a field the bindings do not have is refused, as are a write
  grant on a field the form never writes or on a pinned column, an operation
  the form does not offer, a lookup over the tenant column whose target is not
  pinned to the same tenant, and a property this release does not read. Watched
  failing against a first, naive implementation: a missing tenant gave
  `filter: []`, a role list given as the string `'superclerk'` authorised a
  clerk, an unknown lookup gave `[]`, an inherited `constructor` was used as an
  attribute value; and, found in review, an actor with field grants and no
  read grant was given a filter and a column list, and a customer lookup whose
  target was not pinned offered every tenant's customers. Watched failing
  against the finished code too, on the three guards the naive version could
  not show: with a field that has no entry made readable, with roles matched
  by case and prefix, and with an unknown field accepted by `validatePolicy`,
  each of its tests fails. That the host builds
  the context from a verified identity is
  **not mechanically enforced** and cannot be from a pure function; that every
  record operation calls these is not enforced yet either, because no record
  operation exists.

## Context

The plan's database-neutral contract says every operation receives a trusted
policy context, and that an adapter cannot bypass authorisation because the
database login has broad permissions (plan section 6). That login is one
account for every person who fills in a form: the database cannot tell two
tenants apart, so nothing below this module will.

Section 11 lists what every read, lookup and write does, in order: verify the
host's identity, resolve the trusted tenant and policy context, apply
operation, field and row permissions, recheck foreign-key membership under the
same actor's policy. It adds that hidden and disabled controls are
presentation, not authorisation. Section 5 notes that formancy's existing
server roles are not evidence of row- or column-level database authorisation,
and that its generic API lets a membership check be omitted. The backlog item
(DATA-09) is done when a forged tenant context and over-posted fields are
rejected.

The realistic leaks are mundane. A host forgets to set the tenant and a filter
built from a missing value comes out empty, which is every tenant's rows. A
request body carries `tenant_id`, and an insert that names every submitted
column writes it. A lookup offers customers from every tenant, and a selected
customer of another tenant is written into this tenant's order. A context
assembled from a decoded token has `roles: "superclerk"`, and
`"superclerk".includes("clerk")` is true. Upstream's
[formancy.ai 0022](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0022-fail-open-fail-closed.md)
is the rule for each of them: closed.

## Decision

A **`PolicyContext`** — an actor with an id and roles, and string attributes
such as `tenant` — is built by the host from an identity it verified, and never
from request input. A **`FormPolicy`**, kept apart from the form and its
bindings, says which roles may read, create and update, which may read and
write each field, which root columns must equal which attribute, and the same
for each lookup's target table.

- **Deny by default.** A field with no entry is readable and writable by
  nobody. A lookup with no entry offers nothing. Roles match as exact strings,
  and there is no wildcard.
- **A row filter is an equality** between a column from approved metadata and
  an attribute of the context. A missing or empty attribute is a refusal,
  never a shorter filter. `rowFilters: []` is a statement that the table is
  not per tenant, and a policy without the property is refused.
- **A pinned column comes from the context.** `forcedValues` writes it on
  create; a submitted value for it is over-posting on create and on update.
  A lookup that sets a pinned column is accepted only when the policy pins the
  paired target column to the same attribute, so the membership check on save
  — the lookup contract's, against `lookupRowFilter` — can find only this
  tenant's rows.
- **Every function reads both inputs at runtime**, copying them into Sets and
  Maps before deciding, and answers `{ ok: true, … }` or a refusal with a
  stable code. `authorizeOperation` refuses an operation it cannot scope, and
  it is not the only gate: `readableFields`, `rowFilter`, `lookupRowFilter`
  and `forcedValues` authorise and scope the operation they serve before
  returning anything, as `checkSubmittedFields` does before looking at a key,
  because a field grant is not an operation grant and a caller can skip a
  gate. A lookup is searchable only by an actor who may read or write its
  field, under a policy fitted to the form, so its options are never listed
  under a policy its save would refuse.
- **Nothing reads the form document.** Decisions come from the policy and the
  bindings alone.
- **`validatePolicy(policy, bindings)` refuses a policy that does not fit its
  form**, listing every problem: a field the form does not have, a grant
  nothing can honour, a filter on a column the form is not bound to, a
  property this release does not read.

## Consequences

**What it buys.** The leaks above are refused in one place, in pure code that
runs in every test without a database, and the adapters will receive a
`RowFilter` — identifiers they quote and values they bind — never a predicate.
A regeneration that adds a column cannot expose it, because a field nobody
granted is a field nobody sees. A policy that drifted from its form is refused
at publication with the list of what drifted, rather than applied with grants
that now mean something else.

**What it costs.** Equality is all a row filter can say. "A manager sees their
team's orders" is not expressible, nor is an actor in two tenants at once: an
attribute is one string, and the host chooses one tenant per request. A policy
names every field explicitly, so a field a regeneration adds is invisible
until somebody grants it, and a regeneration that renames a field makes the
policy invalid until it is edited — friction on purpose, and friction all the
same. The bindings do not describe a lookup's target table beyond its key and
display columns, so a lookup filter on a column the target lacks is caught by
the adapter when it builds the query, not at publication. Attribute values are
strings: whether `'42'` and an integer tenant column agree is the codec's
decision, and the policy cannot tell. And nothing calls these functions yet.
Until the lookup contract (DATA-07) and the record operations (DATA-10) call
them on every request, "every operation carries a trusted context" is a
contract with no caller, and the context's trustworthiness is always the
host's: a host that builds it from a request body defeats all of it, and no
test here can notice.

**What it forecloses.** A row filter written as SQL or as an expression in the
policy, a tenant taken from the request, a wildcard role, and an empty filter
by omission.

## Alternatives considered

**The database's own row-level security** — PostgreSQL policies, SQL Server
security policies. Rejected as the mechanism, though not as a complement: it
means creating objects in a customer's database, which this module does not
do; the two engines express it differently; and it needs the tenant set as
session state on every pooled connection, where a connection returned to the
pool with the previous request's tenant still set is a leak of its own.

**Accept the tenant column from the request when it equals the context.**
Rejected: it teaches clients to send a value they never need to, and the
comparison is between a string and whatever a codec made of the column —
`'042'` against `42` — which is a second implementation of equality that has to
be right. Refusing is one branch.

**Allow by default, with deny lists.** Rejected: every regeneration that adds a
column would add a readable, writable field before anybody had looked at it.

**Row filters as CEL predicates**, since formancy already speaks CEL. Rejected:
a predicate over rows is either compiled to SQL, which is SQL built from a
string somebody wrote, or evaluated after fetching rows, which fetches other
tenants' rows first.

**Throw on refusal.** Rejected: an actor without a role is a normal outcome,
not an error, and the plan's API returns stable machine-readable codes. A
result type also cannot be used as a filter until the caller has checked
`ok`, where a thrown error can be caught by a handler that carries on.
