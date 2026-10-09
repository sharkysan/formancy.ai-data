# Architecture decision records

Every decision here was actually made, in the order the numbers suggest, while
building Formancy Data. Where a decision was reversed or narrowed later, the
record says so and points at the one that superseded it. Where a decision rests
on one made in formancy.ai, the record cites it as `formancy.ai NNNN` with a
link, and does not restate it.

## Why these exist

Two audiences:

1. **Contributors**, who need to know why the obvious simpler thing was not
   done, so they do not helpfully undo it.
2. **Customers and evaluators**, deciding whether to build on this module, who
   want the reasoning and not just the result — especially about the licence
   and about what the module refuses to do with their database.

## Format

[MADR](https://adr.github.io/madr/)-shaped, trimmed to what is load-bearing:

```markdown
# NNNN — Title in the imperative

- **Status:** accepted | superseded by NNNN | reversed
- **Date:** YYYY-MM-DD
- **Deciders:** who
- **Verified by:** the tests, gates or files that hold this decision in place

## Context

The forces. What was true when the decision was made.

## Decision

What was decided, in one or two sentences.

## Consequences

What this buys, what it costs, and what it forecloses. The cost paragraph is
not optional: a record with no downside is marketing, not a decision.

## Alternatives considered

Each with the reason it lost.
```

**Verified by** is the field that distinguishes a decision record from an
opinion. If a decision is load-bearing, something in the repository fails when
it is violated — a test, a CI gate, a script the workflow runs. A record whose
only enforcement is "we remember" says so plainly.

## Index

| # | Decision | Status |
|---|---|---|
| [0001](0001-a-paid-module-in-its-own-repository.md) | A paid module lives in its own repository, under its own licence | accepted |
| [0002](0002-depend-on-upstream-never-copy-it.md) | Depend on released upstream packages at exact versions; never copy them | accepted |
| [0003](0003-real-databases-in-every-test-run.md) | Database behaviour is proved against real servers, on both engines, in every run | accepted |
| [0004](0004-a-snapshot-says-what-it-could-not-see.md) | A metadata snapshot says what it could not see, and is made in one place | accepted; narrowed by 0027 |
| [0005](0005-one-fixture-written-twice.md) | One business model, written twice, and one comparator both adapters answer to | accepted; extended by 0026, 0027 |
| [0006](0006-postgres-discovery-reads-pg-catalog.md) | PostgreSQL discovery reads pg_catalog, and says what the account may not use | accepted; narrowed by 0027 |
| [0007](0007-sqlserver-discovery-and-what-it-hides.md) | SQL Server discovery reads the catalog views, and names each thing they hide | accepted; narrowed by 0026, 0027 |
| [0008](0008-exact-values-travel-as-strings.md) | Exact values travel as strings, are canonical, and are never rounded | accepted; narrowed by 0026, 0028 |
| [0009](0009-generation-is-deterministic-and-says-what-it-chose.md) | A form is generated deterministically, and says what it chose and what it refused | accepted; narrowed by 0026, 0027 |
| [0010](0010-drift-is-classified-against-the-bindings.md) | Drift is classified against the bindings | accepted; narrowed by 0026, 0027, 0028; extended by 0030 |
| [0011](0011-every-operation-carries-a-trusted-policy-context.md) | Every operation carries a trusted policy context | accepted |
| [0012](0012-a-lookup-token-is-a-reference-not-a-permission.md) | A lookup token is a reference, not a permission | accepted; narrowed by 0028 |
| [0013](0013-published-configuration-is-files-with-link-based-swap.md) | Published configuration is files, and compare-and-swap is a hard link | accepted; extended by 0030 |
| [0014](0014-host-identity-is-verified-offline.md) | Host identity is a token verified offline, with a pinned algorithm | accepted |
| [0015](0015-a-record-operation-is-one-guarded-statement.md) | A record operation is one guarded statement, canonical in and out, never retried | accepted; extended by 0031 |
| [0016](0016-postgres-operations.md) | PostgreSQL operations: canonical text in and out, every name from pg_catalog | accepted; narrowed by 0028; extended by 0031 |
| [0017](0017-sqlserver-operations.md) | SQL Server operations: one guarded batch, and a write reported done only when the table holds it | accepted; narrowed by 0026, 0028, 0031; extended by 0027, 0031 |
| [0018](0018-one-planner-turns-answers-into-requests.md) | One planner turns answers into requests, and leaves membership to the database | accepted; narrowed by 0028 |
| [0019](0019-a-published-form-is-checked-every-time-it-is-read.md) | A published form is one bundle, checked every time it is read; a form reaches only allowlisted databases | accepted; extended by 0030 |
| [0020](0020-administration-is-a-separate-plane.md) | Administration is a separate plane, held by a role in the host's token | accepted; extended by 0033 |
| [0021](0021-generated-forms-preview-in-both-frameworks.md) | Generated forms are previewed in both frameworks, generated in the browser from a captured snapshot | accepted; narrowed by 0029 |
| [0022](0022-the-runtime-plane-asks-the-policy-every-time.md) | The runtime plane asks the policy on every request, and removes only the echo it can prove | accepted; narrowed by 0031 |
| [0023](0023-the-audit-trail-is-operational-not-evidence.md) | The audit trail is operational, never holds a value, and is not evidence | accepted; extended by 0031, 0033 |
| [0024](0024-the-studio-speaks-only-the-admin-plane.md) | The studio speaks only the administrator plane, holds the token in memory, and edits presentation with its own controls | accepted; narrowed by 0030; extended by 0032 |
| [0025](0025-each-adapter-owns-its-driver.md) | Each adapter package owns its driver, and one suite runs the whole product on both engines | accepted |
| [0026](0026-name-every-column-fact-the-engines-disagree-on.md) | Name every column fact the two engines disagree on, and check values in the column's own unit | accepted |
| [0027](0027-a-snapshot-says-what-its-account-may-do.md) | A snapshot says what its account may do, and whose it is | accepted |
| [0028](0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md) | Row filters, labels and refusals mean the same on both engines | accepted |
| [0029](0029-a-host-renders-a-published-form-through-one-client.md) | A host renders a published form through one client of the runtime plane | accepted; narrowed by 0031; extended by 0032 |
| [0030](0030-presentation-is-a-patch-over-the-generated-base.md) | Presentation is a patch over the generated base, kept beside it, and carried to the next base by what each field stands for | accepted; narrowed by 0033 |
| [0031](0031-an-answer-lost-after-a-write-is-unknown.md) | An answer lost after a write is unknown, carried to the host as such, and never replayed by anything here | accepted |
| [0032](0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md) | A clean install is the composed stack behind one proxy, and CI runs its guide | accepted |
| [0033](0033-the-administrator-plane-is-audited.md) | The administrator's plane is audited like the runtime, one event per request | accepted |
