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
  kept under its id); and the ways said in words that name the open form
  (watched failing with them unnamed: "from its fields").
  `apps/host/src/forms-nav-alone.test.tsx`, the list in jsdom without a
  server -- Enter, Esc and Down left to an input method while it
  composes, and to the key 229 Safari reports after it (watched failing
  with the composition unread: Enter opened Order line; and with 229
  unread); Down with Shift, Ctrl, Meta or Alt left to the box (watched
  failing with the modifiers unread) and Down and Up with one left to the
  browser on a form (watched failing with the modifiers unread on the
  list); each linked form's arrow, read off the DOM since it is hidden
  from the tree, by which end of its shaft each head points to (watched
  failing with the heads of fields and rows swapped); the keyboard on a linked link taken away moved to the same
  form's link in its group, or to the box where a search left that out
  (watched failing with the keyboard left where the link was, and with no
  fallback); and left where the person moved it (watched failing with the
  link that had the keyboard never forgotten). Neither file needs a
  database, but every host file runs under the suite's `globalSetup`,
  which starts both: they were run and watched failing under a copy of
  `apps/host/vitest.config.ts` without it, which was not kept.
  `apps/host/src/forms-nav.test.tsx`, against the real server -- the
  clerk's forms under "Parity" and "Sales", each a list its heading
  names, and Tab from the list's heading to Find a form and then the
  first form (to be watched failing in CI with the headings undrawn, the
  groups kept); the list narrowed as the person types and the status
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
  list); the search kept as typed after a form is chosen from it (to be
  watched failing in CI with the box emptied whenever the open form
  changes); the linked forms left whole while it narrows the groups (to
  be watched failing in CI with the linked forms narrowed by the search
  too); Escape in an empty box heard by the document, not prevented (to
  be watched failing in CI with Escape always taken by the box); and, on
  both engines, an order line's lookup naming both forms over the orders
  "where Order line’s fields lead", one of them opening as the list opens
  it (to be watched failing in CI with every linked form's link opening
  the first linked form), an employee naming the staff's orders once as
  "rows that refer to Employee" and not itself (to be watched failing in
  CI with only the first child the menu names read for the linked forms,
  the employee form's own) -- the definition's `opens` and the children
  left unread would each leave the keyboard case no linked form to start
  from --, Enter over
  unsaved work asking first, Keep editing giving the keyboard back to the
  box (to be watched failing in CI with the matching form's link handed
  to the guard in place of the box), and a linked form chosen keeping the
  keyboard on its link in its group while it is asked for, then on its
  heading, and Back from a linked form's link the same (to be watched
  failing in CI with the keyboard left where the link was; first run in
  CI on 6b534f1, the case expected the keyboard to stay on the link after
  Back, which opens a form onto its heading as a choice does, and was
  put right) -- fourteen
  breaks chosen so that each fails its own case and no other. Every other host suite finds a form's
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
  record outside CI. Its check that axe decides the contrast of every
  text failed in all three browsers in every state that drew a linked
  form while the arrows were characters, → and ←, which axe cannot
  measure; drawn as an SVG they are no text, and that check was not
  watched failing on the list otherwise.

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
which puts together `find-form.tsx`, `form-groups.tsx` and
`linked-forms.tsx`, each drawing what `apps/host/src/form-list.ts`
decides, every link through `form-link.tsx`).

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
neither taken nor stopped, but left to the page; Down moves to the first
form listed. On a form, Down and Up move to the next and the one before,
through the groups and the linked forms, and Up from the first goes back
to the box. While an input method composes a word, every key in the box
is its own, as in the filter line: Enter takes the word and Esc ends the
composition. With Shift, Ctrl, Meta or Alt held, Down and Up are the
box's, the browser's or the screen reader's. There is no shortcut
from elsewhere on the page: `/` is the filter line's
([0131](0131-a-person-types-a-grids-filter-as-a-line-and-sees-each-condition-as-a-chip.md)).

**"Linked to" the open form's title follows the groups** once its
definition has answered: the forms its lookups open in, as its definition
names them, then the children the menu names for it, each once at its
first place with every way it is linked. The open form itself is left
out -- a form that is its own child, or whose lookup opens in it, links
to where the person is -- and so is one the menu does not name. Each link
is named by the form's title, its id and how it is linked, in words that
name the open form and say which way the link runs, since a screen
reader's list of links reads a link without the heading over it:
"Customer pg-customer where Order’s fields lead", "Order line
pg-order-line rows that refer to Order", or "where Order’s fields lead,
and rows that refer to Order". An arrow is drawn beside the words, its
head at the linked form's end for where the open form's fields lead, at
the open form's end for rows that refer to it, at both for both: an SVG
hidden from the accessibility tree, as the page draws every symbol, not
a character that a screen reader reads out as "rightwards arrow" and axe
cannot measure. It is drawn in `--muted`, #95a0b4, which against the
room's ground, #080a12, is 7.5:1, past the 3:1 a symbol needs: worked out
on 2026-11-06 from the `room.css` of the `@formancy/themes` this
repository pins, with WCAG's formula for relative luminance.

**The keyboard is kept when the linked forms are drawn without its
link.** While a linked form chosen is asked for -- or another form opened
by Back or Forward -- no linked form is drawn, and the link the keyboard
was on is gone, which would leave the keyboard on the page itself, where
a screen reader says nothing of where it is. Once a commit has taken that
link away, the keyboard goes to the same form's link in its group, or,
where a search left that out, to the box; when the form answers, its
heading takes the keyboard, as it does for every form opened by a choice,
Back or Forward (0047), and where the person keeps their unsaved work
instead, the keyboard stays on that link. Which link has the keyboard is heard from the
document's `focusin`, which every move of the keyboard to an element
fires and a link taken out of the document does not.

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
- A linked form's name says the open form's title with ’s whatever it
  ends in: "where Orders’s fields lead".
- A keyboard that left a linked link for nothing, a press on the page's
  background, is still that link's: once the link is gone, the keyboard
  is put on the same form's link in its group.
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

**Two linked lists, one for where its fields lead and one for rows that
refer to it**: a form linked both ways would be listed twice under one
heading's form.

**Words from the open form's side, "from its fields", "its child rows"**,
as the list first had them: heard in a screen reader's list of links
without the heading over them, they said neither whose fields nor which
way the link runs.

**The linked forms kept drawn while the form chosen is asked for**: the
link chosen would stay, but the list would name the forms linked to a
form no longer open, and the next form's linked forms would still take
away the link the keyboard was on once it answered.

**A shortcut to the box**: `/` already puts the keyboard on the filter
line, and any other letter is one a person types into a grid's boxes.

**The "Forms" heading always drawn**: where no form is in a group, the
list would say "Forms" twice over every form.
