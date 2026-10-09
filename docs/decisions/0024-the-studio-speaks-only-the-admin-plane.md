# 0024 — The studio speaks only the administrator plane

- **Status:** accepted; presentation survives regeneration, and an edit that is not presentation is refused at publish, narrowed by [0030](0030-presentation-is-a-patch-over-the-generated-base.md); the one reverse proxy is `deploy/web/nginx.conf` in the composed stack, serving the studio at `/studio/` beside `/v1`, extended by [0032](0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)
- **Date:** 2026-10-09
- **Deciders:** Daniel Bacher
- **Verified by:** `apps/studio/src/journey.test.tsx` — every request the
  studio makes on the whole journey, sign-in to drift, is one of the
  administrator plane's routes or `/v1/whoami`, and the journey uses every one
  of them it has a reason to (watched failing with one stray call to a form
  route); axe at WCAG 2.2 AA plus the page-structure rules, and a name on
  every control, at every step; a step that cannot work yet is disabled and
  says what it waits for.
  `apps/studio/src/api.test.ts` — the client reads every route in the shape the
  real server sends; a refusal carries the server's code, sentence, problems
  and current version (watched failing with the problems dropped); the token
  travels in the Authorization header and in no URL; the studio's form-id rule
  agrees with the server's answer for every candidate.
  `apps/studio/src/sign-in.test.tsx` — a wrong token and a non-administrator's
  token are refused in the server's words, with what whoami says the second one
  names; the token is in no storage, no cookie and not in the document
  (watched failing with it written to `sessionStorage`).
  `apps/studio/src/presentation.test.tsx` — every control the presentation step
  offers is a label, a move, a width, undo or redo, and what they produce is
  published, served back, accepted by `validateBundle` and places every bound
  field (watched failing with a "Remove a field" button added).
  `apps/studio/src/policy.test.tsx` — the editor's problems are
  `validatePolicy`'s, in its words, and publishing waits for them (watched
  failing with the check stubbed); pins changed after generation are said and
  regenerated.
  `apps/studio/src/publish.test.tsx` — a conflict names the version somebody
  else published and rebases onto it (watched failing with the conflict shown
  as a bare failure); a refused bundle shows every reason.
  `apps/studio/src/connect.test.tsx`, `choose.test.tsx`, `drift.test.tsx` and
  `preview.test.tsx` for the steps between, gaps before tables among them
  (watched failing with the order swapped); discovering another connection
  keeps the generated form and its policy until a root is chosen on it, and
  the root says what choosing one replaces (watched failing when discovering
  discarded them).
  The removals in `policy.test.tsx` and the rebase in `publish.test.tsx` leave
  the keyboard on a deliberate control, not on the page (watched failing
  before it was moved there).
  `apps/studio/src/fixtures.test.ts` — the three captured snapshots hash to
  their fingerprints and agree with the shared fixture model.
  `apps/studio/scripts/browser-test.mjs` (`pnpm test:browser`, the existing CI
  job) — the whole journey in Chromium, against the real server on the
  studio's own origin, at 320 and 360 pixels, one past each breakpoint in
  the studio's stylesheet and 1440, and at 320 again with the web fonts refused: no
  sideways scroll and nothing past either edge at any step, the first Tab on
  the token and in the workbench on the skip link and then into the step, and
  axe's colour-contrast and target-size rules in every state that adds colour
  (watched failing with a muted colour darkened, the connection grid wider
  than a phone and the skip link kept off screen); Enter on Move down, on a
  filter's Remove and on Rebase leaves the focus on a deliberate control
  (watched failing with the rows keyed by position, and before the removals
  moved it); and no rule of the studio's stylesheet — `studio.css` with its imports
  inlined, as Vite builds it — selects an element on the preview's paper
  (watched failing with the element rules unscoped).
  `scripts/source-size.test.mjs` counts stylesheets against the 600-line
  budget (watched failing on the studio's, at 1042 lines, before it was split).
  `scripts/upstream-deps.mjs` refuses a range in the studio's manifest,
  watched failing with `@formancy/builder-core` at `^0.3.0`.

## Context

Plan section 3 is the administrator's journey: connect, discover, choose,
generate, review, try, publish, evolve. The server has carried its half since
0020 — seven routes, each requiring an administrator role in the host's token
— and nothing called them but tests. The studio is the person's half.

Four questions had answers that someone could helpfully undo. What may the
studio talk to? Where does the operator's token live? How are labels and
order edited without breaking what the bindings name? And what do the
studio's tests talk to?

## Decision

- **The administrator plane, and nothing else.** One client, `src/api.ts`, with
  a function per route and `/v1/whoami` to show who a token names. The runtime
  plane is for the host application's people and the studio never calls it:
  publishing a form and writing a record stay different permissions out to the
  screen (0020). So the preview's lookup list is not filled, and the page says
  why.
- **Same origin.** The server sends no CORS headers, and the studio needs
  none: it is served from the server's origin — behind one reverse proxy in a
  deployment, through Vite's proxy in development — so every request it makes
  is same-origin and the server is unchanged.
- **The token is held in memory.** A closure inside the client, in React state;
  never storage, a cookie or the address. Reloading the page signs the
  operator out, and the sign-in screen says so before the token is pasted.
- **The server decides; the studio says so early only with the server's own
  function.** The proposal is the server's, over a fresh discovery. The policy
  editor runs `validatePolicy` from `@formancy/data-core` on every change — the
  function `validateBundle` runs on publish (0019) — and publishing waits for
  it. Anything else in a bundle is the server's alone, and a 422 is shown with
  every problem it gives. The form id is checked as typed by a rule a test holds
  to the server's answers.
- **The policy's root row filters are the generator's pins.** One list, edited
  in Choose or in Policy; a change after generating is said, blocks publishing,
  and is one button from a regeneration, so the form and the policy cannot
  disagree about which column the tenant comes from (0011).
- **Presentation through `@formancy/builder-core`'s session, with controls of
  the studio's own, not `@formancy/builder-react`'s panes.** Each edit — a
  field's label, a section's label, a field's place among its neighbours,
  whether it spans the row — is a session command, so formancy's validator
  judges it and its history undoes it. The released builder 0.3.0 was read
  first (`packages/builder-react`, `apps/admin`), and it cannot be constrained
  to edits that keep the bindings:
  - Its components take a `BuilderSession` and nothing that forbids a command.
    The session is an interface, so a guarded one could be passed, and the
    structure tree does announce a refusal's message.
  - The property panel — the only surface of the builder that edits a
    field's label —
    discards the outcome of `setFieldProperty`, and the layout panel that of
    `setLayoutNodeProperty`. A refused edit leaves the typed value in the box
    and the document unchanged, and says nothing: refused without a reason.
    Upstream records the same shape of silence in builder-core's own comment
    on `numericAlternative` ("typing a numeric span did nothing at all and
    nothing said why").
  - The panel offers what are binding facts here: `optionsSource`, which is
    the lookup's source name, and `required`, `maxLength` and `pattern`,
    which the generator derived from the column. The logic panel edits the
    `disabled` rules that keep a never-written field read-only. And the tree
    adds and deletes fields and moves them into groups, which nest a field's
    data path: each changes what a binding names.
  What would change this is upstream: panels that show a refusal, or a
  session that takes a command policy, through formancy's contribution rules
  (0002).
- **The tests talk to the real server.** `createDataServer`, in the test, with a
  fake identity verifier and a fake connection registry whose adapters answer
  with snapshots captured from the shared fixture — PostgreSQL as its owner and
  as the restricted reader, SQL Server as its owner — by
  `scripts/capture-snapshots.mjs`, behind a fake `fetch` that goes through
  `app.inject`. No response body is written by hand.

## Consequences

**What it buys.** The studio cannot do anything the plane does not allow, and a
change to the plane's shapes fails the studio's suite rather than blanking a
pane. The problems an operator fixes a policy from are the server's own words.
"No relationship" and "cannot tell" are different on screen: gaps come before
the tables, and a lookup into a table out of sight is listed, disabled, with
its gap.

**What it costs.**

- **There is no list of published forms.** The plane has no route for one, so
  the drift step asks for a form id, defaulting to the one just generated.
- **The preview's lookups are empty.** The list is the runtime plane's, under
  the published policy; the renderer says where it would be.
- **A reload is a sign-out.** There is no session to resume, and a token that
  expires mid-work turns every request into the server's 401, said as such.
- **Rebasing is not merging.** A conflict shows the version somebody else
  published and lets the operator publish over it; what they changed is not
  merged into this draft.
- **Presentation edits do not survive regeneration** yet, which plan section 9
  asks for; the policy does, and is checked against the new form, with what
  the new form no longer has listed for removal.
- **Presentation offers less than the builder**: no new sections, no widths but
  full width, no moves between sections, no help text, no translations. Each
  is a command the session already has, to be offered once it can be shown not
  to touch a binding.
- **One origin for both.** A deployment routes the studio's files and `/v1` to
  one origin, or the studio cannot sign in.
- **The plane is configuration.** A server started without a store, an
  allowlist and administrator roles has no administrator plane
  ([0025](0025-each-adapter-owns-its-driver.md)); the studio says so at sign-in
  rather than failing request by request.
- **The admin's palette is copied twice** by hand now, in the examples and the
  studio, and nothing fails when upstream's moves.
- **Three captured snapshots.** Re-capturing needs Docker and both images; the
  SQL Server one is a gigabyte and a half. Their comparison with the model
  runs without a container.
- **Weight.** `vite build` on 2026-10-09: 625 kB minified (168 kB gzipped),
  the released renderer, engine, spec validator and builder session among it.
  Loading the preview step on demand took 70 kB off, which was not worth a
  loading state; Vite's warning limit is set just above the measurement, so
  growth still warns.
- **jsdom and the browser disagree about ids.** The gate found the root-table
  select labelled by `htmlFor="root"`, which in the browser names index.html's
  mount point; the suite now mounts the studio in a `#root`, as the page does.

**What it forecloses.** Nothing published: the studio is private, and no
package depends on it.

## Alternatives considered

**`@formancy/builder-react`'s panes over a guarded session.** Rejected for the
reasons above: the panel that edits labels drops a refusal on the floor, and
offers binding facts as presentation.

**Keep the token in `sessionStorage`.** Rejected: it would survive a reload,
and be readable by every script on the origin for as long as the tab lives —
a credential at rest for the convenience of not pasting it again.

**CORS on the server.** Rejected: a same-origin deployment needs nothing from
the server, and an allowed-origins setting would be one more piece of
reviewed configuration whose usual mistake, a wildcard, hands the plane's
answers to any page somebody pastes a token into.

**Hand-written responses in the tests.** Rejected: the suite would pass
against a server that had changed, which is the failure a test of a client
exists to catch.

**Generate in the browser, as the examples page does.** Rejected for the
studio: a proposal must come from the discovery the server will publish
against, and the snapshot travels with it into the bundle.

**Leave the policy to the server alone.** Rejected: `validatePolicy` is the
server's own function, so running it as the person types says nothing the
server would not, earlier, in the same words.

**A backend for the studio.** Rejected: a second server between the operator
and the plane, holding the token, for nothing the plane does not already do.
