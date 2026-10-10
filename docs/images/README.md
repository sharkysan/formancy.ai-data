# How the README's pictures are taken

Every picture in the [README](../../README.md) is taken by `pnpm pictures`, in
Chromium, from a state the product reaches: the built page against the real
data server, never a mock-up, and never retouched. The browser job then walks
the same states and fails when a picture's elements no longer say what they
said when it was taken
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
  `ms-reader` is SQL Server's account without VIEW DEFINITION. ada and grace
  are two administrators. No Docker.
- **The host page** runs against the real server over a real PostgreSQL
  (`POSTGRES_IMAGE` from `@formancy/data-fixtures`, through testcontainers),
  connected as the order form's own account, whose grants and row-level
  security bind it. ada publishes `pg-order` with the guide's request and
  policy; clara is a clerk of tenant 1 and otto a clerk of tenant 2. The
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
  discovery suites hold equal to what discovery reports after a real rename.
- *A refused choice*: a customer inserted and, after it was chosen, deleted
  through the database's owner.
- *A save whose answer was lost*: the update is handed to the server, required
  to answer 200 and to have been sent once, and the page is then told the
  connection was reset.

## The camera

`scripts/pictures/camera.mjs` takes every picture the same way:

- **Settings.** Device scale factor 2, `en-US`, UTC, reduced motion, a
  viewport 900 px high and 1200 px wide for the studio and the host page,
  1300 px for the examples page; each app refuses a width at or below its
  stylesheet's widest `max-width` breakpoint.
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
too. They run at every capture and every `--check`.

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
| `pnpm pictures --check` | Walks every scene with Google Fonts refused and compares each part's text with the record; writes nothing. Each app's `pnpm test:browser` runs it. |
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
2026-10-10. A picture wider than the column is scaled down by GitHub; how
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
- **The preview's Customer field loses its required marker.** When the
  renderer cannot fill a field's options -- the studio speaks only the
  administrator plane -- it draws a sentence in place of the control, so
  nothing in the field carries `aria-required`, which is what the Blueprint
  theme draws the `*` from; the field still says "required" after Validate.
  That is `@formancy/react`'s fallback, at 0.3.0 and at 0.4.0 alike, and
  the themes, upstream.

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
- **SQL Server on the host page.** Only PostgreSQL is pictured there; the host
  page's suites prove its behaviour on both engines.
- **The snapshot format.** A Playwright upgrade that changes how the
  accessibility snapshot is written turns the check red with no product
  change; retaking the pictures is the answer, and the failure names both
  Playwright versions.
