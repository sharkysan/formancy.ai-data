# 0151 — A person sets a grid column's width, and the browser keeps it

- **Status:** accepted; narrows [0106](0106-a-hosts-grid-keeps-its-columns-sort-and-view-in-the-viewers-browser.md): a column's width is no longer its content's alone -- a person sets one by its header's edge, by Alt and an arrow on its header and in the Columns panel, and the viewer's browser keeps it in the value 0106 defined; amends [0047](0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md): a field's column is resized by hand, and the page's sizing never sizes a width a person set
- **Date:** 2026-11-13
- **Deciders:** Daniel Bacher
- **Verified by:** run here, under a copy of `apps/host/vitest.config.ts`
  without its `globalSetup`, which starts both databases and none of these
  needs, which was not kept, and watched failing with each break their
  comments name: `apps/host/src/widths.test.ts` -- the widths a browser
  kept read back as written; a negative, a fraction, a number in a string,
  one past either end, a field named twice or not at all and a key this
  release does not write each dropped alone, and a list that is no list
  read as none; a width for a field the form no longer offers dropped; a
  width set, replaced and taken away, whole and in range; a press a step
  from the width drawn, never past the column's floor or the widest; an
  empty header's floor the narrowest the reader takes; and what the panel
  says of a width set, an end reached and a column fitted.
  `apps/host/src/columns.test.ts` -- a value with widths read back in each
  shape it is written in; a value kept before widths were read as before;
  a width the reader would not take dropped and the rest read; widths
  written alone or beside the columns and the list; a width a part of its
  own over what is stored, which Reset columns changes with the columns;
  and a section opening on the kept widths of the columns still offered.
  `apps/host/src/grid-sizing.test.ts` -- a column with a kept width never
  among those the grid sizes to their content.
  `apps/host/src/column-widths.test.tsx`, the Columns panel without a
  server -- Wider, Narrower and Fit for every column, a hidden one
  included, each named for its column; a step at a time from the
  keyboard, the keyboard staying on the button and the panel saying how
  wide; an end said, and nothing kept for it; Fit keeping no width; and a
  press at an end said again each time, as a new element of the line; axe
  and a name on every control in each state. `apps/host/src/grid-widths.test.tsx`,
  AG Grid as the page configures it, without a server -- a kept width
  drawn when its column is made and never again from the definitions; a
  width the panel sets drawn and told as the person's; nothing of the
  page's own sizing told; each step of Alt and an arrow on a header told
  while the section keeps each; a double click on an edge sizing nothing;
  and a row's Delete never resized. On both engines against the real
  server, to be watched failing in CI with B1 to B4 of the commit
  "TEMPORARY: break what 0151's host cases hold, to watch them fail":
  `apps/host/src/grid-keys.test.tsx` -- Alt and an arrow on a header
  resizing its column and the width kept (B1), and a width set in Columns
  through a new page, the separator let go and the page mounted again, as
  a reload mounts it (B2); `apps/host/src/columns-panel.test.tsx` -- Wider,
  Narrower and Fit from the keyboard, the header following, the width
  kept and then none, each press said, and Reset columns giving a width
  back (B3, B4), and a child section's width kept under its own key. The
  browser gate, in Chromium, Firefox and WebKit, to be watched failing in
  CI: `apps/host/scripts/browser/widths.mjs` -- a pointer's drag on a
  header's edge widening its column by as much as it moved, and a reload
  opening it at that width; a drag far to the left stopping at a floor
  where every word of the header is whole (B1); Wider from the keyboard
  making the column wider than a phone's window, with nothing past either
  edge at 320 px; and Fit giving it back to its content (B4) -- the
  reload's check failing with B2 too.

## Context

Every readable field is a column of a host's grid, sized to its content:
to the first page that has rows, again each time the separator is let go,
and never past 320 pixels, so one long note does not take the well
([0047](0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md)).
A person chooses which columns a grid shows and in what order, and the
viewer's browser keeps that with the grid's sort and view
([0106](0106-a-hosts-grid-keeps-its-columns-sort-and-view-in-the-viewers-browser.md)).
Nobody could widen or narrow a column: 0047 set `resizable: false`,
`grid-keys.test.tsx` held that Alt and an arrow resized nothing, and 0106
listed it as a cost. A long text column the first page sized narrow, or a
wide one that pushed the rest out of view, could not be fixed.

What AG Grid Community 36.2.0 does, read in its source. A field's column
with `resizable` draws a handle at its header's right edge, which a
pointer drags; resizing is the core module's own, with no module to
register. On a focused header, Alt with Left or Right resizes the column
by two pixels a press, more while the key is held; AG Grid calls
`preventDefault` and `stopImmediatePropagation` on any modifier with Left
or Right on a focused header whether a column resizes or not, so the
browser's Back and Forward, which Alt with an arrow is on Windows and
Linux, were never reached from a header, before this or after; and
`suppressHeaderKeyboardEvent` does not reach that handler, which is a
listener of its own on the header. A double click on a header's edge
sizes the column to its content, within the column's own limits, and
reports it as `autosizeColumns`, the source the page's own sizing reports.
A drag's last step and each press report `uiColumnResized`, `finished`.
And AG Grid delivers `columnResized` after the change, so a width drawn
again from the column's definitions between two presses puts back the
first press's width under the second: `grid-widths.test.tsx` found it,
the second press of Alt and Right told 242 where the header had been 244.

## Decision

**A pointer drags a field's column's header edge**, as AG Grid draws it:
`resizable` on every field's column (`apps/host/src/grid-options.tsx`),
never on a row's Delete, whose width is its button's. Headers still wrap
(WCAG 1.4.12). A column is never narrower than its header's floor,
`headerFloor` in `apps/host/src/widths.ts`, which the grid already sized
to: the header's widest word measured in its face, with the criterion's
letter spacing allowed for, the cell's padding and the sort's icon; the
browser gate drags a column far past it and finds every word of its
header whole. A drag stops at 960 pixels, `WIDEST`: three times the 320
the page sizes a column to, a ruling and not a measurement. The page's
own sizing is still capped at 320 (`CONTENT_WIDTH`, passed to AG Grid's
sizing as its default limit), where it had been the column's `maxWidth`.

**The keyboard's way is the Columns panel** (`apps/host/src/columns-panel.tsx`),
where every other change of a column is (0106, formancy.ai 0046). Each
column's line has Wider, Narrower and Fit, named "Make Amount wider",
"Make Amount narrower" and "Fit Amount to its content", the visible word
in each name. Wider and Narrower move the column 40 pixels from the width
the grid draws it at now (`WIDTH_STEP`, a ruling: an eighth of the 320 a
column is sized to, so a press is seen and eight take a column across
that); at the floor or at `WIDEST` a press changes nothing and says so.
Fit gives the column back to its content. A width the panel sets is set
on the grid as the person's (`drawWidths`), so it is told and kept by the
one way a drag's is. What a press did is said on the panel's line, a
status named Columns, in the page's own muted voice, a new element each
time so a press at an end is heard again: the browser keeps a width, not
the server, so it is not the teal 0146 keeps for what the server did.

**Alt and an arrow on a header resize it, as AG Grid does.** Stopping it
would give the keys to nothing, since AG Grid takes them from the browser
there anyway, and would mean a listener in front of AG Grid's own on
every header; letting it work gives a keyboard on a header AG Grid's own
way, kept as a drag is, and the panel stays the way that is named, steps
in a size a person sees and says what it did. **A double click on an edge
sizes nothing** (`suppressAutoSize`): AG Grid's would size past the
page's cap and report itself as the page's sizing does, so it could not be
told from it and kept; Fit does it.

**What the grid tells is kept, and a kept width is drawn once.** A
`columnResized` that is `finished` and `uiColumnResized` -- a drag let go,
a press of Alt and an arrow, the panel's width -- is told to the section
in whole pixels (`apps/host/src/record-grid.tsx`), which keeps it
(`apps/host/src/use-grid-state.ts`). A kept width is the column's
`initialWidth`: drawn when the column is made -- the grid opened, a
reload, another page, Drill down's level, a child section -- and never
again from the definitions, which would put back a width the person had
dragged past since. After that the width the grid has is the column's.

**The browser keeps widths in the value 0106 defined**, under the same
key and the same version: `widths`, a list of a field and whole pixels
(`apps/host/src/columns.ts`, `KeptGrid`). A value without one reads as
before. A width is a part of its own over what is stored (`withKept`):
set in one section, it keeps the columns and the view another section
under the key kept since. A width the reader would not take -- not a
whole number from `NARROWEST`, 28 pixels, an empty header's floor, to
`WIDEST` -- is dropped alone and the rest of the value read, where any
other malformed part is the whole value refused: a width is the least of
what is kept, and a limit a later release moves must not cost a person
their columns and their view. A width for a field the form no longer
offers is dropped when the section opens, as a kept column is
(`mergeChoices`). A width is neither an arrangement nor a list: widening
a column keeps the form's order and its default view the form's.

**The page's sizing never sizes a width a person set**
(`apps/host/src/use-grid-sizing.ts`, `sizedToContent` in
`apps/host/src/grid-sizing.ts`): not the first page, the separator let go,
a well drawn again nor a column shown again. Fit takes the column's width
away and Reset columns takes every one, and the column is then sized to
the rows on the page, or to the next page that has some.

**Nothing on the server, `data-core` or the client changes.** A width is
the browser's, as 0106's other choices are: not the server's, and not a
person's own view (0126).

## Consequences

A person widens a long text column to read it, narrows a wide one to see
the rest, from a pointer or the keyboard, and finds it as they left it on
the next page, after a reload and in Drill down, without the server
storing anything about them.

The costs:

A width is the browser's, not the person's: it follows nobody to another
device, everybody signed in on one browser shares it, and it is in no
view of theirs (0126), so a view they saved does not bring it back
elsewhere.

A release before this one refuses a value that holds widths, its reader
taking only the keys it wrote: after a rollback, a viewer who set a width
opens on the form's columns and default view, as if nothing were kept.

A width set in one section is drawn in another under the same key -- a
form that is its own child, at two levels of Drill down -- only when that
one opens again, as a column moved there is. A width wider than a lane
leaves the rest of the grid behind the grid's own scroller.

Alt and an arrow move a column two pixels a press and say nothing; a
person who presses it by mistake keeps a width they did not mean, which
Fit gives back. Wider and Narrower at an end are not `aria-disabled`: the
panel does not know a column's drawn width until it is pressed, so the end
is said when it is reached. A double click on an edge, which other grids
use to fit a column, does nothing here.

AG Grid draws its resize handle between the headers in the room's
`--edge-strong`, two pixels wide and a third of the header's height; no
gate measures its contrast, and a pointer finds the edge by the cursor AG
Grid draws there too. The headers of every README picture of a host grid
show it.

The floor is the header's words: a column whose cells say more than its
header is narrowed past them, and its cells cut, as a person asked.

## Alternatives considered

- **Widths on the server, per person.** Rejected for now, as 0106
  rejected its columns there: the server would need a store for each
  person's settings and a route for them, under their token, for a choice
  that changes what they see and nothing they may do. It is the way to
  follow a person across devices, and a decision of its own.
- **AG Grid's Alt and an arrow as the only keyboard path.** Rejected: a
  person learns of it nowhere on the page, it says nothing when it moves a
  column, and it moves two pixels a press; and a column hidden has no
  header to press it on. It stays beside the panel's, as AG Grid's own.
- **No resizing, and wider sizing by default.** Rejected: fitting every
  column to the lane, or sizing past 320, gives one column's room to the
  next without asking, and the long note 0047 capped would take the well
  again. Which column needs room is the person's to say.
- **Stopping AG Grid's Alt and an arrow.** Rejected: AG Grid takes those
  keys from the browser on a header whether a column resizes or not, so
  stopping its resize would give Back and Forward back to no one, and would
  need a listener in front of AG Grid's own.
- **A kept width as the column's `width` in its definitions.** Rejected
  once measured: the definitions are drawn again with every change of the
  section, and a width told a moment before put back the one the person
  had pressed past (`grid-widths.test.tsx`).
