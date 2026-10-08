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
| [0004](0004-a-snapshot-says-what-it-could-not-see.md) | A metadata snapshot says what it could not see, and is made in one place | accepted |
| [0005](0005-one-fixture-written-twice.md) | One business model, written twice, and one comparator both adapters answer to | accepted |
| [0006](0006-postgres-discovery-reads-pg-catalog.md) | PostgreSQL discovery reads pg_catalog, and says what the account may not use | accepted |
| [0007](0007-sqlserver-discovery-and-what-it-hides.md) | SQL Server discovery reads the catalog views, and names each thing they hide | accepted |
| [0008](0008-exact-values-travel-as-strings.md) | Exact values travel as strings, are canonical, and are never rounded | accepted |
| [0009](0009-generation-is-deterministic-and-says-what-it-chose.md) | A form is generated deterministically, and says what it chose and what it refused | accepted |
| [0011](0011-every-operation-carries-a-trusted-policy-context.md) | Every operation carries a trusted policy context | accepted |
| [0012](0012-a-lookup-token-is-a-reference-not-a-permission.md) | A lookup token is a reference, not a permission | accepted |
| [0013](0013-published-configuration-is-files-with-link-based-swap.md) | Published configuration is files, and compare-and-swap is a hard link | accepted |
| [0014](0014-host-identity-is-verified-offline.md) | Host identity is a token verified offline, with a pinned algorithm | accepted |
| [0015](0015-a-record-operation-is-one-guarded-statement.md) | A record operation is one guarded statement, canonical in and out, never retried | accepted |
