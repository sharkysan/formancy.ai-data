# 0064 — The first release's notes summarise the development before it

- **Status:** accepted
- **Date:** 2026-10-15
- **Deciders:** Daniel Bacher
- **Verified by:** `scripts/release-notes.test.mjs`, in `pnpm test:repo` —
  each body a release could be cut with from `CHANGELOG.md` itself,
  data-core's version's section when there is one and Unreleased, with a
  green run's summary, is no longer than GitHub accepts (watched failing on
  the changelog as it stood before this record).

## Context

0035 makes a release's body one section of `CHANGELOG.md`, its version's,
then the report's summary, and refuses a body longer than the 125,000
characters GitHub accepts in the report job, before anything is published.
`RELEASING.md` said to cut a release by renaming `## Unreleased` to the
version's heading.

Every change since the repository began wrote its entry under Unreleased: a
paragraph with its reason, as this repository asks. By the first release
the section was 178,500 characters (`releaseNotes(changelog,
'Unreleased').length`, 2026-10-15). Renamed, it makes a body GitHub
refuses. Nothing said so earlier: in CI the body is built only to be
measured (0035), and the rehearsal, which refuses it, had never run.

## Decision

The 0.1.0 section is a summary: what the release contains, what it knowingly
lacks, the licence it is under, and what changed to release it, pointing to
the history below it. The entries written before it stay as they were,
under `## Development before 0.1.0`, a heading no release announces, so
`releaseNotes` never takes it for a version's section. Unreleased starts
again, and a later release is cut as `RELEASING.md` says, by renaming it.

A test reads the changelog itself: each section a release could be cut
with -- data-core's version's, when the changelog has one, and Unreleased,
which the next release's is made from -- must make a body under the limit
with a green run's summary, so the pull request that grows one past it
fails.

## Consequences

**What it buys.** The first release has notes a reader can take in, and a
later release meets an overlong section in the pull request that made it,
not at the rehearsal.

**What it costs.** The first release's notes say less than its history: why
each change was made is in `CHANGELOG.md`, under its own heading, and not on
the release page. The summary is written by hand from the entries and the
README, and nothing checks that it says what they say; review holds it. The
licence's history, which 0048 kept as two entries under Unreleased so that
the first release's notes would carry both, reaches those notes as a
summary of them.

The test's summary is a run made by hand, shorter than a real run's by the
limitations only a real run derives, so a section within that difference of
the limit passes the test and is refused by the rehearsal.

**What it does not do.** It shortens no entry and moves none out of the
file. It does not split one release's notes across bodies, and it does not
limit a section that no release can be cut with.

## Alternatives considered

**Trim Unreleased until it fits.** One section, renamed as `RELEASING.md`
says. Rejected: it would cut by length, not by what matters, and the reasons
cut would be lost from the one place that keeps them.

**A body that is only a link to the changelog.** Nothing to write. Rejected:
0035 makes the body the version's notes so that a release says what it is on
its own page.

**Attach the notes to the release as a file.** No limit. Rejected: the
release page is what a reader opens, and an attachment is one more download
on it.
