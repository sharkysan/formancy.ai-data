# 0134 — The Build a condition panel is retired

- **Status:** accepted; amends [0104](0104-a-list-and-a-browse-are-filtered-by-conditions-on-their-columns.md): a host grid's condition is typed in its line or a column header's box, or taken from a cell, and no longer built from menus; amends [0123](0123-an-administrator-chooses-the-fields-a-forms-filter-panel-offers.md): "the Filter panel" a field is left out of is now the line and the header boxes; amends [0131](0131-a-person-types-a-grids-filter-as-a-line-and-sees-each-condition-as-a-chip.md): the panel 0131 kept as Build a condition is gone
- **Date:** 2026-11-05
- **Deciders:** Daniel Bacher
- **Verified by:** `apps/host/src/filter.test.tsx`, on both engines
  against the real server, holding through a header box or the line every
  case the panel's tests held: a grid lists only what every condition
  holds for, on every page, in its file and in a child section's alone; a
  value the server refuses is its sentence on the grid's line, the box
  keeping what was typed; a condition the line cannot read sends nothing;
  and a field its administrator left out is offered by neither the line
  nor a box. `apps/host/src/filter-terms.test.ts`, without a server -- a
  timestamp's range chip says it is whole days, in UTC or as stored
  (watched failing with the words taken out). `apps/host/src/grid-filter.test.tsx`
  -- the line completes only the fields the form offers.
  `apps/host/scripts/browser/filtering.mjs`, in Chromium, Firefox and
  WebKit -- a header box applies its condition with Enter and keeps the
  keyboard, a refusal keeps the box's value, and Clear filter puts the
  keyboard on its Undo.

## Context

0104 gave each grid of the host page a Filter panel: a field, a condition
it offers, and a value or a range's From and To, applied one condition at
a time. 0131 made the line the way a condition is typed, kept the panel
behind a button named Build a condition, and said it stays until each
column's header filters its column. 0132 put a box under each column's
header and 0133 a condition on each cell's value, so every condition the
panel could build is now one a person types where they look: in the line,
which completes a field, an operator and a value as they are typed, or in
the column's own box.

## Decision

**The panel is gone.** `apps/host/src/filter-panel.tsx` is deleted, and
`grid-filter.tsx` draws the line, the hint and the chips alone. What the
panel's hints said moved where a person reads a condition: a timestamp's
range chip ends with "whole days in UTC" for an instant and "whole days
as stored" for a time without a zone (`apps/host/src/filter-terms.ts`'s
`summaryOf`), and the line's hint says the words it reads.

**0123's name stays.** The studio's "The Filter panel offers", a
presentation's `unfiltered` and a description's `offered` keep the name
0123 gave them; it now means the fields the line and the boxes may name.
A view may still filter on a field left out, which is then a chip, as
before.

## Consequences

**What it buys.** One way to say a condition, in the words the chips and
the boxes say it back, and one button less above every grid.

**What it costs.**
- A person who does not know a field's name finds it in the line's
  completion, which lists the fields offered as the line is opened, not in
  a menu named Field.
- A field the grid does not show as a column has no box: only the line
  names it.
- The panel's word that `contains` ignores case and that an empty text is
  a value, not empty, is said by no control; the chips say what a
  condition finds, not how.
- An operator the server comes to offer is offered by no control until
  the line's reader learns to write it.
- The studio still says "The Filter panel offers" of the line and the
  boxes, which the host no longer calls a panel.

**What it forecloses.** Nothing on the server: what reaches it is what
the line, the boxes and the cells send, the terms the panel sent.

## Alternatives considered

**Keep the panel behind its button.** A second way to say every condition,
with its own menus, its own refusals and its own tests, for a person the
line's completion already walks through a field, an operator and a value.

**Keep the panel for a range alone.** A range is `>= a and <= b` in the
line or the column's box, and a chip says it back as "is between a and
b"; a panel for one operator would be the menus again.

**Rename the studio's words with it.** "The filter offers" is the clearer
name now, and a later change: it moves the studio's controls, the tests
that find them by name and the pictures that show them, none of which
this retirement touches.
