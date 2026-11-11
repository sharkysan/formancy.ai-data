# 0148 — The workspace's Node is one every package it installs accepts, and so is the server image's

- **Status:** accepted
- **Date:** 2026-11-11
- **Deciders:** Daniel Bacher
- **Verified by:** `scripts/node-floor.test.mjs`, in `pnpm test:repo` --
  the workspace's floor, `engines.node` in the root `package.json`, a
  Node every package `pnpm-lock.yaml` installs accepts (watched failing
  with the floor put back to `>=22.12.0`: 58 packages named, Angular 22's
  and jsdom's among them; and at `>=22.19.0`: 13); the server image's
  Node, the oldest release the `node:` tag of
  `packages/data-server/Dockerfile` names, one every package of
  `@formancy/data-server`'s production deploy accepts (watched failing
  with the image built `FROM node:20-alpine`: tedious and the `@azure`
  packages named); the deploy read from the lockfile as pnpm installs it,
  dependencies and the workspace projects they link and never a
  devDependency (watched failing with devDependencies followed: vitest
  named; and with links skipped: a linked project's dependency missing);
  and the `engines` ranges read as npm reads them, as far as the lockfile
  uses them (watched failing with a caret read as `>=`: 23.0.0 accepted by
  `^22.22.3 || ^24.15.0 || >=26.0.0`; and with a bare major read as its
  `.0.0` alone: 20.5.0 refused by `18 || 20 || >=22`), a range it cannot
  read thrown rather than passed. Measured on 2026-11-11 on an Apple
  silicon workstation under Node 22.23.4.

## Context

GitHub listed 24 open advisories against the lockfile on 2026-11-09, 6 of
them high. Most had a fix in reach. `@azure/msal-node` 6.0.1, under the
SQL Server adapter's exact `@azure/identity` 4.13.3, had one in 7.1.0,
which `@azure/identity` 4.14.1 takes. Fastify, `fast-uri` beneath it,
`ip-address` beneath its rate limit, undici beneath jsdom, and Vite each
had a patch release in the range already declared, but for the Vite that
`@angular/build` 22.2.2 pinned exactly, which 22.2.5 moved past.

undici 8.12, the release that fixes its four advisories, declares
`node >=22.19.0` and reads `zlib.createZstdDecompress` as it loads; Node
22.14 does not have it, and every suite that loads jsdom stopped there.
The workspace's floor said `>=22.12.0`. Asked of the lockfile instead of
assumed, that floor was already false before the update: 56 packages on
`main` refused 22.12, Angular 22 asking for `^22.22.3 || ^24.15.0 ||
>=26.0.0` and jsdom's selector engine for `^22.22.2`. A contributor on
22.12 was promised a workspace that packages in it did not promise, and
nothing in the repository would have said why a suite failed.

The server image is a different question. It runs what
`pnpm --filter @formancy/data-server --prod deploy` installs, on
`node:22.12-alpine`, and all 133 packages of that deploy accept 22.12:
nothing it runs needs more.

## Decision

The workspace's floor is `>=22.22.3`, the lowest Node 22 every package
the lockfile installs accepts. The server image stays on
`node:22.12-alpine`, every package of the server's production deploy
accepting it. `scripts/node-floor.mjs` reads both from the lockfile, and
its test fails when either stops being true. Every advisory with a fix in
reach is taken: `@azure/identity` 4.14.1, Fastify `^5.12.8`,
`@angular/build` `^22.2.6` and Vite `^8.3.6`, and the transitive
packages within their ranges.

## Consequences

- A contributor on Node 22.12 to 22.22.2 installs a newer 22 before the
  suites run, where before the floor said they need not and they ran into
  an error with no reason given. CI was already on the newest 22.
- The floor now moves when any installed package moves its own, a
  development tool's included: a version bump can fail `pnpm test:repo`
  with a floor to raise, and that floor is a commit and a CHANGELOG line
  of its own.
- What is held is what a package **declares**. A package that needs more
  Node than its `engines` says, as undici would have if it had not said
  so, passes here and fails where it runs.
- The image's Node is read as the oldest release its tag names, 22.12.0
  for `22.12-alpine`, although the tag floats over 22.12's patch
  releases; a package that accepted 22.12.5 alone would be named although
  the image may hold it.
- The reader knows the `engines` forms the lockfile uses. A new form
  throws, which fails the guard until the reader is taught it.
- Two advisories stay open, both under development tools alone: glob 10
  beneath testcontainers' archiver, and minimatch 9 and 10 beneath it and
  beneath ESLint. Neither has a fix in its major line, and neither path
  meets input from outside: glob's is an AbortSignal the archiver never
  passes, and minimatch's patterns are the repository's own.
- `@angular/build` 22.2.6 brings `oxc-parser`'s WebAssembly binding,
  which pins `@emnapi/core` 2.0.0-alpha.6 where its own
  `@napi-rs/wasm-runtime` asks for `^1.7.1` or a 2.0.0 beta. It is an
  optional package for `wasm32` alone, installed nowhere this repository
  builds, and `pnpm peers check` names it.

## Alternatives considered

- **Hold undici at 8.11 and the floor at 22.12.** Four high advisories
  left open, and a floor that 56 other packages already refused.
- **Raise the floor to 22.19, undici's.** Still false: Angular 22 asks for
  22.22.3. A floor written from the one package that broke is the guess
  this guard replaces.
- **Move the server image to a newer Node as well.** Nothing it runs needs
  one. The image's Node is a choice with costs of its own -- its size,
  what 0037's and 0059's measurements were taken on -- and the guard says
  when a dependency forces it.
- **Override glob to 14 and minimatch to 11.** Major versions under
  packages their authors have not tested them with, to close advisories
  whose paths are not reached; a break there would show only where
  testcontainers copies files into a container.
- **Read `engines` with a semver package.** None is a root dependency,
  and the lockfile's ranges are a small and known set; a form the reader
  does not know throws rather than passing.
