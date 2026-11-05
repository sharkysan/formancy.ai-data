# 0131 — A person types a grid's filter as a line, and sees each condition as a chip

- **Status:** accepted; extends [0104](0104-a-list-and-a-browse-are-filtered-by-conditions-on-their-columns.md): the panel stays, as Build a condition, and the conditions it listed are chips; extended by [0132](0132-each-column-header-filters-its-column.md): a box under each column's header is the line's condition on that column
- **Date:** 2026-11-05
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/records/filter-line.test.ts` --
  a field is named by its label as a person types it, letters of any
  script kept, and by its key where the label would say another field
  too (watched failing with ASCII letters alone kept: "Größe (cm)" was
  `gr_e_cm`); each condition is read into the term the panel sends, a
  lower and an upper comparison on one field one range, a quoted value
  one value whatever it holds, words and names in any case, a state by
  its label and a boolean by yes or no; each refusal marks the characters
  it is about and says what would be read, a label typed another way by
  its name in the line (watched failing with the list of every field
  instead) and a number typed with separators as the number it is read
  as; every term a list request carries is written to a line that reads
  back to it, and a term on a field the line does not offer is left out.
  `packages/data-core/src/records/filter-complete.test.ts` -- what may
  come next at the caret: a field by its name or its label, its operators
  in the chips' words, its states or yes and no, `and` after a condition,
  nothing inside a quote, the whole word under the caret replaced. Both
  were written first and run against no module.
  `apps/host/src/grid-filter.test.tsx`, without a server -- Enter sends
  what the line reads after a condition on a field it does not offer,
  which it keeps (watched failing with that condition dropped); a line it
  cannot read sends nothing and keeps every character and the caret, so a
  line not finished yet is typed on (watched failing with the marked
  characters selected: "amount >" became "amount  5"); an edit left
  unapplied is dropped when the filter changes elsewhere, and said while
  it is pending (watched failing with the line and the chips saying two
  filters); Enter and Esc are an input method's while it composes
  (watched failing with half a word applied); completion is moved through
  and taken by the keyboard, and points at no option once the caret moves
  (watched failing with `aria-activedescendant` naming one gone); a chip
  removed, Clear filter or the line cleared is put back by Undo, which is
  forgotten once the filter changes otherwise (watched failing with Undo
  never offered, and again with it offered back); a list nothing matches
  offers to try it without the last condition; the builder offers only
  the fields offered (0123). `packages/data-core/src/records/filter-line.test.ts`
  also holds a letter with its marks one letter, and a label typed with
  its space told its name (each watched failing).
  `apps/host/src/filter-line.test.tsx`, on both engines against the real
  server -- the same in a page: the terms in the list's body and in no
  URL, a refusal of the server's said on the grid's line with the line
  kept, no way out offered where a search matched nothing, `/` and Esc,
  and axe and a name on every control in each state.
  `apps/host/scripts/browser/filtering.mjs`, in Chromium, Firefox and
  WebKit -- the completion open over the grid, a line applied and a chip
  removed, each measured for contrast, target size and no sideways scroll
  down to 320 px. `scripts/install-fixture/consume.ts` -- the reader,
  the writer and completion resolve from `@formancy/data-client`'s
  tarball with the types that shipped.

## Context

The user, 2026-11-04: "i still miss an intuitve filter an table slectiojn
concpet", "i expceted a filter for the colimns … and some dort of filter
language", and "make it easy to use, I want the users to have fun with
the product". 0104's panel asks four choices for one condition -- a
field, an operator, a value, Apply -- behind a disclosure, and lists what
it applied as sentences with a Remove each. It is precise and slow: a
person who knows they want the placed orders over 1000 has nowhere to
say so.

## Decision

**A filter line, read in the browser.** `status = placed and amount >
1000`: a condition is a field's name, an operator and a value -- `=`,
`>`, `>=`, `<`, `<=` or `contains` -- or a name and `is empty` or `is not
empty`, and conditions are joined by `and`. A comparison bounds a range,
`>` and `<` leaving their own value out (0130), and a lower and an upper
comparison on one field are one range, since a field is named once in a
filter. A value is a word, or `"quoted"` with `\"` and `\\`. A field is
named by its label as a person sees it, lower-cased with `_` for what is
not a letter or a digit (`order_date`, `größe_cm`), and by its key where
that would be another field's name or key too; the key is read as well.
`packages/data-core/src/records/filter-line.ts` reads a line into the
terms a list request carries and writes terms back as one, and
`filter-complete.ts` says what may come next at the caret; data-client
re-exports both. The server receives the terms, as the panel sends them,
and never the line (0011, 0104), so the line can say nothing the panel
could not.

**The host page draws the line above each grid.** An ARIA 1.2 combobox
named Filter: completion is a listbox under it, Enter applies what the
line reads, and a line it cannot read keeps every character and the
caret, marks the ones it is about and says why, sending nothing. Enter
and Esc are an input method's while it composes. While the person is not
in it, the line shows the filter applied, however it was applied: an edit
left unapplied there is dropped when the filter changes elsewhere, and
said as not applied yet while it is pending. A
condition on a field the line does not offer -- one an administrator left
out of the panel (0123), set by a view -- is not in the line, and
applying the line keeps it. `/` outside a text box puts the keyboard on
the Records grid's line, Esc closes its completion, and a second Esc puts
back what is applied and gives the keyboard to the grid.

**Each condition is a chip.** Its words are the panel's sentence --
"Amount is over 1000" -- and its Remove is named for them. A removal,
Clear filter or the line cleared offers Undo until the filter changes some
other way, never on a timer (WCAG 2.2.1). A list nothing matches offers to
try it without its last condition, except where a search matched nothing,
whose way out is Clear search.

**The host's gate shows an empty box its pane cuts whole.** Axe says
"Element has no value" of an empty box whose contrast failed, and it fails
one the edge of its scrolling pane cuts, for want of the background the
pane hid; the gate shows it whole in that pane and asks axe again, as it
already did a text axe called partially obscured, and fails it otherwise
(`apps/host/scripts/browser/measure.mjs`'s `decide`). Seen with the
search box at the Records panel's top, once the line made the panel
taller. The panel stays, as Build a condition, until each
column's header filters its column.

A person's view's name box offers the conditions in words, in the room's
muted ink, while it is empty, and Save keeps the view under them; a name typed replaces them
(`apps/host/src/view-save.test.tsx`, watched failing with the words as
the box's value, which a typed name was appended to).

## Consequences

**What it buys.** A condition is one line, typed in the order it is
thought; the page teaches the line as it is typed, and nothing a person
removes is lost to a slip.

**What it costs.**
- A grammar to keep in step with `filterOffer`: an operator the server
  comes to offer is the panel's alone until the reader learns to write
  it.
- A field's name in the line is its label, so a field relabelled in the
  studio is typed by its new name; a view stores keys, so no view breaks.
- The line's words -- `and`, `contains`, `is empty` -- are English, and
  there is no `or`, no `not` and no parenthesis.
- Undo puts back one removal. A list nothing matches offers to drop the
  last condition, which need not be the one that empties it: finding that
  one would cost a request per condition.
- A number is typed with a point and no separators, and a date as
  `YYYY-MM-DD`; the line says so rather than reading `1'000`.

**What it forecloses.** Nothing on the server: what reaches it is what
the panel sent.

## Alternatives considered

**A query language the server reads.** Text from the browser that the
server parses into conditions is the outsider's text 0011 keeps from
the server's statements, and a second reader of conditions beside
`readFilter` that would have to agree with it.

**Labels with their spaces, as names.** `Order date >= 2026-10-01` cannot
be told from a field named `Order` and the word `date` without quoting
every name.

**Keys alone.** `employee_2` is what the order form calls its approver;
no person sees that word.

**A parser generator.** A dependency in a browser package for a grammar
of a handful of rules, whose offsets a hand-written reader keeps anyway.
