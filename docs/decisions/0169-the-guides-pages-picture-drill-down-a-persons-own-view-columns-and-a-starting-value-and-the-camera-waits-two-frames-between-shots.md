# 0169 — The guide's pages picture Drill down, a person's own view, Columns and a starting value, and the camera waits two frames between shots

- **Status:** accepted; extends
  [0038](0038-readme-pictures-are-taken-by-a-script-and-held-to-the-text-they-show.md):
  the camera waits two animation frames after each shot, and the host
  page's walk publishes a parcels' form over parcels it inserts; extends
  [0168](0168-the-readme-pictures-the-workspace-a-buyer-meets-and-each-step-of-how-it-works.md):
  the guide's scenes walk over the hero's invented orders, between the
  workspace's acts and host-delete's
- **Date:** 2026-11-20
- **Deciders:** Daniel Bacher
- **Verified by:** CI's `pictures` job, `pnpm test:pictures` in Chromium,
  runs each app's `pictures.mjs --check` over the new scenes as over the
  others, with their holds, each watched failing on 2026-11-20 in the
  `mcr.microsoft.com/playwright:v1.63.0-noble` container below, with one
  hold changed, `pictures.mjs --check` run for its app, and the file put
  back and compared by sha256:
  - that the Records grid draws what Columns says -- with Created by
    expected still in its header, a 20 s timeout; and with Customer
    expected a pixel wider than the panel's line says, "the panel says
    Customer is 237 pixels wide, and the grid draws it 237 wide";
  - that View names clara's own view -- with Online orders expected
    chosen, a 20 s timeout;
  - that the server keeps it for her, her condition in the view's order --
    with the order expected oldest first -- and offers otto none -- with
    clara asked in his place;
  - that the Express delivery is order 10422's and holds the two invented
    parcels -- with them expected of order 10421;
  - that the parcel's paper names its delivery -- with Freight waited for,
    a 20 s timeout -- and that the trail names every level -- with the
    second parcel expected last;
  - that the generator's note under the starting value says the column's
    default, and that Use the column's default is offered -- each with
    another state or field named, a 30 s timeout; and that Undo gives
    status the column's default back before version 1 is published --
    with placed waited for, a 30 s timeout.

  `scripts/pictures/readme.test.mjs`, in `pnpm test:repo`, holds the new
  scenes as it holds every other: each region is the render, each quote is
  in its part's recorded text, and each picture is the one its record
  describes.

  **The camera's wait is held by a capture alone**, which `--check` never
  takes: host-drill-down did not settle in ten shots in nine captures of
  ten while its act was written, and in each of two on this record's final
  code with the wait taken out, the file put back and compared by sha256
  after; with the wait, it settled in two shots in each capture.

## Context

0168 pictured the README's hero and *How it works*. The host page's guide
and the studio's still described features no picture showed: Drill down, a
form shown as a tree, a person's own views, a state's moves and Columns on
the host page; Browse and a starting value in the studio. Reading what
each would take, against the pictures' planes:

- **The host plane connects as the order form's own account** (0038,
  0032). It may read `sales.order`, three columns of `sales.customer`,
  `sales.delivery` and `sales.parcel`, and not `sales.employee` or
  `sales.order_line`
  (`packages/data-fixtures/fixtures/postgres.restricted.sql`). The model's
  one table that is its own child, which a form draws as a tree (0110), is
  `sales.employee`.
- **The studio plane has no database.** It discovers over the captured
  snapshots and has no record adapter, and it gives nobody a browse role,
  so its Browse step (0099) waits for one.
- **A state's moves are a native select's options** (0127). Chromium draws
  an open select's list outside the page, so a picture of one shows the
  state it holds; its options are in the accessibility snapshot the record
  keeps, and not in the picture a reader sees.

And one fact of the camera, found while taking Drill down. A full-page shot
draws the page beyond the window and puts the window back. A shot begun
before the window was put back told the page, for the length of the shot,
that its window was 1×1 px: every `(max-width: …)` query the host page
reads (`useMedia`) matched, the workspace drew itself again, and every
input React updated changed its `name` and `type` and back. The camera's
watch saw a page that never stopped changing. Measured on 2026-11-20 in the
`mcr.microsoft.com/playwright:v1.63.0-noble` image under Docker Desktop on
Windows 11, Playwright 1.63.0, Chromium 153.0.8010.12, by a listener of the
page's `resize` and its media queries while the act took shots as the
camera does. In one walk, three shots in a row on Drill down's parcel saw
the window 1×1 at every shot after the first, three on the same page in
Stacked 1440×900 at every one, and three in Drill down again 1×1 after the
first. In another, four shots in Drill down with nothing between them saw
1×1 after the first, and four each with two animation frames, 100 ms and
300 ms between them 1440×900 at every one. In Stacked each shot took about
half a second, against a third in Drill down, whose page is shorter, which
is the likeliest reason no picture before met it; that was not measured
further.

## Decision

**Each app's page of the guide pictures its features where a reader looks
for them**, taken as the other scenes are (0038):

- **host-drill-down**, inline: Drill down from order 10422 to its Express
  delivery, from the order's Delivery tab, and on to that delivery's first
  parcel, from its Parcel tab, the trail above naming every level (0090,
  0142). The parcels are invented, "Carton 1 of 2" and "Carton 2 of 2",
  their keys given, inserted through the owner's connection as 0168's
  orders are, and taken with them by host-delete's act, a delete of an
  order cascading through its deliveries into their parcels. Their form,
  `pg-parcel`, is published by ada as the deliveries' is
  (`apps/host/scripts/pictures-forms.mjs`): read by clerks, granting no
  write, a parcel kept to the tenant of its delivery through its lookup
  (0043).
- **host-views**, more: over Online orders, `status = placed` typed into
  the filter line in place of the view's own condition, and kept as
  clara's own view, "Placed orders", which View then names, with Remove
  your view beside it (0105, 0126, 0131).
- **host-columns**, more: the Records grid's Columns, Created by and
  Approved by hidden, Customer a step wider, which the panel's line says in
  pixels (0106, 0151).
- **studio-starting-value**, more: the Presentation step's row of Status,
  given "placed" over its column's default, draft (0150), after the
  preview, so its label is Status again, and taken back by Undo before
  version 1 is published, so every picture after it is what it was.

`apps/host/scripts/pictures-guide.mjs` holds the host's three acts, which
run after the workspace's and before host-delete's; `undo` chooses Stacked
again before it moves the line, from whatever layout they left.

**Three features are not pictured**, and the guide says what they do in
words: a form shown as a tree, which would need a grant the plane's
account lacks; a state's moves, which a picture shows closed; and the
studio's Browse, which would need a database and a browse role in the
studio's plane, a second server in its walk and Docker in its check.

**The camera waits two animation frames after each shot**, before it reads
what changed (`scripts/pictures/camera.mjs`'s `shoot`). Nothing a shot
pictures changes, so no picture taken before is retaken: on this record's
final code, `pnpm pictures --app host --all` and `--app studio --all`
retook every picture as the same bytes but four -- host-drift,
studio-connect, studio-drift and studio-restored -- which main's own
scripts, without the wait, retook as the same bytes as this branch's.
Those four were taken before a stylesheet change their text does not
show, which `--check`'s notice names, and are not retaken here.

## Consequences

**What it buys.** A reader of the host page's guide sees Drill down's trail,
a person's own view and the Columns panel, and a reader of the studio's
sees a starting value, each in a state the product reaches, held to its
text by the pictures job. The camera can picture a page that reads its
window's width while it is shot, as the host page does in Drill down.

**What it costs.**

- **Four more pictures to retake**, three of them the host page's, which
  need Docker; a change of look retakes them too. 226,410 bytes of WebP, as
  taken on 2026-11-20: host-drill-down 1165×671 CSS px and 50,524 bytes,
  host-views 1165×685 and 104,552, host-columns 518×430 and 48,602, and
  studio-starting-value 840×335 and 22,732. `captured.json` holds the
  current numbers.
- **The host walk is longer and more coupled.** Its new acts publish a
  third form, insert two parcels, keep a view on the server for clara and
  arrangements in the browser, and leave the page in Drill down; host-delete
  undoes the rows and the layout, and a change to what one act leaves is
  met in the next one's check. `pnpm pictures --check --app host` took
  28.9 s for 14 scenes, PostgreSQL's start included, and `--app studio`
  11.9 s for 18, once each in that container.
- **Two shots are two frames further apart**, at every capture of every
  scene; a picture that settles in two shots waits four frames more.
- **The width Columns says is a number of the look.** “Customer is 237
  pixels wide.” is quoted, and the width a step reaches depends on the
  face the header is measured in, so a font release that moves it turns
  host-columns' check red, as it would change the picture.
- **What a select offers is not pictured.** View's list and a state's
  moves are in the record's text and not in the picture, so a caption says
  what View names, never what it lists.

**What it forecloses.** Nothing published: the pictures and their scripts
are never in a package.

## Alternatives considered

**A tree over `sales.employee`** through a grant to the order form's
account, or through the owner. The first changes the shared fixture's
grants, which the access suites hold to what each account may do (0027);
0038 refused the second, which row-level security does not bind.

**A state's moves pictured on a shipped order**, where the policy leaves
no move and the field is drawn disabled. It shows a field nothing writes,
which a create-only field on the same paper shows too; the moves are what
the feature is, and a picture cannot show them.

**The studio's Browse over a PostgreSQL the studio's walk starts.** A real
record adapter beside discovery over snapshots, a browse role in the
plane, and Docker in the studio's check, which 0038 kept free of it; a
record of its own, if it is wanted.

**Drill down pictured at the delivery**, its Parcel tab listing the
parcels. Fewer levels in the trail, which is the feature, and the
delivery's heading is its 36-character key.

**The camera's full-page shot only where the clip leaves the window.**
Every picture the camera took so far was taken full-page; one inside the
window would be taken another way, whose bytes nobody has compared with
the full-page shot's, and finding out is a retake of them all for a
camera change that pictures nothing new.

**A wait of a fixed time between shots.** 100 ms did as well as two frames;
a frame is what the shot waits for, and a fixed time is a number nobody
measured a reason for.

## Older records

Applied and unchanged: 0043, whose `through` keeps a parcel to its
delivery's tenant; 0090, 0142 and 0145, whose levels, tabs and layouts
Drill down shows; 0105, 0126 and 0131, whose view, own view and filter
line are pictured; 0106 and 0151, whose Columns and widths are; 0117,
whose disabled fields the parcel's paper shows; and 0149 and 0150, whose
column default and starting value the studio's row shows.
