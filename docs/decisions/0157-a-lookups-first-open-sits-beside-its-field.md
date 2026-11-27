# 0157 — A lookup's first Open sits beside its field, joined to its box

- **Status:** accepted; amends [0141](0141-a-lookups-record-opens-below-the-record.md)'s place for a lookup's Opens
- **Date:** 2026-11-27
- **Deciders:** Daniel Bacher
- **Verified by:** the Open beside a lookup's box in both renderers, the
  Opens under it, and the host page's journeys through them. Written on a
  machine without Docker on 2026-11-27: the cases that need no database
  ran there, each watched failing with its rule broken and the file put
  back byte for byte; the host's suites that start the databases, and its
  browser gate against the real plane, have not run, and CI is their first
  run.
  Ran and watched failing:
  `apps/host/src/lookup-opens.test.ts`, run with a configuration of its
  own without the databases its package's suites start, which it does not
  use, as 0141's were -- the first form the server names for a lookup is
  the one beside its box and the rest are under it, in the server's order,
  the two together every Open 0141 offers (watched failing with the one
  beside taken from the last form named, and with every Open left under
  the field too); the one beside is there while the answer is empty or no
  token, with no token, and nothing is under it (watched failing with none
  beside an empty field); a press on it opens nothing while it has no token
  and 0141's first Open once it has (watched failing with the choice made
  whatever the token); nothing is beside a field no form is named for
  (watched failing with one beside every field of the offer); and it is
  named as `namedOpens` names it, answered or not (watched failing with the
  form's title alone).
  `apps/host/src/lookup-addition.test.tsx`, the same way, around each
  renderer -- the Open beside each lookup the offer names is a
  `<button type="button">` in the place formancy gives a host beside the
  box, named and hinted by its first form's label, showing no words and one
  path in an `aria-hidden`, unfocusable `svg`, with no style attribute
  (watched failing in each with no `fieldBeside` given to the form, five
  cases); it is `aria-disabled` and not `disabled` while the field is
  empty, and the same button is available once it answers (watched failing
  in each with `disabled` in its place, two cases); a press while it is
  unavailable hands the page nothing (watched failing in each with the
  press handed on whatever the answer); the other forms' Opens are under
  the field only while it answers (watched failing in each with every Open
  drawn under it, the first twice, and with the addition not given to the
  form); nothing is beside a select no form is named for (watched failing
  in each with the place beside given to every field asked about); a press
  under the field hands the page its form, token and button (watched
  failing in each with the press handed nowhere); and Tab from the box
  lands on the Open beside, empty or answered, and a typeahead cleared and
  left with Tab keeps the keyboard on it as it becomes unavailable (watched
  failing in each with `disabled` in place of `aria-disabled`, the keyboard
  going on to the next field, and in React with the button drawn again as
  it empties).
  `apps/host/scripts/browser/beside.mjs`, the host gate's checks of the
  Open beside, run in Chromium on a page of its own with Blueprint's
  stylesheet and the row formancy 0.14.0 draws, not against the real plane:
  with `tabindex="-1"` planted on the button, Tab from the box went on to
  the next field; with the button 12 px square, axe's target size left it
  undecided, which the gate's own audit, counting violations, passes; with
  its glyph drawn #dddddd, it measured 1.36:1; and an unavailable button
  asked for as available was said to be unavailable.
  Not run here, CI their first run: `apps/host/src/open-lookup.test.tsx`,
  on both engines -- the journeys of 0141 press the Open beside by the name
  0141's first Open had, a button that shows no words, once it is
  available; an empty lookup draws it unavailable and offers nothing; and a
  level's parent field draws nothing beside it. And the host's browser
  gate (`apps/host/scripts/browser-test.mjs`, `browser/journey.mjs`), in
  each browser: in every state, every Open beside a box measured and passed
  by axe's target size and, while available, its glyph at 3:1 or more
  against what is behind it; each pass drawing one available and one
  unavailable; and Tab from the order's Customer, in each renderer, landing
  on its Open, unavailable on a new order and available on a loaded one.
  The gate would fail with `tabindex="-1"` on the button, as the page of
  its own did; it has not been watched doing so against the plane.

## Context

Under every lookup of an open record the host page drew one text button per
form the lookup's record opens in, "Open in Customers", through the field
addition, a line of the field's own under its error
([0141](0141-a-lookups-record-opens-below-the-record.md)). Each took a line,
and read as something of the form's rather than of that field's answer.
formancy 0.14.0, to which this repository moved its pins, gives a host a
place after a select's or a typeahead's box, on its line, which every theme
joins to the box as one field
([formancy.ai 0237](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0237-a-host-may-add-content-beside-a-fields-control.md)).
A lookup is one of the two. A host function for a path that gives content
for a while and none after draws the box again, and a person in it loses
the keyboard, so what a host draws there is given for as long as the field
is drawn.

## Decision

**The first of a lookup's Opens sits beside its box**, drawn by both
renderers through `fieldBeside`: the Open of the first form the server
names for the lookup (0140), which names them by id. It is a
`<button type="button">` showing a glyph -- an arrow leaving a box, one
path in an `svg` hidden from the accessibility tree -- and no words; its
`aria-label` and its `title` are the label 0141 gives that Open, so it is
"Open in Customers" to a screen reader, a test and a pointer's hint alike.
It comes right after the box in the keyboard's order. **While the field is
empty it is drawn all the same, unavailable**: `aria-disabled="true"`, never
the native `disabled`, and a press then opens nothing. So the box keeps its
width as an answer comes and goes, and a typeahead cleared and left with
Tab, which commits its empty answer as the keyboard lands on the button,
leaves the keyboard there. A press on it once the field answers does what
pressing 0141's first Open did.

**The other forms' Opens stay under the field**, in words, through the
field addition, only while the field answers a token, as 0141 drew them.
Nothing is beside a field no form is named for, nor beside a Drill down
level's parent field (`opensBelow`). `lookup-opens.ts` decides which Open
is beside and which are under (`besideOpen`, `underOpens`); the renderers
draw what it says. The page adds no rule to the paper: the theme dresses
the button and sizes and colours its glyph.

## Consequences

**What it buys.** A lookup whose record opens in one form, which is nearly
every one, takes no line of its own for its Open: it sits on the field's
line, joined to its box, sharing its frame and its height, and reads as
the answer's. The box is as wide with an answer as without, and the
keyboard reaches the Open in the same place either way.

**What it costs.**
- A lookup whose record opens in more than one form looks half new: its
  first form's Open beside the box, the others under the field in words.
  Which form is first is the server's order, by form id, not the person's
  choice or the form they use most.
- The button shows no words. Its name is said to assistive technology and
  shown on a pointer's hover as `title`; a sighted person on a keyboard or
  a touch screen sees only the glyph.
- Beside an empty lookup the button is drawn unavailable: a control a
  person cannot use until they pick an answer, one more Tab stop per
  lookup on the way through the form, and a press on it does nothing and
  says nothing on screen.
- The glyph's contrast is held by the host's browser gate in Blueprint
  alone, the theme the host page draws its paper in, from the computed
  colours; axe's contrast rule reads text, and the button has none. While
  unavailable its glyph is faint, as WCAG 1.4.11 allows an inactive
  control.
- Only a select or a typeahead draws the place beside (formancy.ai 0237).
  Every lookup the generator makes is one of the two, and the host page
  gives each its source; a host of its own that gives a lookup's select no
  source has a sentence drawn in the box's place, and no Open beside it.
- A host with a page of its own, which draws a lookup's Opens from the
  form's `opens` (0141), needs a formancy renderer of 0.14.0 or later to
  put one beside the box.

**What it does not do.** It changes neither which forms a lookup opens in
nor what each Open is called (0140, 0141), nor where an Open goes: one Drill
down level below. It draws no menu. The studio and the examples page draw
no Open and do not change.

## Alternatives considered

**Inside the box, at its end.** What was first asked for. A select's end is
its arrow and a typeahead's is where the person types and its list opens;
formancy.ai 0237 rejected a place there for that reason.

**One button beside the box per form.** Several glyphs alike, told apart
only by their names and hints, for the rare lookup of two forms; the
second and later ones would be found by name alone.

**One button opening a menu of the forms.** A popup part every theme would
dress and a menu's keyboard model, for a host that has one form per lookup
nearly always; formancy.ai 0237 rejected the menu for that reason too.

**Every Open under the field, as 0141 had them.** The line of its own, and
the weak tie to the field, that this record exists to end.

**The native `disabled` while the field is empty.** Tab would skip the
button, and a typeahead cleared and left with Tab would drop the keyboard
to the page as its blur empties the field under the button the keyboard
had just reached.

**No button while the field is empty**, as the Opens under the field do.
The box would change its width as an answer comes and goes, and content
beside a box that comes and goes draws the box again, taking the keyboard
from a person typing in it (formancy.ai 0237).

**Words on the button, "Open".** Wider than the room a theme keeps beside
the box (`--fm-beside-size`, 44 px in Blueprint), which the field's status
under the row ends short of, so a wider button leaves the status's end
showing beside an open list (formancy.ai 0237).
