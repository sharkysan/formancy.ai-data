# 0172 — The README is a short pitch page, and How it works opens with a sketch of the architecture drawn by hand

- **Status:** accepted; extends
  [0154](0154-the-readme-speaks-to-a-buyer-first-and-the-detail-lives-in-the-guide.md):
  the README keeps its sections but *Why*, whose four points open the
  page, says each thing in a line or two and links a record only where a
  reader needs one, and the guide's pages hold the rest; narrows
  [0038](0038-readme-pictures-are-taken-by-a-script-and-held-to-the-text-they-show.md):
  the README's sketch of the architecture is drawn by hand and is no
  screenshot; extends
  [0168](0168-the-readme-pictures-the-workspace-a-buyer-meets-and-each-step-of-how-it-works.md):
  its six captions are shorter, three quotes dropped, and the hero's no
  longer points at Run, whose caption says it is the hero's order
- **Date:** 2026-11-20
- **Deciders:** Daniel Bacher
- **Verified by:** `scripts/architecture-sketch.test.mjs`, in
  `pnpm test:repo`, which the `verify` job of `.github/workflows/gates.yml`
  runs on every pull request and before every release:
  - every `@formancy/*`, `apps/*`, `packages/*` or bare `data-*` name the
    sketch writes, in a box, its `<title>` or its `<desc>`, is a workspace
    package or app, read from `pnpm-workspace.yaml` and the manifests, or
    an `@formancy` package a workspace manifest depends on, upstream's
    renderers among them;
  - every published package, one whose manifest is not private, is drawn
    by a box;
  - its `<desc>`, and the alt of README.md's `<img>` of it, name every name
    the boxes draw, and README.md shows it;
  - it holds no script, no embedded file, no `@import`, no font of its own,
    no `url()` and no link outside itself;
  - and every colour it names is one `@formancy/themes`' room.css declares,
    written as room.css writes it, read where the apps resolve it.

  Watched failing on 2026-11-20 in the repository itself: with the
  data-identity box renamed `@formancy/data-gateway` ("docs/images/architecture.svg
  names @formancy/data-gateway, which is no workspace package or app and no
  @formancy package a workspace manifest depends on", "@formancy/data-identity
  is published, and no box of docs/images/architecture.svg draws it", and
  the `<desc>` and the alt not naming the new name); with the teal written
  `#40e0d0` ("draws with #40e0d0, which room.css does not declare"); and
  before README.md showed the sketch ("README.md shows no <img> whose src
  is ./docs/images/architecture.svg"); each put back and compared by
  sha256. Its cases on fixtures hold each refusal, and that a comment in
  the sketch is not read as a name, a colour or something loaded.

  What held the README's sections holds them still, as 0154 lists:
  `scripts/pictures/readme.test.mjs` the hero and the five steps, under
  their items, their captions quoting only what their parts say;
  `scripts/architecture.test.mjs` every link, the new one into
  *Packages*' licence section among them; `scripts/demo.test.mjs` and
  `scripts/live-demo-docs.test.mjs` *Try it*'s two addresses;
  `scripts/setup.test.mjs` the link to `docs/setup.md`; and
  `scripts/licence-status.test.mjs` the licence's block.

  **Held by review alone:** that the sketch's arrows and layout are true
  of the code -- that a host's pages reach the runtime plane alone and the
  studio the administrator plane alone, that both planes stand on
  data-core, that the adapters are reached through the server -- and that
  it can be read; that the README stays short; and that its line still
  says what the guide's longer one says.

## Context

0154 made the README a page for somebody deciding whether to use the
module, and 0168 gave it a hero of the host page's workspace and a
picture under each step of *How it works*. On 2026-11-20 it was 431 lines
and 32,791 characters (`wc`): *Why*'s four benefits, each ending in its
records; *What you get* in three groups of bullets, the one about actions
alone longer than *Try it*; *What it does not do yet*, each limit with its
records; a status paragraph listing what 0.4.0 added; and two paragraphs
under the licence's table. Nearly all of it was said again, at length, on
the guide's pages, which 0154 made the reference. And nothing on the page
showed how the pieces fit: a reader met the packages' names in prose, in
*Get started*, near the end, and the only drawings of them are the text
diagrams of the context and the building blocks in `docs/architecture/`.

The question put was to simplify the README and add an architectural
sketch; the answer chosen was a short pitch page, and a drawn picture.

A browser draws an SVG shown by an `<img>` as an image: it runs no script
in it and fetches nothing it names, so a sketch can use only the faces the
reader's system has, and every colour and shape must be in the file.

**What was looked at**, on 2026-11-20, on Windows 11 in Playwright
1.63.0's Chromium, where the faces were Segoe UI and Consolas: the sketch
drawn by an `<img>` 600 CSS px wide in an 880 px column, on white and on
a dark ground like GitHub's, and scaled to a 400 px column at a
device pixel ratio of 2, as a phone draws it. At 600 every box's text
read; at 400, 0.67 of its size, its names at about 10 CSS px and its
smaller lines at about 9, it read, not comfortably. Not looked at: the
wider faces macOS and Linux give the same stack, and GitHub's own page,
which 0038 could not reach.

## Decision

**The README is a short pitch page.** In order: the name, the promise and
a paragraph; four bullets that were *Why* -- the database as it is, with
the condition a reader would otherwise meet too late, that a form updates
and deletes only where a rowversion or a version column every writer
increments tells a stale save; the rules on every request; a schema
change checked; real servers; the hero; *Try it*, both addresses; *How it
works*, the sketch and then the five steps, a sentence each, each with its
picture; *What you get* and *What it does not do yet*, a line or two
each; *Get started*; *Status*, the release and where the rest is said;
*Licence, in one table*, unchanged, its block, and a line naming 0001 and
the page that says the rest; and *Learn more*, the guide and the other
documents in a few lines. A record is linked where a reader needs one:
the captions' and the licence's. The section names CLAUDE.md and the
guards rely on are kept.

**Every fact cut is said on a page of the guide.** Most already were;
what was said nowhere else moved: the licence's history and what the
built apps carry of what they bundle to a new section of *Packages*, *The
licence, and what the apps bundle*, with the theme a host dresses a form
in; the whole list of what 0.4.0 added to *Status*; that published forms
are files beside the server and nothing in the database, and the tree and
Drill down, to *What it does*; and that only the Records grid offers a
choice, so more than a page is run a page at a time, to *Host example*.

**The sketch, `docs/images/architecture.svg`, is drawn by hand as SVG
text**, on its own dark ground with rounded corners, so that it reads on
GitHub's light and dark pages alike, in room.css's colours -- violet for
what a person acts on, teal for what the server does -- and a system font
stack. It draws your application, its pages with `@formancy/react` or
`@formancy/angular` through `@formancy/data-client`, the host page its
example; the studio, for administrators, built from this repository; the
data server, one image, holding the runtime plane, the administrator
plane, `@formancy/data-core`, `@formancy/data-identity` and the
configuration store; and below it the two adapters and the two databases,
read and written as the account each connection names; an arrow from each
client to its plane, and from the server through each adapter to its
database; a key to the two colours; and a line saying the engine below is
Apache-2.0 and this module source-available. It has its own `<title>` and
`<desc>`, and README.md shows it at 600 CSS px, linked to itself, with an
alt that says it all. The building blocks link it, and the sketch's
comment names the guard.

**The captions are shorter.** The hero's says what its picture shows, that
the rows are invented and inserted by the capture script, and that Muster
AG is the fixture's; each step's says its picture in a sentence or two
with one record. Connect's quote of its gap panel and Generate's two
quotes of the generator's notes are dropped, and their keys with them;
every alt is unchanged. No picture is retaken: the record and the
pictures are as captured. The hero line says that the screenshots are
taken by the script and that the sketch is drawn by hand, and every
document that said every picture in the README is taken by the script
says screenshots.

## Consequences

**What it buys.** Somebody deciding meets what the module is, its four
promises, the product at work, how its pieces fit and each step, in the
first screens, and what it does and does not do yet in a line each. The
sketch's names are the workspace's, and fail the pull request that
renames a package without it.

**What it costs.**

- **A reader follows a link for the detail.** A condition, a refusal or a
  number the README used to state is a page away, and a reader of the
  README alone reads the short version.
- **The sketch is redrawn by hand** when a block changes -- a package
  added or published, a plane split, a store moved out of the image -- in
  a text editor, with its coordinates. The guard says when a name is
  wrong or missing; an arrow nobody moved is wrong in silence.
- **The guard holds the names, the colours, the alt and that nothing is
  loaded, not the arrows or the layout**, which review alone holds.
- **Three drawings of the architecture**: the sketch, the building blocks'
  text diagram and the context's, and nothing compares them.
- **Fewer quotes hold the steps' captions.** Connect's and Generate's
  captions quote nothing now; their alts still quote their parts.
- **The README is nearer half its length than a third.** 197 lines and
  14,364 characters (`wc`), of which the hero's and the steps' generated
  regions, the licence's block and the sketch and its caption take 51.
- **On a phone the sketch is small.** Drawn at 400 CSS px its smaller lines
  are about 9 px; a reader opens it whole, as the steps' pictures.

**What it does not do.** It changes no behaviour of the module, takes no
picture and publishes nothing.

## Alternatives considered

**A Mermaid diagram**, which GitHub draws from text in a fenced block. Its
source would be diffable and its names readable by a guard as easily; it
was passed over for a drawn picture, laid out by hand and in the room's
colours rather than in GitHub's, which change with the reader's theme.

**The same sections in plainer words**: every bullet and condition kept,
each sentence shorter. The page would stay as long as the list of what
the module does, and a reader would still meet every condition before the
next section; the guide already holds that list.

**The building blocks' text diagram, copied into the README.** It names
every package and what each may import, which is a developer's question;
on a phone it scrolls sideways, and it has no colour to say which side
a person acts on.

## Older records

Extended: 0154, whose README keeps its sections and gives up *Why* to the
opening, and 0168, whose captions are shorter. Narrowed: 0038, every
picture of the README taken by the script, which now holds for its
screenshots, the sketch drawn by hand. Each Status line says so.
