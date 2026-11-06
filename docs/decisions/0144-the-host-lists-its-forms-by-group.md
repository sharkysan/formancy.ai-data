# 0144 — The host lists its forms by group, with a search and the forms linked to the open one

- **Status:** accepted; extends [0047](0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md): Forms holds Find a form, the forms under their groups and the forms linked to the open one; extends [0143](0143-a-form-is-listed-in-a-group.md): the host page draws the menu's groups
- **Date:** 2026-11-06
- **Deciders:** Daniel Bacher
- **Verified by:** `apps/host/src/form-list.test.ts` -- the groups are
  ordered as English words, a number by its value, "accounts", "Ärzte",
  "Region 2", "Region 10", "Sales" (watched failing with the headings in
  codepoint order: "Sales" came before "accounts"); two the words call
  equal, "Ärzte" composed and decomposed, by their codepoints (watched
  failing with no tie-break: the menu's order decided); the forms in no
  group under "Forms", after every group (watched failing with no group
  sorted among the groups: "Forms" came between "Finance" and "Sales"); a
  group spelled "Forms" with them (watched failing with it kept apart:
  two headings said "Forms"); the menu's order within a group (watched
  failing with the forms sorted by title); the headings drawn unless
  every form of the menu is in no group, whatever is typed (watched
  failing with that decided on the forms that match: a search for "note"
  dropped the heading); a match anywhere in a title, in any case
  (watched failing with a match from the title's start alone, and with
  the case kept); the id matched too (watched failing with the id
  unread: "STAFF" found nothing); the search read without the spaces
  around it (watched failing with them kept: " line" missed "Lineage");
  letters compared composed and their marks kept, "zurich" finding no
  "Zürich" (watched failing with the letters compared as typed, and with
  the marks folded away); every form while nothing is typed (watched
  failing with the spaces kept: three spaces matched nothing); a group
  with no match dropped, and the matches in the order they are drawn
  (watched failing with the group kept, and with the matches in the
  menu's order); the status silent while nothing is typed (watched
  failing with a count said for an empty box), "1 of 12 forms matches.
  Enter opens it." for one (watched failing with one said as many), and
  what was looked for when nothing matches (watched failing with the
  spaces around it quoted); the linked forms, those the open form's
  lookups open in (watched failing with `opens` unread) and those whose
  rows refer to its records (watched failing with the children unread),
  each once with every way it is linked (watched failing with one entry
  for each way), never the open form (watched failing with it kept),
  fields first and each at its first place (watched failing with the
  rows first), never one the menu does not name (watched failing with it
  kept under its id); and the ways said in words (watched failing with
  arrows for words). It needs no database, but every host file runs
  under the suite's `globalSetup`, which starts both: it was run and
  watched failing under a copy of `apps/host/vitest.config.ts` without
  it, which was not kept. `apps/host/src/forms-nav.test.tsx`, against
  the real server -- the clerk's forms under "Parity" and "Sales", each a
  list its heading names, and Tab from the list's heading to Find a form
  and then the first form (to be watched failing in CI with the headings
  left undrawn); the list narrowed as the person types and the status
  saying how many match (to be watched failing in CI with the list drawn
  from every form whatever was typed); Enter opening the one form that
  matches, with the keyboard on its heading and its link marked, and
  nothing while three do (to be watched failing in CI with Enter opening
  the first form that matches, however many do); Escape emptying the box
  and keeping the keyboard in it (to be watched failing in CI with Escape
  in the box unhandled); Down from the box along the list and Up back to
  it (to be watched failing in CI with Down and Up on a form unhandled);
  a search that finds nothing saying so, and Clear the search emptying
  the box with the keyboard in it (to be watched failing in CI with Clear
  the search left undrawn); the floor -- axe and a name on every control
  -- while searching, finding nothing, and with linked forms (to be
  watched failing in CI with the linked forms' items drawn without their
  list); and, on both engines, an order line's lookup naming both forms
  over the orders "from its fields", one of them opening as the list
  opens it (to be watched failing in CI with the definition's `opens`
  left unread by the workspace), an employee naming the staff's orders
  once as "its child rows" and not itself (to be watched failing in CI
  with the menu's children left unread by the workspace), and Enter over
  unsaved work asking first, Keep editing giving the keyboard back to the
  box (to be watched failing in CI with the matching form's link handed
  to the guard in place of the box) -- ten breaks chosen so that each
  fails its own case and no other. Every other host suite finds a form's
  link as before, by its title and id, which a linked form's name does
  not end in (`formLink` in `test-host.tsx`); the browser gate's
  `allowance.mjs`, `demo.mjs`, `drilling.mjs`, `more.mjs` and
  `workspace.mjs` name a form's link exactly, since a linked form's name
  starts with the same words (not watched failing: matching the whole
  name is what they now do). The gate measures the page, the list
  included, in Chromium, Firefox and WebKit in every state it reaches --
  reflow down to 320 pixels, target size, contrast, and no rule of
  `styles/workspace.css` or `styles/narrow.css` reaching the paper -- with
  the linked forms of whichever form is open; it was not run for this
  record outside CI, and none of its checks was watched failing on the
  list.

## Context

Since [0047](0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md)
the host page's Forms is one list of the forms a person may read, in the
order of their ids, which the menu names
([0045](0045-the-runtime-plane-lists-the-forms-a-person-may-read-and-nothing-about-the-others.md)).
A list of forty is read from the top. The design of finding records gives
the page a list of tables on the left: a search box over the titles, the
forms grouped, and the forms linked to the one open. Its goals are that it
is easy and fun and keyboard first.

The data is there. Each form in the menu names its group, its schema's
name in words unless its presentation names another or none
([0143](0143-a-form-is-listed-in-a-group.md)), and the children whose rows
refer to its records (0045); an open form's definition names the forms
each lookup's record opens in
([0140](0140-a-form-names-the-forms-each-lookups-record-opens-in.md)).
Nothing on the page shows the groups, and the forms an order's fields lead
to, or whose rows lead back to it, are reached only from a record. The
fixture publishes every form on both engines, so every title a test sees
is two forms, told apart by their ids alone.

## Decision

**Forms holds, in order, Find a form, the forms under their groups, the
forms linked to the one open, and Sign out** (`apps/host/src/forms-nav.tsx`,
which draws what `apps/host/src/form-list.ts` decides).

**Each group is a heading and the list it names**, in the order of the
headings as English words, the page's language -- the alphabet's order
whatever the case, a letter with a mark beside the letter, a number by
its value -- and two the words call equal by their codepoints. The forms
in no group are under "Forms", after every group, and so is a group an
administrator spells "Forms", so the list never draws two headings that
say the same. Within a group the forms keep the menu's order. Where no
form of the menu is in a group, as where every table is in the engine's
own default schema (0143), no heading is drawn: "Forms" under the list's
own "Forms" would say it twice. That is decided on the whole menu, so a
search never draws or drops a heading.

**Find a form narrows the groups as the person types**: a form whose
title or id holds what is typed, anywhere, in any case, without the
spaces around it; nothing typed lists every form. The id, because the list
draws it and it alone tells two forms of one title apart. Letters are
compared composed, as typed with a combining mark or not, and keep their
marks: the codebase has no fold of marks, and this adds none. A polite
status under the box says nothing while it is empty, "2 of 10 forms
match." while there is a search, "1 of 10 forms matches. Enter opens it."
for one, and "No form’s title or id holds “zzz”." for none, with Clear the
search, which empties the box and leaves the keyboard in it. The search
narrows the groups, not the linked forms, and stays as typed after a form
is chosen until the person empties it.

**Keyboard first.** Tab from the list's heading, where arrival puts the
keyboard, goes to the box and then into the list. In the box, Enter opens
the one form that matches as a click on it would -- through the
unsaved-changes guard, whose Keep editing gives the keyboard back to the
box -- and does nothing while several or none match; Escape empties a box
that holds something and keeps the keyboard there, and in an empty box is
the page's; Down moves to the first form listed. On a form, Down and Up
move to the next and the one before, through the groups and the linked
forms, and Up from the first goes back to the box. There is no shortcut
from elsewhere on the page: `/` is the filter line's
([0131](0131-a-person-types-a-grids-filter-as-a-line-and-sees-each-condition-as-a-chip.md)).

**"Linked to" the open form's title follows the groups** once its
definition has answered: the forms its lookups open in, as its definition
names them, then the children the menu names for it, each once at its
first place with every way it is linked. The open form itself is left
out -- a form that is its own child, or whose lookup opens in it, links
to where the person is -- and so is one the menu does not name. Each link
is named by the form's title, its id and how it is linked, in words from
the open form's side: "Order pg-order from its fields", "Order line
pg-order-line its child rows", or "from its fields and its child rows".
An arrow, → ← or ↔, is drawn beside the words and hidden from the
accessibility tree, which would read it as "rightwards arrow" or not at
all.

**Every link opens its form as before**: it carries the form's fragment,
a press goes through the guard and puts the keyboard on the form's
heading, and the open form's own link, in its group, is marked
`aria-current`. On a window narrower than 80rem the list is the band of
tabs it was, now holding the box and each group's heading before its
tabs; on a phone a link draws its title and a linked form's arrow, its id
and its words kept in its name, which still starts with what is drawn
(WCAG 2.5.3). It is host chrome in `styles/workspace.css` and
`styles/narrow.css`, in the room's variables; no rule of it selects inside
a paper or a grid.

## Consequences

**What it buys.** A long menu is a few headings; a form is a few letters
and Enter away, and the next one along an order's fields or back from its
rows is one press, without opening a record first; a database whose
tables are all in one schema looks as before, with a box above it.

**What it costs.**
- Marks are kept: "zurich" finds no "Zürich", and a person types the
  letter with its mark.
- The id is matched too: "pg" or "order" lists forms whose titles do not
  hold it.
- The search narrows the groups alone, so a form can be listed twice,
  in its group and as linked, two links to one place told apart by the
  words; and it stays as typed after a form is chosen, so the person
  comes back to a narrowed list until they empty it. A reload or a sign
  out forgets it.
- The headings are ordered as English words whatever the reader's
  language, and a group an administrator spells "Forms" is listed last,
  with the forms in no group, rather than in its place.
- Where a menu has groups and forms in none, those are under a heading
  "Forms" inside the list named Forms, which a screen reader hears twice.
- The linked forms appear once the open form's definition has answered,
  and not while it is asked for or after it was refused; a form that is
  its own child is never said to be linked to itself there, which only
  its record's tabs say (0142).
- Down and Up move along the list, but Home, End and a letter do not,
  and Down on the last form stays there.
- On a window narrower than 80rem the box and each group's heading take
  room in the band above the form, which wraps onto more rows for a long
  menu, so main starts lower than it did.
- The list is the host page's: a host with a page of its own draws its
  own from the menu and a definition's `opens`.

**What it forecloses.** Nothing: the order of the groups, what a search
matches and what the linked forms are are one pure module's, which a later
decision can change without changing the page.

## Alternatives considered

**A search over the titles alone**, as the design had it. Two forms of one
title, an order form and the staff's, could never be told apart by
typing, and Enter could never open one of them.

**Marks folded away**, "zurich" finding "Zürich": the codebase has no
such fold to reuse, and one written for this list -- the letters
decomposed and their marks dropped -- would also fold letters a language
holds apart, the German ä and a, which a later decision can weigh with the
reader's language.

**The search narrowing the linked forms too.** A form found by typing and
opened with Enter would have its linked forms narrowed to the same
letters, when those are what a person looks at next.

**The search emptied once a form is chosen**, as a palette empties.
Clicking from a narrowed list would throw away what was typed; Escape
empties it in one key.

**Codepoint order**, as the menu orders ids: every capital before every
small letter, "Sales" before "accounts", and "Ärzte" after "Zoll".

**The reader's own language's order.** Two people would see one menu in
two orders, and the page is in English.

**A combobox over a listbox**, the arrows moving an active descendant.
The forms would no longer be links: no fragment to open in a new tab, and
a second pattern for what was a list of links.

**Arrows alone for the way a form is linked**, or the arrows in the
name: read out as "rightwards arrow", or not at all.

**Two linked lists, "From its fields" and "Its child rows"**: a form
linked both ways would be listed twice under one heading's form.

**A shortcut to the box**: `/` already puts the keyboard on the filter
line, and any other letter is one a person types into a grid's boxes.

**The "Forms" heading always drawn**: where no form is in a group, the
list would say "Forms" twice over every form.
