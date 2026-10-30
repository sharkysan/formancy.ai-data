# 0110 — A form that is its own child is shown as a tree of its records: its roots, and under each record those naming it

- **Status:** accepted; extends [0044](0044-a-forms-records-are-listed-a-page-at-a-time-under-its-read-policy.md): a list's `parent` may name no record, which narrows it to the rows whose field references none; extends [0047](0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md): the Records panel of a form that is its own child shows its records as a grid or as a tree
- **Date:** 2026-10-30
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/records/plan-list.test.ts` -- a parent of
  `record: null` plans every column of its field NULL, as the person's own
  `null` conditions beside theirs, and a field the actor may not read names
  no roots either (watched failing with the NULL conditions left out: the
  roots were every order). `records/list-query.test.ts` -- a parent's
  record is a token or `null`, and nothing else. `apps/host/src/tree.test.tsx`,
  on both engines over the employees, whose manager is an employee --
  Tree lists the records with no manager, Ada and the one the test made,
  and not Grace, whom Ada manages (watched failing with the roots asked
  for with no parent: every employee was a root, Grace among them); Right
  expands a record and lists those it manages at the level below, Down
  goes to the first, Enter opens it in the detail, Left goes back up and
  Left again collapses, axe clean and every control named; a record
  managing nobody, expanded, says so and is a leaf from then on (watched
  failing with a leaf left expandable).
  **Not mechanically enforced:** the browser gates do not reach the tree;
  jsdom and axe hold it.

## Context

A table that references itself -- an employee and their manager, a
category and its parent, an account and the account it rolls up into --
holds a hierarchy. The module already knew one: such a form is its own
child (0045), so under an open employee the host lists the employees they
manage, and Drill down goes a level deeper at a time (0090). But the
records as a whole were a flat grid, the hierarchy visible only one
record at a time. The backlog asked for a tree view of a self-referencing
table.

AG Grid Community, the host's grid (0047), has no tree data; that is a
feature of its paid edition. And a list could not ask for a tree's roots:
its `parent` named a record, never none.

## Decision

**A list may ask for the rows that reference no record.** `parent:
{ field, record: null }` narrows a list -- and a file of it -- to the rows
whose lookup field holds nothing: every one of the field's columns NULL.
It is planned as the person's own `null` conditions are (0104), one per
column, beside theirs, so each adapter spells it as it spells those. The
field must still be a lookup the person may read; a parent remains a
narrowing and never a permission.

**The host shows such a form's records as a tree** (`record-tree.tsx`).
Where the menu names a form as its own child, the Records panel offers
"Show the records as" Grid or Tree. The tree lists the roots, the records
whose field names no record, and a record's level -- the records naming it
-- when it is first expanded; each level is the form's own list with
`parent`, a page at a time, the next asked for after the last row it
showed (0108) through a "More records" item at the level's end. A
WAI-ARIA tree: one item in the tab order; Down and Up move, Right expands
or goes to the first record below, Left collapses or goes up, Home and End
go to the first and the last; Enter opens the record in the detail and
moves there and Space opens it beside, as a row does; a click opens it.
An item is named by its record's crumb name (`crumbs.ts`), else its token.
A record whose level holds none says so and is a leaf from then on.

## Consequences

**What it buys.** A hierarchy seen as one, a level at a time, each level
the same list the grid asks for, under the same read policy, with no
statement of its own and nothing new in either adapter.

**What it costs.**
- The tree has no search, no filter, no sort and no columns: each level is
  in key order, and a record is its name. The grid is a press away.
- A record whose parent is not one the person may read, or is gone, is in
  no level of the tree -- it references something, so it is not a root,
  and its parent is not listed. Nor is a record in a cycle with no root.
  The grid lists them.
- A record shows whether it has records below only once it is expanded,
  one list request per level.
- A composite foreign key is a root only with every column NULL; a row
  with some of them NULL references nothing and is in no level.
- Whether the panel shows a grid or a tree is not kept: it opens as a grid.
- The browser gates do not measure the tree.

**What it forecloses.** Nothing the grid does.

## Alternatives considered

**AG Grid's tree data.** In its paid edition, which the host does not use.

**The roots as the person's `null` condition on the lookup field.** One
spelling for both; but a lookup field offers no filter (0104), and a
filter on it would be a narrowing a person could also apply to a grid,
where a lookup's NULL is a choice of none, not a place in a hierarchy.

**The whole hierarchy in one request.** A recursive query on each engine
-- a second spelling of a list, a cycle to stop, and every row of the
table for a tree that shows a few levels.

**The tree as a layout beside Side by side and Drill down.** A layout is
how the records and the record are arranged (0090); the tree is how the
records are shown, and keeps every layout.

## Older records

Extended, not edited away: 0044 (a list's `parent` may name no record,
planned as `null` conditions on its field's columns); 0047 (a form that
is its own child offers its records as a tree beside the grid).
