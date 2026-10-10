# 0038 — README pictures are taken by a script from states the product reaches, and held to the text they show

- **Status:** accepted
- **Date:** 2026-10-10
- **Deciders:** Daniel Bacher
- **Verified by:**
  `scripts/pictures/readme.test.mjs` (`pnpm test:repo`, Node only) —
  README.md's four picture regions are what `scripts/pictures/scenes.json`
  and `docs/images/readme/captured.json` render, each once and no other
  (watched failing with a caption edited in scenes.json and the README not
  written again: "README.md's pictures region "studio" is not what
  scenes.json and captured.json render: run `node
  scripts/pictures/readme.mjs --write`", and with the studio region's
  markers deleted); every scene has a record, and a picture whose size and
  sha256 are the record's (watched failing with one byte appended to
  `studio-restored.webp`: "(42091 bytes, recorded 42090)", and with
  `host-refused.webp` deleted); the directory holds nothing but the record
  and the scenes' pictures, and the record no other scene (watched failing
  with a stray `stray.webp`, and with a record for a scene scenes.json does
  not have); every “…” in a caption or alt is a key of the scene's `quotes`,
  every key is quoted, and each occurs inside one decoded name or value of
  every part it names (watched failing with “No such record.” changed to
  “No such order.” in host-other-tenant's caption: "“No such order.” is
  quoted in its caption or alt and is not a key of its quotes, so nothing
  holds it to the picture"; with host-loaded's “99999999999999.9999” scoped
  to the part Record: "is not inside one name or value of what the part
  Record says, so the caption quotes what its picture does not show"; and
  with a quotation added to an alt without a key); every record names one
  look (watched failing with one record's Chromium edited: "the pictures
  were taken on 2 looks"); every link and picture the regions show is a file
  of the repository (watched failing with a caption linking a record 0099,
  and with `docs/images/README.md` moved away: "README.md's pictures region
  "hero" links ./docs/images/README.md, which is no file of the
  repository"); each scene's shape, and a `pictures.mjs` for its app
  (watched failing with host-refused's app set to `hosts`:
  "apps/hosts/scripts/pictures.mjs does not exist, so nothing takes or
  checks this picture"); and the guard on the guard, no app script without a
  scene and no region without a picture (watched failing with the examples
  scene removed: "apps/examples/scripts/pictures.mjs takes no scene of
  scenes.json, so its check would compare nothing"). Each of these was made
  in the repository itself on 2026-10-10 and put back by checksum; the same
  file holds each as a standing case on a small repository of its own.
  `scripts/pictures/aria-text.test.mjs` — the decoder of Playwright 1.63.0's
  accessibility-snapshot lines, one line of each shape (watched failing with
  the `''` replacement removed).
  `scripts/pictures/record.test.mjs`, `camera.test.mjs`, `session.test.mjs`
  and `scripts/pictures.test.mjs` (`pnpm test:repo`) — the record, the
  camera's pure parts, the walk the three app scripts share, and the root
  runner: a capture whose caption would quote what the new text does not say
  is refused before anything is written (watched failing with that refusal
  removed); a picture taken on another look is refused, naming `pnpm
  pictures --all` (watched failing with the comparison removed); a picture
  retaken as the same bytes, text and look keeps its date, so a retake on
  another day changes no byte (watched failing with the date always the
  day's); by default a picture is retaken when its file is not the one its
  record describes (watched failing with the bytes not compared); `--check`
  takes nothing but `--app` (watched failing with `--check --all`
  accepted); and `--check` says "compared no scene" when the act table is
  empty or the walk read nothing. The last case was added while this record
  was written: with the branch that says it removed, every test had stayed
  green, because the one case reached the sentence through the pairing;
  watched failing then.
  Each app's `node scripts/pictures.mjs --check`, the second half of its
  `pnpm test:browser`, which the `browser` job runs — walks every scene with
  Google Fonts refused, runs each act's holds and the intrusion check, and
  fails when a part's text is not the recorded text, with a line diff and
  both Playwright versions. Watched failing while the scripts were written
  (2026-10-09 and 10), each after a build with one product source changed,
  and every dist byte-identical once it was put back: the Blocking sentence
  in `apps/studio/src/drift.tsx`, on studio-drift with the changed line,
  while the studio's gate passed; a change to `DRAFT_KEPT` in
  `apps/host/src/pane.tsx`, on host-stale; `decimalPattern` in data-core's
  generator allowing one decimal more than the scale, on both parts of
  examples-order; and Drift listed before Publish in
  `apps/studio/src/workbench.tsx`, on studio-publish-conflict ("no entry 7.
  Publish"), the first scene that meets the reorder, where the design had
  expected studio-drift. The first was watched again on this record's final
  code on 2026-10-10: the studio's gate green in 30.9 s, its check red in
  12.0 s. And with an app script edited: a scene with no act, and an act's
  key renamed, on the pairing check before any walk; the act table emptied,
  on "compared no scene"; and a paragraph inserted into the page between the
  Policy step's two pictured groups, on the intrusion check, which `--check`
  runs too.
  The holds, at every capture and every check — watched failing with
  host-unknown's route storing nothing, on its database hold, and with the
  hero asserting `9007199254740992`, on both panes.
  The camera's refusals, at every capture — each watched on 2026-10-10 in the
  real scripts on their final code, with one temporary edit put back by
  checksum: Google's font files aborted at capture, "the font Archivo had not
  loaded after 20000 ms, and a picture in a fallback face would look like a
  different product"; examples-order's React part with its background
  toggled every 16 ms, "the picture did not settle in 10 shots: the page kept
  changing while it was shot" (two equal shots alone had let such a toggle
  through in one of its colours, in each of five captures);
  `image/avif` asked of the encoder, "Chromium's canvas did not encode
  image/avif: it answered image/png"; React removed from the hero's parts,
  "host-loaded: the clip of Record, Allowed, Angular shows what no part
  holds, so the record would not say it: the text "React"; the text
  "Order"; …"; "Muster AG" listed among the plane's secrets, "host-typeahead:
  the part React shows one of the plane's secrets -- a token, a password or
  a connection URL -- so it is neither recorded nor printed", the first
  scene in walk order that shows it, with the value printed nowhere;
  `--review ./x`, "is inside the repository"; the studio at 1000 px, "a
  picture is taken past the widest breakpoint, 1024px, and 1000px is not
  past it"; and `--scene studio-drift` with another record's Chromium
  edited, refused, naming `pnpm pictures --all`. And the walk's own two: a
  part whose text differs before and after its shot is refused (it caught a
  race in one capture of three, before the wait below existed); and after
  every act nothing in the parts may have been `aria-busy` for 500 ms (with
  every lookup answered a second late, the host's check failed without that
  wait, on host-stale in each of two runs and on host-refused in one, and
  passed with it).
  The discovery suites of `@formancy/data-postgres` and
  `@formancy/data-sqlserver` — a column renamed in the database is
  discovered as `renamedColumn` from `@formancy/data-fixtures` gives it,
  which is the edit the drift pictures stand for a rename (watched failing
  there, in the change that added them, with an edit that dropped the
  column's access and with one that gave it a new ordinal).
  Held by nothing: what a picture looks like. Review holds it, as
  [`docs/images/README.md`](../images/README.md) says.

## Context

The README described the product in prose only. Somebody deciding whether
to build on the module had to infer from it what the studio, the host page
and the examples page show, and where they are careful. Upstream's pictures
are taken by hand from a recipe that says each of them "outlived at least
one change to the thing it shows before anybody noticed". The browser gates
here assert "numbers and computed results, never screenshots", because a
pixel baseline is a file somebody updates when it goes red.

What the design rests on, read in the code: Playwright's `ariaSnapshot()`
gives each element's role, name and value, the lens CLAUDE.md already asks
tests to use, and its lines have one format in `playwright-core` 1.63.0
(`renderAriaSnapshotAsYaml`); the studio's gate already runs the real server
over the committed captured snapshots without Docker, and the host's over a
real PostgreSQL; the guide's stack connects as the order form's own account,
and the host's gate as the owner, a superuser row-level security does not
bind (0032).

**What was measured**, on 2026-10-09 and 2026-10-10, in a Docker Sandbox VM:
Linux x86_64 (kernel 7.0.14, Ubuntu 26.04.1) with 20 CPUs and 15 GiB, Docker
Engine 29.8.1, Node 22.22.1, Playwright 1.63.0 and Chromium 153.0.8010.12.
The machine was shared throughout: a live demo held three containers, and
two other workflows ran their Docker suites. Sizes and texts do not depend
on that; the times do, and are that machine's under that load.

- **M1. Settled shots.** One examples state at DPR 2, shot until two
  consecutive shots were equal, in three contexts in each of two browser
  launches (2026-10-09): five of six runs gave the same 70,879-byte PNG. The
  sixth had no IBM Plex Sans face loaded after `document.fonts.ready` had
  resolved, and its two shots were equal too, so a settle loop alone does not
  catch a missing font.
- **M2. Fonts.** All three apps load Archivo, IBM Plex Mono and IBM Plex Sans
  from Google's css2 API, which serves whatever version Google publishes:
  v25, v20 and v23 on both days, read from the font files' URLs.
- **M3. Encoding.** One PNG encoded on Chromium's canvas as WebP at quality
  0.9 gave the same bytes in two runs in each of two launches, for three
  crops. Over 20 prototype crops WebP was 0.63 of PNG (2,643,476 against
  4,168,027 bytes), 0.46 to 0.88 per crop. One DPR-2 frame: 306,480 bytes as
  PNG, 205,416 as WebP at 0.95, 162,879 at 0.9 and 124,602 at 0.8. Lossless
  WebP of another frame was larger than its PNG (366,724 against 255,375),
  and the canvas's `alpha: false` changed nothing (212,188 bytes either
  way). Asked for AVIF, the canvas answers PNG.
- **M4. The pictures**, as taken on 2026-10-10, at DPR 2:

  | Scene | CSS px | Bytes |
  | --- | --- | --- |
  | host-loaded | 1200×1141 | 104,628 |
  | examples-order | 922×851 | 63,476 |
  | studio-connect | 874×640 | 146,738 |
  | studio-choose | 874×634 | 96,180 |
  | studio-generate | 874×1051 | 213,178 |
  | studio-policy | 874×530 | 59,628 |
  | studio-presentation | 874×1100 | 87,742 |
  | studio-preview | 916×1088 | 92,756 |
  | studio-publish-conflict | 916×422 | 70,004 |
  | studio-drift | 916×1381 | 213,806 |
  | studio-regenerated | 874×427 | 66,590 |
  | studio-carried | 874×225 | 30,224 |
  | studio-restored | 874×210 | 42,090 |
  | host-stale | 1200×1034 | 98,358 |
  | host-unknown | 576×1005 | 57,684 |
  | host-typeahead | 576×851 | 29,264 |
  | host-refused | 576×1019 | 54,758 |
  | host-other-tenant | 1200×329 | 29,866 |

  Together 1,556,970 bytes, and the record 47,603. `captured.json` holds the
  current numbers; this table is the day's. examples-order at DPR 1, as it
  was first taken (890×821, before the bench around the parts was added):
  25,442 bytes, against 60,688 at DPR 2.
- **M5. Determinism.** `pnpm pictures --all` run a second time changed no
  byte of the pictures, the record or README.md: at about 00:07 UTC on
  2026-10-10, the day after the pictures were first taken, with every
  record keeping that first date; and twice after the last retake that day,
  right after it and at 09:11 UTC on this record's final code (53.1 s), all
  18 unchanged each time. `--check` passed three times in a row on the
  scripts before their review (24 to 26 s each), and three
  times on the final code (2026-10-10, 09:06 to 09:08 UTC): once in
  `pnpm test:browser` and twice app by app.
- **M6. The repository.** 11,848,933 bytes of blobs are reachable from
  `d78ba3c`, the commit this change starts from, in all its history (1,052
  blobs), and its tree is 4,235,172 bytes (500 files), by `git rev-list
  --objects` and `git ls-tree -l` on 2026-10-10: the pictures add 13.1 % to
  the first and 36.8 % to a checkout.
- **M7. Time.** `pnpm test:browser` through turbo with every build cached:
  64.8 s without the pictures' checks and 90.8 s with them (2026-10-10,
  started at 09:01 and 09:06 UTC). Each app's check alone, twice, at 09:08
  UTC: 2.8 and 2.4 s for the examples page, 11.9 and 11.6 s for the studio,
  and 11.2 and 11.3 s for the host page, whose time includes starting
  PostgreSQL.
- **M8. Churn.** By `git log` at `d78ba3c`: of the 15 commits since the studio
  was added (inclusive), 6 changed a product source under `apps/studio/src`;
  of the host page's 10, 3; of the examples page's 19, 4, and 3 more changed
  data-core's generator.

Not measured: GitHub's README column width, because the sandbox's firewall
refused `github.githubassets.com` on 2026-10-09 and held it for approval on
2026-10-10; whether turbo's prefix on a log line stops GitHub Actions from
reading a `::warning::` annotation, which is why the stylesheet notice also
goes to the step summary; the `browser` job's time on CI's runner; and how a
second machine renders any picture.

## Decision

Every picture in README.md is taken by `pnpm pictures`, in Chromium, from a
state the product reaches: the built page against the real
`createDataServer`, never a mock-up and never retouched.

- **Where from.** The studio over the committed captured snapshots, `pg` as
  the order form's own account and `ms-reader` as SQL Server's account
  without VIEW DEFINITION, with ada and grace two administrators; the host
  page over a real PostgreSQL through testcontainers, connected as the order
  form's own account, with ada publishing `pg-order` from the guide's request
  and policy, and clara and otto clerks of tenants 1 and 2; the examples page
  as built. Each page is answered on an `.invalid` origin by Playwright's
  routing, and `/v1/` by `server.inject`, so nothing listens on a port.
- **What a picture is.** The union of named whole elements, its parts, found
  by role and accessible name, with up to 16 CSS px of the page around them
  where nothing else is drawn nearer; shot at DPR 2 until two shots are the
  same bytes and the DOM did not change between them, and encoded as WebP at
  quality 0.9.
- **What is recorded.** Each part's accessibility snapshot, in
  `docs/images/readme/captured.json`, beside the picture's size, bytes,
  digest, capture date, look, stylesheet digest and what it was taken over.
  Every “…” in a caption or alt names the parts it must occur in.
- **The check.** Each app's `pnpm test:browser` runs its `pictures.mjs
  --check` after its gate: the same walk, with Google Fonts refused, the
  holds asserted, and each part's text compared with the record. It compares
  text, never pixels.
- **The README's regions are generated** from scenes.json and the record by
  `scripts/pictures/readme.mjs`, and nothing else writes them.
- **Induced states are captioned as such:** grace's conflicting publish, the
  renamed column, the customer deleted before Save and the answer lost after
  the server stored the save. Each is a thing that happens in production,
  caused here by the script, and what the page does with it is the
  product's.
- **One look.** Every picture is taken on one platform and one Playwright,
  Chromium and set of font versions; an app script refuses to write a
  picture taken on another, and `pnpm pictures --all` retakes them all.
- **The camera fails closed**, as
  [formancy.ai 0022](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0022-fail-open-fail-closed.md)
  has it for validation: a font not loaded, text in the clip that no part
  holds, a picture that does not settle, an encoder that answers with
  another type, and a secret in the text are each refused, never pictured.

Found on the way, by looking at the pictures:

- **Fixed:** after a conflicting publish, the studio's Publish step said the
  version it had read was the published one, beside an enabled "Publish
  version 2" the server would refuse again. It now says which version is
  published and whose, disables Publish until the rebase, and moves the
  keyboard to "Rebase on version 2"; `apps/studio/src/publish.test.tsx`
  holds it (watched failing on the old code, and the focus assertion alone
  with the focus move removed). The design this record follows had left
  every app's `src/` unchanged; the defect was the product's, so the fix is
  here.
- **Filed, not fixed:** on a loaded record the host page draws the fields
  that are read-only on update -- Customer, Order date, Amount, Created by
  -- as editable, and the server refuses a changed one. The runtime plane
  does not tell a page which fields an update may write, so the fix is the
  server's and the page's. The hero shows it.
- **Upstream:** the studio's preview draws no required marker on Customer,
  because a renderer that cannot fill a field's options draws a sentence in
  place of the control, and the Blueprint theme draws the marker from the
  control's `aria-required`.

## Consequences

**What it buys.** A reader sees what each part of the module does and where
it is careful, in states the product reaches, with captions that say which
of them the script caused. A sentence a picture shows that changes turns the
browser job red on that scene, where the gates stay green; a caption cannot
quote what its picture's parts do not say; and a capture refuses fallback
fonts, stray text in the clip and secrets. On the machine and look that took
them, `git status` after `pnpm pictures --all` lists exactly the pictures
whose pixels changed, because an unchanged state is retaken as the same
bytes (M5).

**What it costs.**

- **Bytes.** 1,556,970 bytes of WebP and a 47,603-byte record, 13.1 % more
  blob bytes than the repository's whole history before, and 36.8 % more in a
  checkout (M6). Each retake of a changed picture adds its bytes to history
  again. Nothing limits the total: a budget would be a number nobody
  measured a reason for.
- **Churn.** A pull request that changes a pictured sentence turns the
  browser job red, and `pnpm pictures --scene <id>` retakes that picture. How
  often, history bounds from above: 6 of the studio's 15 commits changed one
  of its product sources (M8), and not every such change touches a pictured
  sentence. The host's pictures need Docker to retake; the studio's and the
  examples page's do not.
- **CI.** The browser job also walks the 18 states, and starts PostgreSQL
  once more for the host's. Locally that took `pnpm test:browser` from 64.8 s
  to 90.8 s (M7), against the job's 15-minute timeout; on CI's runner it has
  not been measured.
- **Code.** The root runner, five modules under `scripts/pictures/` with
  their tests, and a `pictures.mjs` in each of the three apps, each within
  the size budget.
- **Playwright.** An upgrade that changes how the accessibility snapshot is
  written turns the check red with no product change. The failure names both
  versions, and retaking the pictures is the answer.
- **Coverage.** The host page's pictures are PostgreSQL only; its suites
  prove both engines.
- **Fonts** come from Google at capture, and a font release is a new look:
  the next retake is `--all`.
- **Looks.** What a picture looks like -- a stylesheet or theme change alone,
  a font release, a Chromium rendering change -- leaves the text equal and is
  held by review only. `--check` prints a notice when an app's stylesheet
  digest changed, and fails on nothing. A caption's unquoted sentences are
  held by a hold where there is one, and otherwise by review too.

**What it forecloses.** Nothing published: the pictures and their scripts
are never in a package.

## Alternatives considered

- **Pixel baselines in CI.** They would compare the capturing machine's
  rendering with the runner's, which nobody has measured, and go red when
  Google ships a font (M2), with no change here: the file somebody updates
  when it goes red, which the gates already refuse.
- **An input digest as the gate.** Drawn over every app source it fails on
  every interface change, including those no picture shows; drawn narrowly it
  misses what changes text. It survives as the stylesheet notice.
- **A dated recipe followed by hand**, as upstream's: its own first paragraph
  says why not.
- **The composed stack** (0032). Truest for nginx and real HS256 tokens, but
  neither shows in a picture; it costs about 2.3 GB of images, has no drift
  scenario, and would put the whole stack into the browser job.
- **The host gate's owner connection.** A superuser bypasses row-level
  security, so the pictures would show what production must not do (0032),
  and the generator's read-only notes, the careful part, would be gone.
- **A live `ALTER TABLE` for the drift.** It needs Docker in the studio's
  check, and a live discovery would put the floating image's patch version
  into the recorded text. The discovery suites hold the snapshot edit to a
  real rename instead.
- **A SQL Server writer snapshot**, so the pictured account would be the
  guide's `ms`: a committed fixture and its test for one card in one picture.
- **Hosting the pictures elsewhere** -- release assets, an orphan branch,
  LFS. Links break silently, the pictures stop being versioned with the code
  they show, and LFS adds quotas and a tool every contributor needs.
- **PNG.** 1.6 times WebP overall, 1.1 to 2.2 times per crop (M3).
- **AVIF.** Chromium's canvas answers PNG for it, which the encoder refuses
  (M3).
- **DPR 1.** 0.42 of the bytes on examples-order (M4), and blurred on a
  high-density screen.
- **Stitched composites**, several states in one picture: a picture of no
  state the page reaches.
- **Light variants.** The apps have no light theme, so a light picture would
  be staged.
- **The check folded into the browser gates.** The gates measure layout at
  several widths and assert numbers, never screenshots; a picture's walk is
  one width on one look, and the gates would stop being what their headers
  say.

## Older records

Applied and unchanged: 0003, whose real servers are the host pictures'
database and, through the captured snapshots, the studio's; 0021, whose page
the examples picture shows; 0024 and 0029, whose planes the studio and host
pictures speak and nothing else; 0027, whose account-aware snapshot gives the
generator's read-only and row-level-security notes the studio pictures quote;
0030 and 0031, whose presentation patch and unknown save are pictured; 0032,
whose rejection of the owner connection the host pictures follow; and 0033,
whose audit sink the studio's plane is given, and which is why grace is a
second administrator rather than ada again.
