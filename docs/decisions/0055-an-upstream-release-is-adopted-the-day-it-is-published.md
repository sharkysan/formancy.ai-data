# 0055 — An upstream release is adopted the day it is published, and only upstream is exempt from the release age

- **Status:** accepted
- **Date:** 2026-10-11
- **Deciders:** Daniel Bacher
- **Verified by:** `scripts/upstream-deps.mjs`, through
  `scripts/upstream-deps.test.mjs` in `pnpm test:repo`, which CI runs on every
  pull request. It refuses an entry of `minimumReleaseAgeExclude` in
  `pnpm-workspace.yaml` that names a package outside the `@formancy` scope or
  a sibling in this workspace, a name or a pattern without an exact version,
  or a version the lockfile no longer installs; the test shows each on a
  fixture before checking the real files, and on 2026-10-11 the real
  `pnpm-workspace.yaml` with `ajv@8.20.0`, `@formancy/core@0.4.0` and
  `@formancy/*` added, read beside the real lockfile, was refused for all
  three. That an upstream version younger than a day and not exempt is
  refused is pnpm's own check, in every `pnpm install --frozen-lockfile` that
  CI and the composed stack's two images run: on 2026-10-11, with the pins at
  0.5.0 and no exemption, it failed with
  `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` for the eight `@formancy`
  packages.

## Context

pnpm 12 refuses a package published less than a day before, by default
(1440 minutes, not strict): in resolution, and again when it checks a
lockfile, so `pnpm install --frozen-lockfile` refuses a lockfile that names
one. Every job of the gates workflow installs that way, itself or by
building the server's and the web's images the composed stack builds
([0032](0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)),
and so does the release's check; the CLA and security workflows install
nothing. The policy is for a compromised publish: it gives the ecosystem a
day to notice one before a range or an update installs it here.

formancy.ai published `@formancy/*` 0.5.0 between 11:04 and 11:06 UTC on
2026-10-11, by the registry's times, and the pins moved to it the same day.
pnpm, installing after the pins moved, wrote each of the eight packages it
then installed from that release -- the seven pinned and
`@formancy/expressions` beneath them -- into `minimumReleaseAgeExclude` by
exact version. Without those lines every gate job of the pull request fails,
the two image builds included, until the release is a day old, for a reason
that says nothing about the change.

A version of an upstream package reaches this repository only as an exact pin
moved by hand, in a diff with a CHANGELOG line saying which release and why
([0002](0002-depend-on-upstream-never-copy-it.md)). For upstream there is no
version nobody here chose for the policy to stop; it only delays one somebody
did.

## Decision

An upstream release may be adopted the day it is published. Each package of it
the lockfile installs is exempt from pnpm's minimum release age in
`pnpm-workspace.yaml`, by name and exact version, as pnpm writes it. Nothing
else is exempt: no package outside upstream, no name or pattern without a
version, and no version the lockfile no longer installs, which the next bump
removes.

## Consequences

**What it buys.** An upgrade lands the day upstream releases, with every gate
green, and the policy stays on for everything else the lockfile names --
every third-party package, and every upstream version nobody pinned.

**What it costs.** For the first day of an adopted release, nothing waits for
anyone else to notice a compromised publish of it: the lockfile's integrity
hashes hold what was downloaded, not that it is what upstream meant to
publish, and the bump's own review -- upstream's changelog read, and its
source where this repository relies on a behaviour -- is the only check that
day. Nothing mechanical compares the tarballs with what upstream tagged or
checks that they carry upstream's provenance: on 2026-10-11 the registry
showed SLSA provenance on each of the eight, as on 0.4.0's, read once by hand,
and nothing reads it again at the next bump. It is not only this repository's
installs: an operator who builds the composed stack's images from a checkout
installs with this `pnpm-workspace.yaml`, exemptions included, so within a
day of an adopted release their build installs it without the wait as well.
The exemptions outlive their day, when they stop meaning anything, and stay
until the next bump, which has to remove them by hand; the guard makes it. A
release adopted on its day from another machine, where pnpm does not write
the entries, needs them written by hand.

**What it forecloses.** Exempting a third-party package, even for a security
fix released that morning: it waits a day, or it is a record of its own. And
exempting the scope by pattern, which would admit whatever version is pinned
next without a line naming it.

## Alternatives considered

**Wait a day.** Rejected for an upgrade somebody asked for that day: the pull
request is red in every gate job for a day for a reason unrelated to it, and
a red pull request teaches that red can be merged past.

**Exempt `@formancy/*` by pattern.** Rejected: pnpm reads a bare name or a
pattern as every version, so the exemption would never need touching again,
and a diff that moves a pin would no longer say that a version younger than a
day is being admitted.

**Lower `minimumReleaseAge`, or turn it off.** Rejected: it would loosen the
policy for the third-party packages it exists for, to admit eight packages
this repository chose.

**pnpm's `minimumReleaseAgeExcludePrune`.** Since pnpm 12.4.1 it prunes in
`pnpm install` too, not only in `pnpm add`, `update` and `remove`: on
2026-10-11, with pnpm 12.4.2, a scratch copy of this workspace with it on and
`@formancy/core@0.4.0` and `ajv@8.20.0` added lost the first in a plain
install and in a `--frozen-lockfile` one, and kept the second. Not taken: it
rewrites `pnpm-workspace.yaml` in CI's frozen install as well, before
`pnpm test:repo` reads it, so a stale entry committed would be gone from the
copy the guard checks and stay in the repository; and it refuses nothing --
a third-party exemption whose version is installed stays, as `ajv@8.20.0`
did, and pnpm's changelog says a pattern always stays. Without it the next
bump's install leaves the stale lines, and the guard names them.

**pnpm's `trustPolicy: no-downgrade`.** A mechanical check pnpm offers on the
first day: it refuses a version published with weaker evidence of its origin
than an earlier one, which pnpm reports as a possible takeover. On
2026-10-11, with pnpm 12.4.2, a frozen install of this workspace with it on
passed every `@formancy` package of 0.5.0 and refused `undici-types@6.21.0`
with `ERR_PNPM_TRUST_DOWNGRADE`, and passed with that one version in
`trustPolicyExclude`. Not taken in this record: it is a policy over every
package the lockfile names, and adopting it starts with a third-party
package exempt from a trust check, which is a decision about third-party
packages and a record of its own. Until one is made, nothing mechanical
checks upstream's provenance.
