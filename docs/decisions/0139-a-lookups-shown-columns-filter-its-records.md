# 0139 — A lookup's shown columns filter its records

- **Status:** accepted; extends [0104](0104-a-list-and-a-browse-are-filtered-by-conditions-on-their-columns.md): a list is filtered by conditions through a lookup; extends [0135](0135-a-lookup-field-filters-by-the-record-it-refers-to.md): a lookup is filtered by what it shows as well as by the record it refers to
- **Date:** 2026-11-05
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/records/plan-list.test.ts` --
  a condition on `<lookup>.<column>` is planned on the target's display
  column, carried with the key's pairing and the lookup's own read filter
  scoped on the target, every condition through one lookup in one entry;
  each display column is offered after its lookup, a column no label
  shows is no field, and a lookup whose filter this person does not
  resolve offers none (watched failing with every dotted field refused);
  `related-filter.test.ts` -- `is empty` is neither offered nor planned
  through a lookup, and `is not empty` is (watched failing with the
  column's own offer used through the lookup);
  `list-terms.test.ts` -- an adapter reads the conditions fresh and
  refuses an entry shaped otherwise or with no condition (watched failing
  with the empty-condition check removed); `own-views.test.ts` -- a
  person's view keeps a condition through a lookup, fitted on its column
  (watched failing with a dotted field refused as no field of the form's);
  `presentation/views.test.ts` -- a published view naming one is refused;
  `filter-line.test.ts` -- the line names it `customer.name` after the
  lookup's own name (watched failing with it named by its label). Both
  adapters' `list.integration.test.ts` hold the shared case
  `list: related` over the label case's tables: a condition on the
  parent's name finds the children whose parent, found as the label is,
  holds it -- never the child naming `c` that a case-insensitive key
  relates to `C`, and nothing through a parent the lookup's filter hides
  (watched failing on PostgreSQL with the key matched by the database's
  own equality, on SQL Server with the lookup's filter left out, and on
  both with the conditions dropped by the planner); two conditions hold
  of one parent together, and a page continues after a row they do not
  hold (watched failing on both with the conditions asked of that row).
  `packages/data-server/src/routes/runtime-lists.test.ts` -- the form
  offers `country.name` with its lookup and column, a condition on it
  reaches the port as a related entry, and a person saves a view holding
  one (each watched failing under a mutation: the related conditions
  left out of the request, the related fields not handed to the fit).
  `packages/data-client/src/transport.test.ts` -- an offer whose
  `related` is not a lookup and a column, each text, is not the
  server's. `apps/host/src/filter-terms.test.ts` -- the offer is called
  by its lookup's label and its column's; `filter-line.test.tsx` -- a
  line naming `customer.name` keeps the orders whose customer's name
  holds it, on both engines.

## Context

0135 made a lookup filter by the record it refers to, which a person
picks by its label. Finding every order of a customer whose name holds
"Muster" -- several customers, or one whose name a person half remembers
-- needs a condition on what the lookup shows, not a record. The design
of finding records asked for conditions "also on other tables", one link
away through a lookup the form already has, and never one that reads
what a person may not.

## Decision

**A condition through a lookup is on a column its label shows.** Each
display column of a lookup is a field a list may be filtered by, keyed
`<lookup>.<the column's field key>` -- `customer.name` -- which no field
of a form can be, since a formancy key holds no dot
(`packages/data-core/src/records/related-filter.ts`'s `relatedKeys`). It
offers what its column offers (`filterOffer`) but `is empty`
(`relatedOffer`), after its lookup, with `related: { lookup, column }`
naming the lookup and what the column is called; it is left out of the
filter with its lookup (0123). A column of the target no label shows is
no field: a condition on it would answer questions about values the form
never shows the person. `is empty` is not asked: a row with no target
row, or one the lookup hides, shows the column empty as a target holding
NULL does, and a condition through the lookup finds the last alone; the
lookup's own `is empty` (0135) finds the rows with no target row.

**Only among the rows the lookup may offer this person.** The field is
offered, and planned, only where the lookup's own read filter resolves
for the person, as its label and its sort are
(`scope.ts`'s `reachedLookups`, shared with 0136's `sortLabelsOf`), and
that filter is inside the condition: a target row the lookup hides holds
no condition.

**One EXISTS per lookup, the key matched as the label is.** The list
request carries `related`, an entry per lookup -- the root's foreign-key
columns, the target, its key, the lookup's filter and the conditions on
the target, each planned by `columnFilter` as a condition on a column of
the form's own is -- read fresh by the adapter (`list-terms.ts`'s
`RelatedTerms`). Each adapter spells it `exists (select … from <target>
where <the key> and <the lookup's filter> and <each condition>)`: a
semi-join, so a row is on the page once whatever the target holds. The
key is matched exactly, as the label's (`reachedRow` in each adapter's
`records/list.ts`): a row is found by the label its page shows, which a
token resolves to only on an exact match. Like a person's filter, it
narrows the page and never the anchor a page continues after.

**The line names it after the lookup.** `lineNames` names a dotted field
by its lookup's name in the line, a dot and its column's key; the host
calls it by its lookup's label and its column's (`Customer › Name`) in a
chip. A person's own view (0126) keeps it, fitted on its column.

## Consequences

**What it buys.** Every order of a customer whose name holds "Muster",
typed as `customer.name contains Muster`, on both engines, among the
customers the lookup may show the person.

**What it costs.**
- Only the display columns: a column of the target the form does not
  show through the lookup cannot be filtered by. Detail columns, chosen
  per lookup in the studio, are left to a later decision.
- A published view cannot name a field through a lookup yet: a view is
  fitted against the bindings alone when it is stored, and they hold no
  type of the target's columns, so one naming it is refused. A person's
  own view can.
- A grid has no column, and so no header box, for a field through a
  lookup: the line, its completion and the chips alone name one, and a
  cell offers no condition on one by example.
- Under a collation that folds what the key holds -- case, accents, or
  the trailing spaces SQL Server's `=` ignores -- a row whose foreign key
  differs from its target's key only by what the collation folds is
  found by no condition through the lookup, as its page shows it no
  label, while the lookup's own condition (0135) finds it.
- `is empty` is not asked through a lookup, so a row whose target holds
  NULL in the column is found by none; `is not empty` is.
- A lookup whose filter names an attribute the person does not carry
  offers them no field through it.
- No plan of the EXISTS is measured on either engine, against IN or
  otherwise: a target's key is its primary or a unique key, which each
  engine can seek by, and that is all that is known. On PostgreSQL a
  text key is compared under the database's default collation, which an
  index on a key declared under a nondeterministic one does not serve.

**What it forecloses.** Nothing: the browser names a field and an
operator, the planner decides the rest, as for every condition.

## Alternatives considered

**A join to the target.** A target key that stopped being unique would
multiply the root's rows, and the page's count and its order with them.

**IN over the key.** One column's key spells alike either way; a key of
several columns is a row value, which SQL Server has no IN for. One
spelling on both engines, the through's.

**The database's own equality on the key, as 0135's record filter.** It
would find a row whose page shows no label, by a name the page does not
show it with.

**Any column of the target.** A filter that bisects a column the form
never shows -- `customer.credit_limit > 10000` -- reads what the person
may not, which the design names as the failure to avoid.
