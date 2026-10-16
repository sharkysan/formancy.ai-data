# 0072 — The apps serve their own fonts, from Fontsource's packages at the release formancy.ai installs, and no page asks another host for anything

- **Status:** accepted; extends [0058](0058-the-browser-gates-run-in-chromium-firefox-and-webkit-and-each-fact-the-browsers-disagree-on-is-named-and-held.md), [0038](0038-readme-pictures-are-taken-by-a-script-and-held-to-the-text-they-show.md) and [0046](0046-a-built-app-carries-the-licence-and-notice-texts-of-everything-it-bundles.md); narrows [0069](0069-the-examples-page-is-served-at-formancy-ai-data-examples.md) and [0032](0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)
- **Date:** 2026-10-16
- **Deciders:** Daniel Bacher
- **Verified by:**
  - **`scripts/no-other-host.test.mjs`, in `pnpm test:repo`.** For every
    app -- every `apps/<name>/index.html`, derived, never listed -- its
    `index.html` names no address on another host, however the attribute
    is quoted; its built page and every stylesheet the page links name
    none in any `src`, `href`, `url()` or `@import`; every face of the
    build is a hashed file under `assets/` that one of the app's font
    packages ships; the first family of every stack the room and Blueprint
    draw with -- `--display`, `--sans` and `--mono` of the palette copy,
    `--fm-sans` and `--fm-mono` of `@formancy/themes/blueprint.css` -- or
    Fontsource's `<family> Variable` of it, has a face in the build; and no
    rule of the build asks a face for a width. The three apps import the
    same faces, at the versions the workspace catalog pins exactly, each as
    `catalog:`. Watched failing on `main`, 10 of its 17 cases: each
    `index.html`, and each built page, named `https://fonts.googleapis.com/`,
    `https://fonts.gstatic.com/` and the `css2` link; each build "--display's
    first family, Archivo, has no face in the build", and the same of
    `--sans`, `--mono`, `--fm-sans` and `--fm-mono`; and "apps/examples
    imports no face from a package". After the change, with Plex Mono's two
    imports taken out of the examples page: "--mono's first family, IBM
    Plex Mono, has no face in the build", the same of `--fm-mono`, and
    "apps/studio imports … where apps/examples imports …"; with
    `font-stretch: 90%` on the examples page's `h1`: "sets font-stretch";
    and with Vite's `build.assetsInlineLimit` at 100,000: "a face of
    Archivo Variable is inlined as a data: URL".
  - **The browser gates of the examples page, the studio and the host
    page, in every browser.** `scripts/browser-gate.mjs`'s `guardRequests`
    routes every request a pass's page makes: one to an origin the gate
    does not serve is refused and named at the end of the pass -- in the
    studio, on each of its two origins -- and in the pass at 320 px that
    refuses the web fonts, every `.woff2` and `.woff` is refused, whatever
    its origin. The fonts check reads its families from the faces the
    stylesheets of the built page declare. `scripts/browser-gate.test.mjs`
    holds which requests are refused -- another port of `127.0.0.1` is
    another origin, `data:` and `blob:` are no request -- what the checks
    say, and the families: quoted or bare, a stylesheet the page does not
    link or another host serves not read, and one whose path leaves `dist`
    refused; 8 of its 20 cases failed against `main`'s module. Watched
    failing on `main`, in Chromium 153 on Windows 11, in every pass of all
    three gates -- 7 in the examples page's and the host page's, 6 in the
    studio's on each of its two origins: "1 address on another origin,
    each refused:
    https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..125,500..800&…",
    and "the built page's stylesheets declare no font face". Nothing else
    failed but, in the examples page's, the console's
    "net::ERR_FAILED" for the stylesheet refused. After the
    change, the examples gate failed with the refusing pass's font route
    left out: "Archivo Variable, IBM Plex Mono and IBM Plex Sans loaded
    anyway, so this pass measured the web fonts, not the fallback stack
    (the page fetched 6 font files)"; and with the faces inlined:
    "font-src refused data", and no family loaded. With Plex Mono's imports
    taken out it passed every one of its 175 checks, which is why the
    static case of the stacks exists. With the change, the three gates
    passed every check in Chromium 153 on Windows 11 on 2026-10-16 -- 175,
    918 and 1,708 -- and the examples page's 175 in Firefox 155 too; WebKit
    runs on Linux only, so its legs in CI are the first to run them there.
  - **`scripts/demo.test.mjs`, in `pnpm test:repo`.** The demo's policy is
    `style-src 'self'` and `font-src 'self'`, and `policyProblems` derives
    `font-src`'s hosts from the faces the stylesheets' `@font-face` rules
    name and `style-src`'s from their `@import`s as well as the page's
    links: it refuses a face on another host, by an absolute or a
    protocol-relative address, a stylesheet another host serves imported by
    one of the page, the page's own faces under a `font-src` without
    `'self'`, and a face inlined as a `data:` URL. 6 of its 63 cases failed
    against `main`'s policy. `node scripts/demo.mjs --dry-run` refused the
    build with `font-src 'none'`: "a stylesheet names a face on the page's
    own origin, and font-src does not allow 'self'", and the examples gate
    refused it too, in every pass: "font-src refused
    http://127.0.0.1:…/data/examples/assets/archivo-vietnamese-wght-normal-….woff2".
    With the faces inlined it refused the build: "a stylesheet inlines a
    face as a data: URL, which font-src refuses".
  - **The getting-started gate's page check,** `pageProblems` in
    `scripts/getting-started/stack.mjs`, exempts no host. Its case in
    `scripts/getting-started/stack.test.mjs`, a page linking Google's
    stylesheet and a stylesheet naming a face on `fonts.gstatic.com`,
    against a server of its own, failed against `main`'s check: "expected
    [] to deeply equal [ …(2) ]". `pnpm test:getting-started` itself was
    not run for this record; CI's `getting-started` job runs it.
  - **`scripts/pictures/camera.test.mjs`, in `pnpm test:repo`.** The
    look's faces are each family's package, version and Google's version of
    the face, read from the packages and the same in every app; a family no
    imported package declares, and a font file from any origin but the
    app's, refuse a capture. Failed against `main`'s camera: "lookFonts is
    not a function".
  - **Review alone** holds that the faces' version is the one formancy.ai
    installs, and that a font fix upstream takes is taken here.

## Context

All three apps took Archivo, IBM Plex Sans and IBM Plex Mono from Google
Fonts: two `preconnect`s and one stylesheet link in each `index.html`.
Three things followed.

- **CI failed when Google did not answer.** The fonts check of 0058 fails
  a pass whose faces did not load, rightly, since that pass measured the
  fallback stack. On 2026-10-16 it failed the Chromium leg's first attempt
  three times, in runs 38915951921 ("Archivo, IBM Plex Mono and IBM Plex
  Sans did not load … (the page fetched 4 files from Google Fonts)"),
  38919378187 (the same, with 1 file) and 38937995522 ("Archivo did not
  load … (25 files)"). The first and the third passed on a second attempt.
  "A check that answers differently wherever the network does" is one of
  the two reasons
  [formancy.ai 0142](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0142-the-angular-starter-is-dressed-in-materials-tokens.md)
  gave for not taking a font from a font service; the next is the other.
- **Every visitor told Google their address.** For the demo at
  formancy.ai/data/examples/ that was a recorded cost of 0069. In the EU it
  is a known problem: LG München I (3 O 17493/20, 2022-01-20) held a
  website liable for passing its visitor's address to Google through Google
  Fonts. It is cited here as context, not as legal advice.
- **The demo's policy named Google's two hosts,** so fonts Google moved to
  another host would be refused until the policy was edited.

0069 declined serving the fonts from the page's own path because "the
room's fonts come from Google in every page of formancy.ai's family". They
no longer did when 0069 was written: formancy.ai's site stopped on
2026-10-09
([formancy.ai 0154](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0154-the-website-makes-no-request-to-any-other-site.md)),
and its admin, whose palette these apps copy, on 2026-10-10 (formancy.ai
#240), both from Fontsource's packages at 5.3.0. Upstream 0154 also
rejected writing `@font-face` rules by hand, because they copy Fontsource's
unicode ranges where nothing checks them.

**Measured before deciding, on 2026-10-16,** in Chromium 153.0.8010.12 on
Linux, the pictures' browser, at the pictures' settings:
- Google's Archivo and Plex Mono files, as Google serves them to that
  browser, are byte-identical to Fontsource 5.3.0's.
- Google's Plex Sans is one variable file per subset, which
  `@fontsource/ibm-plex-sans` serves as static instances: the same advance
  widths for all 232 characters of the Latin subset at 400, 500 and 600,
  the same vertical metrics, and outlines that differ at 500 and 600
  (fontTools 4.64.0).
- Drawn, they differ at glyph edges only: 13,357 device pixels of the
  examples page at scale 2, at most 66 of 255 in a channel, the page the
  same height and no line moved. Archivo's `wght.css` drew the same pixels
  as its `wdth.css` at the default width.

## Decision

**The faces are Fontsource's packages, at exactly 5.3.0,** pinned once in
the workspace catalog, the release formancy.ai's site and admin install:
`@fontsource-variable/archivo`'s `wght.css`, `@fontsource/ibm-plex-sans`'
400, 500 and 600, and `@fontsource/ibm-plex-mono`'s 400 and 500. Each app
depends on them as `catalog:` and imports them in its `src/main.tsx`,
beside the Blueprint theme, every subset and both formats as the packages
ship them. Vite bundles them under `assets/` with hashed names. The font
stacks do not change.

**No page asks another host for anything.** The `index.html` links are
gone. The demo's policy is `style-src 'self'` and `font-src 'self'`,
derived from the built stylesheets. Each browser gate refuses and names
any request to an origin it does not serve, and the getting-started gate's
page check exempts no host.

**What is "refused" changes.** Once the fonts are the page's own, a
network that blocks Google is no longer why a pass refuses them; the swap
period before the faces arrive, and a browser or an extension that refuses
web fonts, still are. That pass refuses every font file, whatever its
origin.

**The look names packages.** A README picture's look records each face as
its package, version and Google's version of it, read from the packages
the app imports. `pnpm pictures --check` no longer refuses the fonts: it
reads them from `dist`, as the pictures were taken.

## Consequences

**What it buys.**
- **The gates no longer depend on the network for fonts,** and the runner
  tells nobody anything.
- **A visitor's browser asks formancy.ai,** or the operator's own server,
  **and nobody else.**
- **The demo's policy names no host.**
- **The notices carry the fonts' licence:** the three packages are listed
  with their OFL text, `@fontsource-variable/archivo 5.3.0`,
  `@fontsource/ibm-plex-mono 5.3.0` and `@fontsource/ibm-plex-sans 5.3.0`.
- **The pages draw what formancy.ai's admin draws,** from the same files.

**What it costs.**
- **Bytes in every build.** Each app's build carries 59 font files,
  757,316 bytes: 31 WOFF2, 437,032 bytes, and 28 WOFF, 320,284 bytes, the
  static faces' fallback, which no browser the gates run fetches. Its
  stylesheet carries 31 `@font-face` rules: 10,751 bytes in the examples
  page's, 1,332 gzipped, and 11,105 in the studio's and the host page's,
  1,339 gzipped. The web image holds two such sets. Measured with Vite
  8.3.3 on 2026-10-16.
- **What a visitor fetches** on the examples page, in Chromium
  153.0.8010.12 on Windows 11 on 2026-10-16: 6 files, 135,548 bytes,
  Latin only, where Google's were 4 files of 165,412 bytes and a 12,668-byte
  stylesheet, measured the same day in the same Chromium on Linux. The
  studio and the host page were not measured.
- **The look moves once.** IBM Plex Sans at 500 and 600 is anti-aliased
  differently, so every README picture is retaken with `pnpm pictures
  --all` on the look's Linux Chromium: 0038 refuses two looks in one
  record.
- **A font fix reaches the pages only by a version bump here,** and nothing
  says one is due; keeping to upstream's release is review's.
- **No width axis.** A rule asking Archivo for a width would draw the
  normal width; the static case fails first.
- **A local font named Archivo wins.** The stacks name `Archivo` before
  `Archivo Variable`, as upstream's do, and nothing defines `Archivo` by
  `@font-face` now, so a machine with a font installed under that name
  draws the headings in it. A browser gate on such a machine fails: the
  page never loads `Archivo Variable`.
- **What the run-time check does not see:** a request only an interaction
  the gates do not perform makes, and a connection with no request.

**What it forecloses.** Nothing that cannot be undone.

## Alternatives considered

1. **Keep Google, and retry the pass or the font load.** A retry hides a
   real failure, every run still tells Google about the runner, and every
   visitor still tells Google about themselves.
2. **Another font CDN,** jsDelivr's copy of Fontsource or Bunny Fonts.
   Still a third party that learns every visitor's address, a host in the
   policy, and a network the gates depend on.
3. **System fonts only.** Not the room, and every picture and every gate's
   widths would change with the operating system.
4. **Font files committed to the repository.** The notices plugin lists a
   bundled file under `node_modules` with its package's licence, and
   treats a file of this repository as this repository's own, under
   `LICENSE.md`: the fonts would ship with no OFL text, and nothing would
   fail. The `@font-face` rules and their unicode ranges would be written
   by hand, which upstream 0154 rejected, and the files would have no
   version.
5. **Google's exact pixels:** rules of this repository's own naming `IBM
   Plex Sans` over `@fontsource-variable/ibm-plex-sans`' files, which are
   byte-identical to Google's. Measured identical to Google, and 25,312
   bytes lighter per visitor than the static faces. Not taken: hand-written
   unicode ranges, and pages that would then draw unlike formancy.ai's
   admin.
6. **`wdth.css`, as upstream's admin imports.** Byte-identical to Google's
   Archivo, but 130,032 bytes more per build and 55,176 per visitor for an
   axis no rule uses, and measured pixel-identical to `wght.css` here.
7. **Fewer subsets, or no WOFF.** It saves build bytes only, since a
   browser fetches only the subsets the text needs. It would take a plugin
   that rewrites a package's stylesheet, or Fontsource's per-subset
   stylesheets, which carry no unicode range; and the studio and the host
   page show what a database holds, in any script.
8. **`@import` in the room's stylesheet, as upstream's admin.** The gates'
   and the camera's stylesheet readers refuse a package `@import` on
   purpose, so that a gate never checks less than the page loads; and
   `main.tsx` already imports the theme.
