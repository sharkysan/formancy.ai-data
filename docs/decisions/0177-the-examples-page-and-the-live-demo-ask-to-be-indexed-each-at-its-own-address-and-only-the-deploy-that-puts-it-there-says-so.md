# 0177 — The examples page and the live demo ask to be indexed, each at its own address, and only the deploy that puts it there says so

- **Status:** accepted; amends
  [0069](0069-the-examples-page-is-served-at-formancy-ai-data-examples.md):
  the examples page is staged asking to be indexed at
  formancy.ai/data/examples/, which it names as its canonical address, so
  its cost *A public page* no longer has search engines asked to leave it
  out; amends
  [0070](0070-the-live-demo-runs-the-real-server-and-postgresql-in-a-cloudflare-container-of-each-visitors-own.md):
  the host page's demo build is staged asking to be indexed at
  formancy.ai/data/demo/, its canonical address, with a description of the
  demo in place of the host page's, while the host page itself, the
  composed stack's, still asks to be left out
- **Date:** 2026-11-22
- **Deciders:** Daniel Bacher
- **Verified by:** `scripts/indexed-page.test.mjs`, in `pnpm test:repo`,
  which the `verify` job of `.github/workflows/gates.yml` runs on every
  pull request and before every release:
  - every app's `index.html`, found as every `apps/<name>/index.html`,
    says `<meta name="robots" content="noindex">` once and names no
    canonical address, the examples page's included;
  - every page the composed stack serves, read from
    `scripts/web-policies.mjs`' `WEB_PAGES` -- the studio and the host
    page -- says it in its build, the files the web image copies, so
    `pnpm build` first;
  - `indexedPage` drops that meta and its line, keeps the description or
    writes the one given, escaped, names the address as canonical on the
    line after it, and changes no other byte of a page; and it refuses a
    page with no such meta, with two, with one that says more, with no
    description or two, or with a canonical link already, and an address
    that is not https as a browser writes it;
  - `scripts/demo.mjs`' `stageDemo` stages the examples page's source, as
    a build lays it out, under `/data/examples/` with the deploy's
    `_headers` beside it, asking to be indexed at the address the
    Worker's config routes, `demoUrl`, with its own description and every
    other element as built;
  - and `scripts/live-demo.mjs`' `stageLiveDemo` stages the host page's
    source under `/data/demo/` with the live headers, asking to be indexed
    at `liveDemoUrl`, the Worker's `PREFIX` on formancy.ai, with
    `LIVE_DESCRIPTION`, every other element as built, and leaves the build
    it staged from asking to be left out.

  Watched failing on 2026-11-22: with `stageBuild` staging the page as
  built, both staging cases ("expected [ 'noindex' ] to deeply equal []");
  with the noindex taken out of `apps/host/index.html` and its build, the
  host page's source case, the composed stack's `/host/` case and the live
  demo's staging, which refused the page ("the page has no robots meta,
  and the deploy drops exactly one <meta name="robots"
  content="noindex">, which every page's source carries"); and with the
  live demo staged without its description ("expected 'A host
  application's workspace over …' to be 'A live demo of Formancy Data:
  sign in…'"); each put back and compared by sha256.

  **Held by review alone:** that each description is true of its page;
  that both deploys call their staging, which `main` does and no test
  runs, since running it deploys; what a search engine indexes of either
  page or shows for it, which nothing here reads; and that formancy.ai
  serves neither build at another address.

## Context

Search engines found none of the module's public pages. The examples
page, served at https://formancy.ai/data/examples/ (0069), and the live
demo, at https://formancy.ai/data/demo/ (0070), each said
`<meta name="robots" content="noindex">`, as the studio does; 0069 listed
it under its cost *A public page*: "`noindex` asks search engines to leave
it out; nothing keeps a copy away". They are the module's only public
pages. formancy.ai/data is kept for the product's page in formancy.ai's
site, in that site's shell (formancy.ai 0106), and that page does not
exist; the README and the guide are on GitHub. So nothing of the module
could be found by searching for what it does. The maintainer decided that
both public pages ask to be indexed. formancy.ai's sitemap is to list
them, a change in that repository and not this one.

A page's source is not the page at one address. Every build is served
wherever somebody runs it: the browser gates and `pnpm demo` on a
loopback address, a preview, and, for the studio and the host page, every
operator's composed stack, whose web image builds both from this
checkout (`deploy/web/Dockerfile`). The live demo is the host page's demo
build, `build:demo`, built from the same `index.html` as the host page
an operator serves. An operator who deploys the stack must not find
their host page indexed because the live demo is.

Each deploy is the one place that knows its address: `scripts/demo.mjs`
reads it from the Worker's routes in `apps/examples/wrangler.json`, and
`scripts/live-demo.mjs` from the Worker's `PREFIX`, and each already
stages its build under that path with the `_headers` file it writes. A
browser fetches neither a page's description nor its canonical link, so
a head that differs in those, and in the robots meta, loads what the
build loads.

The composed stack's nginx could have said it instead: an
`X-Robots-Tag: noindex` for the host page. In nginx, a location with an
`add_header` of its own inherits none of its server's, so one added to
`/host/` alone would drop the page's Content-Security-Policy there, which
`scripts/web-policies.test.mjs` fails (0083); at the server's level the
guard passes it. Both were read with `nginxPolicyProblems` on the
committed file on 2026-11-22, not run in nginx.

## Decision

**Every page's source asks to be left out of the index**, as it did: the
studio's, the host page's and the examples page's `index.html` each say
`<meta name="robots" content="noindex">`, and so does everything built
from them, the composed stack's pages among them. The composed stack
changes in nothing.

**The deploy that puts a page at its address alone writes the page that
asks to be indexed.** `scripts/indexed-page.mjs`' `indexedPage` takes the
built page and the address, drops the robots meta with its line, keeps
the page's description or writes the one it is given, and names the
address in a `<link rel="canonical">` on the line after the description.
Nothing else of the page changes. `scripts/demo.mjs`' `stageBuild` makes
that page before it copies anything, so a head it cannot read stages
nothing, and writes it into the staging beside the build's files and the
`_headers` file; the examples page's deploy stages
through it as `stageDemo`, at `demoUrl`, and the live demo's as
`stageLiveDemo`, at `liveDemoUrl`. A head the staging cannot read as
every source writes it -- no such meta or two, one that says more, no
description or two, a canonical link already -- stops the deploy with a
sentence, as does an address that is not https as a browser writes it.

**The descriptions.** The examples page keeps its own, which says what it
shows: forms generated from a database snapshot in the browser, rendered
by both renderers side by side, with what the generator chose beside
each. The live demo is given `LIVE_DESCRIPTION`, "A live demo of Formancy
Data: sign in as one of its people and search, open and change orders in
forms generated from PostgreSQL, on a data server and sample data of your
own.", in place of the host page's, which says what an operator's host
page is. Each page keeps its build's title.

## Consequences

**What it buys.** A search engine may index both pages, at the addresses
their Workers are routed at and under those addresses alone, and a search
can find the module by what it does. An operator's studio and host page
ask to be left out as before, and the test fails the day either source
or build stops asking. The address a page names as its own is derived
from the config that routes it, never typed.

**What it costs.**
- **What a search engine reads of a page drawn by script** is the title,
  the description and an empty root. Everything else is drawn by the
  page's script: the examples page's forms, generated in the browser, and
  the live demo's sign-in, drawn after the page asks its Worker for the
  demo's people. A crawler that runs no script reads the title and the
  description alone; what one that does reads was not looked at. Nothing
  here reads what any search engine indexed or shows.
- **The live demo's title is the host page's**, "Formancy Data host:
  published forms, their records and their rows", which a search shows
  above the demo's description.
- **The demo's data is synthetic.** A search leads to sample sales data in
  forms generated from the demo's own schema, not to anybody's records. A
  crawler starts no server: only a sign-in posted from the page starts one
  (0070), and the page holds no visitor's data.
- **Found is used.** A person who finds the live demo by a search starts a
  server as anybody else does, so 0070's costs -- money while it runs, and
  sign-ins refused while every place is taken -- grow with being found.
- **The page sent is not the build the gates measured.** The browser gates
  serve each build, and each deploy sends its staged copy, whose head
  differs in the robots meta, the description and the canonical link. The
  staging is held by the test; what Cloudflare serves at either address
  is read by nobody, as 0069 says.
- **The meta is the only request.** Neither page's other files -- the
  chunks, the notices -- carry one, and nothing sends an `X-Robots-Tag`,
  in the composed stack or on formancy.ai; a crawler that ignores the
  meta is not stopped by it, as before.
- **No sitemap lists them yet.** Until formancy.ai's site lists both, a
  search engine finds them by the links to them, the README's *Try it*
  among them.
- **A source that says more stops both deploys.** A robots meta edited to
  say anything but `noindex`, or a second description, is refused until
  the staging reads it.

## Alternatives considered

- **A product page on formancy.ai's site**, at formancy.ai/data, in the
  site's shell, linking both. It is the page CLAUDE.md keeps that path
  for, and it stays to do; but it is a page of formancy.ai's repository,
  and it would make neither existing page findable while each said
  `noindex`. The two pages already show what the module does, and are
  what a reader wants to try; they ask to be indexed now, and the product
  page, when it exists, links to them.
- **Pages of the module's own written for search**, static HTML
  prerendered beside the app with a sitemap of their own, as Formancy
  Report's product pages are (formancy.ai-report 0021). A crawler would
  read all of such a page, which it does not of a page drawn by script.
  Lost for now: they are new pages, in several languages there, to write
  and keep true beside two pages that exist and are the product itself.
- **The source pages without `noindex`.** The examples page's build is
  served at one public address alone, and its source could have dropped
  it; the host page's cannot, since the composed stack serves the same
  source. One rule for every source -- every page asks to be left out
  until its deploy says otherwise -- is one test over every app, and the
  canonical address is the deploy's to write either way.
- **`X-Robots-Tag` from the composed stack's nginx, and the host page's
  source without `noindex`.** It would hold the operator's page by a
  header at the server's level, where 0083's guard allows it, but the
  host page's source would then ask nothing of a search engine wherever
  else it is served, and a proxy that replaces nginx, as `docs/guide/deploying.md`
  says a deployment's may, would have to copy one more header.
- **A Vite plugin in the host page's demo mode** writing the head into
  `dist-demo`. The address is the live demo Worker's, which the host
  page's Vite config does not read, and the examples page would need a
  second way to the same head.
