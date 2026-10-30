# 10. Verification

What is checked, how, and what each check actually proves. The organising
principle is **one expectation, two engines, real servers**: database
behaviour is proved against a real server of each kind
([0003](../decisions/0003-real-databases-in-every-test-run.md)), and a case
both engines share is written once and asserted through each adapter
([0005](../decisions/0005-one-fixture-written-twice.md),
[0028](../decisions/0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md)).
Every gate is a job of one workflow, `.github/workflows/gates.yml`, which CI
calls on every pull request and a release calls before it publishes, so a
release passes exactly what CI does
([0035](../decisions/0035-a-release-report-is-derived-from-the-run-that-gated-it.md)).

## 10.1 Real servers, both engines, every run

Every adapter behaviour is tested against PostgreSQL and SQL Server started
through testcontainers. Each engine has a default image, `DEFAULT_IMAGES` in
`packages/data-fixtures/src/images.ts`, which every suite runs, and a
matrix, `MATRIX_IMAGES` beside it, the default first: the `test-images` job
runs data-fixtures and each engine's adapter suite on every other image of
it, `FORMANCY_IMAGES` choosing the image for the leg
([0067](../decisions/0067-the-adapter-suites-run-on-every-image-of-a-per-engine-matrix.md)). What the versions of one engine disagree on is a row of
`VERSION_FACTS` (`packages/data-fixtures/src/versions.ts`), asserted on
every leg by the major its server answered and never skipped. The README's
*What it is tested on* block is generated from what is installed and names
the matrix. A file that needs an image of its own names it:
`packages/data-postgres/src/discovery-pg18.integration.test.ts` names
PostgreSQL 18 for one catalog fact, a NOT NULL added NOT VALID, which it
holds to read as the nullable column and unvalidated check that the same
rule spelled as a check reads as
([0077](../decisions/0077-a-not-null-added-not-valid-is-read-as-the-unvalidated-check-it-is.md)), and
`packages/data-server/src/routes/admin-untested.integration.test.ts` names
PostgreSQL 14, outside the matrix, to show that a server this release was
not tested on is said to be untested and is served ([0068](../decisions/0068-a-snapshot-records-the-server-it-was-read-from-and-nothing-refuses-a-server-discovery-can-read.md)); the report names
such an image as outside the matrix, with its files.

There is no mocked driver, no `--skip-db` flag and no environment variable
that turns a suite into a no-op. That no mock exists is **not mechanically
enforced**: nothing fails if somebody adds one, and 0003 says it is held by
review and by `CLAUDE.md`.

In the packages a file that starts containers is named
`*.integration.test.ts`. `@formancy/data-client` and `apps/host` start both
databases once per run in a vitest `globalSetup`
(`packages/data-client/src/test-databases.ts`,
`apps/host/src/test-databases.ts`), so every file there needs Docker;
`data-core`, `data-identity`, `apps/examples` and `apps/studio` need none.
The whole product runs over HTTP into the real server and through the real
drivers on both engines in `packages/data-server/src/e2e.integration.test.ts`
([0025](../decisions/0025-each-adapter-owns-its-driver.md)).

A SQL Server container that never says it is ready fails its start with
testcontainers' sentence and, after it, how Docker says the container
ended -- running or not, its exit code, whether the OOM killer stopped it
-- and the last 40 lines it wrote, asked before testcontainers removes it;
every container a starter starts is labelled with the file that asked for
it. `packages/data-fixtures/src/unready.integration.test.ts` kills one with
SIGKILL while it starts and holds the report to what Docker and the
container said. Two starts of SQL Server 2025 on CI stopped before they
were ready, on 2026-10-17, and said nothing more; memory, measured, does
not explain them, and their cause is not established
([0082](../decisions/0082-a-sql-server-container-that-never-becomes-ready-says-how-it-ended-and-is-given-no-memory-bound.md)).

What it costs: a developer without Docker cannot run the adapter suites, and
the first run pulls SQL Server's image, which is large. Only the adapter
suites and data-fixtures run per image: the server's, the client's, the
host page's and the studio's suites, the browser gates and the composed
stack run the defaults alone, so what they do on another version is not
seen (0067). The images are moving tags, so two runs of one commit can test
different builds; the release report names the version and digest each
server answered, which reports the difference and does not prevent it.

## 10.2 One model, one expectation

`@formancy/data-fixtures` is private test support and never published
([0005](../decisions/0005-one-fixture-written-twice.md)):

- **One business model in two dialects**,
  `packages/data-fixtures/fixtures/postgres.sql` and
  `packages/data-fixtures/fixtures/sqlserver.sql`, with identically named
  constraints, beside a restricted reader and the order form's own account.
  `packages/data-fixtures/src/load.test.ts` holds the two files to the same
  constraint names.
- **The neutral truth and one comparator.** `FIXTURE_MODEL` says what
  discovery must report, per engine where the engines genuinely differ, and
  `packages/data-fixtures/src/conformance.ts` reports every disagreement as a
  sentence. Each adapter's discovery suite asserts the list is empty;
  `packages/data-fixtures/src/conformance.test.ts` holds the comparator
  itself.
- **One expectation per shared case**: filters, labels and refusals in
  `packages/data-fixtures/src/parity.ts`
  ([0028](../decisions/0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md)),
  changes to a form's own table in
  `packages/data-fixtures/src/drifting.ts`
  ([0041](../decisions/0041-the-runtime-refuses-what-drift-blocks.md)),
  lists, deletes, cascades and uuid keys beside them, and a file of
  records in `packages/data-fixtures/src/exports.ts`: `export: shipments`,
  the bytes both adapters' lists must make through data-core's export, a
  double, a real and a zoneless timestamp's fraction where the engines
  spell a value their own way
  ([0079](../decisions/0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md)).

`sharedCases()` derives every case id, and a test declares the ones it
asserts with `covers()`. The release report keeps a matrix of every case on
each engine and fails a run in which one is missing or failed on either. What
nothing holds is that a test declaring a case asserts it: `covers()` is the
test author's claim, held by review, and 0035 records one declaration that
did not.

The cost, from 0005: every change to the model is made in three places, two
of them in different SQL dialects, by somebody who knows both.

## 10.3 The gates

| Job | Runs | What it proves |
|---|---|---|
| `verify` | `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:pkg`, `node scripts/verify-licenses.mjs`, `pnpm test:repo` | The tree builds and type-checks, the vitest, Vite and tsdown configs with it through `tsconfig.tools.json`; every TypeScript and JavaScript file git does not ignore holds to the shared lint rules -- `@eslint/js`'s recommended set and typescript-eslint's type-aware one, every rule at error, a disable comment only with its reason -- and is as Prettier writes it, which the check reads and never writes; each was watched failing on 30 October 2026, on a floating promise and a double-quoted string planted in `packages/data-core/src/records/heading.ts`, the file put back byte for byte ([0113](../decisions/0113-every-typescript-and-javascript-file-is-linted-and-formatted-by-the-rules-the-four-repositories-share.md)); each published package passes `publint` and `attw`; every tarball declares the source-available licence and carries `LICENSE.md` and `NOTICE` ([0001](../decisions/0001-a-paid-module-in-its-own-repository.md)); the repository's own guards (§10.4) |
| `test`, one per package | `turbo run test:coverage --force --summarize` | Each package's suite, its databases included, on a runner of its own; `--force` so a cached result is never reported as this run's |
| `test-images`, one per image of the matrix but the defaults | the `test` job's command, `FORMANCY_IMAGES` set to the leg's image | data-fixtures and that engine's adapter suite on that image (0067); no coverage is uploaded |
| `browser`, one per browser | `pnpm test:browser` | §10.5 |
| `pictures` | `pnpm test:pictures` | §10.6 |
| `install` | `scripts/install-test.mjs` | §10.7 |
| `container` | the server image, built and started | It refuses to start unconfigured, naming the setting; serves health; refuses an unauthenticated request; and holds the rate limit, the lookup deadline, `path-not-plain`, `Cache-Control: no-store`, a key set read again on SIGHUP, listed origins and trusted proxies as the server's settings say |
| `getting-started`, twice | `scripts/getting-started.mjs` | §10.8 |
| `cloudflare`, twice | `pnpm test:cloudflare` | §10.8 |
| `report` | `scripts/release-report/report.mjs` | §10.9 |

Each package's suite runs on a runner of its own because, as the workflow's
own comment records with the run that showed it, the suites sharing one
runner timed out a test that takes seconds alone.
`scripts/ci-test-jobs.test.mjs` fails when the matrix and the workspace's
packages with a suite disagree, so a new package cannot go untested in CI by
being left off it, and when the `test-images` legs and `MATRIX_IMAGES`
disagree.

Outside the gates: `.github/workflows/cla.yml` fails a pull request naming
any commit author with no signature in `.github/cla/signatories.json`;
`.github/workflows/security.yml` runs CodeQL over the code and the
workflows; and the release's `check` job, before anything is published,
verifies the report, the tarballs, the SBOM and the body
(`scripts/release-report/verify-publish.mjs`). It does not ask whether the
published performance figures describe the product: `RELEASING.md` asks
that, with `scripts/performance-stale.mjs`, and nothing refuses a release
for the answer
([0084](../decisions/0084-a-release-does-not-wait-for-the-performance-figures-to-be-measured-again.md)).
`RELEASING.md` says the rest of a release.

## 10.4 The repository's own guards

`pnpm test:repo` runs every `scripts/**/*.test.mjs`
(`vitest.repo.config.mts`). It needs `pnpm build` first, because some guards
run the built server's own code. **A guard that is not a gate is a comment**,
and each of these fails on the change that breaks what it holds:

- **Upstream and licence.** `scripts/upstream-deps.test.mjs`: every
  `@formancy/*` dependency an exact release, and the release-age exemption
  naming upstream alone
  ([0002](../decisions/0002-depend-on-upstream-never-copy-it.md),
  [0055](../decisions/0055-an-upstream-release-is-adopted-the-day-it-is-published.md)).
  `scripts/licence-status.test.mjs`: every licence block is what
  `LICENSE.md` says, and gate 10 has no evidence while no lawyer has
  reviewed it
  ([0048](../decisions/0048-the-licence-is-in-force-before-a-lawyer-has-read-it.md),
  [0054](../decisions/0054-version-1-1-names-the-address-for-a-redistribution-agreement-too.md)).
  `scripts/third-party-notices.test.mjs`: a built app carries the licence
  and notice texts of what it bundles
  ([0046](../decisions/0046-a-built-app-carries-the-licence-and-notice-texts-of-everything-it-bundles.md)).
  `scripts/check-cla.test.mjs`: a change to `CLA.md` under a signature.
- **Size and look.** `scripts/source-size.test.mjs`: no source file past
  the budget `CLAUDE.md` sets. `scripts/palette.test.mjs`: every app that
  draws with the admin's palette imports `@formancy/themes/room.css`, and no
  stylesheet declares one of its variables again.
  `scripts/no-other-host.test.mjs`: no app's `index.html`, built page or
  linked stylesheet names an address on another host, every family the
  room and Blueprint draw with has a face in the build, and the apps import
  the same faces; it reads no JavaScript
  ([0072](../decisions/0072-the-apps-serve-their-own-fonts-and-no-page-asks-another-host-for-anything.md)).
- **This documentation.** `scripts/architecture.test.mjs`: `docs/README.md`
  and these twelve sections exist; the building blocks name every workspace
  package and app; every decision record is linked from a section; every
  relative link reaches a file and every fragment a heading; and every
  repository path written in backticks names something git would commit
  ([0076](../decisions/0076-the-architecture-is-documented-as-arc42-and-every-change-updates-the-section-it-touches.md)).
  A path given from inside a package, or whose first directory is
  misspelled, is not read as one, a package named that the workspace does
  not have passes, and whether a sentence is still true is review's.
- **The lint rules and the format.** `scripts/code-style/code-style.test.mjs`:
  the rules the four repositories share, a copy of Formancy Health's, each
  at error on the kind of file it is for and each path a repository passes
  doing what it says, on a repository of real files it writes.
  `scripts/lint.test.mjs`: this repository's wiring -- every TypeScript and
  JavaScript file git holds linted by the rules its kind is held to and
  none at `warn`, `require-await` off in every file and a test's seven
  relaxations in tests alone, in a program lint types it with unless it is an install
  fixture, and in the shared style, and the format check naming a
  misformatted file of every extension git holds.
  `scripts/prettier-merge.test.mjs`: a merge across the format through
  `scripts/prettier-merge.mjs` takes a change against main's format of the
  same lines without a conflict, and still conflicts where both sides
  changed what a line says ([0113](../decisions/0113-every-typescript-and-javascript-file-is-linted-and-formatted-by-the-rules-the-four-repositories-share.md)). What a rule
  reports is no defect until somebody reads it, and a disable comment's
  reason is review's.
- **Derived files.** `scripts/codecov-config.test.mjs`: `codecov.yml` is
  what its generator makes of the workspace.
  `scripts/generated-block.test.mjs`: every generated region of the
  Markdown keeps its marker and grammar. `scripts/performance-doc.test.mjs`:
  `docs/performance.md` is what its committed results render.
- **The workflows.** `scripts/ci-test-jobs.test.mjs`, above, and
  `scripts/release-report/workflows.test.mjs`, which holds
  `.github/workflows/ci.yml`, `.github/workflows/gates.yml` and
  `.github/workflows/release.yml` to the shape a release depends on: every job
  collects and uploads, `report` needs them all, third-party actions pinned
  to a commit, no secret passed to the gates, and `verify`'s lint and
  format check after the typecheck and before the guards
  ([0035](../decisions/0035-a-release-report-is-derived-from-the-run-that-gated-it.md)).
- **What a gate measures without a browser or Docker.**
  `scripts/browsers.test.mjs` and `scripts/browser-gate.test.mjs` for the
  browser gates
  ([0058](../decisions/0058-the-browser-gates-run-in-chromium-firefox-and-webkit-and-each-fact-the-browsers-disagree-on-is-named-and-held.md));
  `scripts/pictures/*.test.mjs` for the pictures
  ([0038](../decisions/0038-readme-pictures-are-taken-by-a-script-and-held-to-the-text-they-show.md));
  `scripts/getting-started/*.test.mjs` for the guide's tables, control names
  and Compose pin, and `scripts/mint-token.test.mjs` for the composed
  stack's token minter
  ([0032](../decisions/0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md));
  `scripts/cloudflare/*.test.mjs` for the overlay and its doors
  ([0037](../decisions/0037-cloudflare-is-the-edge-not-the-runtime.md));
  `scripts/demo.test.mjs` for the examples demo's Worker, deploy and
  headers
  ([0069](../decisions/0069-the-examples-page-is-served-at-formancy-ai-data-examples.md));
  `scripts/live-demo.test.mjs` for the live demo's Worker config, deploy
  and headers, `scripts/live-demo-docs.test.mjs` for what the README says
  of it, and `scripts/live-demo-gate/*.test.mjs` for its gate's pure parts
  ([0070](../decisions/0070-the-live-demo-runs-the-real-server-and-postgresql-in-a-cloudflare-container-of-each-visitors-own.md));
  `scripts/server-start.test.mjs` for what the built server says and
  refuses at start about the Entra connections in its allowlist
  ([0074](../decisions/0074-a-sql-server-connection-may-log-in-as-an-entra-principal-and-no-test-logs-in-as-one.md));
  `scripts/web-policies.test.mjs` for the studio's and the host page's
  Content-Security-Policies: each is 0069's with its named allowances and
  holds exactly what its built page loads, `deploy/web/nginx.conf`'s map is
  what the module writes, every location that serves files has a policy
  and every other answers with no page, and nothing in the file keeps the
  header from a page in the ways it names -- a location's own
  `add_header`, the header sent without `always`, a request moved out of
  the page -- read as nginx reads it, not run in nginx
  ([0083](../decisions/0083-the-studio-and-the-host-page-are-served-under-a-content-security-policy-each.md)).
- **The release.** `scripts/release-report/*.test.mjs`: the report, the
  registers and what a publish refuses;
  `scripts/release-notes.test.mjs`: each changelog section a release could
  be cut with fits the release body
  ([0064](../decisions/0064-the-first-releases-notes-summarise-the-development-before-it.md));
  `scripts/performance-stale.test.mjs`: no workflow runs the staleness
  check ([0084](../decisions/0084-a-release-does-not-wait-for-the-performance-figures-to-be-measured-again.md)), and every file the measured
  product leaves out, the default deadline's among them, holds one exported
  integer and nothing else
  ([0063](../decisions/0063-the-default-lookup-deadline-is-outside-the-measured-product.md)).

One guard of the composed stack's configuration runs in a package's suite
instead, beside the number it holds:
`packages/data-server/src/export-limits.test.ts` reads
`deploy/web/nginx.conf` and fails when an export's deadline, with a
statement still running after it, is not below every forwarding location's
`proxy_read_timeout` -- its own, its server's, or the http block's, set
outside every block of the file -- or nginx's default where none is set
([0079](../decisions/0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md)).

## 10.5 The browser gates

jsdom applies no CSS and performs no layout, so what a page looks like to a
keyboard and to the eye was a hand check until these gates. Each app has
one, `apps/examples/scripts/browser-test.mjs`,
`apps/studio/scripts/browser-test.mjs` and
`apps/host/scripts/browser-test.mjs`, over a shared harness,
`scripts/browser-gate.mjs`. In every state a person reaches -- the examples
clean and after a failed submit
([0021](../decisions/0021-generated-forms-preview-in-both-frameworks.md)),
the studio at every step of its journey against the real server
([0024](../decisions/0024-the-studio-speaks-only-the-admin-plane.md)), the
host page at every state of a load, a save, a stale save, a lost answer, a
refused selection, a delete and a download
([0047](../decisions/0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md),
[0053](../decisions/0053-a-host-deletes-a-record-from-its-detail-or-its-row-after-a-confirmation-in-place.md),
[0080](../decisions/0080-a-host-downloads-the-records-its-grid-lists-and-the-browser-saves-the-servers-file.md))
-- they check that nothing scrolls sideways down to 320 CSS pixels, WCAG's
reflow width; that the first Tab lands on the skip link and the next in the
content; axe's colour-contrast and target-size rules; and that no rule of
the app's own stylesheet reaches the form's paper. The host page's gate also
fails when Enter on the skip link leaves the keyboard anywhere but `<main>`,
and when a file Download CSV saves, through Playwright's download event, is
not `<form id>.csv`, does not start with the byte-order mark, or differs by
a byte from what the server answers for the request the page sent -- the
browser's save of an object URL, which jsdom cannot make, so the host's
`export.test.tsx` takes the file where the page hands it over and
`save-file.test.ts` holds the anchor and the revoke (0080).
`guardRequests` in the harness refuses and names every request to an origin
the gate does not serve, and the pass that measures the fallback stack
refuses every font file; on the examples page the demo's policy refuses
such an address before any request exists, and its check names it
([0072](../decisions/0072-the-apps-serve-their-own-fonts-and-no-page-asks-another-host-for-anything.md)).
A request only an interaction the gates do not perform makes is seen by
nothing.
Each page is served with the Content-Security-Policy it is sent in
production -- the examples page with the demo's headers, the studio and
the host page with the policy `deploy/web/nginx.conf` sends them -- and the
studio's and the host page's gates fail every state in which the browser
refused anything under it, an event the document heard or a console line
about the policy, and fail on what it refused after a document's last
state; each gate ends a pass with an inline script put in the page, which
must be refused and heard with nothing heard before it that no check
read, so a page served under no policy, or a listener that hears nothing,
fails; a refusal whose report is still on its way when a document's last
read is made is heard by nothing; and the host page's gate fails,
once a run, when the page without its one allowance no longer has AG
Grid's style elements refused
([0083](../decisions/0083-the-studio-and-the-host-page-are-served-under-a-content-security-policy-each.md)).
The host page's gate starts PostgreSQL alone, because layout, focus and
colour do not depend on the engine.

Every check runs in Chromium, Firefox and WebKit, headless, in Playwright's
builds, none skipped or loosened for a browser
([0058](../decisions/0058-the-browser-gates-run-in-chromium-firefox-and-webkit-and-each-fact-the-browsers-disagree-on-is-named-and-held.md)).
Where the browsers genuinely differ -- Firefox's Tab after a click, whether a
lost save is sent again, what AG Grid takes WebKit for -- the difference is
a row of `FACTS` in `scripts/browsers.mjs`, held by a check with one name in
every browser. The report fails a run in which a gate made another list of
checks in one browser than in another, or did not make a check a fact
names. On a machine `FORMANCY_BROWSERS` chooses, Chromium alone by default;
CI runs one leg per browser, on a pinned runner image because WebKit's
networking and every leg's fallback fonts are the image's.

What it does not prove, from 0058's costs: these are not the browsers people
install, nor any browser on macOS, Windows or a phone; Playwright's WebKit is
not Safari; and no scrollbar took width in any of them.

## 10.6 The README's pictures

Every picture in `README.md` is taken by `pnpm pictures` from a state the
product reaches, the built page against the real server, and never
retouched
([0038](../decisions/0038-readme-pictures-are-taken-by-a-script-and-held-to-the-text-they-show.md)).
`scripts/pictures/readme.test.mjs` holds the README's picture regions to
`scripts/pictures/scenes.json` and what was captured; each app's
`pictures.mjs --check`, run by `pnpm test:pictures` in Chromium in the
`pictures` job, walks the same states and fails when a pictured element no
longer says what the caption quotes. What a picture looks like is held by
review alone; `docs/images/README.md` lists what else nothing checks.

## 10.7 The install gate

Every other gate resolves a workspace package through a symlink to its
source, so an `exports` map that is wrong for a consumer can be right for
the whole suite. `scripts/install-test.mjs` packs each published package,
installs the tarballs into a plain npm project, type-checks
`scripts/install-fixture/consume.ts` with `skipLibCheck` off and runs it
under Node. The tarballs it packed are kept as the run's `release-tarballs`,
and a release publishes exactly those bytes. It does not talk to npm and
connects to no database.

## 10.8 The guide and the edge, run

**Getting started.** `scripts/getting-started.mjs` runs
`docs/getting-started.md` as written, from a clean checkout with Node and
Docker and nothing installed, then the journey over HTTP through the
composed stack's one origin on both engines: propose, publish, lookup,
create, a create sent again, update, a stale update, another tenant's
refusal, a file of the orders downloaded as each tenant, tenant 2's
without the order tenant 1 created
([0079](../decisions/0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md)),
and the fixture's order deleted with what it reaches (0051). It fails if
a secret or a token reaches a log, compose's configuration or a
container's inspect, and it runs twice, with the
runner's Compose and with the oldest release the guide names, so the
guide's claim about that release fails here the day `compose.yaml` needs a
newer one
([0032](../decisions/0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)).
Its page check fails when nginx sends the studio or the host page another
Content-Security-Policy than `scripts/web-policies.mjs` gives it, or none
([0083](../decisions/0083-the-studio-and-the-host-page-are-served-under-a-content-security-policy-each.md)).
`scripts/getting-started/steps.test.mjs` holds the guide's generated tables
and Compose pin without Docker, and `apps/studio/src/guide.test.tsx` and
`apps/host/src/guide.test.tsx` hold the controls it names. Not covered:
Docker Desktop, Windows and macOS, and nothing clicks through the composed
stack in a browser.

**Cloudflare.** `pnpm test:cloudflare` holds `deploy/cloudflare/` to
`docs/deploy/cloudflare.md` offline: it resolves both Compose files, runs
the guide's configure step with a fake tunnel, asks the pinned cloudflared
what the configuration means, and sends a corpus of paths cloudflared, the
router and nginx could read differently through to the built server, which
must refuse each. The tunnel's doors, `deploy/cloudflare/doors.json`, are
generated from the routes the built server registers, and
`scripts/cloudflare/doors.test.mjs` fails when they differ. No Cloudflare
account is reached, and nothing of the deployment has been measured through
a real tunnel
([0037](../decisions/0037-cloudflare-is-the-edge-not-the-runtime.md)).

**The examples demo.** The page at formancy.ai/data/examples/ is deployed
by Cloudflare from `main`, not by a workflow here. `scripts/demo.test.mjs`
holds its configuration and headers; what Cloudflare actually serves was
read by hand once, and nothing here reads it again
([0069](../decisions/0069-the-examples-page-is-served-at-formancy-ai-data-examples.md)).

**The live demo.** `pnpm test:live-demo` (`scripts/live-demo-gate.mjs`), the
`live-demo` job, builds the host page's demo build and the image of
`deploy/demo/Dockerfile`, and runs the Worker's own module in front of it
over a stand-in for Cloudflare's runtime, `scripts/live-demo-gate/cloudflare.mjs`:
one Durable Object per name with its storage and alarm, and containers that
are `docker run`s of the image at the instance type's share of a CPU and
its memory. It walks a visitor's journey over HTTP -- each person's menu,
paging, a search, the typeahead, writes and refusals, a second visitor's
own data, neither secret in what the container wrote, the reset -- and
then the page in Chromium under the live headers, with axe, at 320 pixels
and by keyboard. It is not workerd and not Cloudflare: it does not take a
container's network away, stop it when idle or cap how many run, and
`wrangler dev` was measured not to run a container here, so the Durable
Object's code is held by review until the first deploy is read by hand.
`apps/live-demo`'s own suite holds the data, the image's forms and the
Worker's pure parts, two of its files against PostgreSQL 17
([0070](../decisions/0070-the-live-demo-runs-the-real-server-and-postgresql-in-a-cloudflare-container-of-each-visitors-own.md)).

## 10.9 The release report and its registers

The last job builds a report from what every other job found: what the run
was tested on, as each server and browser answered; every package's
results; every shared case on both engines and on every image of the
matrix (0067); the build identity of what a
release publishes; the release gates; and the known limitations
([0035](../decisions/0035-a-release-report-is-derived-from-the-run-that-gated-it.md)).
It is a build output of the run, never a committed document, and it fails
the run on anything in its problems: a job that ended other than success, a
test skipped or failed -- skipped is not passed -- a shared case on one
engine only or missing on an image of the matrix, an image of the matrix
that answered no test, a browser gate missing in a browser, two builds of
one package that differ. `docs/release/README.md` lists every rule, and
how to build a report on one machine.

Two registers live in `docs/release/` and are held by `pnpm test:repo`:

- **`docs/release/gates.json`** names, for each of the plan's release gates
  by number, the evidence a run must pass, or why it has none
  (`scripts/release-report/gates.test.mjs`). A document as evidence is shown
  as stated, never as passed in the run. The open gates are in
  [§11.4](11-risks-and-debt.md#114-the-release-gates-still-open).
- **`docs/release/limitations.json`** has an entry for every decision
  record: the costs a user, integrator or operator meets, or why it has
  none. Each entry carries the hash of its record as it was read, so any
  edit to a record fails `scripts/release-report/limitations.test.mjs` until
  somebody reads it again and stamps it. Where a test shows a line still
  holds, `heldBy` names it, and the report fails a run in which it did not
  pass. The fence detects change, not meaning: a stamp without a reading
  passes, and a line can outlive its truth until its record changes.

## 10.10 Coverage is reported, not gated

`vitest.coverage.ts` is one coverage policy for every package, with its
exclusions argued: barrels, the composition root and declaration files. The
report shows each package's totals; Codecov receives them when the
repository has a token, and never during a release. There is no threshold,
and none is wanted. The bar instead is that new behaviour arrives with a
test that fails without it, and that each case says in a comment which
failure it prevents -- both held by review, not by a tool.

There is no count of tests in this document. Each run's report has them,
and a number typed here would drift from the next run.

## 10.11 The honest limits

- **Automated accessibility checking is a floor.** axe in jsdom and in
  three browsers finds what a rule can find; nothing here records a run of
  the apps with assistive technology.
- **Not mechanically enforced, and said:** that no mocked driver exists
  ([0003](../decisions/0003-real-databases-in-every-test-run.md)); that a
  test declaring a shared case asserts it, and that a register line is a
  fair summary of its record
  ([0035](../decisions/0035-a-release-report-is-derived-from-the-run-that-gated-it.md));
  what a picture looks like
  ([0038](../decisions/0038-readme-pictures-are-taken-by-a-script-and-held-to-the-text-they-show.md));
  that a merged branch is deleted, which a repository setting does
  ([0036](../decisions/0036-a-merged-branch-is-deleted-by-the-merge.md));
  and that the pull request bringing the format merges with a merge commit,
  so that `.git-blame-ignore-revs` names commits on `main`, and that the
  lint rules are Formancy Health's and those formancy.ai publishes, which
  nothing compares ([0113](../decisions/0113-every-typescript-and-javascript-file-is-linted-and-formatted-by-the-rules-the-four-repositories-share.md)).
- **"Tested on" is not "accepted by".** Nothing in the product refuses a
  server version no test ran but SQL Server discovery before 2019; a
  snapshot records the server it was read from, and the studio and drift
  review tell an administrator when this release was not tested on it
  ([0068](../decisions/0068-a-snapshot-records-the-server-it-was-read-from-and-nothing-refuses-a-server-discovery-can-read.md)). The report says what the run met, and an installation may meet
  another.
- **No test logs in as an Entra principal.** A SQL Server connection may
  log in as an Entra managed identity or service principal, and the tests
  show only that a SQL Server 2025 container started with a certificate
  refuses one over TDS 8.0, that the run's image of the matrix resets the
  connection before any login, that nothing is tried again as a SQL login
  and that nothing of the principal is written; what the driver sends
  first is shown by a listener that answers nothing, and the token's path
  is reached by a unit test alone. Nothing verifies that an Entra login
  succeeds
  ([0074](../decisions/0074-a-sql-server-connection-may-log-in-as-an-entra-principal-and-no-test-logs-in-as-one.md)).
- **A declined TLS is shown against a stand-in.** No real server answers
  a client asking for TLS that it will not encrypt, so what the real
  driver sends then -- its PRELOGIN and nothing after it -- is shown by
  data-fixtures' stand-in, which answers that one message in the server's
  place; that every server of the matrix encrypts, and its TLS passes the
  adapter's guard, is shown on each image
  ([0081](../decisions/0081-a-sql-login-that-asks-for-tls-is-refused-when-the-server-answers-that-it-will-not-encrypt.md)).
- **No gate is required before a merge.** Every gate reports on every pull
  request and fails a release; what stops a red one from being merged is
  the maintainer reading it (`GOVERNANCE.md`, [§11.6](11-risks-and-debt.md#116-people-and-process)).
