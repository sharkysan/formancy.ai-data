# 0171 — Every release's notes are a summary, and an Unreleased entry is a sentence or two

- **Status:** accepted
- **Date:** 2026-11-20
- **Deciders:** Daniel Bacher
- **Verified by:** `scripts/release-notes.test.mjs`, in `pnpm test:repo` —
  every entry under Unreleased in `CHANGELOG.md` itself is at most
  `ENTRY_LIMIT`, 500 characters, every run of white space counted as one,
  and no released section or development history is read (watched failing
  on the changelog as it stood before 0.4.0's section, 76 of its 92
  entries over); and, as 0064 has it, each body a release could be cut
  with fits.

## Context

[0064](0064-the-first-releases-notes-summarise-the-development-before-it.md)
made the first release's notes a summary and kept the entries written
before it under `## Development before 0.1.0`; a later release was to be
cut as `RELEASING.md` said, by renaming Unreleased. 0.2.0 and 0.3.0 were:
each section a summary followed by every entry since the release before.

An entry was a paragraph with its reason, and the paragraphs grew. On
2026-11-20, a month and about 150 commits after 0.3.0, with records 0093
to 0168 between them, Unreleased held 92 entries and 123,061 characters
(`releaseNotes(changelog, 'Unreleased').length`): the median entry 1,091
characters and the longest 4,404, every run of white space counted as
one. Renamed to 0.4.0, with a green run's summary made by hand, it was a
body of 124,979 of the 125,000 characters GitHub accepts, so every entry
written next failed 0064's test. Most of an entry restated its record --
what an integrator notices, what an operator notices, what it costs --
which the record already says, its cost paragraph being required. And a
release page that long is not one a reader takes in.

## Decision

Every release's section is a summary, as 0.4.0's is: what the release is,
how to get it, what an operator or an integrator must do or will meet on
upgrading, what is new grouped by where a person meets it, and what is
knowingly missing, each line with the record behind it. The entries
written since the release before stay as they were written, below it,
under a heading of their own that no release announces --
`## Development between 0.3.0 and 0.4.0` -- and Unreleased starts again,
empty.

An entry under Unreleased is short: what changed and why, in a sentence
or two, with its record's number; the detail lives in the record. A test
holds every entry under Unreleased to 500 characters. An entry is an item
at the margin with every line under it, a list of its own included, or a
paragraph outside a list; its length is its text with every run of white
space made one space, so how it is wrapped does not count. The limit is
measured from the 92 entries 0.4.0's development kept: the longest of two
sentences or fewer, 0094's, is 330 characters, and the longest link to a
record, `([0163](docs/decisions/…))`, 169; together 499.

This amends 0064, under which a later release was cut by renaming
Unreleased.

## Consequences

**What it buys.** Notes a reader takes in in a few minutes: 0.4.0's
section is 15,915 characters, its body 17,828 with the same summary made
by hand, where renaming Unreleased made 124,979. A body far from the
limit however busy the month, since it grows by a summary and not by the
entries. And an entry that says what changed, with its record a link
away.

**What it costs.**
- Every release's summary is written by hand from the entries and the
  records, and nothing checks that it says what they say; review holds it,
  as 0064 said of the first.
- Why a change was made is a sentence in the changelog and a record's
  page, no longer a paragraph in the changelog: a reader who wants the
  detail opens the record, and a change with no record of its own has its
  sentence or two and nothing more.
- The limit counts characters, not sentences: one long sentence passes and
  three short ones may not, and a long record name spends the budget an
  entry has. An entry that needs more is a record's, or two entries.
- `CHANGELOG.md` still grows by every entry, under one more heading each
  release: only the release body is bounded, and only 0064's test bounds a
  summary.

**What it does not do.** It shortens no entry written before it and
rewrites no released section: 0.1.0's to 0.3.0's stay as they were, and so
do the entries kept under *Development between 0.3.0 and 0.4.0*. It holds
no entry outside Unreleased.

## Alternatives considered

**Condense the month's entries in place.** Rewrite each of the 92 to a
sentence or two under Unreleased, and rename it 0.4.0 as before. Rejected:
it rewrites what was written when each change was made, losing what is
not in a record -- a measurement, a failure observed in CI -- from the one
place that kept it; and with nothing holding the next entry, 0.5.0 meets
the same limit.

**Let the body link past the limit.** Over 125,000 characters, a body
that names the section and links it in the changelog. Rejected: 0064
rejected a body that is only a link, since a release says what it is on
its own page, and a section of 120,000 characters is not read on any
page.
