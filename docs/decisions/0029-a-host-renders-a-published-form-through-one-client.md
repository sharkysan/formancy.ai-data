# 0029 — A host renders a published form through one client of the runtime plane

- **Status:** accepted; narrowed by [0031](0031-an-answer-lost-after-a-write-is-unknown.md): a non-JSON 502 is `unexpected` on a read only; a write's answer is known only when the data server says what happened, every write carries a write id of its own, and `reconcile` reads an unknown one; the host page is served at `/host/` on the composed stack's one origin, by `deploy/web/nginx.conf`, extended by [0032](0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)
- **Date:** 2026-10-09
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-client/src/records.integration.test.ts` — on both engines,
  across real HTTP into the real server with the real identity verifier and
  HS256 tokens: `form()` returns the form, its operations and readable fields
  with the token in the Authorization header and nowhere else (watched failing
  with the token in a query string); a wrong token is the server's 401
  sentence; the token is asked for on every request (watched failing with it
  read once at construction); create, an exact read-back of the largest
  `numeric(18,4)`, an update read back as `12.5000` with a new version, and a
  stale update refused with the database still holding the first save; a
  record another tenant cannot see is the server's 404 (watched failing first
  on PostgreSQL with an invented token that the create case had just made); a
  customer of another tenant is `422 invalid-values` on the customer field and
  `fieldProblems` gives the server's sentence (watched failing with codes
  applied, which showed `not-an-option`); and a headless engine built from the
  published form saves exactly what the server reads back.
  `packages/data-client/src/lookups.integration.test.ts` — on both engines:
  one source per name the document carries; a search returns only the
  tenant's customers as value and label; labels for a stored token, another
  tenant's token left out rather than refused, and no request for no values
  (watched failing with labels always asked for); the operation getter read on
  every request (watched failing when read once); a refusal rejects (watched
  failing when answered with an empty list); an abort rejects with the
  AbortError (watched failing when turned into an Outcome); the plain select's
  `search ''`; and a name of `..` or `.` refused before any request (watched
  failing without the guard: the request landed on
  `POST /v1/forms/pg-order/query`).
  `packages/data-client/src/transport.test.ts` — against a `node:http` server:
  nothing listening is `unreachable`, a non-JSON 502 is `unexpected`, a
  redirect is not followed (watched failing with `redirect: 'follow'`), a 2xx
  of the wrong shape and a body cut off after a 200 are `unexpected` (watched
  failing with any 2xx accepted, and with a body-read failure propagated), an
  abort while the body arrives rejects (watched failing when not rethrown).
  `packages/data-client/src/lookups.test.ts` and `problems.test.ts` — names
  through groups and repeaters, once each, in document order; a refusal's
  sentences grouped by field, once each, in order (each watched failing with
  the walk, the deduplication or the grouping removed).
  The client's own type gates: `import 'node:crypto'` in its source fails its
  `tsc` (TS2882), and renaming `readable` in the server's GET reply fails the
  server's (TS2353) now that the reply `satisfies PublishedForm`.
  `scripts/install-fixture/consume.ts` (`pnpm test:e2e:install`) — the packed
  client installs into a plain npm project, type-checks with `skipLibCheck`
  off and refuses `form('..')` without calling fetch (watched failing with the
  guard removed from the built package).
  `apps/host/src/session.test.ts` — one pane's session on both engines: a
  first save creates and the session then asks lookups under update (watched
  failing with the operation fixed rather than a getter); a save shows the
  stored spelling in the same engine; a stale save keeps the draft and
  `reload()` is the one way to the saved record; a refused selection is the
  server's sentence on the customer field; any other refusal is the server's
  sentence, sent once (watched failing with a create sent twice); a submit
  the engine refused sends nothing (watched failing with `ok` ignored). With
  the server's answer held after it has written: an answer the person changed
  while the save was out keeps their value and the result says it is not
  saved, the unchanged ones take the stored spelling (watched failing with
  every stored answer set back), and a second press sends nothing and says so
  (watched failing when the press sent a second create); an answer that
  arrives after New is said as the replaced form's — the created record's
  token, or the refusal's sentence — and leaves the new form alone (watched
  failing first against the session that returned nothing); and a replaced
  form's save settling does not lift the new form's guard against a double
  press (watched failing with the guard cleared by whichever save finished:
  the press sent a second create of one form fill).
  `apps/host/src/in-flight.test.tsx` — on both engines and in both renderers,
  with the writes held the same way: typing during a save is kept and the
  line says "Saved." followed by the changes not being saved, the second press
  says it sent nothing, and the line reads "Saving…" while each save is out,
  so two "Saved." in a row are two changes to the live region (watched failing
  with no "Saving…" line); New during a create says the created record's token
  on the pane's line and leaves the new form empty (watched failing against
  the pane that dropped the answer).
  `apps/host/src/journey.test.tsx` (plan steps 4 and 5) — on both engines and
  in both orders of renderer: an order created through the typeahead at the
  largest amount, loaded into both panes with the customer labelled through
  resolve, its customer and amount changed and saved in the other, the field
  then showing `12.5000` and a client beside the page reading exactly that
  (watched failing with the stored answers not set back into the engine).
  `apps/host/src/stale.test.tsx` (plan step 7) — on both engines and in both
  orders: the second pane's save shows the server's sentence and "Your changes
  are still in the form.", the keyboard is on the notice, the draft is still
  in the form and the database holds the first save; "Load the saved record"
  replaces the draft, leaves the keyboard on the pane's heading, and says so
  in a status line that was on the page before it spoke (watched failing with
  the engine rebuilt on 409, the focus check with the notice not focused, and
  the line check with the line inside the part each Load rebuilds, where it
  arrived already holding its sentence and was not announced).
  `apps/host/src/problems.test.tsx` — on both engines and in both renderers, a
  customer deleted between the choice and the save is "This is not one of the
  options this form offers." as the Customer field's description and in the
  error summary, which has the focus, with the other answers kept (watched
  failing with codes applied: the field read `not-an-option`).
  `apps/host/src/plane.test.tsx` — every request of a whole journey is a
  runtime route, the journey uses every one, each carries the signed-in token
  in the header and in no URL or body, and no body names a tenant (watched
  failing with one stray `/v1/whoami` call).
  `apps/host/src/page.test.tsx` — signed out, open, loaded, saved, after a
  stale save and after a refused selection: axe at WCAG 2.2 AA plus the
  page-structure rules, and a name on every control (watched failing with the
  record token's label unbound); both panes draw every published field by its
  label; a 401 at open and a 404 on load are the server's sentences (each
  watched failing with words of the page's own); the token is in no storage,
  no cookie, no address and nowhere in the document (watched failing with it
  written to `sessionStorage`); New record; and Sign out, after which the
  keyboard is on the host token (watched failing with it on the page itself).
  `apps/host/src/angular-mount.test.tsx` — a failed Angular start is said and
  leaves no element behind, a pane unmounted before Angular started lets go
  of its engine, and a submit reaches the pane's current handler (each watched
  failing with its guard removed).
  `apps/host/src/test-setup.ts` puts Node's `Uint8Array` back in the jsdom
  worker the server runs in (watched failing without it: every SQL Server
  rowversion read as "did not come back as a rowversion").
  `apps/host/scripts/browser-test.mjs` (`pnpm test:browser`) — in Chromium
  against the real server on PostgreSQL, at 320 and 360 pixels, one past each
  breakpoint in the host's stylesheet and 1440, and at 320 again with the web
  fonts refused: no sideways scroll and nothing past either edge, axe's
  colour-contrast and target-size rules signed out, open, with the customer
  list open, loaded, saved, with the stale notice and after a refused
  selection; the skip link first and on screen, then the token, and after
  opening Enter on the skip link puts the keyboard on `<main>` and the next
  Tab on its first control (watched failing with the link pointed at a missing
  id, while the next-Tab check alone stayed green: nothing in the header can
  take the focus, so that Tab lands on the first control either way); the
  focus on the notice after a stale
  save, in the error summary after a refused selection, on Save after a save
  that worked; and no rule of `host.css`, imports inlined, selecting anything
  on either paper (watched failing with a muted colour darkened, the panes'
  grid wider than a phone, the skip link kept off screen, an unscoped `label`
  rule, and the notice not focused).
  `scripts/palette.test.mjs` (`pnpm test:repo`) — the admin's palette says the
  same in every app that copies it (watched failing with one value changed in
  the host's copy).
  `apps/host`'s `tsc` is the check that `lookupSources(...)` still fits both
  renderers' `OptionsSources`: `react-form.tsx` and `angular-bootstrap.ts`
  type it as each renderer's own.

## Context

Plan section 21's first technical demonstration, steps 4 to 7, and release
gate 2 — both frontend frameworks pass the published-form scenarios — had no
code. Nothing outside `packages/data-server` called the runtime plane: its
routes were proved by the server's own suites, and no host had ever rendered
what it serves.

What the released 0.3.0 packages say decided most of the shape, read from
their declarations and their code:

- `@formancy/react` and `@formancy/angular` each declare their own
  `OptionsSource` and `OptionsSources`, structurally identical, on purpose. A
  map of names to sources is the only way a document's list reaches a
  renderer (formancy.ai 0077), and it must be synchronous.
- A plain select with a source asks once with an empty query; a typeahead
  asks per keystroke; both ask for the label of a value already held. The
  renderer caps what arrives and cannot be told that more exists.
- Both renderers print an error entry **verbatim**, beside the field and in
  the summary, and neither form includes a summary: the host places one.
  There is no catalogue for a server's codes.
- A generated form carries logic rules, so an engine needs a clock from its
  host, and two engines of one document on one page need different form ids
  (formancy.ai 0095).
- The runtime plane's replies had no type of their own: the server built the
  definition, a refusal and a resolve reply by hand, and nothing would have
  failed on either side if one changed.

## Decision

- **One client package, `@formancy/data-client`, source-available and
  framework-neutral.** A function per runtime route over `fetch`, with no
  Node API, and three decisions every host would otherwise make again:
  - the token is the host's, asked for on every request through
    `token: () => string`, and sent in the Authorization header only — never
    in a URL or a body;
  - the base is the page's own origin by default, and the page must be
    same-origin, since the server sends no CORS headers (0024);
  - a document decides which source names exist and nothing else. A name is
    one encoded path segment under the same form, refused before any request
    when it is empty, `.` or `..`, which `fetch` would resolve to a different
    route. A document never supplies a URL, a header, a token, a tenant or an
    operation (formancy.ai 0077, 0012).
  A refusal is the server's code and sentence, verbatim. `fieldProblems`
  turns a refusal's field errors into the server's **sentences**, grouped by
  field, because a renderer prints an entry as it is; the code stays on the
  refusal for a program. Nothing is cached and nothing is retried (0015,
  0022). `createDataClient` is a factory over concrete functions, with no
  interface something implements; `lookupSources` returns plain objects that
  satisfy both renderers' contract structurally, and the host's type check is
  what fails when either moves.
- **The wire types are declared once, in data-core.** `PublishedForm`,
  `RuntimeRefusal` and `ResolvedLookup`; the server's replies are annotated
  with them and the client reads against them, so a shape change is a type
  error on both sides.
- **`apps/host` speaks only the runtime plane**, the mirror of 0024: one
  published form, under both renderers side by side, each pane with its own
  engine, record, version and draft. Load reads a record once and opens it in
  both; New opens both empty. A framework-neutral session per pane makes the
  decisions, and both renderers show them:
  - **saved or created** — the engine is kept and each stored answer set back
    into it, so the stored spelling shows; the session takes the record and
    the new version, and a status line says "Saved." or "Created record …"
    after "Saving…" while the request was out, so a repeated "Saved." is still
    heard; the keyboard stays on Save;
  - **stale** — nothing is touched. A notice gives the server's sentence and
    "Your changes are still in the form.", takes the keyboard (focused, not an
    alert, as the renderers' summary is), and offers one button, "Load the
    saved record", which discards the draft. Nothing merges;
  - **a field the server names** — its sentence goes onto the field through
    `applyServerErrors`, and the renderer's error summary appears and takes
    the keyboard;
  - **anything else** — the server's sentence, in the notice. A 502 already
    says the record may have been saved; nothing is sent again;
  - **while a save is out** — neither 0.3.0 renderer holds the form, so the
    person may go on typing. An answer they changed since pressing Save is
    newer than the stored one and is left as it is; the result says the
    changes are not saved yet, and the next press sends them from the new
    version. A press while the save is unanswered sends nothing and says so.
    The guard is the form's that set it: Load or New starts a new form that
    may save at once, and the old form's answer, arriving later, is not
    applied to it but said on the pane's line as the replaced form's — the
    created record's token, or the refusal's sentence — so a record written
    or a "may have been saved" is never dropped.
  The pane's status line sits outside the part each Load rebuilds, because a
  live region is heard when its text changes, not when it arrives already
  holding some.
  The lookup operation is read through a getter, so the first save, which
  moves a pane from create to update, needs no new source map — in Angular,
  no new application.
- **Real databases in every suite.** The client's and the host's suites run
  against the real server on PostgreSQL and SQL Server (0003). What stale is,
  whether a selection is still a customer and what a tenant's lookup offers
  are database answers; an in-memory record adapter would have to decide each,
  which is the mock 0003 refuses. The studio's fake registry is not a
  precedent: its plane's only database answer is a discovery snapshot,
  captured from the real database and checked by fingerprint, and a write
  has no captured equivalent. What is fake in the host's suite is what the
  studio's fakes: literal tokens instead of signed ones, and `fetch` through
  `app.inject`.
- **A browser gate on real PostgreSQL**, for what jsdom cannot see: layout,
  focus and colour, which do not depend on the engine.
- **The examples page keeps its in-memory source**, because it has no server.
  This narrows 0021's "until the lookup route exists": the route exists, and a
  host reaches it through this client, as `apps/host` shows.

## Consequences

**What it buys.** A host is one import away from the runtime plane, with the
token, the names and the refusals already decided, and the decisions are
tested on both engines across real HTTP. Release gate 2 has a suite: the
published-form scenarios run in both renderers, against the database, in
every run.

**What it costs.**

- **`hasMore` and `omitted` do not reach the person.** `RemoteOption[]` has
  nowhere to put them at 0.3.0, so a list of exactly one page looks complete.
  A typeahead keeps narrowing as somebody types; a plain select does not.
- **Every name the document carries gets a server-backed source.** A host
  with lists of its own merges maps, and a name the server does not know
  fails closed, as "The options could not be loaded".
- **Records are addressed by token only.** The definition does not say which
  columns identify a record, so a host keeps the tokens a create, a read or a
  lookup gives it, or encodes a key with data-core's `encodeKeyToken` outside
  the client.
- **The sentences are the server's, in English.** A host that shows another
  language maps codes itself; the codes stay on the refusal for that.
- **The typeahead is the host page's choice.** The generator emits a plain
  select, and since 0030 the server publishes only the generated form with
  presentation applied, which a widget is not. So the host page draws every
  lookup that names no control of its own as a typeahead on its own copy of
  the form (`apps/host/src/widgets.ts`, held by `widgets.test.ts` and the
  journey suite, which fails without it). Every other host makes that choice
  for itself; whether the generator should emit a typeahead for a lookup, or
  presentation should carry a widget, is a decision not taken here.
- **Same origin is required**, by the client's default and by the server.
- **The verify job starts two more pairs of containers**, the client's and
  the host's suites each starting PostgreSQL and SQL Server. Measured on
  2026-10-09 on a Windows 11 workstation with both images pulled: the client
  suite about 20 s; the host suite 65 s with coverage run alone, its slowest
  test 11.3 s under coverage and 5.5 s without, and 126 s once the in-flight
  suite joined it, measured inside the whole `pnpm test:coverage` with every
  package's suite running at once. Not yet measured on CI's runner.
- **The browser job needs Docker** and pulls `postgres:17-alpine`. The host's
  gate took 22 s on the same workstation with the image cached, PostgreSQL and
  the server starting in 4 s of it; all three gates, run by `pnpm test:browser`
  with the builds cached, 26 s.
- **A third hand copy of the admin's palette.** `scripts/palette.test.mjs`
  fails when the copies here disagree; when upstream's moves, nothing fails.
- **"Load the saved record" discards the draft**, and nothing merges. Copying
  a change across is the person's.
- **A press during a save sends nothing.** The person presses again once the
  first has answered; the page does not queue the newer answers and send them
  by itself, which would be a second write nobody pressed for after the
  first was answered. The form is not locked during a save either: a
  disabled control drops the keyboard's focus, and the renderers offer no
  read-only state for a submit.
- **An answer for a replaced form is only said.** A record created after the
  person pressed New is not opened for them; its token is on the line, to
  load if they want it.
- **The jsdom worker runs the server**, and Vitest's jsdom environment swaps
  the global `Uint8Array` for jsdom's; the host's test setup puts Node's back,
  or every SQL Server rowversion is refused. A browser has one realm, so the
  page loses nothing, but it is a correction a reader has to know about.
- **Weight.** `vite build` on 2026-10-09: the page's chunk 410 kB minified
  (126 kB gzipped), and Angular's, loaded when its pane mounts, 209 kB
  (62 kB gzipped).

**What it forecloses.** Nothing: a host that wants another shape calls the
routes itself, and the client is one more package beside the server.

## Alternatives considered

**The client inside `apps/host`.** Rejected: integrators' hosts are outside
this repository, and each would re-decide where the token goes, how a name
becomes a route and what a refusal says — two implementations of one decision.

**A client per framework.** Rejected: the same decisions twice, and the
renderers already share the contract a source satisfies.

**An interface with a fake implementation for tests.** Rejected: one
implementation, and the tests use the real server; an interface would exist
for the fake alone.

**Extending `apps/examples`.** Rejected: that page is the administrator's
preview with no server, generated in the browser. A host page needs a live
server and a token, and on one page they would be two planes and two
audiences, and the examples' Docker-free gate would need a database.

**A fake registry and an in-memory record adapter**, as the studio's suite
has for discovery. Rejected for the reason above: it would decide stale,
membership and exact decimals instead of the databases.

**CORS on the server.** Rejected for 0024's reason: a same-origin deployment
needs nothing, and an allowed-origins setting is one more piece of reviewed
configuration whose usual mistake is a wildcard.

**Applying codes instead of sentences.** Rejected: the renderers print an
entry verbatim, so a person would read `not-an-option`.

**A client cache of definitions or lookups.** Rejected by 0022: the policy is
asked on every request, and a cached list would offer what the policy has
since withdrawn.

**A host backend holding the token.** Not this page's to decide: a host with
a backend can keep the token there and proxy `/v1`, and the client is
unchanged, since the token is whatever `token()` returns.
