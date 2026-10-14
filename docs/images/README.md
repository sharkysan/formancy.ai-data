# How the README's pictures are taken

Every picture in the [README](../../README.md) is taken by `pnpm pictures`, in
Chromium, from a state the product reaches: the built page against the real
data server, never a mock-up, and never retouched. The pictures job then walks
the same states, in Chromium, and fails when a picture's elements no longer
say what they said when it was taken
([0038](../decisions/0038-readme-pictures-are-taken-by-a-script-and-held-to-the-text-they-show.md)).
This page says how, and what that does not hold.

Sizes, bytes, capture dates and the look each picture was taken on are in
[`readme/captured.json`](readme/captured.json), which the capture writes; this
page does not restate them.

## Where each picture comes from

- **The studio** runs against the real `createDataServer` with its
  administrator plane, over the committed captured snapshots in
  `apps/studio/src/fixtures/`, each read back against its fingerprint. `pg`
  is the order form's own account, as the getting-started guide's `pg` is;
  `pg-owner` is the fixture's owner, for the form over `sales.order_line`,
  which the order form's own account may not read; `ms-reader` is SQL Server's
  account without VIEW DEFINITION. ada and grace are two administrators. No
  Docker.
- **The host page** runs against the real server over a real PostgreSQL
  (`POSTGRES_IMAGE` from `@formancy/data-fixtures`, through testcontainers),
  connected as the order form's own account, whose grants and row-level
  security bind it. ada publishes `pg-order` with the guide's request and
  policy, and, when host-delete's scene starts, `pg-order-delete`, the
  getting-started job's second form -- the same request with delete
  granted to whoever may read and every foreign key a delete of an order
  acts through named (0051), journey.json's `deleting`; clara is a clerk
  of tenant 1 and otto a clerk of tenant 2. That
  account may not read `sales.order_line`, so no child grid is pictured. The
  database the pictures were taken over is in each record's `database`, and
  is never compared.
- **The examples page** is its static build; it has no server.

Every page is answered on an `http://<app>.invalid` origin by Playwright's
routing, files from `dist/` and `/v1/` through `server.inject`, so nothing
listens on a port.

**Induced states**, which the captions say the script caused:

- *A conflicting publish*: grace's publish is a real request to the same
  server, required to answer 201.
- *Drift*: the writer snapshot with `notes` renamed to `memo` in place, by
  `renamedColumn` from `@formancy/data-fixtures`, which both adapters'
  discovery suites hold equal to what discovery reports after a real rename
  of `notes`.
- *Restored*: the writer snapshot put back without the rename, so that
  version 1 fits the database again.
- *A key that moved*: the same snapshot with `order_date` renamed to
  `order date` by the same function. No suite compares that rename with a
  real one; `renamedColumn` refuses a column that a key, a foreign key or a
  check names, and `order_date` is none.
- *A refused choice*: a customer inserted and, after it was chosen, deleted
  through the database's owner.
- *A save whose answer was lost*: the update is handed to the server, required
  to answer 200 and to have been sent once, and the page is then told the
  connection was reset.
- *A row's confirmation*: the second form above, published by the script
  through the same plane as the first; the order its row asks about is
  kept, and host-drift loads it after.
- *A save after the table changed*: `sales.order.status` narrowed from
  `varchar(20)` to `varchar(8)` through the database's owner, after clara
  loaded the record: the shape of the shared drift case `tightened-text`.
  It is the host walk's last act, because it changes the table and every
  earlier act reads it as the fixture made it.

## The camera

`scripts/pictures/camera.mjs` takes every picture the same way:

- **Settings.** Device scale factor 2, `en-US`, UTC, reduced motion, a
  viewport 900 px high and 1200 px wide for the studio, 1440 px for the
  host page, whose workspace draws its Forms sidebar only past 80rem
  (0047), and 1300 px for the examples page; each app refuses a width at or
  below its stylesheet's widest `max-width` breakpoint.
- **Fonts.** It waits until every family the page asks Google Fonts for has a
  face loaded and none is loading, and records each family's version from the
  font file's URL. `document.fonts.ready` alone once resolved with a family
  missing.
- **Parts.** A picture is the union of named whole elements, found by role and
  accessible name, with a bench of the page around them: up to 16 CSS px,
  less where something else is drawn nearer -- a neighbouring panel, a
  coloured glow -- and the same on opposite sides.
- **Intrusion.** It refuses a clip in which any visible text, control or image
  belongs to no part, quoting it, so the text the record holds is everything a
  person reads in the picture. `--check` runs the same check.
- **Settle.** It shoots until two shots in a row are the same bytes and the
  page's DOM did not change from before the first until after the second, and
  refuses after ten. A change outside the DOM -- a canvas, a video -- is not
  seen; no page here has one.
- **Settled text.** A part's text is read once no element in the parts has
  been `aria-busy` -- a lookup's search out -- for 500 ms, after the blur,
  and again after the shot; a capture whose text differs between the two is
  refused, because the act did not wait for the state it pictures.
- **Encoding.** WebP at quality 0.9, through Chromium's canvas, refused if the
  canvas answers with another type.
- **Secrets.** It refuses a part whose text holds a token, password or
  connection URL the plane holds, and names the scene and the part, never the
  value.
- **Object URLs.** A link whose address is an object URL -- the studio's
  version download
  ([0062](../decisions/0062-a-published-version-moves-between-deployments-as-its-version-file.md))
  -- is recorded with the URL's UUID said as `<uuid>`, because the browser
  draws a new one on every load and a record holding one walk's would differ
  from every walk after. Nothing else in a part's text is changed.

## Parts, quotes and holds

`scripts/pictures/scenes.json` holds each scene: its app, where the README
shows it, its title, its studio step, its caption, its alt text, and its
**quotes**: every “…” in a caption or alt names the parts it must occur in,
and `pnpm test:repo` fails when the recorded text of a named part does not
hold it. The README's picture regions are rendered from scenes.json and the
record, and `pnpm test:repo` fails when they are not what the render gives.

**Holds** are what the act asserts after reaching a state, by role and name or
against the database: that both panes hold the id digit for digit, that the
stale save overwrote nothing, that the lost save was stored, that the
typeahead offers clara her tenant's customer alone though tenant 2's matches
too; that `status` is `varchar(20)` before the narrowing and `varchar(8)`
after it, as host-drift's caption says, read from the catalog because neither
width is in the picture (watched failing with 9 for 8); that after it drift
review, asked as ada, says reads go on and create and update stop, for the
runtime too, and that the save after it was sent once, answered 409 `drift`
and left the row as it was; that the regeneration over the moved key reports
`order_date` and nothing else, and that the Publish step waits for it with
its button disabled (watched failing with the button left enabled for
undecided keys); that host-delete's confirmation, under the grid, takes the
keyboard and offers Keep it before Delete it; and that the lines' form notes that nothing scopes its rows
until the box is ticked (watched failing with the note taken out of the
step). They run at every capture and every `--check`.

## Commands

All of them need `pnpm build` first, Chromium
(`pnpm --filter @formancy/data-examples exec playwright install chromium`),
the network for Google Fonts at capture, and Docker for the host page.

| Command | What it does |
| --- | --- |
| `pnpm pictures` | Walks every scene and retakes those whose text changed, or that have no record, no picture or a picture other than the one recorded. |
| `pnpm pictures --scene <id>` | Retakes those scenes; repeatable. |
| `pnpm pictures --app <app> --all` | Retakes every picture of one app, on this machine's look. |
| `pnpm pictures --all` | Retakes every picture on an empty record: the one way to a new look (another Chromium, Playwright or font version). |
| `pnpm pictures --check` | Walks every scene with Google Fonts refused and compares each part's text with the record; writes nothing. Each app's `pnpm test:pictures` runs it, in the pictures job, in Chromium alone, where the browser gates run in every browser ([0058](../decisions/0058-the-browser-gates-run-in-chromium-firefox-and-webkit-and-each-fact-the-browsers-disagree-on-is-named-and-held.md)). |
| `--review <dir>` | Also writes each new picture, decoded to PNG, into a directory outside the repository. |

## Before a picture is committed

1. `pnpm build && pnpm pictures --all --review <dir outside the repository>`,
   or `--scene` for the pictures a change touched.
2. Open every `<dir>/<id>.png` at 100% and check that the caption and alt are
   true of it, that it starts and ends at whole elements with no sliver of
   anything else, that no hover, focus ring or caret shows (the typeahead's
   focused field excepted), that headings are in Archivo, and that no token,
   password or connection string shows. Anything that looks wrong is a product
   defect to fix or file, never cropped out or retouched.
3. Open README.md on the pull request's branch on github.com, signed in, in a
   desktop window, in both themes, with every `<details>` open. Write the
   window width, the column width (the article's content box, in the
   browser's developer tools) and the date into the pull request and below.
   There is no retake for width: GitHub scales a wider picture down. If the
   hero's digits cannot be read at that width, the hero's parts change, and
   the pull request says so.
4. Run `pnpm pictures --all` once more on the same machine. Its table says
   every picture is `unchanged`, and no file it wrote the first time changes,
   because a settled shot and its encoding are the same bytes each time and
   an unchanged picture keeps its date. A picture it calls `changed` did not
   settle, and is a question for the camera.
5. Say in the pull request which pictures changed and why: whether their text
   changed, or which change of look made `--scene` or `--all` necessary.
   Review the decoded PNGs and the rendered README, not GitHub's diff view,
   which may not show a WebP at all.

**GitHub's column width has not been measured.** The machine the pictures
were first taken on could not reach GitHub's assets: its firewall refused
`github.githubassets.com` on 2026-10-09 and held it for approval on
2026-10-10, and held it for approval again on 2026-10-11, when the pictures
of the moved key, the lines' form and the save after the table changed were
added. A picture wider than the column is scaled down by GitHub; how
far, and whether the hero's digits stay legible at that scale, is for the
first review on github.com to say, with the window width and the date.

## What the pictures show that is wrong

Filed, not hidden, because a picture is the product as it is:

- **Fields read-only on update are drawn editable on a loaded record.** The
  generator says Customer, Order date, Amount and Created by are "Read-only on
  update" for the order form's own account, and the server refuses a changed
  one on update; the host page draws them as ordinary fields once a record is
  loaded, which the hero shows. The runtime plane does not tell the page which
  fields an update may write, so the fix is the server's and the page's, not
  this page's.
- **A restore's help line names the version after the one it made.** Once
  version 1 is restored as version 4, the Versions panel's help line above
  it already says a restore publishes "as version 5", which the restored
  picture shows beside "Restored version 1 as version 4". Both are true;
  side by side they read as a contradiction. The studio's copy, filed.
- **A moved key's columns are told apart by a space.** The Policy step's
  sentence about a reassigned key, "...written for column order_date; it now
  stands for column order date", sets both names in proportional type, where
  the space reads as ordinary English; the key that moved picture shows it.
  The sentence is data-core's `describeReassigned`, which the server's
  refusal says too, so marking the names is a change to both, filed.
- **The preview's Customer field loses its required marker.** When the
  renderer cannot fill a field's options -- the studio speaks only the
  administrator plane -- it draws a sentence in place of the control, so
  nothing in the field carries `aria-required`, which is what the Blueprint
  theme draws the `*` from; the field still says "required" after Validate.
  That is `@formancy/react`'s fallback, at 0.3.0, 0.4.0 and 0.5.0 alike,
  and the themes, upstream.

## What nothing checks

- **What a picture looks like.** A change to a stylesheet or a theme alone, a
  font Google ships, or a Chromium rendering change leaves the text the same;
  `--check` prints a notice when the app's stylesheet changed, and fails on
  nothing. Review holds the looks.
- **Unquoted sentences.** Whether a caption's unquoted words are true, beyond
  what the holds assert.
- **Whether a picture persuades**, and how GitHub scales it.
- **The people's names.** That ada, grace, clara and otto are the identities
  the scripts' literal tokens stand for.
- **SQL Server on the host page.** Only PostgreSQL is pictured there. The host
  page's suites prove its behaviour on both engines, but for the drift
  refusal: that the page shows one is held only by host-drift's `--check`, on
  PostgreSQL, and no host suite reaches it on either engine.
- **The snapshot format.** A Playwright upgrade that changes how the
  accessibility snapshot is written turns the check red with no product
  change; retaking the pictures is the answer, and the failure names both
  Playwright versions.
