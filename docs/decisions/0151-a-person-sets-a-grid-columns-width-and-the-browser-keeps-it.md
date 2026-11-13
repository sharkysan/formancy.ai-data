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
  width set, replaced and taken away, whole and in range; a resize the
  person finished kept only where its width moved; a press a step from
  the width drawn, never past the column's floor or the widest; an empty
  header's floor the narrowest the reader takes; the header measured in
  the theme's weight and size and the family the page sets; the step, the
  widest, the content's cap and the narrowest at the numbers this record
  says; and each sentence the panel's line may say.
  `apps/host/src/columns.test.ts` -- a value with widths read back in each
  shape it is written in; a value kept before widths were read as before;
  a width the reader would not take dropped and the rest read; widths
  written alone or beside the columns and the list; a width a part of its
  own over what is stored, which Reset columns changes with the columns; a
  width set over the widths stored, not the section's own; and a section
  opening on the kept widths of the columns still offered.
  `apps/host/src/grid-sizing.test.ts` -- a column with a kept width never
  among those the grid sizes to their content.
  `apps/host/src/fonts-loaded.test.tsx` -- each time the page's fonts
  finish loading counted, after which the floors are measured again.
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
  while the section keeps each; a click and a double click on an edge
  keeping nothing, pressed with the pointer; a double click sizing
  nothing; and a row's Delete never resized. To be watched failing in CI,
  in two runs, each with the breaks of one commit -- B1 to B3 of
  "TEMPORARY (1/2): break what 0151's host cases hold, to watch them fail"
  and B4 to B7 of "TEMPORARY (2/2): ..." -- each case failed by its break
  alone: on both engines against the real server,
  `apps/host/src/grid-keys.test.tsx` -- Alt and an arrow on a header
  resizing its column and the width kept (B1), and a width set in Columns
  through a new page, the separator let go and the page mounted again, as
  a reload mounts it (B4); `apps/host/src/columns-panel.test.tsx` -- Wider,
  Narrower and Fit from the keyboard, the header following, the width
  kept (B2) and then none, each press said, Fit sizing the column again
  (B7), and Reset columns giving a width back; and a child section's
  width kept under its own key (B2). The browser gate, in Chromium,
  Firefox and WebKit, `apps/host/scripts/browser/widths.mjs` -- a click
  and a double click on a header's edge keeping nothing (B5); a pointer's
  drag on it widening its column by as much as it moved (B1), and a
  reload opening it at that width once its first page is sized (B4); a
  header of several words dragged far stopping at a floor (B1) where each
  of its words is drawn whole on one line, read by a Range over each word
  (B6); Wider from the keyboard making the column wider than a phone's
  window, with nothing past either edge at 320 px; Fit giving it back to
  its content (B7); and Fit on a column nobody set sizing it to a longer
  value a search listed (B3).

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
A drag's last step and each press report `uiColumnResized`, `finished`;
a drag of its resize handle starts at no distance, so a press on the edge
starts one and the release ends it, telling the width the column had as
finished too -- a click on an edge, which a review found would have been
kept. And AG Grid delivers `columnResized` after the change, so a width drawn
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
letter spacing allowed for, the cell's padding and the sort's icon. The
face is the grid theme's weight and size in the family the room's
variable names, read where the page sets it (`headerFace`), so the theme
says it once; and since a canvas measures in a fallback face until the
web font has loaded, the floors are measured again each time the page's
fonts finish loading (`apps/host/src/use-fonts-loaded.ts`). The browser
gate drags a header of several words far past its floor and finds each of
its words drawn whole on one line. A drag stops at 960 pixels, `WIDEST`: three times the 320
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
Fit sizes the column to the rows shown and keeps no width for it, a
column nobody set included. A width the panel sets is set
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
told from it and kept; Fit does it. **A click or a double click on an
edge changes nothing:** a resize the person ends is kept only where its
width moved from where it began (`changedWidths`), measured against the
width each column had when its last resize finished, the page's sizing
included, or when it was made.

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
under the key kept since; and a width set is set over the widths stored
(`widthsAfter`), not the section's own, so Amount set at one level of
Drill down keeps the Notes set at another since. A width the reader would not take -- not a
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

Each column's line in Columns has three more Tab stops, Wider, Narrower
and Fit, a hidden column's included: the panel's way through grows by
three for every column.

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
- **A spinbutton per column**, one Tab stop whose Up and Down move the
  width a step and whose value is said as it changes. Rejected: its value
  would be the width the grid draws, which the page's sizing changes under
  it, so it would need reading from the grid on every render and say a
  number nobody set; Up and Down are the panel's moves' words already;
  and it has no Fit, which would be a button beside it anyway.
- **A kept width as the column's `width` in its definitions.** Rejected
  once measured: the definitions are drawn again with every change of the
  section, and a width told a moment before put back the one the person
  had pressed past (`grid-widths.test.tsx`).
