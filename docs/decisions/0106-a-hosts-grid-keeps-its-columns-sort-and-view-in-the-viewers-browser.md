# 0106 — A host's grid lets a person choose its columns, and keeps them, its sort and its view in the viewer's browser

- **Status:** accepted; extends [0047](0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md): a person chooses which readable fields a grid shows and in what order, through a panel of the page's own, and nothing is moved or resized by hand still; extends [0105](0105-a-forms-list-offers-views-its-administrator-named.md): a grid opens on the view its viewer last picked before the default
- **Date:** 2026-10-28
- **Deciders:** Daniel Bacher
- **Verified by:** `apps/host/src/columns.test.ts` -- a choice fitted
  to what the form offers, columns dropped and appended and the defaults
  when nothing kept is shown, no move past an end, the last shown column
  kept, every kept shape read back as written and every other refused, a
  view kept by name and with the person's sort where a header sorted it
  another way, an empty filter's sort kept, `[]` included, a filter of the
  person's own kept as its sort alone, only the part changed written over
  what is stored, and what a section opens on. `prefs.test.ts` -- one key
  per form and section, a child section's by its field, removed when
  nothing is left, and every call surviving storage that throws.
  `columns-panel.test.tsx`, on both engines -- the grid's columns listed
  and never Delete, a column hidden, shown and moved by keyboard with the
  headers following, Delete last, the focus kept and nothing asked of the
  server or put in the address; the last column kept and said; Reset
  columns; a view sorted by a hidden column listed in one request; and a
  child section's own Columns, without its parent's field.
  `remembered.test.tsx`, on both engines -- a reload bringing back the
  columns and a picked view in one first page, All records over the
  default and a header's sort; a filter of the person's own not brought
  back, and no value typed into one under any key; what was kept read over
  what the form offers now, and a value of another shape read as nothing;
  Reset columns with no list chosen keeping nothing; storage that throws;
  and a child section's arrangement under another parent. The browser
  gate's `apps/host/scripts/browser/columns.mjs`, a column shown over a
  page with no rows sized to the next one that has some among it.

## Context

Every readable field of a form is a column of its grid, in the generator's
order, sized to its content
([0047](0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md)).
A form over a wide table shows a person columns they never read, and the
ones they do read are wherever the generator put them. A person who sorts
their list, or picks a view
([0105](0105-a-forms-list-offers-views-its-administrator-named.md)), does
so again each time they open the form.

The workspace already keeps two of a viewer's choices in their browser:
which renderer draws the record, and where the split between the records
and the record sits (0047). Nothing on the server knows a person beyond
their token, and the host page holds the token without reading it.

## Decision

**A grid's columns are chosen in a panel of the page's own.** Columns, a
disclosure between View and Filter on the Records panel's grid and on each
child section's (`apps/host/src/columns-panel.tsx`), lists the grid's
columns in their order: each a checkbox "Show <label>" and two buttons,
"Move <label> up" and "Move <label> down", and below them Reset columns,
which gives the form's order back with every column shown. Every action
is the keyboard's, and nothing is dragged: the grid still moves and resizes
no column by hand (0047, formancy.ai 0046). The last column shown cannot be
hidden -- a row is opened through its cells -- and the panel says so; a
move at an end changes nothing and keeps the keyboard on its button. The
Delete column is never listed and stays last, and a child section's grid
never lists its parent's field. The arrangement is data in
`apps/host/src/columns.ts`, and a section holds its filter, its sort and
its columns in `use-grid-state.ts`.

**A hidden column stays a column of the grid**, hidden, never removed: a
view or a remembered sort may order by it, and the grid asks for a block
only when its headers hold the section's sort (0105), which a column the
grid did not have could never hold.

**The viewer's browser keeps, per form in its Records panel and per form
and parent field in a child section, the columns and the list's state.**
A child section is keyed by the field its rows are narrowed by too, so an
employee's orders created and approved, both on screen, keep two
arrangements. In `localStorage`, like the renderer and the split, and read
through the same wrapped calls, so a browser that refuses site data shows
the defaults and loses nothing else. The key is
`formancy-data-host.grid.records.<form id>` or
`formancy-data-host.grid.child.<form id>/<field>` (`prefs.ts`'s
`gridKey`), its value one JSON object of version 1: the columns, in their
order and each shown or not, once the person has arranged them, and the
list's state once they have chosen one, and the key goes when neither is
left. A value of any other shape is read as nothing kept. Opening a form
writes nothing, so a form's default view stays the form's until its
viewer picks another. A change writes only the part changed, the columns
or the list, over what is stored (`withKept`): two sections under one key
-- a form that is its own child, at two levels of Drill down -- do not undo
each other's choices.

The list's state is kept as a view's name when the filter and the sort are
that view; as the view's name and the sort when the filter is a view's
and a header sorted it another way, since those conditions are the
administrator's and not typed; as the sort when the filter is empty -- an
empty sort being All records, which then wins over the default view --
and as the sort alone when the person has conditions of their own. A
person's own conditions are never kept, so no value they typed is stored:
0104 keeps a filter in no address for the same reason.

**What is kept is fitted to what the form offers when it is read.** A
column no longer offered is dropped, one new to the form is shown at the
end, and nothing shown leaves the defaults. A view no longer offered by
that name gives the default view, its sort with it, since the conditions
it stood for are gone. A sort's terms no longer sortable are dropped and
the rest kept -- with no terms left, every record -- never the default
view in its place, which the person had chosen away from. Restored, the
grid asks for one first page, as it does when it opens.

## Consequences

A person reads the columns they need, in their order, and finds their
list as they left it, on every form, without the server storing anything
about them.

The costs:

What is kept is the browser's, not the person's: it follows nobody to
another device, and everybody who signs in on one browser shares it, since
the host page cannot tell them apart.

A column's width is still its content's: a person cannot widen or narrow
one, and the headers wrap rather than being dragged (0047).

A person's own filter conditions are not kept: a reload brings back the
view they picked, or their sort, without the conditions they typed.

Download CSV holds every readable field, hidden or not: the file is the
server's (0079, 0080).

Every child section of one form under one field shares one arrangement,
under every parent and at every level of Drill down. A view is kept by its name: renamed, the grid
opens on the default; changed, on its new conditions. A sort term no
longer sortable is dropped without a word, and so is a view no longer
offered. A browser that keeps nothing says nothing of it.

A hidden column is still read: its values are fetched, and a lookup's
labels resolved, as when it is shown. Search and page are not kept.

Columns adds a Tab stop between Show view and Filter, and its panel, open,
takes a row of the grid's toolbar.

## Alternatives considered

- **Kept on the server, per person.** Rejected for now: the server would
  need a store for each person's settings and a route to read and write
  it, under their token, for a choice that changes what they see and
  nothing they may do. It is the way to follow a person across devices,
  and a decision of its own.
- **AG Grid's own column menu, or dragging headers.** Rejected: its menu
  speaks the grid library's words, and a drag has no keyboard path
  (formancy.ai 0046).
- **Keep the person's own filter conditions too.** Rejected: a value
  typed into a condition -- a customer's name, an amount -- would sit in
  the browser's storage after the person left, which 0104 keeps out of
  every address for the same reason. A condition worth keeping is a view.
- **Columns removed from the grid when hidden.** Rejected: a view sorting
  by one would never be listed.
