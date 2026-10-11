# 0043 — A child form's rows are reached only through a parent its policy admits

- **Status:** accepted
- **Date:** 2026-10-11
- **Deciders:** Daniel Bacher
- **Verified by:**
  both adapters' `through.integration.test.ts`, against `postgres:17-alpine`
  and `mcr.microsoft.com/mssql/server:2022-latest` loaded with the shared
  fixture, requests planned by `planRead` and `planUpdate` from bindings
  generated over what discovery reports, each case declared with `covers()`
  (shared cases `through: read`, `through: update`, `through: self-reference`,
  `through: composite`, `through: moved-parent`):
  a line of tenant 2's order, inserted by the owner, is not found by tenant
  1's read and tenant 1's own is; tenant 1's update of it is `not-found` with
  its current version and with a wrong one, and the owner reads it unchanged,
  while tenant 1's own line is updated; and `sales.employee`, scoped through
  `fk_employee_manager` by the manager's name, finds Grace under Ada and
  neither Ada, who has no manager, nor Orphan, whose manager does not exist;
  `sales.order`, scoped through its composite `fk_order_customer` by the
  customer's tenant, finds tenant 1's order and not tenant 2's, though both
  name customer 1001 (watched failing on both engines with the pairs
  reversed -- tenant 1's own order not found -- and with the tenant pair
  dropped -- tenant 2's found). Where the engines differ, `moved-parent`:
  another transaction holds a line of tenant 1's and moves its order to
  tenant 2, and tenant 1's update of the line, seen waiting on the server
  before that transaction commits, is written on PostgreSQL under READ
  COMMITTED and under REPEATABLE READ, and is `not-found` on SQL Server with
  READ_COMMITTED_SNAPSHOT off and on; an update of an order under its own
  row filter, its tenant moved the same way, is `not-found` on both (the
  PostgreSQL half watched failing with `for share of "p"` in the EXISTS:
  not found under both isolations). A read or an update whose `through` is
  missing, null or not a list is thrown by both adapters, and nothing is
  written (watched failing on both with each path reading a missing one as
  none: the read was answered, and the update written).
  Watched failing on both engines before the adapters read the request's
  throughs -- tenant 2's line found, its update answered `ok` and committed,
  Ada found -- then with the EXISTS left out of the statement that tells a
  stale update from one aimed at nothing (PostgreSQL answered `refused`, SQL
  Server `stale`), and with the correlation left unqualified (Grace not
  found: a bare `manager_id` bound to the inner row).
  SQL Server's record statements were aliased `[r]` first, with nothing else
  changed: its records, records-failures, records-lost-answer and
  records-definition suites passed unchanged.
  `packages/data-core/src/policy/validate.test.ts` -- a through on a field the
  form lacks, on one that is not a lookup, and over a lookup whose entry is
  `[]` is refused, naming each; one that is not a list, an entry that is not
  a key and a key named twice too (watched failing before `through` was read:
  every policy using it was refused as a property this release does not read).
  `policy/through.test.ts` -- `throughProblems` refuses a text key column on
  the target side and on the root side, naming the field and the column, and
  a lookup that does not configure, with `buildLookupConfig`'s reason
  (watched failing with only the root side checked). `policy/evaluate.test.ts`
  -- `throughFilters` authorises the operation first, refuses a missing or
  empty attribute rather than scoping nothing, and scopes an actor granted
  nothing on the field where a lookup search refuses them (watched failing
  with `[]` for a missing attribute, and with `lookupRowFilter` in its place);
  `authorizeOperation` refuses read, create and update `missing-attribute`
  to a context without a through's attribute, and grants them with it
  (watched failing: read granted).
  `records/plan-read.test.ts` and `plan-update.test.ts` -- a line's read and
  update carry a `Through` typed from the snapshot, under the order lookup's
  filter, and a through the snapshot cannot compare is refused by the planner
  in `throughProblems`' words (watched failing with the through left off the
  read); a through field may not be cleared on update, and `plan-create.test.ts`
  -- it is required on create, omitted or null, even over a nullable column
  (both watched failing before the planner knew the field: planned).
  `records/through.test.ts` -- `throughTerms`, which both adapters read a
  request's throughs through, refuses throughs that are not a list, a filter
  that scopes nothing, a text, empty, unpaired or unnamed key, a target that
  is not a table, and a property it does not read.
  `packages/data-server/src/bundle.test.ts` -- a through over a lookup that
  offers every row, or over a text key, is refused at publish, and with a
  filter over an integer key the form publishes (watched failing, the text
  key published, before `policyProblems` asked `throughProblems`).
  `routes/runtime.test.ts` -- a read, an update and the read the update makes
  first each carry the through to the port (watched failing with that read
  sent without it); a create without the through field, omitted or null,
  is 422 `required` with nothing checked or written, on a memo whose order
  is nullable and outside its key, so that the through is all that
  requires it (watched failing with the planner's rule taken out: the memo
  was planned and sent to the port); and the line form is 403 to a context
  without the through's attribute and offers read, create and update to one
  with it (watched failing: 200).
  `packages/data-core/src/presentation/rebase.test.ts`,
  `packages/data-server/src/reassigned.test.ts` and
  `apps/studio/src/carry.test.ts` -- a key a through names is a grant for
  0039's check, with no role on its field: a lookup re-pointed from a
  line's order to its quote, both onto `sales.order`, is refused until
  confirmed, and the studio asks again about a removed one once a through
  names it (each watched failing with a through counted as nothing).
  `e2e.integration.test.ts`, on both
  engines through the real server and drivers -- tenant 1's clerk creates,
  reads and updates a line of tenant 1's order, and tenant 2's clerk is told
  404 for the read, 404 for the update with the line's current version, and
  422 `not-an-option` for a line created under that order (watched failing
  with the line form published without `through`: tenant 2's read was 200
  on both engines).
  `packages/data-fixtures/src/conformance.test.ts` -- the model holds
  `order_line.row_version` per engine and refuses a snapshot without it
  (watched failing on the old model), and the captured snapshots it holds
  (`apps/studio/src/fixtures.test.ts`, `apps/examples/src/snapshot.test.ts`)
  were watched failing until recaptured.
  `apps/studio/src/choice.test.ts` -- `throughBlocker` offers an integer key
  and says, in `throughProblems`' words, why a text key is not offered;
  `policy.test.tsx` -- the box is offered only once a lookup's list is
  filtered, a note says that nothing scopes the rows until it is ticked, axe
  passes and every control is named in that state, and the ticked box
  publishes `through` (watched failing with the box offered for an
  unfiltered lookup); a through over a lookup the form does not have is
  named and removed, and removing a reassigned lookup's grants takes it out
  of `through` (both watched failing before the step knew of `through`).
  **Not mechanically enforced:** that a child form's lookup filter says the
  same tenant rule as its parent form's row filter; and the cost of the
  EXISTS, which is not measured. SERIALIZABLE is not measured in the
  `moved-parent` race.

## Context

`sales.order_line` has no tenant column; its order has one. A row filter may
name only the form's own bound columns (`validatePolicy`, 0011), so a line
form could be published only with `rowFilters: []`, and then a read by a
guessed `k1:<order id>,<line no>` reached every tenant's lines. An update
would have too on a child with a version column; the fixture's lines had
none, so none was offered. A create was scoped only by the order lookup's
membership check (0018).

Both adapters tell a stale update from one aimed at nothing in a statement of
its own: PostgreSQL's built from the same `located` WHERE as the read, SQL
Server's `existsStatement(table, key, terms)`. A scope that were only in the
update would answer another tenant's line `refused` or `stale`, each saying
the line is there. SQL Server's record statements named their table without
an alias, so a correlated subquery had nothing to name the row by.

PostgreSQL lets a foreign key join two text columns of different collations,
and a direct comparison of the two then cannot resolve one. Probed on
2026-10-11 against `postgres:17-alpine` (17.11): a foreign key from a column
under a nondeterministic ICU collation to one under `"C"` was created, and
the EXISTS this record builds over the pair failed with 42P22, "could not
determine which collation to use for string hashing"; so did a foreign key
between two deterministic collations, `"POSIX"` onto `"C"`. A snapshot
records no collation to name in a COLLATE, on either engine.

## Decision

A policy may name lookup fields in a new optional property, `through`. A root
row exists for a read or an update only when, for each, the row its foreign-key
columns reference is one that lookup's own filter on its target admits
(`lookups[field]`). Still policy `version: 1`: absent means none, so every
policy written before this means what it meant, and a server older than this
refuses a policy that uses it, as it refuses every property it does not read.

- **Shape.** `validatePolicy` refuses a through entry that is not a lookup
  field of the form, is named twice, or whose `lookups` entry is `[]` -- a
  through over every row scopes nothing, and a rule nothing enforces is
  refused (0011).
- **Against the snapshot.** `throughProblems(snapshot, bindings, policy)`
  refuses a lookup that does not configure, and one whose foreign-key columns,
  on either side, are not integer, decimal, uuid or date: a text key is
  refused on both engines until a snapshot records collations. The server's
  publish check, its regeneration report and every read of a published form
  ask it through `policyProblems`, and so does the planner.
- **Evaluation.** `throughFilters` authorises the operation, then resolves
  each lookup's rules as `lookupRowFilter` does: a missing attribute refuses.
  It asks for no grant on the field. A through is a row filter: it decides
  which rows exist and offers no options. `authorizeOperation` resolves the
  throughs too, for every operation -- a read and an update carry them, and
  a create's parent is checked under the same filter -- so a context without
  a through's attribute is offered nothing by `GET /v1/forms/:id` rather
  than operations every request of which is refused.
- **Grants on a reassigned key (0039).** A key a through names is a grant on
  it, with or without a role on its field: `grantsOnKey` counts it, so the
  server refuses a publish that re-points such a key to another foreign key
  until `keysConfirmed` says so, and the studio asks. The same filter through
  another parent decides which rows exist all over again, and can admit rows
  the old scope hid: a line whose order is another tenant's, reached through
  a quote of this one's.
- **Planning.** `planRead` and `planUpdate` put a `Through` on the request --
  the root's foreign-key columns with the snapshot's types, the lookup's target
  and key from its config, and its filter scoped as every filter is (0028) --
  so the read an update makes first carries it too. `planCreate` requires a
  through field, omitted or null, even over a nullable column, and `planUpdate`
  refuses to clear one: a row whose foreign key is NULL references no parent,
  and nobody could reach it again. A create's parent is checked as every
  selection is, by `rejects` under the same filter (0018); a changed parent on
  update too, while the old one is in the update's WHERE.
- **Adapters.** Every statement that locates a record -- the read, the update
  and the one that tells stale from not-found -- carries each through as an
  EXISTS over the target, read through `throughTerms` as filters are read
  through `rowFilterTerms`. The key pair compares with the database's own
  equality, as the foreign key does (`operator(pg_catalog.=)` on PostgreSQL);
  the filter terms compare exactly (0028). Every column is qualified, so a key
  onto the same table compares the parent's key with the record's column. SQL
  Server's record statements alias the table `[r]`, `update [r] set … from
  <table> as [r]`, the insert excepted.
- **The child's fields and filters are its own.** The parent form's policy is
  not consulted: the line form's `lookups.order` restates the order form's
  tenant rule.
- **Fixture (0005).** `sales.order_line` gains `row_version`: an
  application-maintained `bigint not null default 1` on PostgreSQL, a
  `rowversion` on SQL Server, as `sales.order`'s, so a line form offers
  update. The captured snapshots that see `order_line` were recaptured.
- **Studio.** Under each lookup whose list is filtered and whose key
  `throughBlocker` accepts, a box, "Only rows of <root> whose <label> is one
  of these", produces `through`; under a filtered list over a text key, the
  reason in `throughProblems`' words. A note, never a refusal, says when the
  root has no row filter and no through while a lookup's list is filtered. A
  through over a lookup the form no longer has is named with a way to remove
  it, as a stray lookup filter is, and removing a lookup's grants takes its
  through with its filter.

## Consequences

**What it buys.** A line of another tenant's order is `not-found` on read and
on update, whatever version is sent, from the statements that decide it, on
both engines, though `order_line` has no tenant column; and a line can be
created only under an order the person may reference.

**Where the engines differ.** Under concurrency on PostgreSQL a through is
weaker than a row filter. The parent is read from the statement's snapshot
and never again, so an update that waited for its row is written though
another transaction moved the row's parent out of the scope and committed
during the wait, as though the update had come first: measured under READ
COMMITTED and REPEATABLE READ. A row filter on the row itself is checked
again on the row the wait ends with, and is `not-found`. SQL Server answers
`not-found` in the same race, with READ_COMMITTED_SNAPSHOT off and on. The
race needs a transaction that moves a parent between tenants while a child's
update is in flight. A create's parent is checked in a statement of its own
before the insert (0018), on both engines, so a parent moved between the two
is not seen either; that was so before this record.

**What it costs.**
- One EXISTS per through in every read, update and not-found statement. The
  probe is on the referenced key, a primary or unique key and so indexed on
  both engines; the plans and the time are not measured.
- The child's tenant rule restates the parent's, and nothing checks that the
  two agree.
- A row whose through key is NULL is reachable by nobody, so a through field
  is required on create and may not be cleared on update, whatever its column
  allows.
- A through over a lookup that offers every row is refused, and so is one over
  a text key, on both engines, until a snapshot records collations.
- SQL Server's record statements are aliased; anyone reading them in a trace
  sees `[r]`.
- The fixture has a second application-maintained version column on
  PostgreSQL, and every captured snapshot that sees `order_line` changed.
- A server older than this one refuses a policy that uses `through`.
- The studio offers the box under every filtered lookup with a key it
  accepts, the order form's Customer list included, where the root's own row
  filter already scopes the rows.
- What a create pins is a parent the person may reference, not the one on
  their screen: that is the page's prefill.
- On PostgreSQL, an update racing a transaction that moves its row's parent
  out of the scope may be written (above), where SQL Server and a row
  filter answer `not-found`.
- A through is a grant for 0039's check, so a regeneration that re-points a
  through's key asks an administrator even when nobody holds a role on it.

**What it does not do.** One hop: a through names a lookup of the form's own
root, and a grandchild is not scoped by its grandparent. It does not lock the
parent. Lookups are not scoped by it: a child form's other lookups offer what
their own filters admit.
No list of records exists yet; a later record that adds one carries the
throughs from its first statement.

**What it forecloses.** Nothing deeper than one hop is offered; it is not ruled
out.

## Alternatives considered

**Require a tenant column on every child table.** The module would refuse
common schemas.

**Two reads, the parent first.** A window between them, and nothing to put in
an update's WHERE.

**Scope the child by the parent form's policy.** Two bundles and two snapshots
would meet in one security decision, and unpublishing the parent would break
the child.

**Database row-level security.** Rejected by 0011 as the mechanism.

**Join paths of any depth.** Each hop adds statement shape, parity cases and
unmeasured cost; one hop is what a child needs. A cost judgement: 0011 does
not foreclose it.

**Policy version 2 with `through` required.** Every published form would be
republished for a property most do not use.

**The parent named beside the answer in a create.** A second spelling of the
same field.

**Text keys, with each column's collation read at statement time.** COLLATE
takes a name, not an expression.

**The scope in the update only.** The statement that tells stale from
not-found would say another tenant's line is there, by answering `refused` or
`stale` -- which the through suites watched it do.

**Lock the parent on PostgreSQL, `for share of "p"` in the update's EXISTS.**
Measured by running the `moved-parent` case against it: it closes the race,
`not-found` under READ COMMITTED and REPEATABLE READ. Not done: PostgreSQL
refuses a locking clause on a table the account may only read (42501,
"permission denied", probed on 17.11 on 2026-10-11), so a line clerk would
need UPDATE on the orders, and every write of a line would lock its order's
row against the order's own updates.

**Check the parent again after the update, in its transaction.** Under READ
COMMITTED a second statement takes a new snapshot and would see the move.
Not done: it makes a guarded update two statements and a transaction, with
a commit whose answer can be lost (0031), and under REPEATABLE READ the
second statement would read the transaction's snapshot, the first one's,
and see nothing new.

## Older records

Extended, not edited away: 0005 (`order_line.row_version`, written twice as
`order`'s is); 0011, whose "Equality is all a row filter can say" stops being
the whole truth -- a row may also be scoped one foreign-key hop away, to a row
a lookup's equality filter admits; its "a row filter written as SQL or as an
expression" stays foreclosed, and `through` is neither; 0015 (the WHERE that
locates a record carries every through, the not-found read included); 0016
and 0017 (their update's WHERE and the read that tells stale from not-found
carry the throughs, and SQL Server's record statements are aliased); and 0018
(the read and update requests carry `through`, and a through field is
required on create and not cleared on update); and 0039 (a through that
names a key is a grant on it, with or without a role).
