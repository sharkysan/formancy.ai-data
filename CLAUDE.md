# Working in this repository

## What this is, and what it is not

Formancy Data is a **paid, source-available** module that builds on the
Apache-2.0 [formancy](https://github.com/sharkysan/formancy.ai) packages. It
lives in its own repository so that formancy's licence and its promise — a
self-hoster never hits a paywall — stay true without qualification
([0001](docs/decisions/0001-a-paid-module-in-its-own-repository.md)).

Three things follow, and each has a guard:

- **Depend on upstream, never copy it.** `@formancy/*` packages are
  dependencies at **exact** released versions; `scripts/upstream-deps.mjs`
  refuses a range, a `workspace:` link or a path
  ([0002](docs/decisions/0002-depend-on-upstream-never-copy-it.md)). A generic
  improvement the module needs goes upstream through formancy's own
  contribution rules, not into a patched copy here.
- **Every package declares the source-available licence**, never Apache-2.0.
  `scripts/verify-licenses.mjs` refuses a manifest that says otherwise and a
  tarball without `LICENSE.md` and `NOTICE`. The realistic mistake is a
  manifest copied from upstream, which is how every manifest here started.
- **Never call it open source.** Not in a README, a package description, a
  commit message or a landing page. "Source-available" is the phrase, and the
  licence table in `README.md` is the explanation.

The regulatory documentation set (IEC 62304, SOUP, safety analysis) lives in
formancy.ai and describes **that** software. This repository does not claim one
yet. If it ever does, the claim is a decision record first.

## Every change keeps the documentation true

A change is not done until the documents that describe it say so. Update them
in the same pull request as the code, not in a follow-up:

- **`README.md`** when behaviour, a package or a command changes — including
  the *Status* paragraph, which describes one point in time and no other.
- **`CHANGELOG.md`** — a line under *Unreleased* for anything a user or
  integrator would notice, with the reason attached, not only the what. A bump
  of an upstream `@formancy/*` version is always noticed.
- **Decision records** (`docs/decisions/`) — a new record for every decision
  someone could helpfully undo, in the format `docs/decisions/README.md`
  describes: next free number, the cost paragraph, the alternatives, and a
  **Verified by** line naming the test or gate that fails if it is violated.
  Add it to the index. A decision that changes an old one marks the old record
  `superseded by NNNN` or `reversed` rather than editing it away. A decision
  that depends on a formancy.ai record cites it as `formancy.ai 0003`.

Keep the voice of the existing documents: say what it costs and what it does
not do, and never claim more than a test shows.

## A claim in prose is backed by something that fails

Documentation drifts silently, because prose does not break. So where a document
states a fact about the repository, something fails when it stops being true,
and the document says what. Three shapes, in order of preference:

1. **Derive it.** `codecov.yml` is generated from the workspace by
   `scripts/codecov-config.mjs`.
2. **Check it.** `scripts/codecov-config.test.mjs` fails when the committed
   file is not what the generator produces; `scripts/check-cla.test.mjs` fails
   when `CLA.md` changes under a signature; `scripts/upstream-deps.test.mjs`
   fails on an inexact upstream version. All of them run as `pnpm test:repo`,
   and CI runs that — **a guard that is not a gate is a comment.**
3. **Measure it.** Below.

Counts written into prose go stale. **Prefer wording without a number.** Where a
number is the point, derive it; where that is impossible, date it.

**When you write a guard, make it fail first.** Revert the thing it guards,
watch it fail, put it back. A test that has never failed has not been shown to
test anything. And derive the fact from the code or the data, never from
wording: a check that matches a phrase passes for the wrong reason the moment
the phrase appears somewhere else.

## Measure before you write a number

Numbers here are measured, not estimated. The plan this repository started from
estimates twenty to twenty-eight person-weeks; that is a plan's number and it
belongs in the plan. A number in this repository — a timeout, a page size, a
startup time, a benchmark — comes with how it was measured, on what, and when.

## Database behaviour is proved against real servers

**There is no mocked driver in this repository and there is not going to be
one** ([0003](docs/decisions/0003-real-databases-in-every-test-run.md)).
Database semantics are the product: what quoting does to a reserved word, what
a catalog view hides from a restricted account, what `rowversion` is and is
not. A suite that passed without a database would be proving the mock.

- Every adapter behaviour is tested on **both** engines, through testcontainers,
  against the exact images the tests name. Passing on one does not imply the
  other, and passing on one release does not imply all historical versions.
- A test needs Docker. There is no `--skip-db` flag and no environment variable
  that turns the suites into no-ops, because a suite that can be skipped is a
  suite that is skipped.
- Pure logic — codecs, generation, drift analysis — is unit-tested in
  `data-core` where it lives, and that is the right place for it. It does not
  excuse the adapter from proving what the database does with the result.

## Secrets and identifiers

- **Nothing in a package reads configuration.** An adapter takes a connected
  driver; the composition root opens the connection, which is where a secret
  is handled, once. A connection string in a log line, an error message or a
  test fixture is a defect.
- **Identifiers come from approved metadata and are quoted by the adapter.**
  Values are bound as parameters. Neither the browser nor a form document ever
  supplies SQL or a raw identifier to execute. A function that builds SQL from
  a string an outsider can influence does not merge.
- **Fail closed.** A lookup source that cannot answer refuses the submission; a
  concurrency strategy that is not proven keeps the form read-only; a metadata
  snapshot that cannot establish completeness says so rather than reporting
  "no relationships". Upstream's
  [0022](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0022-fail-open-fail-closed.md)
  is the rule and this repository inherits it.

## The user interface is formancy.ai's concept, applied

The first UI here is `apps/examples`, the page that previews a generated form
under both renderers
([0021](docs/decisions/0021-generated-forms-preview-in-both-frameworks.md));
the second is `apps/studio`, the administrator's application over the
server's administrator plane
([0024](docs/decisions/0024-the-studio-speaks-only-the-admin-plane.md)). Both,
and the landing page when it arrives, are formancy.ai's concept applied, not a
new one:

- **The same room.** The admin, the playground and the site upstream share one
  look: a dark bench, glass panels, violet for what the person acts on and teal
  for what the server did, with the builder's panes from `workbench.css`
  recoloured only through its `--wb-*` variables and not one rule overridden
  for colour. The Studio is that admin extended with connection, discovery,
  mapping and drift panes. It wears `admin.css`'s variables, not a palette of
  its own, so the tool stays one tool in two places. It edits presentation
  with controls of its own over `@formancy/builder-core`'s session, not the
  builder's panes, which cannot be held to edits that keep the bindings
  (0024); so it loads no `workbench.css` and sets no `--wb-*`.
- **Form previews on white paper, in Blueprint.** An administrator previews
  what the people filling in the form will see, not the admin. A generated form
  renders through `@formancy/react` or `@formancy/angular` with a shipped theme.
- **Renderers ship no CSS; themes target `data-formancy-part`.** Nothing this
  repository adds to a form carries styling. A control, if one is ever needed,
  is operable without a theme (formancy.ai 0101) and is dressed by all four
  reference themes without a component change, or the headless claim is false.
- **Keyboard first, accessible name only.** Every drag has a keyboard path
  (formancy.ai 0046). Tests find elements by role and accessible name and
  nothing else (0034), and axe runs in the suite. Where the accessibility
  tree cannot answer — an element id, an element with no role — a test reads
  the DOM, and its header says which and why rather than claiming otherwise.
- **One shell for every page of the site** (formancy.ai 0106). The
  `formancy.ai/data` page, when it exists, is a page in that shell, built in
  that repository's `apps/site`, not a second site with a second header.
- **A number on a page is derived.** Supported databases, field types, decision
  records: counted at build time, never typed.

What holds this section, brought with the first UI from upstream's guards for
the same promises:

- **The size budget**, `scripts/source-size.test.mjs` in `pnpm test:repo`:
  no source file past the 600 lines below.
- **The starter-demo test**, `apps/examples/src/examples.test.ts`: every
  document the page shows is one the released spec accepts, places every field
  in the layout both previews draw, and has what the page says it shows.
- **The studio's journey and presentation tests**,
  `apps/studio/src/journey.test.tsx` and `presentation.test.tsx`, against the
  real server behind a fake `fetch`: every request the studio makes is one of
  the administrator plane's routes; axe and a name on every control at every
  step; and nothing the presentation step offers can remove, rename or retype
  a bound field, while what it produces publishes.
- **The browser gates**, `apps/examples/scripts/browser-test.mjs` and
  `apps/studio/scripts/browser-test.mjs`, run as `pnpm test:browser` in their
  own CI job, for what jsdom cannot see: in Chromium, no sideways scroll and
  nothing past either edge down to 320 pixels, the first Tab on the skip link
  and the next into the content, and axe's colour-contrast and target-size
  rules — for the examples clean and after a failed submit, for the studio at
  every step of the journey against the real server on its own origin.

What nothing holds yet, said: the palette is copied from `admin.css` by hand,
into `app.css` and `studio.css`, and nothing fails when upstream's moves; that
neither stylesheet reaches into a preview's paper is held by review; and the
one-shell bullet has nothing to hold until the `formancy.ai/data` page
exists.

## Branch names

Name a branch after what it changes, with a prefix for the kind of change:
`feat/postgres-discovery`, `fix/sqlserver-rowversion-codec`, `docs/licence-draft`.
Not a generated name: the branch is what a reviewer sees first.

## Branch from `main`, and target `main`

No stacked pull requests. Branch from `main`, target `main`, and where a branch
replaces another say "supersedes #N" in the description rather than stacking.

**Commit as `Daniel Bacher <dbacher@gmail.com>`**, never
`daniel.bacher@ergon.ch`. The CLA record names that address, and the check
reads commit authors.

**No tool attribution.** No "Generated with Claude Code" line or session link
in pull request descriptions, and no `Co-Authored-By: Claude` or
`Claude-Session` trailers in commits. The author is the person above.

## Tests, and what the bar actually is

**Coverage is reported, not gated.** There is no threshold in
`vitest.coverage.ts` and none is wanted. The bar is this:

- **New behaviour arrives with a test that fails without it.** Test-first, and
  the failure observed.
- **Every case says which failure it prevents**, in a comment, in the same
  voice as the code. "tests the happy path" is not that; "a ping that answered
  from the driver's configuration would pass against a server that is not
  there" is.
- **A code path no test reaches is a claim nobody checked.** If it is hard to
  reach, that is usually the design saying something.
- Run `pnpm test:coverage` for what you changed and read the report. A file
  whose number dropped is the question, not the failure.

### When the test is wrong and the code is right

It happens. When a test disagrees with the code, work out which is wrong before
changing either. Match the whole property, not the shape it usually has.

## The code reads as though a senior wrote both halves

The standard is not "it works". It is that a senior back-end engineer who knows
PostgreSQL and SQL Server recognises the shape immediately and finds nothing to
explain away.

**Ports and adapters.** `data-core` describes intent; an adapter translates it
into one database's operations. A use-case takes an adapter, not a connection.
A port exists because there are two implementations and a conformance suite
that proves they agree; **no interface with one implementation**, no layer that
only forwards, no abstract base class for two concrete cases.

**Database neutrality must not silently erase precision, time semantics or
relationship behaviour.** A capability is explicit — editable, read-only,
unsupported — and visible before publication. The place where the two engines
genuinely differ is written down in the adapter, with the difference named, not
smoothed over in the core.

**Duplication is cheaper than the wrong abstraction, and both are cheaper than
a silent divergence.** Two adapters implementing one operation by hand is
deliberate. Two implementations of the *same decision* — how a composite key is
encoded, what a stale version means — is the thing the core exists to prevent.
The question is never "is this repeated" but **"if these two ever disagree,
would anybody find out?"**

### Size is a signal

**600 lines** for a source file, tests excluded; `scripts/source-size.test.mjs`
fails past it. Split by **the reason to change**, never by line count. The
seams that will work here: one catalog concern per file in an adapter, one
operation family per file in the core. The same applies below the file, held
by review: a function past about 60 lines, a `switch` growing a case per
feature, a class whose name needs "and" to describe it.

## Checks before pushing

CI runs `pnpm build`, `pnpm typecheck`, `pnpm test:coverage`, `pnpm check:pkg`,
`node scripts/verify-licenses.mjs`, `pnpm test:repo`, and in jobs of their own
`pnpm test:e2e:install` and `pnpm test:browser`. Run the ones for what you
changed.

`test:coverage` needs Docker and starts both databases. The first run pulls the
SQL Server image, which is about a gigabyte and a half.

`test:browser` builds the examples page and measures it in Chromium, which
Playwright downloads once per machine:
`pnpm --filter @formancy/data-examples exec playwright install chromium`.

`test:e2e:install` is the only gate that looks at the packages from outside. It
packs them, installs the tarballs into a plain npm project, type-checks it with
`skipLibCheck` **off** and runs it under Node — because every other gate
resolves a package through a symlink to its source, so an `exports` map that is
wrong for a consumer can be right for the whole suite. It needs `pnpm build`
first.

## Conventions that live upstream

Do not restate these here; go and read them in formancy.ai.

- **Layering: what may import what**, and why `data-core` has no `@types/node`
  — [0008](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0008-layered-packages.md).
- **A name and never an address** for anything a document names — option
  sources, checks — [0077](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0077-options-may-come-from-a-named-source.md).
  A lookup here is a named source the deployment resolves, and the database
  module is the resolver.
- **TypeScript is pinned to `~6.0.3`** for the reason the workspace catalog
  gives.
- **Releasing, provenance and signing** — [`RELEASING.md`](RELEASING.md).
- **Reporting a vulnerability** — [`SECURITY.md`](SECURITY.md).
