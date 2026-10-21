# 0092 — The SBOM describes what a consumer installs, and is held to that install

- **Status:** accepted; changes how
  [0035](0035-a-release-report-is-derived-from-the-run-that-gated-it.md)'s
  SBOM is made and checked
- **Date:** 2026-10-21
- **Deciders:** Daniel Bacher
- **Verified by:**
  - `scripts/release-report/workflows.test.mjs`, "makes the SBOM of the
    tarballs installed as a consumer installs them, never of the
    workspace". `release.yml`'s `check` job runs neither pnpm nor
    corepack. Its SBOM step installs `release-tarballs/*.tgz` with `npm
    install --ignore-scripts --legacy-peer-deps` in
    `${RUNNER_TEMP}/formancy-data-sbom`, then runs cdxgen
    `--required-only` there. The check is passed that install's
    `package-lock.json`. Watched failing against the workflow as v0.2.0
    ran it.
  - `scripts/release-report/verify-publish.test.mjs`, "the SBOM" and "the
    SBOM against the install it describes". Each case was watched failing
    against the check by name, which asked none of this. The check
    refuses an SBOM that leaves out:
    - a driver;
    - a package this release publishes, at its version;
    - an upstream package their install brings.

    It also refuses an SBOM that:
    - gives a published package a runtime dependency at a version neither
      its suites loaded nor this run's clean install resolved;
    - gives the dependency that declares a nested one, tedious under
      mssql, such a version;
    - records no such dependency, or has no dependency graph at all;
    - names a package the install does not hold, or leaves out one it
      holds.

    It is not refused for a second copy of a name brought by something
    else, for a package of types alone, or for an upstream package only
    an app declares. The nested case and the types case were watched
    failing on the 0.2.0 tarballs, installed on 2026-10-21.
  - `scripts/release-report/tested-on.test.mjs`, "marks shipped the
    upstream packages a published package brings": `@formancy/spec` is
    shipped, and the renderers, the themes and `@formancy/core`, which
    only the apps and the suites declare, are not. Watched failing before
    the mark existed.
  - By hand, on 2026-10-21. The workflow's commands were run on
    `pnpm pack` of the six packages at 0.2.0:
    - npm installed 136 packages, and cdxgen 12.8.4 listed 132
      components with no test tool among them. The published packages,
      tedious 20.3.8 under mssql 12.7.10, and `@formancy/spec` 0.6.0 were
      all listed.
    - The check, given the facts `tested-on.mjs` derives on this checkout
      and that install's versions as the install gate's, refused nothing.
    - Given the suites' versions alone, it refused fastify 5.12.7, jose
      6.2.13, `@fastify/rate-limit` 11.2.1 and mssql 12.7.10, which no
      suite ran.

## Context

The `check` job made the release's SBOM with cdxgen over the pnpm workspace,
after `pnpm install`, and held it to the report by name (0035). The SBOM
0.2.0 published, `formancy-data-v0.2.0-sbom.cdx.json`, had 85 components:
- **What does not ship, listed as required:** vitest, Playwright,
  testcontainers, Vite, Angular's builder and a TypeScript 5.6.1-rc.
- **What does ship, missing:** tedious, which every install of
  data-sqlserver resolves and which speaks TDS to SQL Server. 0035 had
  named this cost on 2026-10-09.
- **The release itself, missing:** none of the five packages being
  published, which in the workspace are links.

The check by name had a second flaw, which formancy.ai-report met first: a
consumer's tree can hold one name at two versions, the other brought by a
dependency of a dependency that no suite's record names. A check that held
every component of that name to the version the suites loaded refuses a
correct SBOM. formancy.ai-report's record 0017 and formancy.ai-health's
release check settled both questions; this applies them here.

## Decision

**The SBOM is made from the tarballs `check` pinned, installed as a
consumer installs them.** The step:
1. writes a `package.json` naming `formancy-data` at the release's version,
   in a directory under `RUNNER_TEMP`, outside the checkout;
2. installs every tarball there with `npm install --ignore-scripts
   --legacy-peer-deps`, so no lifecycle script runs and the peers are left
   to the host;
3. runs cdxgen 12.8.4 with `--required-only` over that directory.

The `check` job installs nothing else and runs no pnpm, so nothing can read
the workspace in place of what ships.

**The SBOM is held to that install.** It names exactly what npm's lockfile
of the install holds: nothing else, nothing left out. Packages of types
alone (`@types/*`) are the one exception. cdxgen leaves them out and so does
the check, since no code of theirs runs.

**The SBOM is held to the report through its dependency graph.** It names:
- both drivers;
- every package this release publishes, at its version;
- every upstream package their install brings. The report now marks those
  `shipped`: a published package's `dependencies` name it, or a shipped
  package's own do.

Each runtime dependency the report names is held where it is given:
- **A published package's own:** the graph must give the published package
  that dependency.
- **A nested one** (tedious): the graph must give it from whichever mssql
  the published package is given.

**Versions are the install's on the day.** A runtime dependency is held to a
version its suites loaded, or to the one the install gate's clean install of
the same tarballs resolved in the same run. The report already records the
second version (0035's `fresh`), and the release body names each such
package as "which no suite ran". An upstream package is held, by name, to
either version too.

## Consequences

**What it buys.**
- **An SBOM that describes the artefact.** A customer or an auditor reading
  it sees what an install brings: the released packages, tedious, and the
  closure npm resolved. The tools this repository tests with are not in it.
- **A check a correct SBOM passes.** A second copy of a name, a package of
  types, and a renderer only the host page declares no longer refuse it.

**What it costs.**
- **Versions resolved on the day, not the versions the suites ran.** On
  2026-10-21 a clean install already resolved four runtime dependencies no
  suite ran: fastify, jose, `@fastify/rate-limit` and mssql. The release is
  not refused for that. The release body says it, as it said before. The
  rest of the closure is held to nothing but the lockfile of that install.
- **Two installs on one day can disagree.** If a version is published
  between the install gate and `check`, the SBOM names a version neither
  saw, and the release is refused until it is run again.
- **The check needs cdxgen's dependency graph.** An SBOM with none gives no
  published package anything and is refused. A cdxgen that stops writing
  the graph stops every release, with a sentence, rather than passing.
- **Packages of types alone are not inventoried.** `@types/mssql`, which a
  consumer's type checker reads, is not in the SBOM.
- **One more unlocked registry install in a release.** cdxgen's own
  dependencies were already unlocked. That is why the tarballs are pinned
  before the step runs and the SBOM is pinned once the check accepts it.
- **First run on a runner is the next rehearsal.** The commands were run
  by hand on Windows. The rehearsal is where a difference on Linux shows.

## Alternatives considered

- **Hold every runtime dependency to the version the suites loaded, as
  formancy.ai-report does.** Data publishes caret ranges, so any patch
  release of fastify, jose, mssql or tedious would stop the next release
  until the lockfile moved. The report already says, in every release body,
  which versions a clean install resolved that no suite ran. Refusing here
  would make the same fact a stop in one place and a sentence in another.
- **Keep cdxgen on the workspace and filter its output.** The filter would
  be a second definition of what ships, written beside the one npm applies
  when it installs a tarball.
- **One SBOM per package, from `pnpm deploy --prod`.** That gives six
  documents, built from the lockfile's versions rather than what a consumer
  resolves, where 0035 attaches and signs one.
