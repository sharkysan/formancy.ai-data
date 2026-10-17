# 0080 — A host downloads the records its grid lists, and the browser saves the server's file

- **Status:** accepted
- **Date:** 2026-10-17
- **Deciders:** Daniel Bacher
- **Verified by:**
  `apps/host/src/export.test.tsx`, on both engines against the real
  server -- one press of Download CSV sends one request with the search the
  grid lists and the grid's sort, and the file handed to the browser is the
  server's, byte for byte, under `<form id>.csv`, its header the grid's
  headers with each lookup's key column after it (watched failing with the
  search box's text sent: `"search": "<stamp> typed"`; with the sort left
  out: `"sort": []`; and with Notes left out of the grid's columns: the
  file's header held a Notes the grid did not); while the file is made the
  button is `aria-disabled` and not `disabled`, described by its line,
  "Making pg-order.csv.", the keyboard on it, and Enter, Space and a click
  send nothing more (watched failing with the press unguarded: four
  requests for one file; and with `disabled` for `aria-disabled`: no
  `aria-disabled` at all); a refusal is the server's sentence on the line,
  nothing saved, and pressing again makes the file (watched failing with
  the refusal's code shown for its sentence: `unavailable`); choosing
  another form, or signing out, while a file is made aborts its request,
  says nothing and saves nothing (watched failing with nothing aborted when
  the section leaves: the signal still live); a child section's file sends
  its parent and no search, is that parent's rows, and keeps the parent's
  column the grid leaves out (watched failing with the parent left out:
  `"parent": null`; and with the grid's columns in reverse: the header no
  longer the grid's); and the button is offered in the Records panel and in
  a child section under a saved parent, not under a new one, and nowhere
  once a version hides the form's key from the person so its `list` is
  `null` (watched failing with the button drawn whatever `list` says).
  `apps/host/src/save-file.test.ts` -- the anchor is in the document when
  it is clicked, carries the object URL and the file's name, is gone after,
  and the URL is revoked in a later task (watched failing with the anchor
  left out of the document: no click reached it; and with the URL revoked
  at once: revoked before the click's task ended).
  `apps/host/src/page.test.tsx`, on both engines -- axe at WCAG 2.2 AA and
  a name on every control with a file in the making, made, refused, and a
  line's file made (watched failing with the button's words swapped for an
  ellipsis while the file is made: `button-name`, and the button unnamed).
  `apps/host/src/plane.test.tsx`, on both engines and through the live
  demo's path -- the journey downloads once, and sends every route of
  `ROUTE_OPERATIONS`, the export's among them, each with the token in the
  Authorization header and nowhere else (watched failing with 0079's
  exception removed and no press: `[ "export" ]` unused).
  `apps/host/scripts/browser/exporting.mjs`, run by
  `apps/host/scripts/browser-test.mjs` at every width down to 320 px -- a
  file in the making is `aria-disabled` with the keyboard on it and a second
  press sends nothing; Playwright's download event gives the Records' file
  and an order's lines' file as `<form id>.csv`, its bytes starting with the
  byte-order mark and equal to what the server answers for the body the
  page sent, with no `<a download>` left in the document; a refusal is the
  server's sentence; and each state passes axe's colour-contrast and
  target-size rules with nothing past either edge. Run in Chromium
  153.0.8010.12 and Firefox 155.0 on Windows 11 on 2026-10-17, every check
  of the gate passing in each; WebKit runs
  on Linux only, so its leg is CI's (watched failing in Chromium with the
  page saving `new Blob([await file.text()])`, which takes the byte-order
  mark off: "its bytes start with the byte-order mark" and "every byte the
  server's").
  **Not mechanically enforced:** that the browser kept the file -- a
  browser that asks where to save it, or a person who cancels, is heard by
  nothing -- and that Safari, or any browser on a phone, saves it.

## Context

A person may download one CSV file of the records a list would show them
(0079), and `@formancy/data-client`'s `exportRecords` resolves to the
file's bytes as a `Blob` and its name, `<form id>.csv`, taken from the
form's id because a page on another origin cannot read
`content-disposition` (0060). The host page lists a form's records in the
Records panel and a record's child rows in a section each (0047), and had
no way to ask for the file: 0079 left the button to this record, and
`plane.test.tsx` named the export as the one route of `ROUTE_OPERATIONS`
the page could not send yet.

The token is in the Authorization header and nowhere else (0029), so the
browser cannot be sent to the route by a link: the page must fetch the
file and give the browser its bytes. New record is the section's one
primary action (UX-SPEC §5.8), and a busy button is `aria-disabled`,
never `disabled`, which drops the keyboard (0029). In the grids, a sort is
AG Grid's until its datasource asks for a page with it, and the search is
what was submitted, never what the box holds (0047).

What a browser needs to save an object URL's bytes through an anchor was
read nowhere. On 2026-10-17, on Windows 11, in Playwright's Chromium
153.0.8010.12 and Firefox 155.0, a probe saved a 20,000-line file ten
times in ten through each of four ways -- the anchor in the document or
not, the URL revoked in the click's task or the next -- whole every time.
Playwright's WebKit runs on Linux only (0058) and was not probed.

## Decision

**A Download CSV button in the head of the Records panel and of each child
section saves, through the browser, the server's one file of the records
that grid lists -- the search as submitted, the grid's sort and, in a
child section, its parent -- and says on a line under it what is
happening.**

- **Where.** In the section's head, after New record, where the
  definition says the records can be listed:
  `definition.list !== null`, the one condition the server's `listable`
  answers (0079). A child section under a new parent has none: it has no
  rows to give. A plain `button`, the room's secondary look, never
  `primary`: New record stays the section's one primary action.
- **What it sends.** When pressed, `exportRecords(formId, { search, sort,
  parent }, signal)`: the Records panel's submitted search, never the
  box's text, or none in a child section; the grid's sort as its datasource
  last asked for a page -- `RecordGrid`'s handle gives it, `sort()` -- so
  the file is in the order the grid shows; and a child section's parent,
  whose column the file keeps where the grid leaves it out, so the file
  says whose rows they are. Nothing else travels.
- **What it says.** A status line, named by the button and describing it,
  on a row of its own under the head, its words under the button, and out
  of the flow -- still in the tree, so the live region is there before it
  speaks -- while it has nothing to say: "Making pg-order.csv."
  while the file is made, muted; "Made pg-order.csv; your browser saves
  it." once it is handed over, in the server's teal; a refusal in the
  server's own sentence in `--warn`. The name is `exportFileName`, which
  `@formancy/data-client` now re-exports so the line can say it before the
  file arrives.
- **While it is made** the button is `aria-disabled`, keeps the keyboard,
  and a press of any kind sends nothing. Pressing it after a refusal is the
  retry. The section leaving the page -- another form, signing out, a child
  section mounted again for another parent -- aborts the request and says
  nothing; an answer that arrives after it is never saved.
- **How it is saved** (`apps/host/src/save-file.ts`): an object URL of the
  `Blob`, an `<a download>` with the client's name put in the document,
  clicked and taken out, and the URL revoked in the task after: of the four
  ways the probe found whole in Chromium and Firefox, the one that needs
  least of a browser -- the anchor where a click on it is a click in the
  document, the URL outliving the click's task -- because WebKit was not
  probed. The browser gate holds it in every browser, WebKit on CI's leg. So
  no browser does anything another does not, and no row of `FACTS` names a
  difference. The page is mounted with another `save` where it has no
  object URLs: the suites, in jsdom.

## Consequences

**What it buys.** A person takes the rows a grid lists into a file in one
press, from where the grid is, in its order and under its search and
parent, and the file is the server's, whole, byte for byte. The host page
now sends every runtime route, which `plane.test.tsx` holds without
exception.

**What it costs.**

- **Leaving loses the file in the making.** Another form, signing out or
  another parent drops it, and nothing says so; the person presses again.
  The server stops before its next page once the request is gone (0079).
- **"Made … your browser saves it" is the page's side only.** The page has
  handed the bytes over; a browser that asks where to save, a person who
  cancels, a download blocked by the browser's settings, is heard by
  nothing.
- **No count of records.** The line names the file and not what it holds:
  a count would mean parsing the file in the page, or a header a page on
  another origin cannot read (0060).
- **The whole file in the page's memory.** The `Blob`, up to
  `EXPORT_MAX_BYTES`, is held by the page until it has the whole of it,
  and by its object URL until the task after the click; what the browser
  holds while it saves is the browser's.
- **Nothing for a page on another origin but the bytes and the id's name.**
  A host application elsewhere calls `exportRecords` itself and gets
  exactly what this page gets, and draws its own button; this page's is
  this repository's only one.
- **The grid moves down a line the first time the line speaks**, and
  stays there while the section is open; the buttons do not move.
- **The section's first status is no longer its grid's.** The line sits
  before the grid's own in the section, named by its button; the suites
  and the browser gates now find the grid's line as the section's first
  status with no name.
- **WebKit's save is CI's to see.** The way chosen was measured in
  Chromium and Firefox on Windows; Playwright's WebKit, which is not Safari,
  runs on Linux only, so a pull request built on Windows learns of a
  WebKit that needs another way from its WebKit leg.

**What it does not do.** No Stop button -- leaving stops it -- no choice of
columns or format, no file of every child section at once, no progress,
and no button on the studio or the examples page.

**What it forecloses.** Nothing that cannot be undone.

## Alternatives considered

**A link to the route, `<a href="/v1/forms/…/records/export" download>`.**
The browser would save the file itself, streamed, with none of it in the
page -- and without the token, which is in the Authorization header alone
(0029). Putting it in the URL puts it in every proxy's log; a cookie is a
session this module does not have. And the route is a POST, so the search
is in no URL (0044).

**A primary button, or one in the grid's toolbar.** New record is the
section's one primary action (UX-SPEC §5.8); and the toolbar is the
grid's -- its search, its line, its pages -- where a file of every page
would read as a page's.

**Saving through the File System Access API (`showSaveFilePicker`).**
Chromium alone of the three browsers the gates run, and a picker the
person must answer before anything is saved.

**A data URL, or `window.open` of the object URL.** A data URL is the file
again, a third larger, in a string; a new window is a popup a browser may
block, and shows a CSV rather than saving it.

**The line in the room between the heading and the buttons.** Built first:
given a width of its own it wrapped the head even while empty, and in Side
by side, where the Records panel shrinks its grid to fit, the wrapped head
kept only its minimum height, so the search drew over New record -- the
browser gate's axe found New record partly covered at 897, 1281 and 1440 px, in
Chromium and Firefox, and its text and the search's contrast undecided.
Given none, a sentence longer than the room would run over the buttons.
The head now keeps its height wherever it wraps (`flex: none`), and the
line is a row of its own; nor is a band reserved for it, which would be an
empty row under every section's heading in every state it has nothing to
say.

**A Stop button.** Leaving stops it; a second control for what one press
asked would be one more stop for the keyboard in every section.

**The file kept when the person leaves.** It would arrive in a form they
have left, or after they signed out; held by the workspace, it would be
work the guard asks about before every way of leaving (0047), for a file
the server makes again in one press.

## Older records

Extends [0079](0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md):
the host page's Records panel and each child section download the file,
and `plane.test.tsx`'s exception for the export is gone, as 0050's for the
delete route went with 0053; `@formancy/data-client` re-exports
`exportFileName`. Extends
[0047](0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md):
a section's head holds Download CSV beside New, `RecordGrid`'s handle gives
the sort its datasource last asked with, and the section's grid line is its
first status with no name. Within
[0029](0029-a-host-renders-a-published-form-through-one-client.md)'s rule,
unchanged: the file comes through the one client, the token in its header,
and a busy button is `aria-disabled`. Within
[0058](0058-the-browser-gates-run-in-chromium-firefox-and-webkit-and-each-fact-the-browsers-disagree-on-is-named-and-held.md)'s
rule: the save is held in every browser under one name per check, and no
browser needed a fact of its own.
