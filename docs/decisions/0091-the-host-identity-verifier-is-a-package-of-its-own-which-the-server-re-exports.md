# 0091 — The host identity verifier is a package of its own, which the server re-exports

- **Status:** accepted
- **Date:** 2026-10-21
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-server/src/index.test.ts` — every value the server
  exported for the host's identity before, `createIdentityVerifier`,
  `KeySet`, `KeySetRefusal`, `readKeySet`, `openKeySetFile` and
  `resolveSecret`, is the very object `@formancy/data-identity` exports
  (watched failing with the server's index exporting its own copies of the
  modules beside the new package: "createIdentityVerifier: expected
  [AsyncFunction createIdentityVerifier] to be [AsyncFunction
  createIdentityVerifier]").
  `packages/data-identity/src/index.test.ts` — the package's entry exports
  those six values, `isKeySetAlgorithm` and `oneKeySet`, and nothing else
  (watched failing with an entry that re-exported every module whole: it
  added `KEY_SET_ALGORITHMS`, `MIN_SECRET_BYTES`, `ed25519Point`,
  `isKeySet`, `readKeySetText` and `verifyWithKeySet`).
  `scripts/install-test.mjs`, in `pnpm test:e2e:install` — data-identity is
  packed and installed beside the other tarballs into a plain npm project,
  whose consumer signs a token with `node:crypto` alone and has it
  verified under a key set data-identity read, by data-identity's verifier
  and by the server's; refuses an empty set with the server's
  `KeySetRefusal`; and finds the server's names the same objects (watched
  failing with data-identity bundled into the server's dist through
  tsdown's `alwaysBundle`: the consumer did not type-check, "Property
  '#private' in type 'KeySet' refers to a different member that cannot be
  accessed from within type 'KeySet'").
  `packages/data-server/src/dockerfile.test.ts` — the image copies
  data-identity, now that the server depends on it (watched failing with
  "no workspace package is called @formancy/data-identity", from the list
  of directories it then searched, which it now reads from `packages/`;
  and then with "expected [ 'data-identity' ] to deeply equal []" until
  the Dockerfile copied it).
  `scripts/ci-test-jobs.test.mjs`, `scripts/release-report/workflows.test.mjs`,
  `scripts/codecov-config.test.mjs` and `scripts/architecture.test.mjs` —
  its suite runs in a CI job of its own, it is a codecov component, and the
  building blocks name it (each watched failing before it was added);
  `scripts/verify-licenses.mjs` — it declares the source-available licence
  and ships `LICENSE.md` and `NOTICE`.
  The tests that hold [0014](0014-host-identity-is-verified-offline.md) and
  [0059](0059-the-host-identity-key-is-a-set-selected-by-kid-and-read-again-on-sighup.md)
  moved with the code, changed in comments only: `identity.test.ts`,
  `identity-keys.test.ts`, `identity-file.test.ts` and `secrets.test.ts`
  are in `packages/data-identity/src/`, where those records' *Verified by*
  lines still name them under `packages/data-server/src/`.
  **Not mechanically enforced:** that data-identity imports nothing but
  jose and Node's built-ins — its manifest declares jose alone, so pnpm's
  isolated linker leaves any other package unresolved, but no test reads
  its imports; and that it is first published with 0.3.0: the release
  workflow publishes every package under `packages/` that is not private,
  so the next release publishes it, whatever its number.

## Context

Formancy Report, a sibling product, verifies the same host identity
tokens Data's server verifies: a host signs one token for a person, and
both products accept it under the same rules
([0014](0014-host-identity-is-verified-offline.md),
[0059](0059-the-host-identity-key-is-a-set-selected-by-kid-and-read-again-on-sighup.md)).

The verifier lived in `@formancy/data-server`, which depends on Fastify,
`@fastify/rate-limit`, data-core and both adapters with their drivers,
data-sqlserver's `@azure/identity` among them. A product that needed
`createIdentityVerifier` would install a web server and two database
drivers it never calls, and their advisories would be its own.

What the verifier needs is jose and Node. `identity.ts` is the verifier,
`identity-keys.ts` the key set and its builders, `ed25519.ts` the
small-order check, `identity-file.ts` a key set file read again on demand
and `secrets.ts` a secret reference. None of them imports anything else
of the server's.

## Decision

**Those five files move, with their tests, to `@formancy/data-identity`**,
a published package under the source-available licence, at the version
every Data package carries, depending on jose alone. Its entry exports the
verifier, the key set, the file, the secret reference and two helpers the
server shares: `isKeySetAlgorithm`, with which the server's settings and
its key set file tool read an algorithm, and `oneKeySet`, the set a
one-key setting verifies with, which the tool's `convert` writes. Each is
a decision the server would otherwise make a second time.
`verifyWithKeySet` stays inside, as it stayed out of the server's index
(0059): the verifier is the one way to verify under a set, with the
options it was built with.

**What reads configuration stays in the server.** `identity-settings.ts`,
which reads the `FORMANCY_DATA_IDENTITY_*` variables, the key set file
tool and `main.ts` import from data-identity; nothing in data-identity
names a setting. `resolveSecret` reads the process's environment or a
file only for a reference its caller hands it.

**The server re-exports every name it exported before**, the same
objects, so an embedder's imports from `@formancy/data-server` keep
working, and a set one entry made is a set the other's verifier accepts.
The server depends on data-identity as it depends on data-core,
`workspace:*`, which a tarball carries as the exact version.

**The file store stays in the server.** `createFileConfigurationStore`
keeps Data's published forms, and Report does not need it.

## Consequences

**What it buys.** Report verifies the tokens through the code the server
runs, with jose its only dependency, and the rules 0014 and 0059 set — an
algorithm pinned, a key chosen by kid, a key under which anyone signs
refused, nothing fetched — have one implementation for both products.

**What it costs.** One more package to publish, sign and keep in
lockstep: data-identity carries the version every Data package carries
and moves with `scripts/bump.mjs`, and the next release, 0.3.0, is its
first. That first publish creates a name on npm, which a Granular Access
token limited to the packages it names may not do, and the `npm-token`
job does not check for that ([`RELEASING.md`](../../RELEASING.md#secrets)).

Two public import paths now name the same verifier, and the server's
stays as long as anything imports it from there; retiring it would be a
record of its own. Two products accept the same token under the same
rules only while they install the same release of data-identity, and a
server and a Report at different versions verify under whichever each
installed; nothing here can see the other product's.

jose is now a runtime dependency of data-identity, which the release
report and the README's *What it is tested on* name, and a development
dependency of the server, whose tests still sign tokens with it. The
server's image builds one more workspace package. The published
performance figures were measured on these files at their old paths, so
the stale check names them removed from the server and added to
data-identity until the next measurement (0084).

**What it does not do.** It changes nothing a token must be, nothing a
set may hold and nothing about how a file is read again. It does not
share the server's settings: Report reads its own environment and hands
`createIdentityVerifier` a key and claims, as an embedder of the server
always could.

## Alternatives considered

- **Report depends on `@formancy/data-server`.** It would install Fastify,
  both adapters and both drivers to call one function, and every advisory
  against them would be Report's too.
- **Report copies the verifier.** Two implementations of one decision —
  which keys are refused, how a kid selects one, what a refusal logs —
  agree on the day of the copy and then drift with nobody finding out: a
  fix to one, like 0059's refusal of an Ed25519 point of small order,
  would not reach the other, and no test runs both.
- **The file store moves too, into one package of what both products
  share.** Report does not keep published forms, and one package holding
  the store and the verifier changes for two reasons. If Report ever
  needs the store, that is a record of its own.
- **data-identity is private, and the server bundles it.** The server's
  dist would carry a copy of its own, and Report, which installs from
  npm, could not install the package at all.
