# 2. Constraints

Constraints, unlike decisions, were not chosen here. Some come from
formancy.ai, some from the rightsholder, some from the two database engines,
the browsers and the platforms the product meets. They are recorded because
several decisions in [`../decisions/`](../decisions/README.md) look
arbitrary without them. Each row names the force on the left and, on the
right, what it led to and what holds that, or that nothing does.

## Licence and repository

| Constraint | Consequence |
|---|---|
| **formancy is Apache-2.0, with no proprietary edition ever**, and sells operating the platform, never using it ([formancy.ai 0002](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0002-apache-2-0.md), [formancy.ai 0003](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0003-open-core-line.md)) | A separate repository under its own licence, depending on formancy's released packages and containing none of their code ([0001](../decisions/0001-a-paid-module-in-its-own-repository.md)). Every publishable manifest says `SEE LICENSE IN LICENSE.md` and every tarball carries `LICENSE.md` and `NOTICE`: `scripts/verify-licenses.mjs`, in the gates, refuses one that does not. That no upstream source is copied here is held by review |
| **It is never called open source** | "Source-available" is the word, in every README and description. The manifests are checked by the script above; prose is held by review, and nothing searches it for the phrase |
| **The licence is in force before a lawyer has read it** | It says so at its top ([0048](../decisions/0048-the-licence-is-in-force-before-a-lawyer-has-read-it.md)); Version 1.1 names one address for a production licence and for a redistribution agreement ([0054](../decisions/0054-version-1-1-names-the-address-for-a-redistribution-agreement-too.md)). The README's licence block is rendered from `LICENSE.md` by `scripts/licence-status.mjs`, and `scripts/licence-status.test.mjs` fails when the two differ. What 0048 lists as left open stays open until a reviewed version replaces it |
| **A built app bundles other people's code** | Every app writes the licence and notice texts of everything it bundles beside its page, and the build stops when a bundled package ships none, but for what Vite folds in as text ([0046](../decisions/0046-a-built-app-carries-the-licence-and-notice-texts-of-everything-it-bundles.md)); `scripts/third-party-notices.test.mjs`. The examples page's deploy refuses a build without the file ([0069](../decisions/0069-the-examples-page-is-served-at-formancy-ai-data-examples.md)), and the fonts each app bundles carry their own licence's text there ([0072](../decisions/0072-the-apps-serve-their-own-fonts-and-no-page-asks-another-host-for-anything.md)) |
| **Contributions are taken under a CLA** (`GOVERNANCE.md`) | `.github/workflows/cla.yml` fails a pull request whose commit author has not signed, and `scripts/check-cla.test.mjs` fails a commit that changes `CLA.md` under a signature |

## Upstream

| Constraint | Consequence |
|---|---|
| **formancy's package APIs are not frozen before its 1.0** | Upstream packages are dependencies at exact released versions, never a range, a `workspace:` link or a path, and nothing of theirs is patched here ([0002](../decisions/0002-depend-on-upstream-never-copy-it.md)): `scripts/upstream-deps.mjs`, through `scripts/upstream-deps.test.mjs` in `pnpm test:repo`. A generic improvement goes upstream through formancy's own contribution rules, and this repository waits for the release. That latency is the cost |
| **pnpm refuses a package published less than a day ago** | An upstream release can be adopted the day it is published: its packages, and nothing else, are exempt by exact version, and the same guard refuses any other exemption ([0055](../decisions/0055-an-upstream-release-is-adopted-the-day-it-is-published.md)) |
| **formancy has no exact-decimal or wide-integer field type** | A decimal is a text field whose pattern encodes its precision and scale, and an integer wider than JavaScript holds is text with a digit-count pattern, which formancy's engine checks alike in the browser and in its server-side replay ([0009](../decisions/0009-generation-is-deterministic-and-says-what-it-chose.md)). Upstream's spec 4 window closed on 2026-10-09 without an exact-decimal type, as 0002's status line records; the type was proposed on 2026-10-16 as [formancy.ai#258](https://github.com/sharkysan/formancy.ai/issues/258), and until a release carries it nothing here changes |
| **A form in spec 4 needs a renderer at 0.4.0** | Generated forms stay on spec 3, and the server publishes and serves no other ([0042](../decisions/0042-generated-forms-stay-on-spec-3-after-spec-4-is-released.md)); `packages/data-core/src/generate/generate.test.ts` fails when the generator writes another version. A whole-number field's whole-ness stays the server's check. That a host on a 0.3.0 renderer reads every generated form was measured once, on 2026-10-10, in a scratch check, and nothing here fails if it stops being true |
| **formancy's Angular 22 declares `typescript: ">=6.0 <6.1"`** | TypeScript is pinned to `~6.0.3` in the catalog of `pnpm-workspace.yaml`, as upstream pins it ([formancy.ai 0039](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0039-pin-typescript.md)). Nothing here checks the pin against upstream's; the README's *What it is tested on* reports the version installed |
| **The builder's panes cannot be held to edits that keep a form's bindings** | The studio edits presentation with controls of its own over `@formancy/builder-core`'s session, loads none of the builder's panes and sets no `--wb-*` variable ([0024](../decisions/0024-the-studio-speaks-only-the-admin-plane.md)). What would change this is upstream: panels that show a refusal, or a session that takes a command policy |

## Technical

| Constraint | Consequence |
|---|---|
| **Database behaviour is the product, and only a real server shows it** | Every adapter behaviour is tested on both engines through testcontainers, in every run, with no mocked driver and no switch that skips a suite ([0003](../decisions/0003-real-databases-in-every-test-run.md)), and the adapter suites on every image of each engine's matrix, `MATRIX_IMAGES` in `packages/data-fixtures/src/images.ts` ([0067](../decisions/0067-the-adapter-suites-run-on-every-image-of-a-per-engine-matrix.md)). Docker is a requirement for development, and a cold run is minutes. A server outside the matrix is said to be untested and is still served ([0068](../decisions/0068-a-snapshot-records-the-server-it-was-read-from-and-nothing-refuses-a-server-discovery-can-read.md)). That no mocked driver exists is held by review |
| **The two engines disagree on facts a form depends on**: what a text length counts, how a key is numbered, where NULLs sort, how a uuid orders, what a collation matches | Each difference is named, in the snapshot or in the adapter, never smoothed over in the core ([0026](../decisions/0026-name-every-column-fact-the-engines-disagree-on.md), [0028](../decisions/0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md), [0056](../decisions/0056-a-key-the-database-fills-is-never-written-and-a-uuid-is-ordered-as-each-engine-orders-it.md)). The parity suites hold both adapters to one expectation per case, written once in `packages/data-fixtures/src/parity.ts`. A list ordered by a uuid comes back in each engine's own order, and the two are not the same |
| **A restricted account's catalog is filtered** | PostgreSQL is read from `pg_catalog`, never `information_schema` ([0006](../decisions/0006-postgres-discovery-reads-pg-catalog.md)); SQL Server's catalog views are read with every blind spot a gap ([0007](../decisions/0007-sqlserver-discovery-and-what-it-hides.md)) |
| **JavaScript's number cannot hold every value a column holds** | Exact values travel as strings, canonical and never rounded ([0008](../decisions/0008-exact-values-travel-as-strings.md)) |
| **A browser lets a page read another origin's answers only where that origin grants it** | The studio and the administrator's plane are same-origin only, served behind one proxy beside `/v1` (0024); a host page is same-origin unless the operator lists its origin exactly ([0029](../decisions/0029-a-host-renders-a-published-form-through-one-client.md), [0060](../decisions/0060-the-runtime-plane-answers-the-origins-an-operator-lists-and-the-administrators-plane-none.md)); `packages/data-server/src/cors.test.ts`. A refused preflight reaches a page as a network error, so a write refused there reads as possibly saved |
| **A customer's network should not reach out for keys** | The host's token is verified offline with a pinned algorithm; a key set is a file the operator copies in and SIGHUP reads again, and nothing is fetched ([0014](../decisions/0014-host-identity-is-verified-offline.md), [0059](../decisions/0059-the-host-identity-key-is-a-set-selected-by-kid-and-read-again-on-sighup.md)). A provider's new key verifies only once the operator's copy holds it and the server has been signalled |
| **An operator may want the stack reached over the internet through Cloudflare**, which can be the product's edge and, as the product is built -- files on a volume, write ids in one process's memory, a pool per connection -- not its runtime | Cloudflare is the edge, never the runtime: nothing of the product runs there. The Cloudflare guide puts TLS, a tunnel with no inbound port and Access in front of the composed stack on the operator's machine; the tunnel's doors are generated from the server's own routes, and the server refuses a path a proxy could read differently ([0037](../decisions/0037-cloudflare-is-the-edge-not-the-runtime.md)). `scripts/cloudflare/doors.test.mjs` and `pnpm test:cloudflare` check it offline; nothing has run through a real tunnel. Cloudflare decrypts everything at its edge, host tokens included. The examples page is the one thing Cloudflare serves, as static files with no code ([0069](../decisions/0069-the-examples-page-is-served-at-formancy-ai-data-examples.md)) |
| **A proxy stands between the browser and the server** | The server believes a forwarded client address only from the proxies the operator names, each by its address or range; unset, everybody behind a proxy is one client ([0071](../decisions/0071-the-server-believes-the-forwarded-address-only-from-the-proxies-an-operator-names.md)); `packages/data-server/src/trusted-proxies.test.ts` |
| **A SQL Server customer should not have to run PostgreSQL just to hold configuration**, and control data stays out of the customer's business tables | The configuration store is files on a volume, and compare-and-swap is a hard link on that file system ([0013](../decisions/0013-published-configuration-is-files-with-link-based-swap.md)); a write's id is remembered in the server's process ([0031](../decisions/0031-an-answer-lost-after-a-write-is-unknown.md)). So the product runs as one process on one volume: more than one replica needs a shared store, which is planned and not built |

## Organisational

| Constraint | Consequence |
|---|---|
| **One maintainer, who is also the rightsholder** (`GOVERNANCE.md`) | Decisions are records rather than a committee's minutes. `main` carries no branch protection rule, so no gate is mechanically required: what stops a red check from merging is a maintainer reading it, and `GOVERNANCE.md` says so because a gate invites the opposite assumption |
| **GitHub deletes a merged branch by a repository setting no workflow here can read** | Nobody deletes a remote branch by hand after a merge, and nothing fails if the setting is turned off ([0036](../decisions/0036-a-merged-branch-is-deleted-by-the-merge.md)) |
| **The screens are formancy.ai's concept applied** (`CLAUDE.md`) | The room's palette is copied from upstream's `admin.css` into each app, and `scripts/palette.test.mjs` holds the copies to each other and nothing to upstream's. Renderers ship no CSS and themes target `data-formancy-part` ([formancy.ai 0101](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0101-a-control-is-operable-without-a-theme.md)); every drag has a keyboard path ([formancy.ai 0046](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0046-keyboard-before-drag.md)); tests find elements by role and accessible name ([formancy.ai 0034](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0034-accessible-name-only.md)). One shell for every page of the site ([formancy.ai 0106](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0106-one-shell-for-every-page-of-the-site.md)) has nothing to hold until the `formancy.ai/data` page exists |
| **Every browser is a different engine too** | Each browser gate makes every check in Chromium, Firefox and WebKit, and what the browsers disagree on is a named fact in `scripts/browsers.mjs` ([0058](../decisions/0058-the-browser-gates-run-in-chromium-firefox-and-webkit-and-each-fact-the-browsers-disagree-on-is-named-and-held.md)). WebKit runs on Linux only |
| **formancy.ai's regulatory documentation describes formancy** | Its IEC 62304, SOUP and safety-analysis documents are about that software, and this repository has no such set of its own; if it ever claims one, the claim is a decision record first (`CLAUDE.md`) |

## Conventions

- ESM only, `NodeNext` resolution, `strict` with `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes` and `erasableSyntaxOnly`
  (`tsconfig.base.json`), as upstream compiles.
- Packages import each other through `dist/`; nothing aliases a workspace
  package to its source, so a change in `@formancy/data-core` is invisible to
  an adapter's suite until it is built again.
- No source file past 600 lines, stylesheets included:
  `scripts/source-size.test.mjs` in `pnpm test:repo`. Files are split by the
  reason they change: one catalog concern per file in an adapter's
  `discovery/`, one operation family per file in the core.
- Nothing in a package reads configuration.
  `packages/data-server/src/main.ts` reads every setting, and a secret is
  named by a reference, `env:NAME` or `file:/absolute/path`, which
  `packages/data-server/src/secrets.ts` resolves without ever repeating its
  value in an error ([0019](../decisions/0019-a-published-form-is-checked-every-time-it-is-read.md),
  [0025](../decisions/0025-each-adapter-owns-its-driver.md)).
- Identifiers come from approved metadata and are quoted by the adapter, one
  part at a time; values are bound as parameters
  ([0012](../decisions/0012-a-lookup-token-is-a-reference-not-a-permission.md),
  [0015](../decisions/0015-a-record-operation-is-one-guarded-statement.md)).
- Coverage is reported and never gated (`vitest.coverage.ts`); every test
  says in a comment which failure it prevents, and a test that asserts a
  shared case declares it with `covers()`, or the release report fails the
  run ([0035](../decisions/0035-a-release-report-is-derived-from-the-run-that-gated-it.md)).
