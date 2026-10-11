# 0046 — A built app carries the licence and notice texts of everything it bundles

- **Status:** accepted; extends [0032](0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)
- **Date:** 2026-10-11
- **Deciders:** Daniel Bacher
- **Verified by:** `scripts/third-party-notices.test.mjs` (`pnpm test:repo`)
  — the plugin in real Vite builds, with the Vite `apps/host` resolves
  (8.3.3 on 2026-10-11), over a project made for each case in a temporary
  directory. A package's `LICENSE.txt` and `NOTICE` are each reproduced
  once, and nothing else of it, though its modules are split between the
  page's chunk and a lazily loaded one, and the packages are listed in name
  order though the bundler meets them out of it (watched failing with the
  names matched exactly: "formal@2.1.0 is bundled and ships no licence
  text"; with one file read per package, as Vite's own licence output reads
  them: the `NOTICE` gone; and without the sort: plain before formal). The
  licence of code a package vendors in a directory of its own is
  reproduced, named by its path in the package (watched failing with the
  package's root read alone: the vendored licence gone). One name and
  version installed in two directories, as pnpm installs one per set of
  peers, is listed once, with what either copy vendors (watched failing
  with each directory listed as a package: `twin` twice; and with the first
  copy's files alone: one vendored licence gone). A package of
  stylesheets alone is listed with its `LICENSE` and `NOTICE` when a script
  imports one, and so is one imported only from a lazily loaded module
  whose chunk the CSS step removes (watched failing with stylesheet modules
  left out: neither listed; and with the modules read from the chunks that
  survive to the end: the lazily loaded one missing). A package whose file
  the build writes beside its chunks, named by a script's
  `new URL(..., import.meta.url)` or a stylesheet's `url()`, is listed
  (watched failing with those files not placed, and on the plugin before
  it placed them: neither listed). A package with no licence file, one with
  a `NOTICE` alone, one with an empty `LICENSE` and one whose only such file
  is `license.js` each stop the build by name and version (watched failing
  with that refusal removed: the build passed; and with code counted as a
  licence: the one with `license.js` not refused). A workspace package
  linked into node_modules, and the project's own modules, are not listed
  (watched failing with each module's nearest `package.json` taken for its
  package: the build refused the project and the workspace package for want
  of a licence). A stylesheet two lazily loaded chunks share and the chunks'
  source maps, files Vite writes with no source named, pass (watched
  failing with either left to the rule for files with no source, and with
  the plugin run in its place in the config rather than last:
  "assets/shared-….css is written from no source file Vite names"). A
  module from neither node_modules nor the repository stops the build
  naming its path, and so does one a plugin writes that is not among the
  reviewed bundler modules (each watched failing with its check removed:
  the build passed). A worker -- by
  `new URL`, by `?worker` and by `?worker&inline` -- and a file a plugin
  emits from no source stop the build, each named (watched failing on the
  plugin before this check: the build passed with `formal` in all three
  workers and none listed; without the check on modules: the inlined
  worker unnamed; without the check on files: the other two and the
  plugin's file unnamed). Every reviewed bundler module occurs in the
  first case's build, so the list names nothing Vite and Rolldown no
  longer write. What Vite folds in as text is still missed, and the case
  fails when it is not: a package stylesheet a stylesheet `@import`s, a
  package's file inlined as a `data:` URL from a `url()` and from a
  `new URL`, and a module whose only export is a boolean or a number, none
  in any chunk's modules and none listed. The file is UTF-8, an accented
  licence included and its byte-order mark dropped (watched failing with
  the file written as Latin-1), while a licence file in Latin-1 stops the
  build naming the package and the file (watched failing with a lenient
  decoder: the build passed). Every package this repository builds sets
  tsdown's `deps.onlyBundle` to nothing (watched failing before the
  configs did: `data-client`'s unset); and that tsdown then refuses to
  inline a dependency was watched on 2026-10-11 with tsdown 0.23.0, with
  an entry beside `data-core`'s that re-exports `@formancy/core`, its
  devDependency: unset, `@formancy/core`, `@formancy/expressions` and
  `@marcbachmann/cel-js` were inlined, 276.33 kB, with no more than a
  hint; set, the build failed with "@marcbachmann/cel-js is located in
  node_modules but is not included in deps.onlyBundle option", and the same
  of the other two. Each app whose config runs the plugin -- found by the
  plugins it loads, and exactly the studio and the host page -- names the
  plugin among its build's inputs as `turbo run build --dry=json` resolves
  them (watched failing with `apps/host/turbo.json` removed, and with the
  plugin taken out of the studio's config). `pnpm build` of
  `apps/studio` and `apps/host`, which writes each app's file and stops on
  anything it cannot place, and of every package, which stops on anything
  it would inline.
  `scripts/getting-started/stack.test.mjs` — the notices check accepts
  `200 text/plain; charset=utf-8` and refuses a 404, a bare `text/plain`,
  another charset, and a 404 or a 301 that says UTF-8 text (the last two
  watched failing with the status left unchecked). The getting-started
  gate (`pnpm test:getting-started`, 0032's job) — both
  `/studio/THIRD-PARTY-NOTICES.txt` and `/host/THIRD-PARTY-NOTICES.txt`
  answer 200 `text/plain; charset=utf-8` through the composed stack's
  nginx; its check, `pageProblems`, was watched on 2026-10-11 against the
  web image's nginx (1.30.5) serving both apps built at their bases with
  `nginx.conf`, `server` pointed at loopback: no problem as committed;
  built without the plugin,
  "/studio/THIRD-PARTY-NOTICES.txt answered 404 text/html; charset=utf-8,
  not 200 text/plain; charset=utf-8", and the same of `/host/`; and served
  by `nginx.conf` without its `charset` line, "answered 200 text/plain".
  A whole run of the gate passed on both engines on 2026-10-11, the check
  included.

## Context

The web image of the composed stack (0032) serves the studio and the host
page, each one Vite build. What they bundle is other people's code under
other people's terms: React, Angular, upstream formancy's packages and
what each brings with it, `rxjs` and `tslib` among them. MIT asks that its
copyright and permission notice be included in all copies or substantial
portions; Apache-2.0, which covers upstream formancy and `rxjs`, asks in
section 4 that a copy of the licence go with the work and, under 4(d),
that the NOTICE a work ships be reproduced. Upstream's packages each ship a
`NOTICE`.

Measured on 2026-10-11 with Vite 8.3.3, what both apps resolve:

- **The bundles keep no licence comment.** No chunk or stylesheet of either
  build holds `@license`, `/*!`, `@preserve`, "Copyright" or "SPDX".
- **Vite's own licence output reads one file per package and never a
  NOTICE.** Its `build.license` (off by default) matches a file name
  beginning `license`, `licence` or `copying` and reads the first one it
  finds; it skips every module whose id begins with `\0`, and lists a
  package with no licence file without its text rather than stopping.
- **Some packages name their licence `LICENSE.txt`:** `rxjs` and `tslib`,
  both in the host page's Angular chunk.
- **The module graph is not what ships.** Both apps' graphs hold
  `@noble/hashes`, which `@formancy/spec` imports for `schemaHash`, and
  neither bundle holds any of it: no chunk carries its SHA-256 round
  constants, and no chunk's modules include it. A chunk's modules are what
  the bundler wrote into it.
- **The bundler writes modules of its own into a chunk:** Rolldown's
  runtime helpers, and Vite's module-preload polyfill and preload helper,
  whose ids begin with `\0`. They were the only such modules in either
  build.
- **Not everything that ships is a chunk's module.** Vite builds a worker
  in a build of its own, which runs none of the page's plugins, and hands
  its code back as a file that names no source, or as a string inside the
  module that imports it with `?worker&inline`. A file a script names by
  `new URL(..., import.meta.url)`, or a stylesheet by `url()`, is written
  beside the chunks with the path of its source, unless it is under Vite's
  inline limit, 4096 bytes by default, when it becomes a `data:` URL in the
  chunk or stylesheet with nothing to say whose. A stylesheet a chunk
  imports names its source only when the chunk has one module it stands
  for; one two lazily loaded chunks share, and a source map, name none.
  And a chunk that does nothing but import stylesheets is removed before
  the bundle is written, its rules moved into a stylesheet of their own.
  Each app's own files today -- the page and one stylesheet -- name their
  sources.
- **A workspace package resolves to its real path in the repository**, not
  under node_modules: `@formancy/data-core` and `@formancy/data-client`
  appear as `packages/*/dist/index.mjs`. Their dists' region comments name
  only their own sources, so neither inlines a dependency. tsdown would
  inline one a package imports at run time without declaring it, with no
  more than a hint, and `@formancy/core` is a devDependency of both.
- **nginx set no charset**, so a `.txt` was served as a bare `text/plain`,
  whose encoding a browser guesses. Every licence and notice text either
  build bundles is ASCII; the charset is for the first that is not, an
  accented name or a © in a licence any later package ships.

The host page's workspace, planned next, adds AG Grid Community to the
host page's bundle, and whatever it brings with it. A probe on 2026-10-11
bundled `ag-grid-community` and `ag-grid-react` 36.2.0, from their npm
releases, with the worktree's React 19.3.0 and the grid modules that
design names, through this plugin: it listed `ag-grid-community`,
`ag-grid-react` and `ag-stack`, which `ag-grid-community` depends on, each
with its `LICENSE.txt`, and stopped on nothing; `prop-types`, a dependency
of `ag-grid-react`, was in no chunk and is not listed.

## Decision

A Vite plugin of this repository's own, `scripts/third-party-notices.mjs`,
in the vite configs of `apps/studio` and `apps/host`, writes
`THIRD-PARTY-NOTICES.txt` beside each app's `index.html`, and the web
image serves it with the page.

- **What it lists.** It places every module of every chunk, read as each
  chunk is rendered, and the source of every file written beside them,
  among the plugins Vite runs last (`enforce: 'post'`), after its CSS step
  and its page. One under node_modules belongs to the
  package directly below the last node_modules of its path. Each such
  package is listed once, by name and version in name order, with the
  licence its `package.json` declares, followed by the full text of
  **every** licence and notice file in its directory: a name that begins
  `LICENSE`, `LICENCE`, `COPYING` or `NOTICE`, in any case, and is not a
  script, a stylesheet, JSON, a source map or WebAssembly by its extension.
  A prefix match, so `rxjs`'s `LICENSE.txt` is found, and so is formancy's
  `NOTICE`; never `license.js`. So is every such file in a directory between
  the package's root and a bundled file of it, where a package keeps code
  it vendors under that code's licence, named by its path in the package.
- **Every module and every file is placed, or the build stops.** A bundled
  package with no licence text at its root -- no licence file, a `NOTICE`
  alone, an empty one, a script so named -- stops it, naming the package
  and version. So does a module from neither node_modules nor this
  repository, which nobody here can say the terms of; a module whose id
  begins with `\0` that is not one of the reviewed `BUNDLER_MODULES`; a
  worker, by the module that imports it with `?worker` or `?sharedworker`
  and by the file its code comes back as; and any file that names no
  source and is not a stylesheet or a source map Vite made from a chunk.
- **What it does not list.** The repository's own modules and files, a
  workspace package included, which `LICENSE.md` and `NOTICE` cover and
  the image carries; the bundler's own helpers, the `BUNDLER_MODULES`, of
  which Vite's own licence output lists none either; and the stylesheets
  and source maps Vite makes from the chunks, whose modules are placed.
- **A workspace package inlines nothing.** Every package's tsdown config
  sets `deps.onlyBundle` to nothing, so a build that would inline a
  package from node_modules into a dist fails, naming it.
- **UTF-8, and said.** Every licence file is decoded as UTF-8 strictly, a
  byte-order mark dropped; one that is not UTF-8 stops the build, naming
  the package and the file, rather than being reproduced garbled. The file
  is written as UTF-8, and `deploy/web/nginx.conf` gains `charset utf-8;`
  in its server block: `text/plain` is in nginx's default `charset_types`,
  so the file is served as `text/plain; charset=utf-8`. The pages, which
  declare UTF-8 in a meta tag, and the scripts gain the same charset in
  their Content-Type; stylesheets, not in those types, do not.
- **Build only.** The dev server and the apps' suites bundle nothing, and
  the plugin does not run there.
- **Built again when it changes.** Turbo hashes an app's own files for its
  build, and the plugin is outside both apps, so an edit to it alone would
  replay a cached `dist/` with the notices the old plugin wrote. Each app's
  `turbo.json` names the plugin among its build's inputs.

## Consequences

**What it buys.** Every package whose code or file the studio and the host
page send to a browser as a module or a file of its own has its licence
and notice texts beside the page, in the image and over HTTP, and the
NOTICE that Apache-2.0 asks to be reproduced is among them. A dependency
that ships no licence text, a module from outside the repository, a module
a plugin writes, a worker and a file nobody names the source of cannot
reach either bundle unnoticed: the build stops and names it. Nor can a
dependency inlined into a workspace package's dist, whose own build stops.
The next dependency is listed by the same build without a change here.

**What it costs.**

- **Each build reads the directory and the licence files of every package
  it bundles.** Not measured on its own.
- **The file is as long as the licences.** On 2026-10-11, as `vite build`
  reported it: the studio's 78.98 kB, 6.51 kB gzipped, and the host page's
  93.89 kB, 10.34 kB gzipped. Nothing in either page loads it, and no
  chunk or stylesheet changed: their names, which carry their hashes, are
  the same with the plugin as without.
- **A build can stop for a reason that is not the code's.** A package
  without a licence text, an update that drops one, and a Vite or Rolldown
  release that writes a helper under a new id each stop both builds until
  somebody reads what it is. The list of helpers is checked against a real
  build in the plugin's suite, so a stale entry fails there.
- **A worker stops the build.** Neither app has one. The first that does
  needs the plugin taught to read the worker's own build, through Vite's
  `worker.plugins`; until then the build names the worker and stops,
  rather than ship what it bundles unread. So does a file another plugin
  emits without naming its source.
- **The bundler's own helpers are not listed.** They are code Vite and
  Rolldown write into the chunks they make, which Vite's own licence
  output leaves out too.
- **What Vite folds in as text is not seen.** A package stylesheet that a
  stylesheet `@import`s is inlined by Vite's CSS step without being a
  module of any chunk; a package's file under the inline limit, named by a
  `url()` or a `new URL`, becomes a `data:` URL inside a chunk or a
  stylesheet; and a module whose only export is a boolean or a number is
  copied into its user and leaves no module behind. None is listed. Both
  apps import every package stylesheet from a script --
  `@formancy/themes/blueprint.css` from `main.tsx` -- their own
  stylesheets import only their own files, and neither names a package's
  file by `url()` or `new URL`; that it stays so is held by review. That
  each is still missed is held by the plugin's suite, which fails the day
  Vite reports one, so this paragraph is not left claiming a gap that is
  gone.
- **Code a package vendors is listed under the package that ships it.**
  The licence and notice files on the way to it are reproduced by their
  path in that package; a `package.json` of its own, with its name,
  version and declared licence, is not read.
- **The versions are public.** Each notices file names the exact version of
  every bundled package at a URL anyone who reaches the web front can
  read. The bundles already carry React's and Angular's; the rest are
  added here. A licence text belongs to a release, so the version stays.
- **The repository's own `LICENSE.md` and `NOTICE` are not served.** They
  are at the root of the source and in the web image, at
  `/usr/share/formancy-data/`, outside both pages; the notices file says
  so rather than point beside itself.
- **A workspace package is taken as this repository's own.** Its build is
  what holds that: a dist that would inline a dependency fails, and the
  plugin's suite fails when a package's config no longer says so. A
  dependency a package declares is not inlined, and is bundled by the app
  from node_modules, where it is listed.
- **What a licence requires beyond its text is not judged.** The file
  reproduces what each package ships; whether that satisfies the licence,
  and gate 10's legal review of the dependency inventory, are people's.
- **No page links to it.** It sits beside each page at a known path; the
  README says where.
- **The fonts are not in it.** Both pages load theirs from Google at run
  time (0032), so no font is in either build.

**What it forecloses.** Nothing permanent. Listing the bundler's helpers is
a matter of their packages' texts, should anybody decide they are owed.

## Alternatives considered

- **Vite's `build.license`.** It reads one licence file per package, never a
  NOTICE, and lists a package with no licence file rather than stopping.
- **rollup-plugin-license.** A dependency for one function, and one more
  package in the build's own supply chain.
- **Keeping the bundles' legal comments.** They have none to keep.
- **Copying node_modules' licence files into the image.** That lists what is
  installed, not what ships.
- **The module graph instead of the chunks.** It lists `@noble/hashes`,
  which neither page ships.
- **The bundle as it is at the end, read once.** A lazily loaded chunk
  that only imports a stylesheet is gone by then, and with it the only
  module that says whose the stylesheet's rules are.
- **Every module outside node_modules taken for the repository's own, as
  Vite's output does.** A dependency linked from outside the checkout would
  then ship under no licence text at all.
- **Running the plugin in Vite's worker builds too.** There is no worker to
  read, and the refusal names the first one.
- **Keeping every package's file out of `data:` URLs**, through an
  `assetsInlineLimit` that says no under node_modules. It would change
  what both apps build for a case neither has, and a `?inline` import
  passes it anyway.
- **Serving `LICENSE.md` and `NOTICE` beside each page.** Four more paths
  for the web front and its gate, one with no extension nginx has a type
  for, and nobody has asked.
- **Listing names without versions.** A reader could not tell which
  release's text is printed.
- **Listing Vite and Rolldown for their helpers.** Vite's `LICENSE.md` is
  108,786 bytes in 8.3.3, nearly all of it the licences of the
  dependencies bundled into Vite's own published package, under its
  heading "Licenses of bundled dependencies"; and Vite's own licence output
  lists none of these helpers.
- **A link to the file from each page.** The licences ask that their texts
  accompany the code, which the file beside each page does; a link is a
  change to both pages, their suites and their pictures, for nobody's
  request yet.

## Older records

Extends 0032: the web image carries, beside `LICENSE.md` and `NOTICE`, the
notices of the packages its two pages bundle, at
`/studio/THIRD-PARTY-NOTICES.txt` and `/host/THIRD-PARTY-NOTICES.txt`; its
nginx says UTF-8 for the pages, their scripts and the notices, not the
stylesheets; and the getting-started gate's
page check asks for both files. Applied and unchanged: 0001's licence and
0002's dependencies on upstream, whose NOTICE now also travels with the
bundles that carry its code.
