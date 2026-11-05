# 0133 — A cell filters by its value

- **Status:** accepted; extends [0132](0132-each-column-header-filters-its-column.md): a column's condition can be taken from one of its cells
- **Date:** 2026-11-05
- **Deciders:** Daniel Bacher
- **Verified by:** `apps/host/src/cell-example.test.tsx`, without a server
  -- a value is equal to itself as its row holds it, empty where the column
  offers that, and none where the column offers no equality or the cell
  shows a lookup's label; the example takes the place of the condition its
  column had; `=` on a focused cell applies it, and `=` held with Ctrl, Cmd
  or a plain Alt does not (each watched failing: with the label taken for
  the value -- a branch only a field the line may name and a lookup could
  reach, which none does yet -- with `=` heard nowhere, and with every `=`
  heard). `apps/host/src/filter-line.test.tsx`, on both engines against
  the real server -- `=` on a cell lists the rows with its value, the chip
  and the box saying it, the keyboard back on that row's cell in its
  column, and axe and a name on every control.
  `apps/host/scripts/browser/filtering.mjs`, in Chromium, Firefox and
  WebKit -- `=` from the keyboard, its condition in the list's body, and
  the keyboard back on a cell of the grid once it lists again.

## Context

The design of 2026-11-04, "easy to use, and fun": a person filters by
pointing at what they see before they ever type. The grid is one Tab stop
(0047): Enter on a cell opens its row, Space too, and Tab leaves the grid,
so a cell has no key of its own for anything else.

## Decision

**`=` on a focused cell keeps the rows with its value.** A printable key
on a cell is free -- nothing in the grid edits -- and `=` is the line's
own word for equality. Not with Ctrl or Cmd, which zoom, nor with a plain
Alt; AltGr, Ctrl and Alt together, types `=` on some layouts. The value is
the one the row holds, not the text the cell shows, made the condition on
its column in place of the one the column had (`apps/host/src/cell-example.tsx`'s
`exampleTerm`, `filterByExample`): equal to it, or `is empty` for an
empty cell where the column offers that. Only a column the filter line may
name offers one, and only where the line could say it: a timestamp offers
no equality, so only its empty cells offer one, and a lookup's cell shows
a label whose value it is not. A column that offers none says so on the
grid's line.

**The keyboard stays where the person pointed.** Once the list the
example asked for answers, the keyboard is back on the row it was pressed
on, in its column, or on the first row's (`apps/host/src/record-grid.tsx`),
so a person can point at one value after another. The grid is described
by the filter line's hint, which says the key, so a screen reader reads
it on entering the grid.

## Consequences

**What it buys.** "Only these" is one key on what the person is looking
at; the chip, the box and the line say it.

**What it costs.**
- A pointer has no example of its own: a person with a mouse types into
  the column's box (0132) instead.
- An example replaces its column's condition without an Undo: the
  condition it replaced is gone, and the chip, the box and the line say
  the new one.
- `=` is a key a person learns from the line's hint, which the grid's
  description reads to a screen reader once on entering it.

**What it forecloses.** Nothing on the server: what reaches it is what
the line and the panel send.

## Alternatives considered

**A button in the focused cell.** Built and taken out again in review:
inside the cell its name was read with the cell's, and its "=" was in the
cell's text, which a person copies; in the cell's line it overflowed a
cell sized to its value and moved the rows; drawn over the cell's end it
covered the value; and in Drill down a click on a cell goes down a level,
so a pointer never reaches it. One button per grid, outside the grid,
placed over the focused cell, would avoid each of these, and is the shape
a pointer's example would take.

**A "Not this" beside it.** The line has no "not equal" (0131); a
condition the line could not say would be a chip nothing else can show.

**A context menu on the cell.** AG Grid Community has none, and one of the
page's own would be a second menu over the grid for one action.
