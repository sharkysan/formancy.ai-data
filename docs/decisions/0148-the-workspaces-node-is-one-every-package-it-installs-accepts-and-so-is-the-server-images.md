# 0148 — The workspace's Node is one every package it installs accepts, and so is the server image's

- **Status:** accepted
- **Date:** 2026-11-11
- **Deciders:** Daniel Bacher
- **Verified by:** `scripts/node-floor.test.mjs`, in `pnpm test:repo` --
  every Node the workspace's floor, `engines.node` in the root
  `package.json`, admits, read as the lowest release of each major it
  admits up to the newest any package names, one every package
  `pnpm-lock.yaml` installs accepts (watched failing with the floor
  `>=22.22.3`: 57 packages refusing 23.0.0, 29 refusing 24.0.0 and 15
  refusing 25.0.0; and with `>=22.12.0`); the server image's runtime Node,
  the oldest release the `node:` tag of the last stage of
  `packages/data-server/Dockerfile` names, one every package of
  `@formancy/data-server`'s production deploy accepts (watched failing
  with that stage built `FROM node:20-alpine`: tedious and the `@azure`
  packages named); the stages read through the one reader
  `scripts/release-report/tested-on.mjs` has, a flag skipped and an
  earlier stage's name followed, and a stage on an image naming no Node
  thrown (watched failing with an earlier stage's name left unread, and
  with an unreadable stage given another's Node); the deploy read from the
  lockfile as pnpm installs it, dependencies, the workspace projects they
  link and an alias as the package it stands for, never a devDependency,
  an entry the lockfile does not hold thrown (watched failing with
  devDependencies followed, with links skipped, with an alias read as a
  version, and with a missing snapshot read as one with no dependencies);
  and the `engines` ranges read as npm reads them, as far as the lockfile
  uses them (watched failing with a caret read as `>=`, with a bare major
  read as its `.0.0` alone, and with a pre-release tag dropped), a form it
  cannot read thrown rather than passed. Measured on 2026-11-11 on an
  Apple silicon workstation under Node 22.23.4; review compared the reader
  with semver 7.8.5 on all 110 ranges the lockfile holds, across 2,040
  versions, and found no difference.

## Context

GitHub listed 24 open advisories against the lockfile on 2026-11-09, 6 of
them high. Most had a fix in reach. `@azure/msal-node` 6.0.1, under the
SQL Server adapter's exact `@azure/identity` 4.13.3, had one in 7.1.0,
which `@azure/identity` 4.14.1 takes. Fastify, `fast-uri` beneath its
validator, `ip-address` beneath its rate limit, undici beneath jsdom, and
Vite each had a patch release in the range already declared, but for the
Vite that `@angular/build` 22.2.2 pinned exactly, which 22.2.5 moved past.
`@azure/identity` 4.14.1's managed identity is 4.13.3's byte for byte, and
its workload identity's new proxy is taken only under an
`enableAzureProxy` nothing here passes, so what 0074 reviewed holds.

undici 8.12, the release that fixes its four advisories, declares
`node >=22.19.0` and reads `zlib.createZstdDecompress` as it loads; Node
22.14 does not have it, and every suite that loads jsdom stopped there.
The workspace's floor said `>=22.12.0`. Asked of the lockfile instead of
assumed, that floor was already false before the update: 56 packages on
`main` refused 22.12, Angular 22 asking for `^22.22.3 || ^24.15.0 ||
>=26.0.0` and jsdom's selector engine for `^22.22.2`. A contributor on
22.12 was promised a workspace that packages in it did not promise, and
nothing in the repository would have said why a suite failed. A floor of
`>=22.22.3` is no truer: it admits Node 23, 24.0 to 24.14 and 25, which
the same packages refuse.

The server image is a different question. Its runtime stage runs what
`pnpm --filter @formancy/data-server --prod deploy` installs, on
`node:22.12-alpine`, and all 133 packages of that deploy accept 22.12:
nothing it runs needs more.

## Decision

The workspace's floor is `^22.22.3 || ^24.15.0 || >=26.0.0`, the releases
every package the lockfile installs accepts. The server image's runtime
stays on `node:22.12-alpine`, every package of the server's production
deploy accepting it. `scripts/node-floor.mjs` reads both from the
lockfile, and its test fails when either stops being true. Every advisory
with a fix in reach is taken: `@azure/identity` 4.14.1, Fastify `^5.12.8`,
`@angular/build` `^22.2.6` and Vite `^8.3.6`, and the transitive packages
within their ranges.

## Consequences

- A contributor on Node 22.12 to 22.22.2, on 23, on 24.0 to 24.14 or on
  25 installs a release the floor admits before the suites run, where
  before the floor said they need not and they ran into an error with no
  reason given.
- The floor now moves when any installed package moves its own, a
  development tool's included: a version bump can fail `pnpm test:repo`
  with a floor to change, and that floor is a commit and a CHANGELOG line
  of its own.
- What is held is what a package **declares**. A package that needs more
  Node than its `engines` says passes here and fails where it runs.
- **The images' build stages are not held.** The server image builds on
  `node:22.12-alpine` too, installing the root and the server's packages
  with their development tools, which ask for 22.22: tsdown, jsdom,
  testcontainers, and the `corepack@latest` the stage installs from the
  network, outside the lockfile. The demo image's build stage installs
  the server's the same way, and the web image's the studio's and the
  host page's, Angular and Vite among them. They build today with npm's
  warnings, and the guard says nothing of them. Moving them changes what
  `docs/getting-started.md` measured on disk, which counts one
  `node:22.12-alpine` for every image; that is its own change.
- The image's Node is read as the oldest release its tag names. 22.12.0
  was the only 22.12 release, so for this image the reading is exact; a
  tag over several patch releases would be read at its first.
- CI and Workers Builds ask for Node `22`, which setup-node and Workers
  Builds resolve to a recent release; nothing holds what they install to
  the floor.
- The reader knows the `engines` forms the lockfile uses. A new form
  throws, which fails the guard until the reader is taught it.
- Two advisories stay open, both under development tools alone: glob 10
  beneath testcontainers' archiver, and minimatch 9 and 10 beneath it and
  beneath ESLint. Neither has a fix in its major line, and neither path
  meets input from outside: glob's is an AbortSignal the archiver never
  passes, and minimatch's patterns are the repository's own.
- `@angular/build` 22.2.6 brings `oxc-parser`'s WebAssembly binding,
  which pins `@emnapi/core` 2.0.0-alpha.6 where its own
  `@napi-rs/wasm-runtime` asks for `^1.7.1` or a 2.0.0 beta. It declares
  no CPU, so pnpm installs it everywhere, and nothing loads it where a
  native binding exists; `pnpm peers check` names it, and a frozen install
  does not resolve peers again.

## Alternatives considered

- **Hold undici at 8.11 and the floor at 22.12.** Four high advisories
  left open, and a floor that 56 other packages already refused.
- **A floor of `>=22.19.0`, undici's, or `>=22.22.3`.** Each still admits
  releases packages refuse: Angular 22 asks for 22.22.3, and with jsdom
  refuses 23, 24.0 to 24.14 and 25. A floor written from the one package
  that broke is the guess this guard replaces.
- **Move the server image to a newer Node as well.** Nothing its runtime
  runs needs one. The image's Node is a choice with costs of its own --
  its size, what 0037's and 0059's measurements were taken on -- and the
  guard says when a dependency forces it.
- **Override glob to 14 and minimatch to 11.** Major versions under
  packages their authors have not tested them with, to close advisories
  whose paths are not reached; a break there would show only where
  testcontainers copies files into a container.
- **Read `engines` with a semver package.** None is a root dependency,
  and the lockfile's ranges are a small and known set; a form the reader
  does not know throws rather than passing.
