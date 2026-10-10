# 0002 — Depend on released upstream packages at exact versions; never copy them

- **Status:** accepted; the spec 4 window its costs name closed on 2026-10-09 without an exact-decimal type, see [0042](0042-generated-forms-stay-on-spec-3-after-spec-4-is-released.md)
- **Date:** 2026-10-08
- **Deciders:** Daniel Bacher
- **Verified by:** `scripts/upstream-deps.mjs`, through
  `scripts/upstream-deps.test.mjs` in `pnpm test:repo`, which CI runs on every
  pull request. It refuses any `@formancy/*` dependency that is not a workspace
  sibling and is not an exact released version — a range, a `workspace:` link,
  a `link:`, `file:` or git specifier each fail, and the test proves each on a
  fixture before checking the real tree. That no upstream **source** is copied
  here is held by review; nothing mechanical distinguishes a copied file from a
  written one.

## Context

formancy.ai publishes the spec, the engine, the expression language, the
renderers, the builders and the backend as packages, with provenance. Its
README says the package APIs "are not frozen — they will change before 1.0",
and its history bears that out: the repository merged over a hundred and sixty
pull requests in its first three weeks, and the commit the delivery plan was
written against was four commits behind `main` by the evening of the same day.

This repository needs the engine for validation, the spec for document
validation and canonical hashing, and the builder core for layout editing. Two
ways to get them were on the table: depend on the published packages, or carry
a copy of the parts needed and patch it as this product requires.

## Decision

Depend on the published `@formancy/*` packages, at **exact** versions, and
carry none of their code. A version moves by hand, in a commit whose CHANGELOG
line says which upstream release was adopted and why. Anything this product
needs that upstream does not offer — an exact-decimal field type, a bigint
representation — is proposed upstream through formancy.ai's own contribution
rules, and this repository waits for the release.

## Consequences

**What it buys.** One engine, built once, deciding validity in the browser, on
formancy's server and in this module — which is formancy's first quality goal
and would be the first casualty of a fork. A copy that diverged by one
validation rule would produce a form the module accepts and formancy's server
refuses, and nobody would find out until a customer did. It also keeps
[0001](0001-a-paid-module-in-its-own-repository.md) honest: a repository that
contains no upstream code cannot be a proprietary edition of it.

**What it costs.** Latency. A generic improvement goes through another
repository's review before this one can use it, and upstream's spec version 4
is open now, which is the window for a type this product needs; miss it and the
wait is for a version 5. Exact versions mean an upstream bug fix is not picked
up by `pnpm install` but by a commit somebody makes, and a range would be the
convenient thing. The convenience is the hazard: with APIs that are allowed to
break in a minor, a range lets upstream move under this repository without a
diff anybody reviewed.

**What it forecloses.** Patching upstream behaviour locally "just for now". There
is no mechanism for it, by design, and a `patches/` directory would be the
first step to the fork this record refuses.

## Alternatives considered

**Vendor the engine.** Rejected for the divergence above, and because it would
make this repository a proprietary edition of Apache-2.0 code, which 0001
exists to avoid.

**Ranges with a lockfile.** Rejected: the lockfile pins what was installed, but
`pnpm update` is a command somebody runs without reading upstream's changelog,
and the range invites it. An exact version has to be edited, and an edit is a
diff.

**A git submodule or a workspace link to a formancy.ai checkout.** Rejected:
the build would then depend on what was checked out on one machine, and the
install gate — which packs the tarballs into a project that knows nothing about
either workspace — would be testing something a customer never installs.
