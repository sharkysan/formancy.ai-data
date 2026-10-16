# 0058 — The browser gates run in Chromium, Firefox and WebKit, and each fact the browsers disagree on is named and held

- **Status:** accepted; its table extended on 2026-10-16 by `reportsFocusScroll`: after a focus scrolls the window or a scroller, WebKit says the new scroll only at its next rendering update, and the host gate waits for one between the keys that scroll its grid; extended by [0072](0072-the-apps-serve-their-own-fonts-and-no-page-asks-another-host-for-anything.md): the families a pass must load are those the built page's stylesheets declare, the pass that refuses the web fonts refuses every font file, whatever its origin, and every gate refuses and names a request to an origin it does not serve; its *Google Fonts* cost is history
- **Date:** 2026-10-13
- **Deciders:** Daniel Bacher
- **Verified by:**
  `scripts/browsers.test.mjs` (`pnpm test:repo`) -- `BROWSERS` is the
  `browser` job's `matrix.browser`, read with `yaml` (failing until the
  matrix named Firefox and WebKit); `gateBrowsers` runs Chromium alone with
  `FORMANCY_BROWSERS` unset and every browser for `all`, refuses an unknown
  name, an empty list, a repeat and `all` beside a name, and refuses WebKit
  on `darwin` and `win32`, naming `FORMANCY_BROWSERS=chromium,firefox`,
  while it runs Firefox on both (watched failing with the refusal removed:
  `all` returned WebKit on both); every row of `FACTS` names every browser in
  its values, sources and measurements, and every connection where it is
  by connection (watched failing with WebKit's `resendsLostPost` values
  deleted); `claimsSafari`'s and `claimsMacOs`'s AG Grid is the
  `ag-grid-community` release `apps/host/package.json` pins (watched failing
  with the host's edited to 36.2.1, and with `claimsMacOs`'s: "expected
  '36.2.1' to be '36.2.0'"); every row names the checks that hold it, in an
  app whose `test:browser` is its gate; every system package a row rests on
  is one the gate asks dpkg-query about (watched failing with
  `libsoup-3.0-0` taken out of `SYSTEM_PACKAGES`); and `installCommand`
  names `--with-deps` for Firefox and WebKit and not for Chromium (watched
  failing with the flag dropped). `scripts/browser-gate.test.mjs` -- the
  families a built page asks Google Fonts for are read from its
  `index.html`, `&amp;` included; a pass that does not refuse the web fonts
  fails unless every one loaded, the pass that refuses them unless none
  did, and a page that asks for none fails both; what a machine cannot say
  of its fallback family or a package's version is null with why (watched
  failing, on review, with the `&amp;` decoding removed -- [Archivo, IBM Plex
  Sans] -- with the refusing branch returning null, with the no-family
  guard removed, with the fetched-files suffix dropped, and with
  fc-match's failure replaced by a guess); `lostCreate` fails a Chromium or
  Firefox create sent on a new connection while a kept-alive one stood idle
  and holds one sent on a new connection with none idle as the fresh row,
  fails a WebKit create on a connection that carried a request and a second
  sending, and a sending as often as the table does not say (watched
  failing with the idle condition taken out, which is how the row first
  read: any connection satisfied `idle`); `rowUnmeasured` fails a run none
  of whose creates took the connection its browser takes when it can
  choose (watched failing with it returning null); and `agGridRowProblem`
  answers each browser as it said it was on 2026-10-13 with no problem,
  and fails a platform AG Grid takes for a Mac or an iOS device, MacIntel
  with touch points among them, and a user agent on the wrong side of
  `_isBrowserSafari()` (watched failing with the macOS test read from the
  user agent, which names a Mac in WebKit).
  `packages/data-fixtures/src/tcp-hop.test.ts` -- `sentOn` says of each
  sending of a marker which connection carried it and how many requests
  that connection carried before: 1 for a marker after one request on its
  connection, beside a connection that carried two, and 0 on a new one
  (watched failing with the hop's turns counted across every connection:
  3); and how many other connections it passed over, idle from before its
  connection opened until it crossed: one, beside one answered only after
  it opened, one waiting for its answer, one the server ended whose client
  had not closed, and one never used (watched failing with idleness read
  at the marker alone, and with the end ignored: 2 each).
  `scripts/release-report/gate-results.test.mjs` -- what a browser said it
  was and the system it ran on are kept in that browser's file, and null in
  a file whose run recorded none. `report.test.mjs`, *the same checks in
  every browser* -- a WebKit gate that lacks one of Chromium's checks at
  "reflow, 320" and makes one more at "laptop, 1440", so that the totals
  are equal, fails the run with a sentence for each that names the check,
  the pass and both browsers (watched failing against a comparison of the
  totals: no sentence); a check made twice in one browser's pass and once
  in the other's, and another list of passes, each fail it; a gate that
  ended in an error is left out (watched failing with it compared);
  *0058's facts, each held by its checks* -- a run whose host gate never
  made "the browser names its platform to AG Grid as 0058's table says", in
  Chromium and WebKit at once, fails with a sentence for each browser naming
  the check and the row, and a check made in one pass alone holds its row
  (watched failing with the rows' checks not required: no sentence).
  `render.test.mjs` -- how and where every gate ran is said from what each
  recorded of its launch, and turns to name the headed gate when one is
  (watched failing with the sentence typed); WebKit's packages are named
  from what its gates recorded, a version dpkg-query could not give said
  with why, with the rows that rest on them; each browser's user agent,
  platform, touch points, pointer, hover and fallback family, and each
  row of `FACTS` with the checks that hold it and every browser's value,
  source and measurement, are printed. `tested-on.test.mjs` -- a build
  Playwright pins for each browser (watched failing, on review, with
  `BROWSERS` Chromium alone).
  `workflows.test.mjs` -- the run leaves `browser-chromium`,
  `browser-firefox`, `browser-webkit` and `pictures`, and the report needs
  the pictures job (watched failing with it taken out of the needs); every
  app's `test:pictures` is `node scripts/pictures.mjs --check` and no
  browser leg runs one; the legs and the pictures job run on `ubuntu-24.04`,
  and only WebKit's leg installs system libraries.
  `scripts/pictures/readme.test.mjs` -- the README's hero line names the
  job that runs `pnpm test:pictures` (watched failing while it named the
  browser job). **The three gates**, with `FORMANCY_BROWSERS` naming one
  browser or all, one gate at a time, on 2026-10-13, on the machine
  *Measured* names: every check passed in every browser -- the examples page's 126,
  the studio's 684, the host page's 1596 (2026-10-14, after the rebase onto
  0052 and 0053) -- a local report over the nine
  results files found no check made in one browser and not another and no
  row's check missing, and watched failing in the
  browser named with `fromTheTop` reduced to the click alone (Firefox: "open:
  the first Tab reaches the skip link" on the host page, "the first Tab in
  the workbench reaches the skip link" in the studio); with
  `clickThenTab.firefox` true (Firefox: "a click on the workbench's corner,
  then Tab", "Firefox went to button "Sign out", not the skip link");
  with `postConnection.chromium` fresh (Chromium sent the lost create "on a
  connection that had carried 19 request(s)"); with
  `resendsLostPost.firefox.reused` false ("Firefox sent the lost create 2
  times on a reused connection; 0058's table says once"); with
  `resendsLostPost.webkit.fresh` true ("WebKit sent the lost create once on
  a fresh connection; 0058's table says twice"); with `claimsSafari.webkit`
  false ("WebKit names itself Safari to AG Grid 36.2.0"); with the
  refusing pass's route removed (Chromium: "Archivo, IBM Plex Mono and IBM
  Plex Sans loaded anyway"); with the hop cut just before Save in every
  pass, so that every create took a new connection (Chromium: every pass's
  checks held, and the run failed, "Chromium sent every lost create of
  this run on a new connection, so 0058's row for a reused one -- sent
  again, which 0031 rests on -- was measured by nothing"; the gate without
  this check passed such a run whole, as review showed in a scratch copy);
  with
  `postConnection.webkit` idle (WebKit, every pass: "sent it on a new
  connection while 4 kept-alive connection(s) stood idle", or 3, and the
  run's row measured by nothing); and with `claimsMacOs.webkit` true
  (WebKit: "names its platform as neither a Mac nor an iOS device to AG
  Grid 36.2.0 (Linux x86_64, 0 touch points)"); and, in a probe that
  walks the host gate's own states through its own modules, not committed,
  with `decide`'s sideways clip taken out (Firefox, at 360 pixels:
  "Created by" left undecided, "shown, and the gate read no pixel of the
  cell beside it", where it had read the panel's glass) and with its
  scroll of the window taken out (the lines grid's four headers, below the
  window, where it had read black).
  **Held by the report:** a
  run in which an app's gate left no results in a browser of `BROWSERS`
  fails, so `FORMANCY_BROWSERS` narrows a run on a machine and never a
  gated one; and so does one in which the gate a row of `FACTS` names did
  not make one of the row's checks in a browser.
  **Not mechanically enforced:** that each row's source still describes
  its browser's code at the release Playwright builds from, which is
  review's; that a WebKit pass says anything of Safari, which it does not;
  that a pointer press on the host page's Save sends the save in a real
  browser -- no gate presses Save with a pointer since this record, in any
  browser, and the jsdom suites' `user.click` performs no layout -- which
  in WebKit sent nothing in about one press in thirty-five (*Measured*);
  that a state is measured after the fonts it draws with arrive, since the
  fonts check holds the end of each pass and not each state; that a grid
  cell the host gate reads after scrolling the window to it is under the
  hover its state had, since the scroll moves what is under the pointer;
  and every
  figure for CI, which no run had made when this was written.

## Context

0021 made the first browser gate Chromium's alone, because "Firefox and
Safari lay out and expose focus their own way", and 0035 kept every gate so:
each gate's contrast, target-size and keyboard checks would need validating
per browser, and the host page's resend observation (0031's P7) is
Chromium's. It left the other browsers to a record of their own. The host
page is meant for a host application's users, who are not all on Chromium,
and the claims the gates make -- nothing past either edge down to 320
pixels, the keyboard path, contrast and target size -- held only where they
were measured.

What Playwright 1.63.0 pins (its `browsers.json`): Chromium's headless
shell 153.0.8010.12 (revision 1243), Firefox 155.0 (1543) and WebKit 26.6
(2359). Headless Chromium is launched with `--hide-scrollbars` and with its
hover and pointer forced fine; headless WebKit on Linux is the WPE port,
whose networking is the system's libsoup 3, not Playwright's. The sources
read, each at the revision Playwright v1.63.0's `UPSTREAM_CONFIG.sh` names
as its base, or at the library releases the runner and this machine have:

- **Firefox** `d065a04`, `netwerk/protocol/http/nsHttpTransaction.cpp`:
  `Close` restarts a transaction on `NS_ERROR_NET_RESET` or `NS_OK`, among
  others (`:1546-1553`), when it received nothing and its method is safe,
  it sent nothing, or its connection was reused (`:1594-1595`). The file's
  own comment warns of repeated purchases. A POST sent on a fresh connection
  that received nothing is not restarted; on a reused one it is.
  Playwright's patches over that revision were not read.
- **WebKit** `4d05d73`,
  `Source/WebKit/NetworkProcess/soup/NetworkDataTaskSoup.cpp:166-173`: a
  message is flagged `NO_REDIRECT`, `COLLECT_METRICS` and sometimes
  `DO_NOT_USE_AUTH_CACHE`, never `IDEMPOTENT`. **libsoup** 3.4.4 and 3.6.6,
  alike: a message neither flagged idempotent nor of an idempotent method
  takes a new connection (`soup-connection-manager.c:407-411`); a request
  is restarted only when its connection was used before and its method is
  idempotent (`http1/soup-client-message-io-http1.c:693-711`), and GET,
  HEAD, OPTIONS, PROPFIND, TRACE, PUT and DELETE are (`soup-misc.h:59-65`).
  So a WebKit POST goes out on a new connection and is never sent twice.
- **AG Grid** 36.2.0: ag-stack's `_isBrowserSafari()` is
  `/^((?!chrome|android).)*safari/i` on `navigator.userAgent`
  (`dist/package/main.esm.mjs:2652-2675`), and it turns on
  ag-grid-community's forced browser focus (`:29439`, `:31565`) and five
  more branches (`:41380`, `:41565`, `:42263`, `:43272`, `:53390`);
  `_isBrowserFirefox()` three (`:41450`, `:51417`, `:52925`). Playwright's
  Linux WebKit names itself "Macintosh; Intel Mac OS X 10_15_7 …
  Version/26.6 Safari/605.1.15", with `navigator.platform` "Linux x86_64",
  so in WebKit the host page's grids take AG Grid's Safari paths and not
  its macOS ones.

A probe of 2026-10-12 -- modified copies of the examples and studio gates,
on pages answered by `page.route`, with the system libraries unpacked by
hand -- said the work was feasible: every check of both copies passed in
the three browsers after one harness change. Its figures are not this
record's; what follows is the committed gates' own.

## Decision

- **Every check of every gate is made in Chromium, Firefox and WebKit**,
  headless, in Playwright's builds, against the same page and server, and
  none is skipped, loosened or given a threshold of its own for a browser.
  Each gate is one script and the browser its one parameter;
  `recordedPerBrowser` runs it once per browser, each run with its own
  results file, and the host gate starts its own PostgreSQL and server for
  each.
- **What the browsers disagree on is a table**, `FACTS` in
  `scripts/browsers.mjs`, 0026's rule for the engines applied to browsers.
  Each row has every browser's value, its source at the version that runs,
  how it was measured, and the system packages it rests on where the runner
  supplies them; each is held by a check that has one name in every
  browser, so a browser that changes fails a check by name, and never
  leaves one missing:
  - `clickThenTab`: after a click on the page's corner, the first Tab
    reaches the page's first tab stop, an off-screen skip link -- in
    Chromium and WebKit, and not in Firefox, which starts from the caret the
    click left. The studio holds it in every pass ("a click on the
    workbench's corner, then Tab: as 0058's table says of this browser").
    This is what a person meets in Firefox on any page with an off-screen
    skip link; the page cannot change it without moving the skip link,
    which would cost every keyboard user who arrives by Tab.
  - `postConnection`: a POST goes out on an idle kept-alive connection in
    Chromium and Firefox where one stands idle, and always on a new one in
    WebKit; `resendsLostPost`: over HTTP/1.1, when the connection closes
    after the server read the POST and before any byte of an answer,
    Chromium and Firefox send it again on a reused connection and not on a
    fresh one, and WebKit never. The host gate's state "A create the
    network lost after the server stored it" holds both in every pass: the
    TCP hop between the browser and the page drops the answer and then
    closes the connection, and says through `sentOn` which connection
    carried the create, how many requests it carried first, and how many
    other connections stood idle -- answered, open on both sides, unused
    since -- from before that connection opened until the create crossed;
    the create went out on the connection the table says -- in Chromium and
    Firefox a new one only when none stood idle, in WebKit a new one --
    as often as the table says for that connection, one order is stored,
    and the page says what is true -- "Created record" where it was sent
    again, and the "It may have been saved" notice with the keyboard on it
    where it was not (0031). And once per run, the gate fails unless some
    pass's create took the connection the browser takes when it can
    choose: a run whose Chromium or Firefox creates all went out on new
    connections -- the server's keep-alive timeout, a pool that changed, a
    page that left nothing idle at Save -- holds every pass and measures
    nothing of the resend 0031 rests on.
  - `claimsSafari`: AG Grid's `_isBrowserSafari()` is true in WebKit and in
    no other; `claimsMacOs`: its `_isMacOsUserAgent()` and
    `_isIOSUserAgent()` are true in none, WebKit's platform being Linux.
    The host gate tests both rows' expressions, copied with their AG Grid
    release, against the page's user agent, platform and touch points in
    every pass, and a repository test fails when the host pins another AG
    Grid until the rows are read again.
  - `reportsFocusScroll`, added on 2026-10-16: after `focus()` scrolls the
    window or an element's scroller to show an element, Chromium and
    Firefox say the new scroll -- `scrollY`, `scrollLeft`, every box -- in
    the task that focused, and WebKit only at its next rendering update.
    The host gate holds it once per run, on a page of its own ("a focus
    that scrolls the window or a scroller: the page says where to at once,
    as 0058's table says of this browser"), and its workspace waits for a
    rendering update before and after the Home that scrolls the Records
    grid back to its first column, and checks that it did.
  - **Each row names the checks that hold it**, `heldBy`, and the report
    fails a run in which that gate did not make one of them in a browser:
    the comparison below holds the browsers to each other, so a check
    taken out of a gate in every browser at once would leave the row
    standing and every leg green.
- **"From the top" is the harness's**, `fromTheTop` in
  `scripts/browser-gate.mjs`: what has the focus blurred, a click at (1,
  1), and the selection collapsed to the start of `body`, which puts the
  start of sequential navigation at the top in all three. It stands for a
  person who arrives at the top of a page, which is what a skip link is
  for, not for a person who clicked. The studio's workbench uses it after
  `clickThenTab`'s check, and the host page's Open state uses it.
- **The same checks in every browser, by name and pass.** Each check is
  kept by name under the pass it was made in, and the report fails a run
  in which one app's gate made another list of passes in one browser than
  in another, or, in a pass, made a check in one browser it did not make
  as often in another. A gate that ended in an error is left out: its
  error is already a problem.
- **The web fonts are checked, and the machine recorded.** At the end of
  every pass each gate checks that every family its built `index.html`
  asks Google Fonts for has loaded, and in the pass that refuses them,
  that none did. Once per browser's run it records the user agent, the
  platform, the touch points, whether `(pointer: fine)` and `(hover:
  hover)` match, the family fontconfig gives `sans-serif`, and, for
  WebKit, the versions of `libsoup-3.0-0`, `glib-networking` and
  `libegl-mesa0`; in every pass it measures the scrollbar's width.
- **`FORMANCY_BROWSERS`**: on a machine, unset runs Chromium alone, `all`
  every browser, a comma list those -- the person's decision of
  2026-10-13, for a machine's memory, departing from running every browser
  by default -- and CI names each leg's browser. WebKit is refused off
  Linux: Playwright's WebKit on macOS and Windows is another port, with
  another network stack, and the WebKit rows were measured on Linux.
  Firefox and Chromium run anywhere.
- **The report names, pins and requires each browser** (0035): each
  launched browser is held to its pin, every app's gate must leave results
  in every browser, a release gate's browser evidence passes only when the
  app's gate passed in all of them, and the report says how and where
  every gate ran, what each browser said it was, WebKit's system packages
  and the rows that rest on them, and every row of `FACTS`.
- **CI: one leg of the `browser` job per browser**, on `ubuntu-24.04`;
  each fails the run and its report, and so blocks a release, whose
  publish needs the gates, as Chromium's leg always has. Nothing blocks a
  merge mechanically: `main`'s ruleset, "Protect", holds only deletion and
  non-fast-forward and requires no status check (GOVERNANCE.md), so a
  merge waits for a green run because the merge process says so, and
  `report` is the check to require if required checks are ever added.
  Only WebKit's leg runs `playwright install-deps webkit`. The README
  pictures' check moves out of `test:browser` into `pnpm test:pictures`, in
  Chromium, in a `pictures` job of its own that the report needs.

## Measured

On 2026-10-13 and 2026-10-14, on a Docker Sandbox VM -- Ubuntu 26.04.1,
x86_64, 20 CPUs, Node v22.22.1, Playwright 1.63.0, with `libsoup-3.0-0`
3.6.6-1ubuntu0.1, `glib-networking` 2.80.1-1build2 and `libegl-mesa0`
26.0.8-1ubuntu0.3, its fallback `sans-serif` WenQuanYi Zen Hei, other
workflows building in other worktrees and a demo holding its own databases
at the time -- the gates as this record commits them, each app's run once
with `FORMANCY_BROWSERS=all`, its browsers in turn and one app at a time,
each against its real listening server; the wall time is each browser's
run as its results file records it, and the lost create's figures are that
run's seven passes. The examples page's row is from 2026-10-13; the
studio's, the host page's and the lost create's are from 2026-10-14, after
the rebase onto 0052 and 0053 added the studio's two delete states and the
host page's seven to every pass, and, for the host page, `decide`'s
reading below:

| | Chromium 153.0.8010.12 | Firefox 155.0 | WebKit 26.6 |
|---|---|---|---|
| Examples page: checks, wall time | 126, 13.4 s | 126, 20.7 s | 126, 22.5 s |
| Studio: checks, wall time | 684, 27.0 s | 684, 41.6 s | 684, 51.6 s |
| Host page: checks, wall time | 1596, 245 s | 1596, 293 s | 1596, 437 s |
| The lost create's connection had carried before it | 15 to 45 requests | 24 to 42 requests | none: a new connection, every pass |
| Kept-alive connections standing idle beside it, passed over | none, every pass | none, every pass | 1 to 4 |
| Sent again, after the close | every pass, 10.1 to 14.8 ms | every pass, 20.9 to 29.0 ms | never; the page showed "It may have been saved" |
| After a click at (1, 1), the first Tab | the skip link | Sign out | the skip link |
| `_isBrowserSafari()`'s test of the user agent | false | false | true |
| `_isMacOsUserAgent()` and `_isIOSUserAgent()`, of a platform "Linux x86_64" with 0 touch points | false | false | false |
| Scrollbar width, every pass | 0 | 0 | 0 |
| `(pointer: fine)`, `(hover: hover)`, touch points | yes, yes, 0 | yes, yes, 0 | yes, yes, 0 |
| Web fonts loaded | all three families in every pass but the refusing one, none in that | the same | the same |

Every lost create in Chromium and Firefox travelled on a connection the
page had used before, none idle beside it, so the fresh-connection cells
of `resendsLostPost` stand where they stood: Chromium's on 0031's P7,
where a server answering `Connection: close` on every response saw one
POST, and Firefox's on its source alone, which the report prints as "by
source only".

The first WebKit runs failed twice, and the gates were changed for each,
in every browser. The open row's bar came out at 1.07:1 against its tint
in one pass of the first run, and in none of the 35 WebKit passes that
measured it after; whether the page moved between finding the points and
the screenshot, as the next finding shows it can, was not established, and
`paintedWhere` now finds the points again after the screenshot and reads
again while they moved. The bar is also found by its `rect` now, not by
the SVG around it, and read at the rect's centre: the same point as
before, since the rect is 4 px wide at the SVG's left edge, but a row whose
bar is not drawn yet now says so rather than being read as tint against
tint, which a 1.07:1 reading would also be; which of the two it was is not
established either. And a pointer press on Save sent nothing in five of
about 175 presses -- two of 120 in a probe, a modified copy of the
journey's own sequence, and three in five WebKit runs of the host gate,
neither committed -- because the document scrolled by 24 px between the
press and the release, which landed on the form beside the button; it
settled back about 130 ms later, and what moved it was not established.
That is not the harness's: a person whose click on Save lands in such a
moment sends nothing, and nothing says so. The two create states now
press Save from the keyboard, as every other save of the journey already
did, so no gate presses Save with a pointer in any browser, Chromium
included, where two states did before.

Rebased on 0053, whose grids end in a column of each row's Delete, the
host gate failed in Firefox and WebKit at 360 pixels on 2026-10-14. End
now scrolls the Records grid far enough that its "Created by" header
starts left of the grid's well, and `decide` read the background at the
header's corner wherever it lay: on the panel's glass beside the grid,
4.49:1 in Firefox and 4.47:1 in WebKit, where the header itself reads
7.03:1. In Chromium the same corner lay left of the window, where a
screenshot has no pixel and the gate read black, which passed; and so did
every cell below the window, in every browser, wherever the record's lines
were below the fold. `decide` now reads a cell only where the window shows
it: inside the part of its box no ancestor clips, after the window alone,
never the grid, has scrolled a cell outside it into view and before it
scrolls back, and only where `elementFromPoint` finds the cell -- in its
top padding or, where the grid's header covers that, its bottom padding,
as it did a row's Delete in WebKit at 641 pixels (watched failing in the
probe *Verified by* names). A text the window shows nowhere -- its box cut
away by its grid's own scroller, or covered -- is named in the gate's
output and not decided. In WebKit, from one run to the next, that was the
lines grid's last cell in the pass that refuses the web fonts, a few
pixels of it inside the well and none of its text, and at 1281 or 1440
pixels a row of the Records grid below the grid's own scroller, where the
window showed the panel and the page's footer; in Chromium and Firefox,
nothing. It finds each cell by the element axe answered with, not by axe's
selector, which can name `ag-row-hover`: after the scroll moved a row from
under the pointer, three of its cells matched nothing. Once, in WebKit at
641 pixels and with no scroll, a row of the lines grid was left undecided
the same way; that a class had changed there is likely and was not
established. The window's scroll moves what is under the pointer, so a
cell can be read under another hover than its state had.

Once, the studio's first Chromium pass loaded none of the web fonts and
failed its fonts check, and two Chromium runs after it did not; its
stylesheet most likely never arrived through this machine's proxy, which
was not established. A failed fonts check now says how many files the page
fetched from Google Fonts.

On a clean `ubuntu:24.04` container the same day, `playwright install
--with-deps webkit` installed 372 packages, 220 MB, in 81 s, among them
`libsoup-3.0-0` 3.4.4-5ubuntu0.9, `glib-networking` 2.80.0-1build1 and
`libegl-mesa0` 25.2.8-0ubuntu0.24.04.4; the examples gate then passed its
126 checks in WebKit, with nothing else installed. On this machine, whose
Playwright download had said GTK's libraries were missing, `install-deps
firefox webkit` installed 262 packages.

Not measured when this was written: the legs and the pictures job on the
runner, their times, what `install-deps webkit` installs there and how
long it takes -- the step stays until the first CI run shows whether
WebKit launches there without it -- whether Firefox launches there without
system libraries, each browser's cache, and a release's time without
caches. Each leg keeps fifteen minutes until three green runs give a
slowest time to triple, as 0035's report job does.

## Consequences

**What this buys.** Layout down to 320 pixels, the keyboard path, contrast
and target size, the grids' painted colours and the host page's whole
journey, held in three browsers. Each difference between them is named,
with a red leg when a browser, libsoup or AG Grid release changes it, and
the report names each browser, its pin, what it said it was and the
packages WebKit ran on. A web-font pass can no longer pass on the fallback
stack: in the probe, a WebKit that loaded no font passed every check.

**What it costs.**

- **CI.** Three legs and a pictures job where there was one job, each
  installing and building. The WebKit leg runs `apt-get update` and an
  install in a job a release needs, and every release does too, since a
  release restores no cache: upstream's nineteen-minute apt hang is back in
  reach, bounded by the step's five minutes, and the remedy is a rerun.
  Three legs a green run needs are three times the exposure to a flaky
  check, and the two changes above are what the first WebKit runs already
  asked for.
- **Locally.** A run of every browser takes each browser's time in turn,
  which on the machine above was three minutes for the host page in
  Chromium, four in Firefox and five in WebKit, and starts
  PostgreSQL once per browser. A Linux machine downloads Firefox and
  WebKit once and installs their system libraries once, with sudo. On
  macOS and Windows WebKit is refused, and `FORMANCY_BROWSERS` must name
  the other two. With nothing set, a machine runs Chromium alone and says
  how to run the rest; only CI and the report hold every browser.
- **Upgrades.** A Playwright release that moves a browser can turn a leg
  red with no product change, and so can an AG Grid release until
  `claimsSafari` is read again. A runner image update can move WebKit's
  libsoup, Mesa or the fallback fonts and flip a leg or a row; the report
  names the versions each run had, and the pinned image makes a move
  deliberate.
- **Google Fonts.** An outage turns every leg red until it ends, and a
  stylesheet lost on the way fails the pass it was lost in.
- **The WebKit leg's fonts** include Playwright's tools group, which
  `install-deps` adds and the other legs lack; each leg records its
  fallback family.
- **The host gate presses Home a rendering update after the keys before
  it**, and waits for another after it (`reportsFocusScroll`), in every
  browser: what AG Grid does with keys that come faster than WebKit's
  rendering updates -- which left its grid to the side -- is measured by
  no gate, and an integrator's own browser tests, pressing keys that fast
  in WebKit, can meet it.
- **What is not covered.** WebKit here is the WPE port with the runner's
  libsoup, not Safari: it moves Tab to links, which Safari does by default
  only with Option-Tab, AG Grid's Safari paths run on it, and how Safari's
  own network stack treats a lost save is not measured. Nothing runs on a
  phone. No scrollbar takes width: Chromium's because Playwright hides
  them, the others' for a reason not established. The pictures are
  Chromium's alone. The host gate is still on PostgreSQL only. A pointer
  press on Save is measured in no browser, and in WebKit one was seen to
  send nothing.

**What it forecloses.** A gate check made in one browser only, without a
named fact.

## Alternatives considered

- **Playwright Test's `projects`.** The gates are scripts over the
  `playwright` library; adopting the runner rewrites three gates and the
  recorder the report reads, and its retries turn a failing check into
  "flaky", which a guard may not do.
- **One job running all three browsers in turn.** Its wall time is the sum,
  and a red job does not name the browser.
- **Firefox only, or WebKit only.** Half the claim: Firefox is the one that
  differs on the keyboard, WebKit the one that differs in networking.
- **Skipping the checks a browser disagrees on**, or per-browser
  expectations in every state that starts at the top. The first hides the
  difference; the second repeats one fact in every state. One check per
  fact holds it.
- **A focused sentinel before everything, blur alone, or moving the skip
  link**, for "from the top". The sentinel writes into the page under
  test; blur alone disagrees in all three; moving the skip link changes the
  product for a harness's sake.
- **One resend value per browser.** True only of the connection the gate
  usually gets: a Firefox create on a new connection would turn its leg
  red for no change in anything. Nor **forcing reuse**, which controls
  neither which idle connection a browser picks nor, with `Connection:
  close`, keeps Chromium's resend, which is 0031's case. Nor **asserting
  "resent" everywhere**, false by WebKit's source, nor **skipping the state
  where nothing is resent**, which is the path a WebKit person meets.
- **Comparing the gates' totals.** Equal totals pass with different checks.
- **Recording the fonts and deriving a limitation**, as 0021 printed them:
  the run would be green with half of its layout claim unmeasured.
- **Overriding WebKit's user agent** to a non-Safari string. That tests a
  WebKit nobody ships, and loses the Safari paths Safari's users take.
- **Every browser by default on a machine.** The design recommended it; the
  person chose Chromium alone for a machine's memory, with the report and
  CI holding every browser.
- **An argument rather than a variable**, `pnpm test:browser -- --browser
  webkit`: turbo hands arguments to every task, one more thing to rely on.
- **Refusing Firefox off Linux too.** Its rows are Gecko's own code on
  every platform.
- **`--with-deps` for every browser, Playwright's Docker image as the
  job's container, or `ubuntu-latest`.** The first runs apt where nothing
  needs it; the second needs the Docker socket mounted for the host gate's
  database, a second way to run it; the third moves libsoup, Mesa and the
  fonts under the WebKit leg when the label moves.
- **The pictures' check as a step of the Chromium leg.** A step behind
  `if: matrix.browser == 'chromium'` that a rename skipped would go
  unnoticed; a job is in the report's needs.
- **Safari itself**, on a macOS runner through SafariDriver or Playwright's
  macOS WebKit, and **phones**, through mobile emulation: not now, the
  person decided on 2026-10-13. The first is a second automation stack or
  a second WebKit port, with no Docker for the host gate; the second
  emulates a phone's browser and runs none.
