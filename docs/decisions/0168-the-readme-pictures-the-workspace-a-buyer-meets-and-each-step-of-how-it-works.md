# 0168 — The README pictures the workspace a buyer meets, and each step of How it works; the exact digits move to the host page's guide

- **Status:** accepted; extends
  [0038](0038-readme-pictures-are-taken-by-a-script-and-held-to-the-text-they-show.md):
  a scene may be placed under a step of the README's *How it works*, the
  host page's walk inserts invented rows through the owner's connection
  and publishes a list view and the deliveries' form, and the camera's
  bench stops short of what a pseudo-element draws; extends
  [0154](0154-the-readme-speaks-to-a-buyer-first-and-the-detail-lives-in-the-guide.md):
  README.md holds a generated region under each step of *How it works*;
  narrows
  [0047](0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md):
  its cost that the README's pictures show no child grid holds for order
  lines alone, since the hero shows an order's deliveries; extended by
  [0169](0169-the-guides-pages-picture-drill-down-a-persons-own-view-columns-and-a-starting-value-and-the-camera-waits-two-frames-between-shots.md):
  the guide's scenes walk over its invented orders, between the
  workspace's acts and host-delete's
- **Date:** 2026-11-20
- **Deciders:** Daniel Bacher
- **Verified by:** `scripts/pictures/readme.test.mjs`, in `pnpm test:repo`,
  which the `verify` job of `.github/workflows/gates.yml` runs on every
  pull request and before every release; each case below was watched
  failing on 2026-11-20 with its rule taken out of
  `scripts/pictures/readme.mjs`, the file put back and its checksum
  compared after:
  - *picture every step of How it works, one each, under its item, as its
    list names them* -- the repository's own README.md and scenes.json, by
    `stepProblems`;
  - *renders each step in a region of its own on README.md, at 0.7 of its
    size, linked to itself, and in no other region* -- watched failing
    with every step drawn at its recorded width (the small repository's
    842 drawn at 842, not 589), and with `regionOf` left without `step`
    ("README.md must hold the pictures regions hero, ...; how-it-works-1,
    how-it-works-2 not drawn on this page");
  - *regions: a step missing from README.md, and planted on a page of the
    guide*, and *links: a step whose picture does not exist, aimed from
    README.md* -- each watched failing with `pageOf` left without the
    steps' regions;
  - *quotes: a step's caption quoting what its part does not say* --
    watched failing with `quoteProblems` left to the scenes that are not
    `step` ("expected [] to deeply equal [ Array(1) ]");
  - *shape: a step scene naming no step, two in the wrong order, and an
    unknown placement* -- watched failing with each of the three checks
    taken out of `shapeProblems` in turn, `step` among them taken out of
    the placements;
  - *steps: How it works' list and the step scenes disagree* -- watched
    failing with `stepProblems` answering nothing, and with its second
    half, a scene's step the list does not have, taken out;
  - *steps: How it works listing steps and no scene picturing any* --
    watched failing with `stepProblems` answering nothing when scenes.json
    has no step scene, as it first did: with every step scene and its
    region taken out, every check had passed while the list still named
    five steps;
  - *steps: a region under another step than its own* -- watched failing
    with the placement check taken out of `stepProblems`.

  The small repository those cases share gives each of its fixtures its
  own copy of the recorded text: a case that appends a line to one
  record's text had edited every fixture made after it, which no case
  before these met.

  CI's `pictures` job, `pnpm test:pictures` in Chromium, runs each app's
  `pictures.mjs --check` over the new scenes as over the others, with
  their holds, each watched failing on 2026-11-20 in the
  `mcr.microsoft.com/playwright:v1.63.0-noble` container below, with one
  hold changed in the act, `pnpm pictures --check --app <app>` run, and
  the file put back and compared by sha256:
  - that tenant 1's orders in group Online are the invented ones, newest
    first -- with them expected oldest first, "host-record-tabs: tenant
    1's online orders are
    ["10423","10422","10421","10420","10419","10418"], not the
    invented ["10418","10419","10420","10421","10422","10423"]";
  - that the grid draws a row for each -- with a row 10417 waited for, a
    20 s timeout naming the row;
  - that the open order's Delivery tab lists its two deliveries -- with
    "Rows 1–3." waited for, a 20 s timeout;
  - that the deliveries' grid shows Carrier and Shipped at alone once
    their keys are hidden -- with the id left shown, a 20 s timeout naming
    the header row;
  - that `pg` is discovered as `formancy_writer` -- with `formancy_reader`
    waited for, a 30 s timeout;
  - and that the server's latest version of `pg-order` is 1 once the
    studio says it published it -- with 2 expected, the act's own refusal,
    "studio-publish: the latest version of pg-order answered 200 with
    version 1".

  host-delete's and host-drift's checks hold that the walk's new acts
  leave their pictures' text as it was.

  **Held by review alone:** the bench, which no check compares: `--check`
  measures it for the intrusion check and holds nothing it gives. Watched
  on 2026-11-20 in the real script: host-record-tabs was taken at 527 CSS
  px wide with Side by side's separator, a `::before`'s 2 px border, at
  its left edge; with the pseudo-element read, at 513 px with none; and
  host-delete, taken on 2026-11-19 with Stacked's line, a `::before`'s
  border too, 6 px under its Records panel, was retaken at 550 CSS px high
  rather than 564, with none. And, as 0038 says, what a picture looks
  like, and whether one can be read at GitHub's width.

## Context

0154 made the README a page for somebody deciding whether to use the
module, and said that the pictures it wants were a later change. Its hero
was still 0038's: the host page's workspace over the fixture's one
edge-case order, id 2^53+1 and the largest `numeric(18,4)` amount, under
both renderers. That picture is the module being careful, which a
developer who reads the caption values; a buyer looking at it sees one row
of numbers nobody types, and no list, view or child record. Its *How it
works* was five steps in prose, with the studio's pictures one link away.

Two facts of the pictures' planes shaped what could be shown honestly:

- **The host plane connects as the order form's own account** (0038,
  0032), which may read `sales.delivery` but not `sales.order_line`
  (`packages/data-fixtures/fixtures/postgres.restricted.sql`). An order's
  lines cannot be pictured without another account, which 0038 refused for
  the owner; its deliveries can, through a form of their own.
- **The studio plane has no publisher roles.** Review (0065) is a setting
  the server is started with, so a draft approved by a second
  administrator needs a second server in the same walk, and every other
  studio scene's Publish step is a publish.

The fixture model is shared by every parity suite, which counts its rows,
so rows a picture needs cannot be added to it.

**What was measured**, on 2026-11-20, in the
`mcr.microsoft.com/playwright:v1.63.0-noble` image under Docker Desktop on
Windows 11: Linux x64, Playwright 1.63.0, Chromium 153.0.8010.12,
PostgreSQL 17.11 from `postgres:17-alpine` started from inside the image
by testcontainers. The pictures, at DPR 2:

| Scene | CSS px | Bytes |
| --- | --- | --- |
| host-workspace | 1425×1472 | 208,868 |
| studio-connect-pg | 874×687 | 60,282 |
| studio-choose-generate | 916×1295 | 233,786 |
| studio-policy-roles | 874×431 | 35,668 |
| studio-publish | 916×371 | 55,376 |
| host-record-tabs | 513×1060 | 50,558 |

Together 644,538 bytes, and `captured.json` holds the current numbers.
host-record-tabs and the studio's four came out the same bytes before and
after the bench change; host-workspace was retaken once its customer 1003
was renamed and its deliveries' keys hidden, 220,968 bytes before. The
bench change retook host-delete too: 1165×564 CSS px and 81,454 bytes
before, 1165×550 and 82,370 after. `pnpm pictures --check --app host` took
21.1 s and `--app studio` 15.6 s, once each, in that container, starting
PostgreSQL included.

**What a step's picture can be drawn at** was read by eye, on the same
day: the studio's Generate step, decoded from its WebP and resized with
Lanczos to its drawn width at one device pixel per CSS pixel. At 400 CSS
px, 0.44 of its size, its notes could not be read; at 0.6, its grey lines
and code names blurred; at 0.7 they read. Not measured: GitHub's README
column, which 0038 could not reach either, and so how far GitHub scales a
picture down past what the README draws.

## Decision

**The hero is the host page's workspace as clara, a clerk of tenant 1,
meets it**: Forms with the order form and its deliveries' form under Sales
and "Linked to Order"; the Records grid of `pg-order` opened on "Online
orders", a list view an administrator named, its condition a chip, six
orders of October and November 2026 for four customers, drafted, placed
and shipped, amounts in `numeric(18,4)`'s exact digits; and the open
order's deliveries in a tab beside it, their own id and the tenant hidden
in the section's Columns, as a person may (0106). The scene,
`host-workspace`, is `apps/host/scripts/pictures-workspace.mjs`'s:

- **The rows are invented and inserted by the pictures script**, through
  the owner's connection it already opens, as it already induces its
  states: three customers beside the fixture's Muster AG, the orders, and
  two deliveries, every key given so every walk draws the same ones. The
  names are generic and fictional, one series of placeholders -- Muster,
  Beispiel, Vorlage, Entwurf: sample, example, template, draft. The
  caption says which rows the script inserted, and that Muster AG is the
  fixture's. `undo`, which host-delete's act calls first, deletes them
  again.
- **The view and the child form are published by ada** through the
  administrator plane, as host-delete publishes its form
  (`pictures-forms.mjs`): `pg-order` again as version 2 with the view in
  its presentation, and `pg-delivery`, an order's deliveries, its tenant
  pinned. The fixture's edge-case order is in group A, outside the view.
- **Stacked, with the line moved to its end from the keyboard**, so the
  six rows are whole in the camera's 900 px window, which shares its
  height between the records and the record (0145).
- **The order is open on its Delivery tab**, so the hero shows a child
  record; its form is Run's picture, and the caption says so.
- **The scenes walk before host-delete**, so no picture before them lists
  a second order form and host-delete's grid holds the fixture's order
  alone, as its caption says.

**`host-loaded`, the exact digits, stays, as an inline scene of the host
page's guide.** Its record and picture are unchanged: the record holds no
placement, so moving a scene needs no retake.

**Each step of *How it works* has its picture under it.** A `step` scene
names its step in `step`, as the list numbers and names it -- "2.
Generate" for `2. **Generate.**` -- the key a studio scene uses for the
studio's step, here the step of the page it is drawn on, and is drawn in
README.md's region `how-it-works-2`, which opens right after the list's
item 2 (`scripts/pictures/readme.mjs`). So the list is five one-item lists,
each followed by its step's picture, drawn at `STEP_SCALE`, 0.7 of the
width it was taken at, linked to itself, then its caption, led by nothing:
the item above says the step, and the caption says what the picture
shows. A reader reads each step once, with its picture. Every step's text
is drawn at one size, 0.7 of the page's, which the measurement above read.
It is held as the hero is: each region is the render, a step scene is
drawn in its step's region alone, its caption quotes only what its parts
say, its links resolve from README.md, the shape check knows the placement
and wants one scene per step in step order, and `stepProblems` holds the
scenes to the list, whenever the list numbers a step, and each region to
its place, right after its item.

The five, each taken as its app's other scenes are:

1. **Connect**, `studio-connect-pg`: the Connect step for `pg` on
   PostgreSQL, discovered as the order form's own account, with no gap.
   `studio-connect`, SQL Server with its gaps, stays on the studio's page.
2. **Generate**, `studio-choose-generate`: the Generate step whole, after
   Choose with `sales.order` and the customer lookup ticked, its lede
   naming the root and the generator's notes below it. One state shows one
   step, so Choose itself is not in the picture; the notes name the lookup.
3. **Govern and arrange**, `studio-policy-roles`: the Policy step's group
   *Who may do what*, by the plane's role, `clerk`.
4. **Publish**, `studio-publish`: version 1 published, the step saying the
   server keeps every version. **Not a review**: the plane has no publisher
   roles, and a draft approved by a second administrator would need a
   second server started under review in the same walk. The caption says
   so, and that 0065's review exists.
5. **Run**, `host-record-tabs`: the order the hero shows open, drawn by
   React alone, in Side by side, the record pane alone. The hero already
   shows the workspace, so Run's picture is the record, and in Side by
   side its lane is narrow, 513 CSS px.

**The camera's bench stops short of a pseudo-element's drawing.** Side by
side's separator, and Stacked's line, are a `::before`'s border beside the
record lane and under the records, which the bench, reading elements
alone, put in the picture as a sliver. A `::before` or `::after` that
paints a border or a background is now read as its box, from its offsets
where it is placed absolutely and as its element's otherwise; a glyph it
draws is not.

## Consequences

**What it buys.** A reader of the README meets the product at work on data
that looks like theirs, a list view, a filter and a child record, and sees
each step of the path from a connection to a person's record as the product
draws it, under the sentence that says the step, every picture still taken
from a state the product reaches and held to its text. The exact digits
keep their picture, beside the host page's other careful states.

**What it costs.**

- **More pictures to retake.** Six more scenes, two of them on the host
  page, whose pictures need Docker to retake; a change of look -- the
  room's stylesheet, a font, Chromium -- retakes six pictures more.
- **Bytes.** 644,538 more bytes of WebP in a checkout, and in history again
  at each retake.
- **How it works is long.** Its pictures stand under their steps rather
  than beside a sentence, the studio's drawn at 0.7 of their 874 to 916
  CSS px; the Generate step's notes are long, and its picture is the
  tallest. Nothing measures whether one reads at GitHub's width, where
  a narrow window scales them further; a reader opens one whole.
- **The list is five lists.** Each item is a one-item ordered list
  numbered by its first item, because a generated region between items
  ends a Markdown list; a renderer that ignores an ordered list's start
  would number every step 1.
- **The host walk is longer and more coupled.** Its new acts insert and
  delete rows and publish two forms between host-other-tenant and
  host-delete; host-delete undoes them, and host-drift puts the renderers
  back. A change to either act's state is met in the next one's check.
- **Invented data in a picture can drift from the model.** The rows use
  the fixture's columns and statuses; a change to those turns the hero's
  act red, as a change to any pictured state does.
- **The hero shows no order lines**, which the account may not read, and
  Publish shows no review, which the plane does not run; the captions say
  what is shown and why.
- **The bench reads every element's pseudo-elements** at each capture and
  check, a computed style each, and a pseudo-element whose box is not
  placed absolutely is taken as its element's, which can keep a bench
  shorter than the drawing needs.

**What it forecloses.** Nothing published: the pictures and their scripts
are never in a package.

## Alternatives considered

**Keep the exact-values hero.** It shows care a developer values and a
buyer does not recognise as a workspace; it is kept, on the host page's
guide.

**The steps' pictures on the guide's pages only**, as every scene but the
hero was. The README's *How it works* would stay prose, and a buyer would
follow five links to see what each step looks like.

**A table after the list, each picture at 400 CSS px beside its caption
led by the step**, this record's first take. The studio's steps were then
drawn at under half their size, where the Generate step's notes could not
be read, and each step was told twice, by the list and by the table.

**Each step's picture at the width it was taken at.** Readable, and the
five 3,844 CSS px tall together as recorded, against 2,691 at 0.7, which
was read as enough.

**Less of the Generate step.** A part is a whole element, and the clip
refuses text no part holds, so the notes the caption quotes cannot be
pictured without the panel around them; the Choose step's lookups, which
are narrower, say what was chosen and not what the generator made of it.

**A hero on the order's own tab**, its form under the grid. The form's
height, not measured across Stacked's record pane, would be added to the
hero's, and no child record would show; Run pictures the form, and the
hero's caption says so.

**Screenshots taken by hand**, with a believable data set typed into a
running stack. Faster to make, and exactly what 0038 refused: nothing
holds them to the text the page shows, and they go stale unseen.

**The rows in the fixture model.** Every parity suite counts the fixture's
rows on both engines, so six orders more would be a change to every
suite's expectations for a picture.

**A second plane with publisher roles**, so Publish could picture a draft
approved by a second administrator. A second server in the studio's walk,
or the walk under review, which changes every other studio scene's Publish
step; the publish is pictured instead, and the caption says why.

**The owner's connection**, so the hero could show an order's lines. 0038
refused it: row-level security does not bind the owner, so the pictures
would show what production must not do.

**Run's picture in Stacked**, the hero's layout. The record pane is then
1,165 CSS px wide, drawn at 816, for the same form Side by side's lane
shows in 513.

## Older records

Narrowed: 0047, whose cost that the README's pictures show no child grid
now holds for order lines alone -- its Status line says so. Applied and
unchanged: 0105, whose view the grid opens on; 0106, whose Columns hide
the deliveries' keys; 0142, whose tab holds the deliveries; 0145, whose
line the keyboard moves; 0122, whose disabled fields Run's caption names;
and 0065, which Publish's caption names and does not picture.
