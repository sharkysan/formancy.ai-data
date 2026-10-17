# 0076 — The architecture is documented as arc42 in docs/architecture, and every change updates the section it touches

- **Status:** accepted
- **Date:** 2026-10-17
- **Deciders:** Daniel Bacher
- **Verified by:** `scripts/architecture.test.mjs`, in `pnpm test:repo`,
  which the `verify` job of `.github/workflows/gates.yml` runs on every pull
  request and before every release. It fails when `docs/README.md` or one of
  arc42's twelve section files in `docs/architecture/` is missing, when the
  entry does not link a section, or the directory holds a file that is none
  of them; when a workspace package or app, read from
  `pnpm-workspace.yaml`'s globs and each manifest's `name`, is not named in
  `docs/architecture/05-building-blocks.md`; when a decision record in
  `docs/decisions/` is linked from no section; when a relative link in the
  entry or a section names no file git would commit, or a fragment no
  heading GitHub would anchor; and when a repository path written in
  backticks there names nothing git would commit. Each was watched failing
  with its defect planted in the real files and put back: the deployment
  view and the entry deleted, `@formancy/data-performance` renamed in the
  building blocks, every link to
  [0036](0036-a-merged-branch-is-deleted-by-the-merge.md) made plain text, a
  link to [0013](0013-published-configuration-is-files-with-link-based-swap.md)
  and a fragment into section 8 broken, section 11.4's heading renamed, and
  a path and a pattern misspelled. The reading underneath -- links as
  Markdown writes them, GitHub's anchors, code spans, what counts as a path,
  patterns with `*`, `**` and braces, the workspace's globs -- is held by
  cases on fixtures in the same file. That a sentence in a section is still
  true of what it names, and that a change updates the section it touches,
  is **not mechanically enforced**: review holds it, by the rule in
  `CLAUDE.md`.

## Context

The decision records say why one thing was done, one record at a time, in
the order the decisions were made. Nothing said how the pieces fit together
except `CLAUDE.md`'s map, a paragraph for whoever works here, which says of
itself that nothing fails when it goes stale. An integrator deciding whether
to build on the module, a reviewer of a pull request and a contributor new
to the code each had to read the records in order to learn where something
lives, what one request does from the browser to the database, what holds a
quality, and what was accepted rather than fixed.

formancy.ai documents its architecture as arc42, in `docs/architecture/`
with `docs/README.md` as the entry, and its `CLAUDE.md` asks every change to
update the section it touches. formancy.ai-report and formancy.ai-health
are being given the same shape at the same time, under the same twelve file
names, each with a guard holding at least the first four checks that
`scripts/architecture.test.mjs` makes here: the sections and the entry, the
packages named, the records cited, and the links and their headings. A
reader who knows one of the four repositories finds things in the others
where they expect them.

`CLAUDE.md` already asks that a change is not done until the documents that
describe it say so, and that a claim in prose is backed by something that
fails. A set of documents that describes the whole repository is the kind
of prose that drifts first, so it arrives with a guard.

## Decision

- **The architecture is documented in `docs/architecture/`**, in arc42's
  twelve sections, under the file names formancy.ai gives them, and
  `docs/README.md` is the entry: who should read what, the sections, the
  decision records and the repository's other documents. The README's
  *Documents* list points at it.
- **The sections describe `main` as it is.** Each design statement links the
  record that decided it and names the test or gate that holds it, or says
  that nothing does. Work on a branch that has not merged is not described
  as done; the risks section names it as not yet merged. A record of
  formancy.ai is cited as `formancy.ai NNNN`, with a link, as the records
  cite it.
- **Every change updates the section it touches**, in the same pull
  request: the building blocks for a new package or module, the runtime
  view for a new flow, the cross-cutting concepts, the quality
  requirements, verification, and risks and debt for anything accepted
  rather than fixed. `CLAUDE.md` says so beside its other documentation
  rules, and keeps its map, which now points at the building blocks for the
  full one.
- **Every decision record is cited by a section**, so the pull request that
  writes a record also places it in the architecture.
- **`scripts/architecture.test.mjs` holds what a test can see**: the files,
  the packages named, the records cited, the links and their fragments, and
  the paths. A repository path is a code span with no space in it, holding
  a slash, whose first segment is one of the repository's top-level
  directories as git lists them; it must name a file git would commit, a
  directory holding one, or, as a pattern, match one, and each choice in
  braces must. A path given from inside a package, as `routes/runtime.ts`
  is under the server's `src/`, is not one.

## Consequences

**What it buys.** An integrator, an evaluator or a reviewer has one place
that says where each piece lives, what a request does, what each quality
rests on and what is accepted rather than fixed, each with the record that
decided it. A package added to the workspace fails `pnpm test:repo` until
the building blocks name it; a record written fails it until a section
links it; a module renamed or deleted fails it while a section still names
it by its path from the root; a heading reworded fails it while a link
still points at the old one. The four repositories read alike.

**What it costs.**

- Prose drifts. The guard holds names, links and paths, never the truth of
  a sentence: a section can go on describing what a module did before a
  change, under the same path, and pass. Review holds that, and a change
  that touches behaviour is not done until its section says so, which is a
  rule somebody follows, not a check.
- Every pull request that adds a record or a package also edits a section,
  and one that moves behaviour should. That is more work per change, and
  the cost is paid whether or not anybody reads the section that month.
- The same fact is said in more than one place: a record argues it, the
  README states it, a section places it. The sections link rather than
  restate where they can, and still restate some, so a change can leave a
  second sentence behind.
- What the guard does not read passes unread: a path given from inside a
  package, a path whose first directory is misspelled, a path in a fenced
  block or wrapped over a line, a file named without a slash, a record
  named without a link, a package named that the workspace does not have,
  and a sentence that names a package without saying what it does.
  Nothing holds a section's length; the source-size budget counts source
  files, not documents.
- A link into a heading is checked as GitHub anchored `#` headings when this
  was written; a heading written another way is refused rather than read.

**What it does not do.** It is not user documentation: how to install, run
and integrate the module stays in the README, the packages' READMEs and the
getting-started guide. It makes no regulatory claim; formancy.ai's IEC 62304
documentation describes formancy.ai, and this repository still claims none.
It does not check the quality goals' order, which no record decides.

## Alternatives considered

**No architecture document: `CLAUDE.md`'s map and the records alone.** The
map is written for whoever works here, and says itself that nothing fails
when it goes stale; the records are one decision each and do not say how
the parts fit. Rejected because an integrator would have to read every
record to find where something lives, and nothing would place a new record
or a new package anywhere but the index.

**C4 diagrams**, a context, container and component view. Rejected: a
diagram draws boxes and arrows and says nothing of what holds each one or
what it costs, and a picture is something no test here can check against
the code. arc42's context and building-block sections carry the same
content as text and tables a guard can read, the few diagrams the sections
need are text in a fenced block, and formancy.ai's shape is arc42.

**Generate it from the code.** The building blocks from the workspace, the
routes from the router, the settings from the composition root. Rejected:
what can be generated is what the guard already derives to check the prose
against -- the packages, the records, the files -- and the rest of each
section, why a thing was done, what it costs and what holds it, is not in
the code to generate. Where a fact can be derived, the guard derives it and
holds the prose to it, as `CLAUDE.md` asks: derive it, check it, measure it.
