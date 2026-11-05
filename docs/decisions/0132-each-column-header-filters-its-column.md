# 0132 — Each column header filters its column

- **Status:** accepted; extends [0131](0131-a-person-types-a-grids-filter-as-a-line-and-sees-each-condition-as-a-chip.md): the filter is seen a third way, a box under each column's header
- **Date:** 2026-11-05
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/records/filter-header.test.ts` --
  a box's text is read as the line reads it with the column's key in
  front, and after an `and` that starts a second bound; a bare value is
  one value whatever it holds, found anywhere in text that offers contains
  and equal to anything else; an empty box is no condition; the line's
  refusals are the box's, in its words; and every condition a box shows
  reads back to itself (watched failing with the bare value read as a
  line, and with the second bound left without the key).
  `apps/host/src/header-filter.test.tsx`, without a server -- AG Grid's
  floating row holds a box, named "Filter" and the column's label, under
  each column the line may name and none under a lookup; Enter or leaving
  it applies it, a select for a column whose field has values; a refusal
  sends nothing, is said where the grid speaks and keeps what was typed;
  and a box shows the condition its column has however it was applied
  (each watched failing with the boxes never offered).
  `apps/host/src/filter-line.test.tsx`, on both engines against the real
  server -- a box's condition in the list's body, the line and the chips
  saying it, a chip removed emptying it, and axe and a name on every
  control. `apps/host/scripts/browser/filtering.mjs`, in Chromium,
  Firefox and WebKit -- the keyboard from a header, Down to its box and
  Enter into it, the condition applied with Enter, and the states measured
  down to 320 px.

## Context

The design of 2026-11-04 asks for one filter seen three ways: the line
(0131), the chips, and a box under each column's header, the place a
person looks when they want "only the amounts over 1000". The page owns
its controls and their words (0104), and AG Grid's own filters, menus and
buttons say AG Grid's words.

A spike on 2026-11-05, in Chromium with ag-grid-community 36.2.0 and in
jsdom, read what AG Grid's floating filter row does with a custom
component: it holds the page's own `<input>` in a `gridcell` of a header
`row`, AG Grid's "Open Filter Menu" button hidden and `aria-hidden` once
`suppressFloatingFilterButton` is set; Down from a header reaches the
box's cell, Enter puts the keyboard in the box, Esc gives it back to the
cell, and Tab still leaves the grid. jsdom cannot answer the keyboard
part: without layout, AG Grid finds nothing to focus in the cell.

## Decision

**AG Grid's floating filter row holds the page's own box.** Each column
the filter line may name -- the fields the Filter panel offers (0123) --
gets `floatingFilterComponent` `HeaderBox` over a filter that filters
nothing (`NeverFilter`), AG Grid's buttons suppressed, and AG Grid's
header keys held from a box while the keyboard is in it, Esc and Tab
excepted (`apps/host/src/header-filter.tsx`, `grid-options.tsx`). A
column whose field has values -- a state (0129), a boolean -- gets a
select: Any, then each value by its label. A lookup has no box.

**A box is the line's condition on one column.** data-core's
`headerCondition` (`records/filter-header.ts`) reads the box's text with
the column's key in front, and again after an `and` that starts a second
bound, so `> 1000` and `>= 2026-10-01 and < 2026-11-01` are the line's
words without the name; a box that starts with no operator holds one
value -- found anywhere in text that offers contains, equal to anything
else. `headerText` writes the column's condition back as the box shows
it. Enter, or leaving the box, applies it in place of the column's
condition; a refusal is the line's, said on the grid's line, the text
kept. While the keyboard is not in a box, it shows its column's condition
however it was applied.

## Consequences

**What it buys.** A condition on one column is typed where the column
is, in the words the line uses, and the three views stay one filter.

**What it costs.**
- A floating row under every grid's headers whose list has a field the
  panel offers: forty pixels of header, and a header row the keyboard
  passes through on its way up from the rows.
- The boxes lean on AG Grid's floating filter keys -- Down, Enter, Esc
  -- which an AG Grid upgrade could change; the browser gate's state is
  what notices.
- A box applies when it is left, so a person who types into one and
  clicks away has filtered.
- Nothing of the page's stylesheet may reach into a grid (the host's
  browser gate fails a rule that does), so a text box wears the theme's
  input style through AG Grid's own input classes, and a select is the
  browser's in the theme's dark scheme: an AG Grid upgrade that renamed
  the classes would leave the boxes unstyled, which the gate's contrast
  and target-size checks would notice. A box's text is the theme's 14
  pixels, so a phone may zoom on focus.

**What it forecloses.** Nothing on the server.

## Alternatives considered

**A row of the page's own under the headers, aligned to the columns.**
Kept as the fallback the plan named: it would follow every column's width
and the grid's sideways scroll by hand, which the floating row does
already.

**AG Grid's own text and number filters.** Their popup, operators and
words are AG Grid's, and they filter in the browser, which an infinite
row model does not.

**A box that applies as it is typed.** A request per key, and a half
typed `> 10` filtering by `> 1` on its way.
