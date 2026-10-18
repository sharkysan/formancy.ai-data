# 0085 — A lookup says when its list goes on, never how long it is

- **Status:** accepted
- **Date:** 2026-10-19
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-client/src/lookups.test.ts`, *optionsPage* — a search's
  page carries the server's rows as value and label, `more` exactly when
  the server's `hasMore` says so, whatever the page holds, and `withheld`
  as its `omitted`; both are kept when the server says both, and
  `@formancy/spec`'s `capRemoteAnswer` then says more, not withheld
  (watched failing with `more` guessed from a full page of 50: two rows
  that go on were `more: false`; and with `omitted` left out: no
  `withheld`).
  `packages/data-client/src/lookups.integration.test.ts`, on PostgreSQL
  and SQL Server, as tenant 3's clerk over the paged customers: the empty
  search, asked with the source's `maxRows`, is a page of the `First` rows
  in the same order on both engines, `more` and nothing withheld; `First`
  is exactly one page and no more; `Later 07`, past the first page, is one
  row; the source's `maxRows` is `DEFAULT_MAX_PAGE_SIZE`, and the server
  answers a query that names no limit with that many rows and `hasMore`,
  and refuses one more, 400 `limit-out-of-range` (watched failing on both
  engines with the source answering a list, as it did: "a search answered
  [...], not a page"; with `more` guessed from a full page: `First`,
  exactly one page, said more; and with `maxRows` 49: "expected 49 to be
  50", and the server answered 50 rows unasked).
  `packages/data-fixtures/src/paged.test.ts` — the paged rows follow from
  the page size, a page of `First` and more, and their names sort alike by
  code point, case-insensitively and by number, so both engines' pages are
  one expectation (watched failing with one name written "later 07": "later
  07 is not ASCII Title Case", and with that check left out, "first
  disagreement: Later 08 against later 07").
  `apps/host/src/lookup-more.test.tsx`, on both engines and in both
  renderers, against the real server as tenant 3's clerk, the typeahead by
  the keyboard alone: Down on Customer opens the first page, and the pane
  says formancy's "Showing the first 50; there are more — keep typing to
  narrow."; End stops on the page's last row, and no `Later` row is
  offered; `First` typed lists the page and says nothing more; `Later 07`
  typed is found, chosen by Down and Enter with the keyboard still on
  Customer, and saved as that customer's token; chosen, the closed list
  says nothing, and Down says it again; the order line's plain select over
  a page of tenant 3's orders and one more says "Showing the first 50;
  there are more than this list can show." in each renderer and offers the
  page; and a record of a form the clerk may only read shows First 01 in a
  disabled Customer, sends no lookup search once it is open and says
  nothing of the list (watched failing on both engines, in both renderers,
  with the client's source answering a search with a list, built into its
  dist: the open list offered the page and never said there were more, and
  the plain select said nothing; and with the page drawing a record it may
  not update with the editable form: React's Customer was not disabled,
  and with that check left out, two searches for "" were sent once the
  record was open).
  `apps/host/src/page.test.tsx`, on both engines — axe at WCAG 2.2 AA and
  a name on every control with each renderer's customer list open and
  saying there are more (watched failing with the list answer: the
  sentence never came).
  `apps/examples/src/lookup-source.test.ts` — the in-memory source answers
  a search with a page that goes on past the limit and not at exactly the
  limit, and labels with a list (watched failing with the search answering
  `.slice(0, limit)`, as it did: "the in-memory source answered a search
  with a list").
  `apps/host/scripts/browser/more.mjs`, last in each pass of
  `apps/host/scripts/browser-test.mjs` in `pnpm test:browser`: signed in
  again as tenant 3's clerk, Tab reaches each renderer's Customer, Down
  opens one page saying there are more with the keyboard still on the box,
  the paper passes axe with the list open, colour contrast and target size
  among it, every text whose contrast axe could not decide lies under the
  open list, the open list's box covers the sentence's, and the whole page
  passes the gate's own checks, nothing past either edge at any width. Run
  on 2026-10-18 on Windows 11 in Chromium 153.0.8010.12 and Firefox 155.0,
  every check of the gate passing at every width (watched failing in
  Chromium with the client's source answering a list: "the list never said
  there are more", in both renderers at every width; and, on 2026-10-19,
  with a style that drew the open list 4rem lower put in the page: "the
  sentence lies outside the open list", likewise); in Linux WebKit it is
  CI's to show.
  **Not mechanically enforced:** what a screen reader says of the status
  line, and when; and anything of the three reference themes other than
  Blueprint but their stylesheets, read.

## Context

A lookup page is answered with what the server knows about the rest
without counting it
([0012](0012-a-lookup-token-is-a-reference-not-a-permission.md)):
`lookupPage` (`packages/data-core/src/lookup/rows.ts`) reads one row past
the page for `hasMore`, and counts in `omitted` a matching row whose key
does not fit a token. The client checks that both are there
(`isLookupResult`, `packages/data-client/src/shapes.ts`), and
`lookupSources` dropped both: until formancy 0.6.0 a renderer's option
source answered a list, which a control took for every row there is.
[0029](0029-a-host-renders-a-published-form-through-one-client.md) named
the cost, "a list of exactly one page looks complete", and since
[0066](0066-a-lookup-a-person-can-search-is-generated-as-a-typeahead.md)
a lookup no search can match is a plain select of its first page, which
looked complete too.

formancy 0.6.0
([formancy.ai 0177](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0177-a-source-may-say-its-list-goes-on.md))
lets a source answer one page, `{ options, more, withheld? }`. `more` is
required; `withheld` counts rows the source matched and could not hand
over; a page with any other key, a `total` included, is refused whole, and
the field says its source failed. What a control says is decided once, by
`optionsStatus` in `@formancy/core/words`: nothing under a field a rule
disables, which asks only for the labels of what it holds; a failure; under
a closed typeahead nothing more; then that the list goes on, was cut or
withheld rows, withheld left unsaid while more rows match. A typeahead
says "Showing the first {count}; there are more — keep typing to
narrow.", a plain select "Showing the first {count}; there are more than
this list can show.", either "{count} matches cannot be chosen here."

Every lookup's page is `DEFAULT_MAX_PAGE_SIZE`, 50: the query route builds
each lookup's config from the bindings and the snapshot alone
(`routes/runtime-lookups.ts`) and answers a query that names no limit with
that many. Its comment calls it "what formancy's select asks for by
default", `MAX_ROWS` in both renderers, which ask for and show the
source's `maxRows` when it states one. The two agreed by assumption.
[0061](0061-a-lookup-statement-stops-when-its-request-is-abandoned-or-its-deadline-passes.md)
bounds a search by time, not by rows.

Where the typeahead's status line is drawn decided one of the costs below.
Each field's status is the row of its grid after the box, and in all four
reference themes of 0.6.0 -- Blueprint, Dusk, Paper and Pop -- the open
list is absolutely positioned at the box's foot (`top: 100%`, `z-index:
20`, up to 14rem tall), over that row. Measured on 2026-10-18 under
Blueprint, the host page's theme, in Chromium 153 and Firefox 155 on
Windows at 1280 and 320 px: with the list open and saying there are more,
the window showed the option "First 01" at the middle of the sentence, and
the browser gate finds the sentence's box inside the list's at every width
it measures.

## Decision

**A search answers one page.** `lookupSources` answers a search with
`{ options, more, withheld }` -- `more` the server's `hasMore`,
`withheld` its `omitted` -- through `optionsPage`, the one place in
`@formancy/data-client` that reads either, and a label request with the
rows it names, as a list.

**Every source states the page the server answers.** Each sets `maxRows:
DEFAULT_MAX_PAGE_SIZE`, so a renderer asks for, and shows, exactly the
server's page, whatever its own default becomes. `PublishedForm` carries
no page size: every lookup has the one bound (0061 left it alone).

**What the person is told is the renderer's.** formancy's words, as
`optionsStatus` decides them: in an open typeahead that there are more and
to keep typing; under a plain select that there are more than the list
can show; how many matches cannot be chosen, only when nothing more
matches; nothing under a closed typeahead or a field nobody can change.
Past the page the person types, which nobody can do into a plain select
(0066).

**The examples page's source answers a page too**, so the page shows what
a host's control says over a database.

## Consequences

**What it buys.** A list that goes on says so, on every host that hands
`lookupSources` to a renderer: under a plain select, where it is seen, and
in an open typeahead, from its status line's live region (but see the
first cost). A row the server matched and could not offer is said, where
only a caller of the route saw its count. The control never asks for a
page the server refuses, whatever formancy's default becomes, and nothing
is counted, so a keystroke costs what it did.

**What it costs.**

- **A sighted person does not read the typeahead's sentence.** It is said
  only while the list is open, and the open list is drawn over the line it
  is on, in Blueprint as measured above and, by their stylesheets, in the
  three other reference themes; closed, the typeahead says nothing. So to
  the eye a typeahead's list of exactly one page still looks complete, as
  before this record; a screen reader hears the sentence from the line's
  live region. The plain select has no list over its line, and its
  sentence is seen. The theme and the renderer are formancy's, and nothing
  here restyles the paper. The browser gate holds this: it fails the day
  a release draws the sentence outside the open list, and this cost is to
  be read again.
- **No total.** The person learns that more rows match, never how many.
- **The status line changes as searches settle.** It says the sentence
  when the list opens and when a search settles on another one; formancy
  holds it while the next search runs, so a search that settles on the
  same sentence changes nothing in the live region. How often a screen
  reader speaks it is formancy's, and no gate here runs one.
- **Rows whose labels agree beyond one page are reached by typing only
  through a display column that tells them apart.** Sixty customers of one
  name, shown by their name alone, list fifty and say there are more, and
  ten cannot be chosen: 0012's "labels are not unique", with its
  consequence for reach.
- **The page is the unmeasured default, one constant for every lookup,
  and `maxRows` is the client's copy of the server's bound.** Both read
  `DEFAULT_MAX_PAGE_SIZE` from `@formancy/data-core`, so a host whose
  `@formancy/data-client` is of another release than its server meets a
  refused search, `limit-out-of-range`, or a shorter page only if a
  release changes that constant; none has.
- **A withheld row is said and never offered**, and counted only when
  nothing more matches: beside more, a count covers one page (formancy.ai
  0177). No host suite drives a withheld row through a database, since no
  key of the fixture is too long for a token; `lookups.test.ts` holds the
  mapping.
- **A search refused for its deadline** (0061, `lookup-timeout`) reads
  "could not be loaded", never that the list goes on.
- **The examples page's source says there are more** though it holds
  every row and could count them.
- **The client's and the host page's suites, and the host's browser gate,
  insert tenant 3's paged customers and orders** into the databases every
  suite of their run shares. Every other tenant's lookup and list is
  filtered by tenant and does not see them; nothing checks that a later
  suite keeps it that way.
- **It waited for an upstream release**, formancy 0.6.0, adopted the day
  it was published
  ([0055](0055-an-upstream-release-is-adopted-the-day-it-is-published.md)).

**What it forecloses.** A total on every search.

**What it does not do.** Page inside the list, or set a page size per
lookup; name which rows were withheld, or log them for an operator; keep
the active option in view while the person arrows through a long list,
which 0.6.0's renderers do not scroll to; or stop the host page's hidden
empty form, which the page draws for a form the person may only read
before a record is open, from asking its lookups for their first page --
found writing this record (`lookup-more.test.tsx` waits it out), not
changed by it.

## Alternatives considered

- **The interim on formancy 0.5.0**: each source states `maxRows` one below
  the server's page, so the control caps and says so, with the host's own
  wording of `options.capped` without its total, in three languages. Honest
  about the count, it said "keep typing" under a plain select and under
  every disabled lookup, showed one row fewer than the server read, wrote
  German and French copy here, and could not say more when a page held a
  withheld row.
- **Count the matches, so "of {total}" is true.** A second number both
  engines must agree on, and a count per keystroke never measured (0034
  timed pages, not counts). formancy 0.6.0 refuses a page that names a
  total, so a count could reach the person only as every matching row, a
  list.
- **"Show more" inside the list, or offset paging in the control.**
  formancy's combobox has no such row, and a native select cannot page.
- **The host page draws its own line beside the field**, which would also
  be seen while the list is open. A control this repository would add to a
  form, unthemed, on one host, and a second voice beside the field's own
  status.
- **Wait for formancy to draw the sentence where it is seen.** The plain
  select's sentence and the typeahead's live region are worth having now;
  where an open list's status is drawn is formancy's to change, and the
  gate says when it does.
- **Carry each lookup's page size in `PublishedForm`.** Every lookup has
  the same bound, so the field would carry one value everywhere.
- **Log `omitted` for the operator instead of telling the person.** The
  person is the one who cannot find the row.

## Older records

Extended: [0012](0012-a-lookup-token-is-a-reference-not-a-permission.md)
(a page's `hasMore` and `omitted` reach the person, as the page a host's
option source answers a renderer) and
[0066](0066-a-lookup-a-person-can-search-is-generated-as-a-typeahead.md)
(a plain select of its first page says when its list goes on, a version
published at 0.1.0 included). Narrowed:
[0029](0029-a-host-renders-a-published-form-through-one-client.md), whose
cost "`hasMore` and `omitted` do not reach the person" no longer holds;
its other lookup costs stand. Unchanged: 0061 (a search is bounded by
time) and 0012's token and page.
