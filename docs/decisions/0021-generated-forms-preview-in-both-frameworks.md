# 0021 — Generated forms are previewed in both frameworks, generated in the browser from a captured snapshot

- **Status:** accepted
- **Date:** 2026-10-09
- **Deciders:** Daniel Bacher
- **Verified by:** `apps/examples/src/previews.test.tsx` — for `sales.order` and
  `sales.customer`, both renderers draw every generated field by accessible name
  and nothing else; every required field left empty is `required` in both; the
  largest `numeric(18,4)` is valid in both and one fractional digit more is
  `pattern` in both; both offer the two captured customers and store the token
  of the chosen key; a lookup with no rows is said in both and in the note; axe,
  in the configuration `@formancy/conformance` holds the renderers to, finds
  nothing in either preview, clean or after a failed submit; no two elements on
  the page share an id. Watched failing against an empty page, and with the
  Angular half alone denied its option sources (three cases fail).
  `apps/examples/src/snapshot.test.ts` — the committed snapshot hashes to its
  fingerprint, is the canonical form `createSnapshot` makes, is refused by the
  page when edited, agrees with the shared fixture model, names a server
  version of the image the fixture runs, and was captured with the customers
  the lookup offers. Each watched failing against a hand-edited file.
  `apps/examples/src/page.test.tsx` — the notes kind by kind, the operations,
  the in-memory statement, Tab reaching every enabled control, a name on every
  control, and axe over the whole document including the page-structure rules.
  `scripts/upstream-deps.mjs` refuses a range in the app's manifest, watched
  failing with `^0.3.0`.

## Context

DATA-08 asks that generated forms render and validate equivalently in Angular
and React. Until now a generated form had been checked by the released
`@formancy/spec` validator and the released engine in server mode (0009), and
drawn by no renderer. The renderers are what a customer runs, and the way two
of them disagree is quiet: a bootstrap that throws, a capability one of them was
not given, a control one names differently. Each leaves the other half looking
perfect. formancy.ai met exactly this, and answered it by putting both
renderers on one page with one engine per renderer
([formancy.ai 0095](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0095-one-schema-two-renderers.md)).

Three facts shaped the rest. The generator's input is a metadata snapshot, and a
snapshot typed by hand shows what somebody believes discovery returns, which is
what the adapter suites exist to prove instead (0003). `@formancy/data-core` has
no Node dependency
([formancy.ai 0008](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0008-layered-packages.md)),
so nothing stops generation running in a browser, and nothing had shown that it
does. And the server has no lookup route yet, so a lookup's options have to come
from somewhere else for now.

## Decision

`apps/examples` is a private Vite app on formancy.ai's playground toolchain —
React 19, Angular 22 through `@analogjs/vite-plugin-angular`, Vite 8, the
workspace's TypeScript — depending on the released `@formancy/react`,
`@formancy/angular`, `@formancy/core`, `@formancy/spec`, `@formancy/themes` and
`@formancy/conformance` at exactly 0.3.0 (0002), and on `@formancy/data-core`
through the workspace.

- **The input is captured, not written.** `scripts/capture-snapshot.mjs` starts
  the shared PostgreSQL fixture (0005), discovers it as its owner with
  `discoverPostgres`, refuses to write a snapshot the fixture model disagrees
  with, and writes `src/fixture-snapshot.json`, with the two customers read as
  text in the same run beside it.
- **Checked, then generated, in the browser.** The page recomputes the
  snapshot's fingerprint with `createSnapshot` and refuses a file that does not
  hash to it, as the server reads a bundle (0019); then `generateForm` runs on
  the page for `sales.order`, with the customer lookup, and `sales.customer`.
- **Each form twice, side by side.** One engine per renderer, each with its own
  id namespace, the document's own layout in both, the same options map in
  both, each on white paper in the Blueprint theme.
- **The lookup source is in memory, and the page says so** until the server's
  lookup route exists. Its values are `encodeKeyToken` of the key in the foreign
  key's column order and its labels `formatLabel` of the display columns, so
  what a person stores here is what the server will decode (0012).
- **The notes are beside each form**, kind by kind, an empty kind said rather
  than hidden, with the operations printed from the bindings.
- **The chrome is the admin's**: `admin.css`'s variables, copied, and its
  dark bench and glass panels.

## Consequences

**What it buys.** DATA-08 is a test rather than a sentence: a change in either
renderer, or in the generator, that makes the two draw or validate a generated
form differently fails here, by name, on a form generated from a real catalog.
The fingerprint check that guards published bundles also guards the page. The
generator's choices are visible beside what they produced, which is the review
screen in miniature.

**What it costs.**

- **The snapshot is a copy.** When the fixture changes it is stale until
  somebody runs the capture again, with Docker. The comparison with the model
  catches that without a container, but only for what the model pins; the
  server version is outside the fingerprint and is checked only for its major.
- **The released engine validates on first submit, then live.** In
  `@formancy/core` 0.3.0 an answer is checked once `validate()` has run and on
  every change after that, so a person typing an over-precise amount into an
  untouched form sees nothing until they press Validate. That is upstream's
  behaviour; the page inherits it and the tests take the same path.
- **The admin's palette is copied, not depended on.** It is an application's
  stylesheet, not a package. When upstream's palette moves, `app.css` moves by
  hand, and nothing fails when it does not.
- **jsdom sees no layout.** No horizontal scroll at phone width, and the
  keyboard order in a real browser, were checked by hand on 2026-10-09 in
  Chromium at 1440, 360 and 320 CSS pixels: the document's scroll width equal to
  its client width, no element past the right edge, the skip link first and the
  first control of the first preview next. No gate repeats that, and colour
  contrast is unmeasured. The guards `CLAUDE.md` names for the first UI —
  upstream's file-size budget, starter-demo and browser tests — do not arrive
  with this record.
- **The notes are shown as the generator writes them**, including the way it
  currently de-snakes its own descriptions ("java script", "utc"). Fixing that is
  a generator change, not a page change.
- **The Angular toolchain enters the lockfile** as development dependencies,
  `@angular/build` among them because the plugin compiles through it. Three of
  its transitive packages carry native-addon install scripts; they are not
  allowed to run, and the app builds and tests without them.
- **Weight.** `vite build` on 2026-10-09: the page's script is 431 kB minified
  (132 kB gzipped) and the Angular bootstrap, loaded when the first Angular
  preview mounts, 203 kB (60 kB). Two frameworks are the point of the page.

**What it forecloses.** Nothing published: the app is private, and no package
depends on it.

## Alternatives considered

**A hand-written snapshot.** Rejected: it would show a belief about discovery,
and a test of the previews would pass against a database that does not exist.

**Generate at build time and commit the forms.** Rejected: the claim that
`data-core` runs in a browser would go unexercised, and a committed form is a
second copy of the generator's output that can drift from it silently.

**One engine shared by both renderers.** Rejected for formancy.ai 0095's reason:
both trees mint the same ids, and `label[for]` resolves to the first, so the
second renderer's fields lose their names.

**`bootstrapApplication` for the Angular half.** Rejected: it finds its host by
selector, which is the first match in the document, and this page has an Angular
preview per form. `createApplication` and `bootstrap(component, element)` mount
each into its own element.

**Copy the accessibility configuration.** Rejected: the tags and exclusions are
`@formancy/conformance`'s public contract at 0.3.0, so the app depends on it
rather than restating it (0002).

**Wait for the lookup route.** Rejected: a lookup is the generator's most
consequential choice on this table, and a preview without one would show the
renderers' "not provided" sentence. The in-memory source uses the server's
encoding so that nothing changes for the form when the route arrives.
