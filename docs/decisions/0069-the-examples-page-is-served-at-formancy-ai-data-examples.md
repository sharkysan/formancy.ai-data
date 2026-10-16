# 0069 — The examples page is served at formancy.ai/data/examples/, by a Worker of its own that Cloudflare deploys from main, under a policy that refuses anything inline

- **Status:** accepted; extends [0021](0021-generated-forms-preview-in-both-frameworks.md), [0037](0037-cloudflare-is-the-edge-not-the-runtime.md) and [0046](0046-a-built-app-carries-the-licence-and-notice-texts-of-everything-it-bundles.md); narrowed by [0072](0072-the-apps-serve-their-own-fonts-and-no-page-asks-another-host-for-anything.md): the policy names no font host -- `style-src 'self'` and `font-src 'self'`, derived from the faces the built stylesheets name -- its costs *Google is asked for the fonts* and *The policy names hosts* are history, its alternative *Fonts served from the page's own path* is taken, and the gate's check that the page fetched nothing but its own files and the web fonts exempts no font host: it reads what the page fetched of its own origin, under `/data/examples/`, and an address on another host fails the check of what the browser refused under the policy, or, where the policy does not govern it, 0072's check of every request to another origin
- **Date:** 2026-10-16
- **Deciders:** Daniel Bacher
- **Verified by:**
  - **`scripts/demo.test.mjs`, in `pnpm test:repo`.**
    - `apps/examples/wrangler.json` routes `formancy.ai/data/examples/*`,
      and `formancy.ai/data/examples` without its slash, on formancy.ai's
      zone, and nothing else.
    - `scripts/demo.mjs` refuses a config that names another Worker than
      `formancy-data-examples` -- formancy.ai's, the report's, or none --
      or routes `/data` itself, the bare `/data` beside the demo, anything
      wider, another path, another hostname, a Custom Domain, a workers.dev
      or preview address, code, a binding, an assets binding or code run
      before the assets, another staging directory, and any
      `html_handling` or `not_found_handling` but the demo's.
    - It refuses a built page that asks formancy.ai for a file other than
      by a path relative to the page -- an absolute path, an address that
      names formancy.ai, protocol-relative or not, or a relative one that
      climbs out of the demo's path -- whether the attribute is
      double-quoted, single-quoted or unquoted.
    - It refuses a file in `assets/` that the public directory put there,
      whatever its name, and one whose name has not the shape Vite gives a
      hashed one; and an examples Vite config, resolved as `vite build`
      resolves it, that names what it bundles by a pattern without
      `[hash]` or by a function, or writes it to another directory than
      `assets/`. The committed config does none of it.
    - The Content-Security-Policy is the one below, directive by
      directive, and names exactly the hosts `index.html` loads from, each
      in the directive it loads under and each address resolved as the
      page resolves it, and `data:` exactly when the page or its
      stylesheets use a data: URL. It refuses an inline script or style in
      the page, a script from another host -- by an absolute,
      protocol-relative, single-quoted or unquoted address, or after a `>`
      in a quoted attribute -- a font host missing, a host the page never
      loads, `'unsafe-inline'`, `'unsafe-eval'` and a directive missing.
    - The `_headers` file reads back as the rules, gives each path what
      Cloudflare's documented matching gives it -- the notices
      `text/plain; charset=utf-8` -- and is within Cloudflare's limits.
    - `scripts/demo-serve.mjs`, through which the browser gate serves the
      page, answers 404 at `/`, at `/index.html` and at `/data/`, sends
      `/data/examples` on to `/data/examples/`, both with none of the
      deploy's headers, and sends each file under it with the headers the
      deploy writes, over the type Cloudflare gives it -- a `.txt` the
      rules do not name is bare `text/plain` -- and a file under it that
      is not there as a 404 with them, as the address answered when read.
    - The Workers Builds settings `.github/REPO-METADATA.md` records are the
      demo's Worker and this repository, as data-core's manifest names it,
      and so is every Worker and repository its steps for creating the
      Worker name; their build and deploy commands are
      `pnpm demo:deploy`'s two halves. `.node-version` is the Node every
      gate and the release run on. No workflow runs the deploy or names a
      Cloudflare token.
    - README's *Try it* and *Examples* name the address the route serves,
      and *Examples* only the page's port.

    Each was watched failing first: 41 of its 47 cases failed against a
    `demo.mjs` and a `demo-headers.mjs` that accepted everything. The
    check of REPO-METADATA.md failed with the report's repository put in
    the table, and again in the steps alone: "expected
    'sharkysan/formancy.ai-report' to be 'sharkysan/formancy.ai-data'";
    and with the report's Worker as the steps' project name: "expected
    'formancy-report-studio' to be 'formancy-data-examples'". The cases
    for the Worker's name, the addresses however quoted, the public
    directory and the naming patterns, the server, the notices' type and
    `default-src 'none'` -- 17 of them -- failed against exports that
    accepted everything and the parsing, the rules and the server as they
    were before: among them "expected [] to deeply equal [
    'src="/assets/x.js"' ]", "expected [] to deeply equal [
    'fixture-snapshot.json', …(1) ]", "expected
    'text/plain; charset=utf-8' to be 'text/plain'" and "expected
    undefined to be 'text/plain; charset=utf-8'". The server's 404 under
    the path and its redirect, held once the address had been read,
    failed against the server that sent that 404 bare: "the 404 under the
    path: Content-Security-Policy: expected null to be 'default-src
    'none'; script-src 'se…'"; and with the headers put on the redirect,
    then on the 404 outside the path: "the redirect's
    Content-Security-Policy: expected 'default-src 'none'; script-src
    'se…' to be null", and the same of "the 404 outside the path".
  - **`scripts/third-party-notices.test.mjs`, in `pnpm test:repo`.** The
    examples build runs the notices plugin, and names it among its turbo
    build inputs, so an edit to the plugin alone builds the page again.
    Watched failing without `apps/examples/turbo.json`: "expected { name:
    'examples', plugin: false }".
  - **`apps/examples/src/page.test.tsx`.** The header says no server and no
    database are behind the page, and links the repository at the address
    data-core's manifest gives. Watched failing before the line existed.
  - **The browser gate, `apps/examples/scripts/browser-test.mjs`, in CI's
    browser legs.** Every check of the page runs with it served by
    `scripts/demo-serve.mjs` under `/data/examples/`, each file with the
    headers parsed back from the `_headers` text the deploy writes. In
    every pass it checks that the page was sent with them, that the
    browser refused nothing under the policy, that the console said no
    error and the page threw none, that the page fetched nothing but its
    own files and the web fonts, that an inline script put in the page was
    refused and the refusal heard, which it records how long after, and
    that `THIRD-PARTY-NOTICES.txt` was sent as UTF-8 text. Watched failing
    on 2026-10-16, in Chromium:
    - with the notices' rule taken out of the headers: "answered 200
      text/plain, not 200 text/plain; charset=utf-8", in all seven passes,
      and nothing else;
    - with an inline script in `index.html`: "script-src-elem refused
      inline", and the console's "Executing inline script violates the
      following Content Security Policy directive";
    - with `font-src 'self'`: "font-src refused
      https://fonts.gstatic.com/…", and "Archivo, IBM Plex Mono and IBM
      Plex Sans did not load";
    - with the server sending no headers: "not as the deploy writes them",
      and the inline script "ran, so the page was measured under no
      policy";
    - with Vite's default absolute base: "0 of 0 previews".

    With the committed files it passed every check in Chromium 153 and in
    Firefox 155, on Windows 11, under `default-src 'none'`. WebKit runs on
    Linux only, so its leg in CI is the first to run it there.
  - **By hand, on 16 October 2026.** `node scripts/demo.mjs --dry-run`,
    with Wrangler 4.146.0, read 9 entries from the staging directory -- the
    page's five files, three directories and `_headers` -- logged "Ignoring
    asset: _headers", matched both routes to its `data/examples` directory,
    found no bindings and uploaded nothing; run again with the checks
    above, it read the same 9 and uploaded nothing. With a file put in
    both `apps/examples/public/assets/` and the build's `assets/`, it
    refused the build: "assets/ holds files copied from the public
    directory or whose names carry no hash, which the headers would cache
    for a year: fixture-snapshot.json". With a copy of a chunk put in the
    build's `assets/` under another hashed name, as turbo leaves an
    earlier build's files when it replays a cached build over `dist/`, it
    refused the build: "assets/ holds files the page never loads, an
    earlier build's, which the deploy would serve too" (the case in
    `scripts/demo.test.mjs` watched failing first against a check that
    found nothing). Once the demo was live, the same day, what the address
    sends was read with curl and in Chromium, as *What it costs* says;
    nothing reads it again.
  - **Review alone** holds what is in Cloudflare's dashboard and GitHub's
    settings: that the Worker is connected with the settings
    REPO-METADATA.md records, that no other branch is built and no
    variable set, and that the GitHub app's access is to this repository.

## Context

The examples page, `apps/examples`, generates forms in the browser from a
captured PostgreSQL snapshot and renders each with both formancy renderers
([0021](0021-generated-forms-preview-in-both-frameworks.md)). It needs no
server and no database, so any static host can serve it. Until now it ran
only from a clone.

Formancy Report's Studio is online at formancy.ai/report/, served by a
Worker of its own that Cloudflare's Workers Builds deploys from that
repository's `main` (formancy.ai-report 0018). The rightsholder chose to
put this page online the same way, at formancy.ai/data/examples/.

formancy.ai's website is one static deployment from formancy.ai's own
repository, served by a Worker named `formancy-ai`. That repository is
Apache-2.0. This one is not, which is why it is separate
([0001](0001-a-paid-module-in-its-own-repository.md)). `formancy.ai/data`
is kept for this product's page, in that site's shell (formancy.ai 0106;
CLAUDE.md, "One shell for every page of the site").

[0037](0037-cloudflare-is-the-edge-not-the-runtime.md) decided that
Cloudflare is this product's edge and cannot be its runtime. It set aside
Pages and Workers static assets for the studio and the host page, because
each would then be on another origin than `/v1`, which both speak to. The
examples page speaks to no server, so that reason does not reach it. The
rest of 0037 stands, and this record keeps to it: the Worker has no code.

A public page is a distribution. The page bundles React, Angular and
upstream formancy, whose licences ask that their texts go with them
([0046](0046-a-built-app-carries-the-licence-and-notice-texts-of-everything-it-bundles.md)).
The examples build did not write them, because it was never served. And a
public page should refuse what it does not mean to run. The report's demo
sends no header of its own, and neither does formancy.ai's site.

**Measured on 2026-10-16**, on the built page and in Chromium:
- **Nothing in the page is evaluated or inline.** Angular is compiled
  ahead of time by the analog plugin. No chunk holds `new Function` or a
  call of `eval`, and `index.html` has no inline script or style. Under
  the policy below the gate saw no violation, in Chromium or in Firefox:
  what React and Angular style, they style through the CSSOM, which
  `style-src` does not govern.
- **The Blueprint theme draws two data: SVGs,** the date and time fields'
  icons, inside `@supports (-webkit-touch-callout: none)`, which is Safari
  on a touch device. `index.html`'s icon is `data:,`.
- **axe fetched Google Fonts' stylesheet** to read its rules, which a
  `connect-src` of `'self'` refuses, three times a pass. Without that
  preload, the outcome of every rule axe ran over the page was the same:
  27 rules ran and 37 did not apply.
- **The notices are not ASCII.** The examples build's
  `THIRD-PARTY-NOTICES.txt` holds four curly quotes, of a bundled MIT
  text's "Software". Workers static assets, with no `_headers`, sent the
  report's `formancy.ai/report/THIRD-PARTY-NOTICES.txt` as `Content-Type:
  text/plain`, with no charset, whose encoding a browser guesses.
- **What Playwright evaluates is not held to the page's policy:** `new
  Function` in an evaluation built and ran under it, in Chromium 153 and
  Firefox 155. axe-core 4.14.0, loaded and run as the gate runs it, built
  no function through the global `Function`, in jsdom or in either
  browser.

## Decision

**The demo is https://formancy.ai/data/examples/.**

**A Cloudflare Worker of its own serves it.** The Worker,
`formancy-data-examples`, has static assets and nothing else: no code and
no binding. It is routed at `formancy.ai/data/examples/*` and at
`formancy.ai/data/examples` on formancy.ai's zone, with no workers.dev
address and no preview address. A route takes precedence over a Worker on
the same hostname's Custom Domain, and a more specific route over a less
specific one. So formancy.ai's own Worker never sees a request under
`/data/examples/`, and this Worker sees no other request. `/data` itself
stays formancy.ai's. Wrangler deploys to whichever Worker the config
names, so the deploy refuses any name but this one: formancy.ai's
`formancy-ai` would serve this page in place of the whole site.

**What it is not.**
- **Not the product's runtime, nor a deployment of it.** No data server,
  no database, no administrator or runtime plane, no studio and no host
  page are behind the address. Each stays where
  [0032](0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)
  and 0037 put it, beside `/v1` on one origin, with Cloudflare at most its
  edge.
- **No code at the edge.** The Worker has no script. What runs is the page,
  in the visitor's browser, generating forms from the snapshot the build
  carries. Workers Builds runs `pnpm build` and the deploy on Cloudflare's
  build machine, which serves nothing.
- **Not formancy.ai/data.** That path, and the site's shell around it, are
  formancy.ai's, for the product's page when it exists.
- **Not a page of formancy.ai's site.** formancy.ai 0106's one shell --
  its bar, its footer, its navigation -- is for the pages the site's own
  build makes. This is an app served on the site's hostname: it wears the
  room's look (CLAUDE.md, "The same room") with a masthead of its own, and
  has no site bar, no site footer and no link back to formancy.ai. The
  shell is a component of that repository's build; drawing it here would
  mean importing it into this build or copying it, which is 0001's line
  and the divergence 0106 exists to prevent. `formancy.ai/data`, when it
  is a page, is the page in the shell.

**The page is built with a relative base.** Vite's `base` is `./`, so one
build is right at the root of `vite preview`, for `pnpm demo`, and under
`/data/examples/`. The deploy copies the build under `data/examples/` in
`apps/examples/.cloudflare`, the directory the config names, and removes it
afterwards.

**Every file under the path is sent with these headers.** The deploy
writes them as the `_headers` file at the staging directory's root, from
`scripts/demo-headers.mjs`:
- **`Content-Security-Policy`:** `default-src 'none'; script-src 'self';
  style-src 'self' https://fonts.googleapis.com; font-src
  https://fonts.gstatic.com; img-src data:; connect-src 'self'; object-src
  'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.
  `'self'` is formancy.ai's whole origin, not this path. A source with a
  path, `https://formancy.ai/data/examples/`, would hold scripts, styles
  and fetches to the page's own files, but the gate serves the page from
  `127.0.0.1`, where that policy refuses every file, so it could not be
  measured.
- **`X-Content-Type-Options: nosniff`** and **`Referrer-Policy:
  no-referrer`**.
- **`Permissions-Policy`,** denying every feature in the module's list,
  none of which the page uses.
- **`Cache-Control: public, max-age=31536000, immutable`** for `assets/`
  alone, whose names Vite writes with a hash. The page itself keeps
  Cloudflare's default, revalidated on each load.
- **`Content-Type: text/plain; charset=utf-8`** for
  `THIRD-PARTY-NOTICES.txt`, as 0046 serves it from the web image.
  Cloudflare documents that a header the file names overrides what it
  sends by default, and the address sent the notices so when read.

What Cloudflare sends with its redirect of the path without its slash,
and with a 404, its documentation does not say. Read at the address on
2026-10-16, the redirect carried none of these headers, and a 404 for a
file under the path the policy, `nosniff`, `no-referrer` and the
Permissions-Policy.

**The browser gate serves it where the demo is,** through
`scripts/demo-serve.mjs`: under the path read from the Worker's config,
each file with the headers read back from that file's text over the type
Cloudflare gives it, a file that is not there a 404 with them, and the
path without its slash a redirect with none. It fails on anything the
policy refuses, and on notices not sent as UTF-8 text. Its axe audits run
without axe's preload.

**The page says what it is.** Its header says that no server and no
database are behind it, and links the repository.

**The page carries its third-party notices.** The examples build writes
`THIRD-PARTY-NOTICES.txt` as the studio's and the host page's do, the
deploy refuses a build without it, and it is sent as UTF-8 text, as the
web image sends theirs.

**Cloudflare deploys it from `main`, on every push.** Workers Builds
connects the Worker to this repository, through the Cloudflare Workers and
Pages GitHub app given access to it. Its settings, recorded in
`.github/REPO-METADATA.md` with the steps that create the Worker, are:
- **Root directory:** the repository's root.
- **Build command:** `pnpm build`.
- **Deploy command:** `node scripts/demo.mjs`.
- **Branches:** `main` is the production branch, and no other branch is
  built.
- **Variables:** none.

Those two commands are `pnpm demo:deploy`, the same command run by hand.
`scripts/demo.mjs`:
- checks the config, the examples Vite config and the built page;
- refuses a checkout with uncommitted changes, so the deployment's
  message names the commit it holds;
- runs Wrangler at a pinned version, with its telemetry off.

Workers Builds generates its own API token, picks Node from
`.node-version`, and its pnpm runs the version `packageManager` names, as
formancy.ai-report 0018 records.

## Consequences

**What it buys.**
- **A demo with nothing to install.** Anyone can open it, beside the
  report's Studio.
- **The gated build in the served shape.** The browser gate runs the build
  under `/data/examples/` and under the headers the deploy writes, not only
  at a root.
- **A page that refuses what it does not mean to run.** A script injected
  into it, from a string or another host, is refused by the browser.
- **No Cloudflare token in GitHub.** No credential able to change
  formancy.ai's zone is held by this repository or its workflows.
- **formancy.ai untouched.** Its repository, its build and its Worker carry
  none of this repository's code, so its licence stays true without
  qualification.

**What it costs.**
- **Main's page, not the release's.** The demo is what `main` holds, so it
  can show what no release has published yet.
- **No wait for CI.** Workers Builds deploys a push to `main` without
  waiting for that commit's CI. The merge commit's own run goes alongside
  the deploy, not before it.
- **Settings outside the repository.** The Worker's build settings are in
  Cloudflare's dashboard. A test holds what REPO-METADATA.md records to
  `pnpm demo:deploy`, but nothing reads what the dashboard holds.
- **Another build machine,** and a whole build. Workers Builds builds on
  Cloudflare's image, with the gates' Node major, pnpm and lockfile.
  `pnpm build` builds every package and app, not the page alone.
- **The Cloudflare GitHub app on this repository.** Workers Builds reads
  the repository through the Cloudflare Workers and Pages GitHub app, which
  must be given access to it. That installation is a setting of the
  rightsholder's GitHub account; REPO-METADATA.md records the step, and
  nothing here reads it.
- **Cloudflare's serving read once, by hand.** When this was decided, no
  answer from the address had been read: that the routes take precedence
  over formancy.ai's Worker, that `/data/examples` is sent on to
  `/data/examples/`, how `_headers` is matched, and that its
  `Content-Type` overrides the one Cloudflare picks were from Cloudflare's
  documentation, which the gate's parser and server follow, and only the
  report's notices had been read, as bare `text/plain`. Once the demo was
  live, on 2026-10-16, the address was read with curl and in Chromium:
  - `/data/examples/` answered 200 `text/html`, with the policy, the
    Permissions-Policy, `no-referrer` and `nosniff`;
  - `THIRD-PARTY-NOTICES.txt` answered 200 `text/plain; charset=utf-8`,
    with those headers and Cloudflare's `public, max-age=0,
    must-revalidate`;
  - a hashed chunk under `assets/` was sent as `text/javascript`, with
    `public, max-age=31536000, immutable`;
  - a file under the path that is not there, `nope.js`, answered 404 with
    the policy, the Permissions-Policy, `no-referrer` and `nosniff`;
  - `/data/examples` answered 307 to `/data/examples/`, with none of the
    headers;
  - `/data` answered formancy.ai's own 404;
  - in Chromium the page drew `sales.order` in both previews, React's and
    Angular's.

  The gate's server answers the redirect and a 404 as they were read; a
  missing file under `assets/`, which the rules give a year's cache too,
  was not. Nothing here reads the address again: a later deploy, a change
  of Cloudflare's or a setting of the zone could add or change a header
  and nothing would fail. After a deploy, `curl -sI
  https://formancy.ai/data/examples/THIRD-PARTY-NOTICES.txt` shows the
  notices' type again; nothing here runs it. A failed build leaves the
  last deployment serving, and its log is in Cloudflare's dashboard.
- **Cloudflare's own script is refused.** Cloudflare's bot detection,
  JavaScript Detections, puts an inline `<script>` into the page as it
  serves it, just before `</body>`, which loads
  `/cdn-cgi/challenge-platform/scripts/jsd/main.js`; the built
  `index.html` has none. The policy refuses it as it refuses any inline
  script, and Chromium's console says so once on every load: "Executing
  inline script violates the following Content Security Policy directive
  'script-src 'self''". Nothing on the page depends on it, and Cloudflare
  gets no bot signal from this path. The notices, sent as text, get no
  script. formancy.ai's site and the report's Studio send no policy, so it
  runs there. The gate cannot see it, because its server is not
  Cloudflare: the gate's "no console error" holds the build, and at the
  address that one error is expected on every load. Read on 2026-10-16,
  in Chromium; nothing reads it again.
- **`'self'` is all of formancy.ai.** The policy allows scripts, styles
  and fetches from any path of the origin -- formancy.ai's site, the
  report's Studio at `/report/`, and whatever is routed there later -- so
  markup injected into the page could load a script from one of them. A
  source with the page's path would close that, and could not be measured
  in a gate that serves the page from `127.0.0.1`.
- **A page on the site's hostname without the site's shell.** A visitor
  sees formancy.ai in the address bar and no site bar, footer or link back
  to it, which formancy.ai 0106 decided against for the site's own pages.
- **The deploy loads the page's Vite config** to read its public
  directory and how it names files: 2.9 s with its plugins, measured on
  this machine on 2026-10-16.
- **A compatibility date to move.** `apps/examples/wrangler.json` names
  `2026-09-18`, as the report's Worker does. Cloudflare ties changes in a
  Worker's behaviour to that date; which of them reach a Worker with no
  code was not read. The date stays until someone reads what moving it
  changes, and nothing here says when that is due.
- **A public page.** What the build bundles -- data-core's generator,
  upstream formancy, React, Angular and the captured snapshot of the
  synthetic fixture -- is sent to anyone who opens the address. `noindex`
  asks search engines to leave it out; nothing keeps a copy away.
- **Google is asked for the fonts.** A visitor's browser sends Google
  their address, as formancy.ai's site does. `no-referrer` keeps the
  page's address out of the request.
- **The policy names hosts.** If Google moves its fonts to another host,
  the browser refuses them and the page falls back to its system stack
  until the policy is edited. The gate fails first.
- **`img-src data:` is held by derivation, not by a browser.** The icons it
  allows are drawn only by Safari on a touch device, which no gate runs.
- **axe runs without its preload.** That was measured equal on this page
  today. A page that gained media or a cross-origin stylesheet some rule
  reads would be audited with less.
- **axe runs outside the policy.** What Playwright evaluates is not held
  to the page's policy, as measured, so the gate's violation check holds
  the page's code and not axe's.
- **A stricter gate.** It now fails on any console error, so a browser
  release that logs a new one fails it until someone reads why; and on
  notices not sent as UTF-8 text.
- **The notices are public.** `THIRD-PARTY-NOTICES.txt` names the exact
  version of every package the page bundles, to anyone. The repository's
  own `LICENSE.md` and `NOTICE` are not staged; the page links the
  repository, where they are.
- **One engine's snapshot.** The demo shows forms generated from a
  PostgreSQL snapshot, as the page always has; nothing of SQL Server is on
  it.

**What it forecloses.** Nothing that cannot be undone. Disconnecting the
repository, or taking the GitHub app's access to it away, stops the
deploys. Deleting the Worker gives `/data/examples/` back to formancy.ai's
404.

## Alternatives considered

**A job in `ci.yml` that deploys after the gates of the same run.**
Rejected. It would deploy only a commit whose own gates passed, which
Workers Builds does not wait for. But it puts a token able to change
formancy.ai's zone into a GitHub environment, and it deploys this site
otherwise than formancy.ai's and the report's.

**Deploy by hand after each release.** Rejected as the only way. The demo
would fall behind whenever a deploy was forgotten. `pnpm demo:deploy`
stays for a deploy outside the pushes.

**At `formancy.ai/data/`.** Rejected. That path is the product's page, in
formancy.ai's site shell, built in that repository. A demo there would be a
second site under the product's name.

**Copy the built page into formancy.ai's build, as its playground is.**
Rejected. formancy.ai's repository is Apache-2.0 and this one is
source-available: the copy would put this repository's code into that
repository's build and deployment, which 0001 keeps apart. It would also
tie the demo to formancy.ai's releases.

**Cloudflare Pages.** Not chosen. A Pages project is attached to a whole
hostname: Cloudflare's guide for moving from Pages to Workers, read on
2026-10-16, lists a route below a hostname's root as supported by Workers
and not by Pages. So a path of formancy.ai would need a Worker in front of
the project, which is code at the edge (0037). A Pages project also answers
at a `pages.dev` address of its own. formancy.ai's site and the report's
demo are Workers with static assets already.

**A workers.dev address, or a preview address per version.** Rejected.
Either is a second address for the product, at Cloudflare's hostname,
beside its website. A preview address would answer for every version
uploaded, each at an address nothing here lists. The deploy refuses both
in the config.

**GitHub Pages, or a subdomain as a Custom Domain.** Not chosen. Each is a
second address for the product beside its website.

**Build with `base: '/data/examples/'`.** Rejected. `pnpm demo` would have
to serve under that path as well, and the built page would hold the path
the config already says.

**The headers from Worker code.** Rejected. It would be code at the edge,
which 0037 keeps out, and Cloudflare applies `_headers` only to what the
assets answer.

**Turn JavaScript Detections off.** Not chosen. It is a setting of
formancy.ai's whole zone, so it would change what formancy.ai's site and
the report's Studio are served with too, to quiet one console line on a
page that needs nothing from the script.

**Let Cloudflare's script run.** Rejected. The script differs on every
response -- it carries a token of the request -- so no hash in the policy
could match it, and only `'unsafe-inline'` would allow it, which lets any
script injected into the page run too. A nonce would have to be new on
every response and written into both the header and the script, which
takes code on each request, and the Worker has none (0037).

**The policy in a `<meta>` element.** Rejected. A meta policy cannot carry
`frame-ancestors`, and it would also bind `pnpm dev`, where the React
plugin's refresh preamble is an inline script.

**Fonts served from the page's own path.** Not chosen now. It would take
Google's hosts out of the policy and visitors' addresses away from Google.
But the room's fonts come from Google in every page of formancy.ai's
family, and changing that is not this page's decision alone.

**`require-trusted-types-for 'script'`.** Not chosen. Nothing measured
that React and Angular's output keep to Trusted Types on this page. It can
be added when a gate shows it.
