# 0133 — A cell filters by its value

- **Status:** accepted; extends [0132](0132-each-column-header-filters-its-column.md): a column's condition can be taken from one of its cells
- **Date:** 2026-11-05
- **Deciders:** Daniel Bacher
- **Verified by:** `apps/host/src/cell-example.test.tsx`, without a server
  -- a value is equal to itself as its row holds it, empty where the column
  offers that, and none where the column offers no equality or the cell
  shows a lookup's label; the example takes the place of the condition its
  column had; `=` on a focused cell applies it, and a cell with the
  keyboard shows a button named for what it keeps (each watched failing:
  with the label taken for the value, with `=` heard nowhere, and with the
  button never drawn). `apps/host/src/filter-line.test.tsx`, on
  both engines against the real server -- `=` on a cell lists the rows
  with its value, the box saying it. `apps/host/scripts/browser/filtering.mjs`,
  in Chromium, Firefox and WebKit -- `=` from the keyboard, and the cell's
  button, measured with the state.

## Context

The design of 2026-11-04, "easy to use, and fun": a person filters by
pointing at what they see before they ever type. The grid is one Tab stop
(0047): Enter on a cell opens its row, Space too, and Tab leaves the grid,
so a cell has no key of its own for anything else, and a button in every
cell would be a Tab stop each or reachable by no key.

## Decision

**`=` on a focused cell keeps the rows with its value.** A printable key
on a cell is free -- nothing in the grid edits -- and `=` is the line's
own word for equality. The value is the one the row holds, not the text
the cell shows, made the condition on its column in place of the one the
column had (`apps/host/src/cell-example.tsx`'s `exampleTerm`,
`filterByExample`): equal to it, or `is empty` for an empty cell where the
column offers that. Only a column the filter line may name offers one,
and only where the line could say it: a timestamp offers no equality, and
a lookup's cell shows a label whose value it is not.

**A cell that has the keyboard shows a button.** "=", named "Only rows
where Status is “placed”", in the cell's own style attribute as a row's
Delete is (no rule of host.css reaches into a grid), 24 pixels a side,
out of the Tab order: a pointer's way to the same thing. A click on it is
the button's, never the row's. The filter line's hint says the key.

## Consequences

**What it buys.** "Only these" is one key, or a click, on what the
person is looking at; the chip, the box and the line say it, and Undo
takes it back.

**What it costs.**
- The button appears only on a cell that has the keyboard -- a pointer
  clicks the cell, which opens its row, then the button.
- `=` is a key a person learns from the line's hint; nothing on the cell
  says it while it has no focus.
- A timestamp's cell offers nothing: its value is an instant, and its
  column is filtered by whole days.

**What it forecloses.** Nothing on the server: what reaches it is what
the line and the panel send.

## Alternatives considered

**A "Not this" beside it.** The line has no "not equal" (0131); a
condition the line could not say would be a chip nothing else can show.

**A context menu on the cell.** AG Grid Community has none, and one of the
page's own would be a second menu over the grid for one action.

**A button in every cell, always shown.** A row of buttons in every row,
read by a screen reader with every cell, for an action most rows never
need.
