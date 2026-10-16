# 0069 — The examples page is served at formancy.ai/data/examples/, by a Worker of its own that Cloudflare deploys from main, under a policy that refuses anything inline

- **Status:** accepted; extends [0021](0021-generated-forms-preview-in-both-frameworks.md) and [0046](0046-a-built-app-carries-the-licence-and-notice-texts-of-everything-it-bundles.md)
- **Date:** 2026-10-16
- **Deciders:** Daniel Bacher
- **Verified by:**
  - **`scripts/demo.test.mjs`, in `pnpm test:repo`.**
    - `apps/examples/wrangler.json` routes `formancy.ai/data/examples/*`,
      and `formancy.ai/data/examples` without its slash, on formancy.ai's
      zone, and nothing else.
    - `scripts/demo.mjs` refuses a config that routes `/data` itself, the
      bare `/data` beside the demo, anything wider, another path, another
      hostname, a Custom Domain, a workers.dev or preview address, code, a
      binding, an assets binding or code run before the assets, another
      staging directory, and any `html_handling` or `not_found_handling`
      but the demo's.
    - It refuses a built page that asks for a file by an absolute path,
      and a file in `assets/` whose name carries no hash.
    - The Content-Security-Policy is the one below, directive by
      directive, and names exactly the hosts `index.html` loads from, each
      in the directive it loads under, and `data:` exactly when the page or
      its stylesheets use a data: URL. It refuses an inline script or style
      in the page, a script from another host, a font host missing, a host
      the page never loads, `'unsafe-inline'`, `'unsafe-eval'` and a
      directive missing.
    - The `_headers` file reads back as the rules, gives each path what
      Cloudflare's documented matching gives it, and is within Cloudflare's
      limits.
    - The browser gate imports the demo's path and the headers from the
      deploy's own modules.
    - The Workers Builds settings `.github/REPO-METADATA.md` records are the
      demo's Worker, and their build and deploy commands are
      `pnpm demo:deploy`'s two halves. `.node-version` is the Node every
      gate and the release run on. No workflow runs the deploy or names a
      Cloudflare token.
    - README's *Try it* and *Examples* name the address the route serves,
      and *Examples* only the page's port.

    Each was watched failing first: 41 of its 47 cases failed against a
    `demo.mjs` and a `demo-headers.mjs` that accepted everything.
  - **`scripts/third-party-notices.test.mjs`, in `pnpm test:repo`.** The
    examples build runs the notices plugin, and names it among its turbo
    build inputs, so an edit to the plugin alone builds the page again.
    Watched failing without `apps/examples/turbo.json`: "expected { name:
    'examples', plugin: false }".
  - **`apps/examples/src/page.test.tsx`.** The header says no server and no
    database are behind the page, and links the repository at the address
    data-core's manifest gives. Watched failing before the line existed.
  - **The browser gate, `apps/examples/scripts/browser-test.mjs`, in CI's
    browser legs.** Every check of the page runs with it served under
    `/data/examples/`, each answer with the headers parsed back from the
    `_headers` text the deploy writes. In every pass it checks that the
    page was sent with them, that the browser refused nothing under the
    policy, that the console said no error and the page threw none, that
    the page fetched nothing but its own files and the web fonts, and that
    an inline script put in the page was refused and the refusal heard.
    Watched failing on 2026-10-16, in Chromium:
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
    Firefox 155, on Windows 11. WebKit runs on Linux only, so its leg in CI
    is the first to run it there.
  - **By hand, on 16 October 2026.** `node scripts/demo.mjs --dry-run`,
    with Wrangler 4.146.0, read 9 entries from the staging directory -- the
    page's five files, three directories and `_headers` -- logged "Ignoring
    asset: _headers", matched both routes to its `data/examples` directory,
    found no bindings and uploaded nothing.

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
Cloudflare is the edge and not the runtime. This record keeps to it: the
Worker has no code.

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
stays formancy.ai's.

**The page is built with a relative base.** Vite's `base` is `./`, so one
build is right at the root of `vite preview`, for `pnpm demo`, and under
`/data/examples/`. The deploy copies the build under `data/examples/` in
`apps/examples/.cloudflare`, the directory the config names, and removes it
afterwards.

**Every answer under the path carries these headers.** The deploy writes
them as the `_headers` file at the staging directory's root, from
`scripts/demo-headers.mjs`:
- **`Content-Security-Policy`:** `default-src 'self'; script-src 'self';
  style-src 'self' https://fonts.googleapis.com; font-src
  https://fonts.gstatic.com; img-src data:; connect-src 'self'; object-src
  'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.
- **`X-Content-Type-Options: nosniff`** and **`Referrer-Policy:
  no-referrer`**.
- **`Permissions-Policy`,** denying every feature in the module's list,
  none of which the page uses.
- **`Cache-Control: public, max-age=31536000, immutable`** for `assets/`
  alone, whose names Vite writes with a hash. The page itself keeps
  Cloudflare's default, revalidated on each load.

**The browser gate serves it where the demo is,** under the path read from
the Worker's config and with the headers read back from that file's text.
It fails on anything the policy refuses. Its axe audits run without axe's
preload.

**The page says what it is.** Its header says that no server and no
database are behind it, and links the repository.

**The page carries its third-party notices.** The examples build writes
`THIRD-PARTY-NOTICES.txt` as the studio's and the host page's do, and the
deploy refuses a build without it.

**Cloudflare deploys it from `main`, on every push.** Workers Builds
connects the Worker to this repository. Its settings, recorded in
`.github/REPO-METADATA.md`, are:
- **Root directory:** the repository's root.
- **Build command:** `pnpm build`.
- **Deploy command:** `node scripts/demo.mjs`.
- **Branches:** no build for any branch but `main`.

Those two commands are `pnpm demo:deploy`, the same command run by hand.
`scripts/demo.mjs`:
- checks the config and the built page;
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
- **Nothing here reads what the address serves.** A failed build leaves the
  last deployment serving, and its log is in Cloudflare's dashboard. How
  Cloudflare applies `_headers` is from its documentation, which the gate's
  parser follows, and was not measured against Cloudflare. A setting of the
  zone could add or change a header.
- **A public page that asks Google for its fonts.** A visitor's browser
  sends Google their address, as formancy.ai's site does. `no-referrer`
  keeps the page's address out of the request. The page still says
  `noindex`.
- **The policy names hosts.** If Google moves its fonts to another host,
  the browser refuses them and the page falls back to its system stack
  until the policy is edited. The gate fails first.
- **`img-src data:` is held by derivation, not by a browser.** The icons it
  allows are drawn only by Safari on a touch device, which no gate runs.
- **axe runs without its preload.** That was measured equal on this page
  today. A page that gained media or a cross-origin stylesheet some rule
  reads would be audited with less.
- **A stricter gate.** It now fails on any console error, so a browser
  release that logs a new one fails it until someone reads why.
- **The notices are public.** `THIRD-PARTY-NOTICES.txt` names the exact
  version of every package the page bundles, to anyone. The repository's
  own `LICENSE.md` and `NOTICE` are not staged; the page links the
  repository, where they are.
- **One engine's snapshot.** The demo shows forms generated from a
  PostgreSQL snapshot, as the page always has; nothing of SQL Server is on
  it.

**What it forecloses.** Nothing that cannot be undone. Disconnecting the
repository stops the deploys. Deleting the Worker gives `/data/examples/`
back to formancy.ai's 404.

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

**Copy the built page into formancy.ai's build.** Rejected. It would put
this repository's code into an Apache-2.0 repository's build and
deployment, which 0001 keeps apart.

**GitHub Pages, or a subdomain as a Custom Domain.** Not chosen. Each is a
second address for the product beside its website.

**Build with `base: '/data/examples/'`.** Rejected. `pnpm demo` would have
to serve under that path as well, and the built page would hold the path
the config already says.

**The headers from Worker code.** Rejected. It would be code at the edge,
which 0037 keeps out, and Cloudflare applies `_headers` only to what the
assets answer.

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
