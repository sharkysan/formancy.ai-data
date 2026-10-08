# 0013 — Published configuration is files, and compare-and-swap is a hard link

- **Status:** accepted
- **Date:** 2026-10-09
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-server/src/config-store.test.ts` — versions
  publish in order and read back unchanged; a publish from a stale base is a
  conflict naming the current version; of twenty concurrent publishes from one
  base exactly one wins and every temporary file is removed; crash leftovers are
  never versions; a hand-edited version is refused; an id that could leave the
  root, or that differs from another only by case, is refused; a root that is a
  file fails loudly on every operation. Watched failing on Windows with
  mixed-case ids allowed.

## Context

Plan section 5 keeps control data — published forms, bindings, policy
references — out of the customer's business tables, and recommends a file store
on a persistent volume for a single-instance pilot, so a SQL Server customer is
not asked to run PostgreSQL just to hold configuration. Two administrators can
publish from the same base at the same moment, and formancy's own rule is that a
published version is immutable (formancy.ai 0025).

## Decision

`ConfigurationStore` is a port with one implementation today,
`createFileConfigurationStore(root)`, and a second planned: a shared store with
compare-and-swap for more than one instance. Layout `<root>/<id>/<n>.json`,
pretty-printed, one file per version.

A publish writes the next version to a temporary file, flushes it, and
hard-links it to its final name. `link` fails atomically if the name exists, so
of two writers that both read version 3 as the newest, exactly one creates
`4.json`. The final name appears only once the bytes are on disk.

Ids are lower case only. On NTFS and APFS `Order` and `order` are one directory,
and one form would silently read the other's bundle; this suite found it on
Windows, where Linux CI never would have.

## Consequences

**What it buys.** No lock, no daemon, no second database. An export is a copy of
the directory, and a review is a `git diff` of one. Concurrency is decided by
the filesystem, which is the one component every deployment already trusts with
its data.

**What it costs.** One instance. `link` is atomic on local filesystems; over NFS
the server is atomic but a client can see the wrong error after a
retransmission, so two instances on a shared NFS volume could both believe they
lost. Finding the newest version reads the directory, which is linear in the
number of versions — fine for hundreds, a reason for the second implementation
long before thousands. Ids lose upper case, so a formancy form id with capitals
needs mapping, and the server does that rather than the store.

**What it forecloses.** Editing a published version in place. A fix is a new
version, as upstream.

## Alternatives considered

**A table in the customer's database.** Rejected by the plan: control data in
business tables, and a schema the customer's DBA did not ask for.

**SQLite.** Rejected for the pilot: a native module in a product whose drivers
were chosen to have none, and a binary file nobody can review in a diff.

**A lock file around read-then-write.** Rejected: a crashed writer leaves the
lock behind, and stale-lock detection is a timing heuristic. The hard link has
no state to go stale.
