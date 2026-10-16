# 0062 — A published version moves between deployments as its version file, and is imported as a publish the target's database must be able to serve

- **Status:** accepted; extended by [0065](0065-with-publisher-roles-set-a-draft-is-published-only-when-a-publisher-who-did-not-submit-it-approves-it.md): under review an import is a draft, submitted as the file and approved by a publisher, and its checks are `gate` in `routes/admin-gate.ts`, which a submit and an approval pass too
- **Date:** 2026-10-14
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-server/src/routes/admin-promotion.test.ts` — two servers,
  each with a store of its own and a fake database whose discovery the test
  changes: development's version read through `GET
  /v1/forms/:id/versions/:version` and imported into production is
  production's version 1 in the bytes development's store wrote; a base and
  form relaxed alike to a `maxLength` of 4000, which validates, is 422
  `invalid-bundle` naming the base (watched failing, 201, with the generator
  check skipped, as a restore skips it); a connection production's allowlist
  does not have is 422 with this record's sentence, and the event names no
  connection; another form id, format 1 and a snapshot edited after it was
  taken are 422; a bound column dropped in production is 409 `incompatible`
  listing only the blocking change beside an added column, and nothing is
  written (watched failing, 201, with the gate removed); an added nullable
  column imports, with that change in `drift`; a production database of the
  other engine is 422 `other-engine` (watched failing as 500 `internal`
  with the engine check removed); a stale base is 409 `conflict` naming the
  current version and writes nothing, and the same file over the newest is
  a new version holding the same bytes; production's version 1 bound its
  keys to other columns, so the import is 422 `keys-reassigned` with the
  `keys` until each is confirmed, and against a base somebody replaced the
  conflict first; an unreachable database is 503 without the driver's
  address; a clerk is 403 and no token 401; and a body of another shape is
  400 with the database down. Each case was watched failing first, 404,
  before the route existed.
  `packages/data-server/src/routes/admin-promotion.integration.test.ts` —
  on PostgreSQL and SQL Server, two servers and two stores over one
  database per engine, each allowlist naming `erp`: development publishes
  the order form and its version read back is the file its store wrote;
  with approved_by dropped by plan section 14 step 8's DDL, the import is
  409 with that one change and production's store stays empty; with the
  column put back it is version 1 in the same bytes, and a clerk creates an
  order through production's runtime and reads it back exactly; `erp`
  pointed at the other engine is 422 `other-engine`; and `erp` as
  formancy_writer refuses the import with exactly the blocking changes
  `diffSnapshots` finds between the two snapshots, measured 2026-10-14 as
  blocking on both (the account, and UPDATE on columns the form writes).
  Watched failing with the gate removed, on both engines: the drop and the
  writer cases, and the import after the drop, which found version 1
  already written.
  `packages/data-server/src/routes/admin-evolution.test.ts` — a restore
  over a connection pointed at another engine is 422 `other-engine` and
  writes nothing (watched failing: 500 `internal`), a regeneration still
  500; every other case of the file and of `routes/admin.test.ts`
  unchanged, which is what shows the publish checks moved into
  `publishing.ts` unchanged.
  `packages/data-server/src/routes/admin-audit.test.ts` — an import's whole
  event: the base once the body is read, the connection once the bundle
  validates against the allowlist, the version on 201; one refused by drift
  holds no version and nothing of the drift; a body of another shape names
  no base; a connection string in the bundle never reaches the trail
  (watched failing with the version and the connection left unset).
  `scripts/cloudflare/doors.test.mjs` — the route is behind Access and not
  forwarded by the runtime door, from the built server's router.
  `apps/studio/src/versions.test.tsx` — any version downloads as the bytes
  the store wrote, read back from the Blob its link's object URL names,
  named `<form>-<version>.json` (watched failing without the trailing
  newline); that URL is revoked when another version is chosen and when the
  panel closes (watched failing with the revoke taken out); and a version
  the server does not serve offers no link. `apps/studio/src/import.test.tsx`, against two real servers: the
  target's version 1 is the source's file byte for byte; each answer of the
  route is shown in the server's words, the keys confirmed exactly as the
  server listed them (watched failing when it sent none); a file that is
  not a version file sends nothing; an answer that arrives after another
  file was chosen is not shown, though the step still checks the form again
  (watched failing: the first file's success under the second's refusal);
  and after a restore on the same step the import names the version after
  it and imports without a conflict (watched failing: the button still
  named the version the restore made). `apps/studio/src/journey.test.tsx` —
  the route is one of the administrator plane's (watched failing with it
  left out of `ADMIN_PLANE`). `apps/studio/scripts/browser-test.mjs` — the
  newest version downloaded from the Drift step is saved, in every browser
  the gate runs in, as the store's file byte for byte and named after the
  form and the version (watched failing in Chromium with the trailing
  newline dropped: 58141 bytes saved, 58142 stored; passed in Chromium,
  Firefox and WebKit on Linux, 2026-10-14); a version file chosen, and an
  import refused by drift, measured at every width with the keyboard held
  on the button; the refused state waits for the list of what blocks it, so
  a refusal of another kind fails it (watched failing with the target
  database of the other engine). `scripts/pictures/aria-text.test.mjs` —
  the README pictures' record says an object URL's UUID as `<uuid>` and
  changes nothing else (watched failing with the snapshot returned as it
  came, and with every UUID in it replaced); and the studio's
  `pictures.mjs --check` fails on studio-drift and studio-restored, each
  with a UUID of its own walk, when `camera.mjs` records the snapshot as
  printed (watched, 2026-10-14).

## Context

A form is proposed, reviewed and published in one deployment. Nothing moved
a published version to another one: a team with a development and a
production server rebuilt the form by hand in production, or copied the
store's directory across, which moved every version of every form at once,
overwrote production's history, wrote no event, and was checked only when
each file was first read
([0013](0013-published-configuration-is-files-with-link-based-swap.md),
[0019](0019-a-published-form-is-checked-every-time-it-is-read.md)).

Four facts of the code decided the shape. A lookup's option-source name is
made from the connection's id (`sourceNameFor` in
`data-core/src/generate/names.ts`), so it is in the base and the bindings: a
connection renamed on the way is another generated base, which the publish
check refuses ([0030](0030-presentation-is-a-patch-over-the-generated-base.md)).
Restore was already the gate a version reviewed elsewhere needs: read,
validate, discover, refuse what drift blocks, compare-and-swap. Drift refuses
to compare snapshots of two engines, which restore turned into 500
`internal`. And the version file is one document, written by the store as
`JSON.stringify(bundle, null, 2)` and a newline.

## Decision

The artefact is one version's file, byte for byte what the store wrote. The
export is the route that already reads it, `GET
/v1/forms/:id/versions/:version`, audited as `version-read`; the studio
offers any version as a download of the store's spelling, through an object
URL for a Blob of those bytes, made for the version shown and revoked when
another is shown or the panel closes, and imports a
chosen file from its Drift step over the newest version it read there. `POST
/v1/forms/:id/imports`, body `{ expectedBase, bundle, keysConfirmed? }`,
writes it as a new version after the checks a publish makes and the gate a
restore passes, in this order: the body's shape (400); the bundle validates,
in format 2, for this form (422 `invalid-bundle`); its connection is a name
this deployment's allowlist has (422, saying the name is kept); this
server's generator writes its base and bindings (422); this deployment's
database is discovered (503); it is of the same engine (422 `other-engine`)
and drift against it blocks nothing (409 `incompatible`, the blocking
changes only); 0039's keys against this deployment's base (422
`keys-reassigned`, a stale base the conflict first); compare-and-swap (409
`conflict`). 201 answers `{ version, drift }`, the drift to review or note.

The bundle is written as it came. The connection and the form keep their
names; nothing is mapped. The served snapshot is the source's, so what was
reviewed is what runs, and the runtime's root check
([0041](0041-the-runtime-refuses-what-drift-blocks.md)) and the target's
drift step compare against it.

The publish route's checks, restore's gate and 0039's comparison are one
module, `publishing.ts`, which the three routes share, so "a version this
server would write" and "a version this database can serve" are each one
decision. Restore moves onto the gate, so a connection pointed at another
engine is 422 `other-engine` for a restore too, where it was 500.

## Consequences

What this buys: a version moves between deployments checked as strictly as
a publish there, one version at a time, with an event on each side naming
who read it and who imported it, and the file is a text a team can keep in
git and review as a diff.

What it costs:

- The connection and the form have the same names in both deployments.
  Renaming is an allowlist edit and a restart.
- Both deployments' generators must agree: a release whose generator writes
  another base from the same snapshot and request refuses the file, and the
  form is proposed again there.
- The target serves, and drifts against, the source's snapshot -- its
  account's name and its whole scope -- until a regeneration there replaces
  it. A target whose account is narrower than the source's is drift, and
  that blocks: measured on both engines with the fixture's writer account.
- A file at rest holds the snapshot's metadata and the role names the
  policy grants; where it is kept is the team's to secure.
- An import identical to the newest version is written as a new version, as
  a restore of the same version is; nothing refuses it as unchanged.
- One discovery of the target database per import.
- The studio holds the version shown for download as a Blob until another
  is shown or the step is left. Its object URL's UUID is new on every load,
  so the README pictures' record says it as `<uuid>`: what 0038 records is
  no longer the accessibility snapshot exactly as Playwright prints it.
- Nothing proves where a file came from. The import re-checks everything it
  holds; it does not know who made it.

What it does not do: move history, map names, sign or digest a file, refuse
a change drift only asks to review, or offer a command-line tool.

## Alternatives considered

- **Copying the store's directory.** Unchecked until first read, overwrites
  the target's history, and writes no event.
- **Exporting the whole history.** Version numbers belong to one store; two
  stores' numbers cannot be merged by compare-and-swap.
- **Mapping connection and form ids on import.** A lookup's source name is
  made from the connection's id, so a mapped connection is another generated
  base, and rewriting it would serve something nobody reviewed.
- **Regenerating on the target.** That is a different version, with its own
  presentation conflicts and keys; it is what the Drift step already offers
  after an import.
- **Importing without the generator check.** A hand-relaxed base would reach
  production as if its database had said so.
- **A digest or a signature.** 0019 rejected signing; the import re-checks
  every part of the file, and a signature would prove only who exported it.
- **An export route of its own, with an `export` event.** It would claim a
  distinction the server cannot enforce: whoever may read a version may save
  what they read.
- **A command-line tool on the volume.** It would bypass authentication and
  the trail.
- **The download as a `data:` URL**, the file percent-encoded into the
  link's address, with nothing to revoke. Its length is not what rules it
  out: on 2026-10-14, Playwright 1.63.0's Chromium 153.0.8010.12, Firefox
  155.0 and WebKit 26.6, headless on Linux, and the first two on Windows 11,
  each saved a `data:` URL of 32 MiB and one character whole. It puts the
  whole file, more than twice as long -- the studio suite's order form's
  version 1, 56,287 bytes, is a 131,007-character `data:` URL -- into the
  DOM and the accessibility tree, whose text the README pictures record, so
  two pictures would hold a version file and their check would fail
  whenever its bytes changed.
- **Refusing review-level drift.** It would refuse harmless differences
  between two deployments' databases -- a column production has and the
  form does not use -- which restore allows.
