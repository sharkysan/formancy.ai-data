# 0154 — The README speaks to a buyer first, and the detail lives in the guide

- **Status:** accepted; extended by
  [0168](0168-the-readme-pictures-the-workspace-a-buyer-meets-and-each-step-of-how-it-works.md):
  README.md holds a second pictures region, a small picture for each step
  of *How it works*, and its hero is the host page's workspace, the exact
  digits an inline picture of the host page's guide
- **Date:** 2026-11-15
- **Deciders:** Daniel Bacher
- **Verified by:** what held the README's sections holds them where they
  now are, in `pnpm test:repo`, which the `verify` job of
  `.github/workflows/gates.yml` runs on every pull request and before every
  release:
  - `scripts/pictures/readme.test.mjs`: each pictures region is on the
    page it is drawn on -- the hero on `README.md`, each app's scenes on
    `docs/guide/<app>.md` -- once, on no other page, and as
    `scripts/pictures/scenes.json` and the record render it, its links and
    pictures aimed from that page. Watched failing with the render's
    re-aiming made to return its text unchanged (every region of the guide
    then differed from the render and linked `./docs/…` from
    `docs/guide/`, which names no file), and with the studio's region
    planted in `README.md` ("README.md holds the pictures region "studio",
    which is drawn on docs/guide/studio.md").
  - `scripts/architecture.test.mjs`: every relative link of every Markdown
    file git would commit but the decision records and `CHANGELOG.md` --
    `README.md`, the guide's pages, the packages' READMEs, the
    getting-started guide among them -- reaches a file git would commit,
    and every fragment a heading of it; a link to the licence the build
    copies into a package is checked as one to the root's file. Watched
    failing with the README's link into *What it is tested on* given a
    heading the page does not have and one of *Development*'s into
    `CONTRIBUTING.md` misspelled; with `../README.md#studio` planted in
    `docs/getting-started.md`, `../../README.md#deploying` in
    `docs/deploy/cloudflare.md` and `../../README.md#what-it-is-tested-on`
    in `packages/data-server/README.md`; with the build's copies not read
    as the root's, when every package README's link to its `LICENSE.md`
    failed; and its read-at-all case with only the README and the guide
    read. It found the link from
    `docs/architecture/03-context-and-scope.md` to the README's old *When
    the schema changes* on its first run.
  - `scripts/release-report/tested-on.test.mjs`: the table on
    `docs/guide/tested-on.md` is what `testedOn()` renders. Watched failing
    with one of jose's versions changed there.
  - `scripts/demo.test.mjs` and `scripts/live-demo-docs.test.mjs`: the
    README's *Try it* names both demos' addresses; the guide's *Examples*
    names the examples page's address and its port alone, *Live demo* the
    Worker's address, people, idle minutes, cap, data and commands, and
    *Host example* the demo build's script. Watched failing with each
    planted at once: the live demo's address changed in *Try it*, Vera
    renamed, the idle minutes changed, `build:demo` renamed on the host
    page and a port changed on the examples page.
  - `scripts/setup.test.mjs` and `scripts/licence-status.test.mjs`, as
    before: the README links `docs/setup.md` and holds the licence block.

  **Not mechanically enforced**, and held by review: that the README stays
  short and speaks to a buyer first, that a page says what its first
  sentence says it covers, that a README line still says what the guide's
  longer line says, and that a change updates the lines below.

## Context

On 2026-11-15 the README was 1,675 lines and 16,848 words (`wc`): a status
paragraph of every release's additions and what was not yet measured, then
every behaviour of the studio, the host page, the examples page and the
live demo, the packages, the deployment's settings, the tested-on table
and the development commands, each line with the record that holds it.
That is the reference somebody integrating the module needs, and it is
true, because each line links a record whose **Verified by** fails when it
stops being so.

It is not what somebody deciding whether the module solves their problem
reads. A team lead or a product owner opening the repository met the
status paragraph, then nearly four hundred lines of *What it does*, before
anything said what the module is for, how to try it, what it costs or what
it does not do yet. A developer met the getting-started guide's command in
the second section and the packages to install after the thousandth line.

Several guards read the README by section: the live demo's and the
examples page's accounts by their headings (0069, 0070), the pictures'
regions by their markers (0038), the tested-on table by its block (0035),
the licence's sentence by its block (0048), and the link to the setup page.

## Decision

**The README is a page for a buyer first and a developer second.** In
order: the name, a promise and three sentences of what the module does and
on what terms; the hero picture; *Try it*, the live demo and the examples
page; *Why*, opening with a line that says the page describes `main`,
which has more than the latest release, then a few benefits, each ending
with the records whose **Verified by** holds it, and saying, where there
is one, the condition a reader would otherwise meet too late -- in the
first, that a form offers
update and delete only where a rowversion or a confirmed version column
tells a stale save, so a PostgreSQL table needs such a column to be
editable; *How it works*, the path from a connection to a person's record
in a handful of steps; *What you get*, a dozen bullets at most, grouped
for a reader -- working with records, as the host page, an example that
is not released, draws them; administration, in the studio, built from
the repository and not published; operations -- each linking its records
and none counting anything that goes stale; *What it does not do yet*;
*Get started*, the composed stack and what an application of one's own
installs, the studio built from the repository; a short *Status*; the
*Licence, in one table*, unchanged, which `CLAUDE.md` names as the
explanation; and *Learn more*.

**The detail lives in `docs/guide/`**, one page per reason to read it, each
opening with a sentence that says what it covers: *What it does*
(`capabilities.md`), *Status*, *Studio*, *Host example*, *Examples*,
*Live demo*, *Packages* with *How it relates to formancy.ai*, *Deploying*
with *When the schema changes*, *What it is tested on* and *Development*.
The README's sections moved nearly unchanged: each keeps its heading, as
the page's title or, for *How it relates to formancy.ai* and *When the
schema changes*, under it, so a link to its anchor needs only the page's
name in front, and its links were re-aimed one directory down. Two sentences that were no
longer true were corrected in the move rather than carried: the live
demo's address was said to be formancy.ai's 404 until its Worker was
created, which `docs/setup.md` records as done on 2026-10-19, and the
drift paragraph said no command checks drift for a pipeline, which 0111's
`dist/drift-check-cli.mjs` does. One number was dropped in the move: the
status said the live demo's start on Cloudflare answered after 1778 ms,
a figure nothing in the repository says how anyone measured, while the
live demo's own section said its start there was not yet measured.
`docs/README.md` lists the pages.

**The generated blocks follow their sections.** The hero's pictures region
stays in the README; each app's region is drawn on its page of the guide,
`docs/guide/<app>.md`, the page derived from the app's name, its captions'
links -- written from the repository's root in `scenes.json`, which does
not change -- and its pictures re-aimed from that page by the render. The
tested-on table is written on `docs/guide/tested-on.md`. No picture, scene
or record changed. The licence block stays in the README.

**Where an earlier record names a section of the README that moved** --
*What it does*, *Studio*, *Host example*, *Examples*, *Live demo*,
*Packages*, *Deploying*, *When the schema changes*, *What it is tested
on*, *Development* -- it now means the guide's page of that name, which its
guard reads; those records are not edited. The README's *Try it* and
*Licence, in one table* are still the README's.

**What a change updates.** A feature's pull request writes its line on the
capabilities page, and on the page of the app it changes, and its line in
`CHANGELOG.md`'s *Unreleased*; it touches the README's *What you get* or
*What it does not do yet* only where the README's reader would notice. The
README's *Status* and the status page change when a release is cut, or
when something they name as not yet measured is measured. `CLAUDE.md` says
so.

## Consequences

**What it buys.** Somebody deciding meets what the module is, how to try
it, why it might fit, what it does and does not do yet, and what it costs,
in a page a few hundred lines long, every claim on it still linking the
record that holds it. A developer finds the composed stack and the
packages in *Get started*. The reference is unchanged in substance, and a
page of it can be linked whole.

**What it costs.**

- Two places to keep in step. A README bullet and the capabilities page's
  longer line say some things twice, and a change can update one and leave
  the other; nothing compares them. The README says less about each thing,
  so it can go on being true longer, but not for ever.
- A reader of the README sees less at once: every condition, refusal and
  number is a link away, and a reader who reads only the README reads the
  short version.
- A link from outside to an anchor that moved -- a bookmark, an issue, a
  pull request -- now opens the README at its top. A link to a released
  tag's README, as `CHANGELOG.md`'s are, still opens that release's.
- A record's sentence about "the README's *Studio*" or "the README's
  *What it is tested on*" is read as this record says, not as written.
- The pictures' check now reads every Markdown file git would commit, to
  find a region left on another page, and needs git, as the licence
  block's already did; an app given scenes needs its page of the guide
  before the check passes.
- The link check reads every Markdown file git would commit but the
  records and the changelog, so a heading renamed on any page fails until
  every link to it, on any page, is aimed again; and a file a build writes
  beside a package is known to it only as `scripts/sync-licenses.mjs`'s
  licence copies, read from the manifests as that script reads them.
- The README's own *Try it* is held for both addresses only: the live
  demo's people, minutes and cap, and the examples page's port, are held on
  the guide's pages, where the README no longer states them.

**What it does not do.** It takes no picture: the hero is today's, the
other regions show today's scenes on their pages, and the pictures the new
README and the guide's pages want are a later change. It does not decide
the product's page on formancy.ai, which is that repository's `apps/site`
in its one shell (formancy.ai 0106). It changes no behaviour of the
module.

## Alternatives considered

**The status quo.** One README that is the whole reference. Rejected: the
reader the repository has to persuade before any other reads it does not
reach the reason to, and the developer finds the first command in the
middle.

**Condense and drop.** A short README and no reference: each section cut
to its first sentence, the conditions left out. Rejected: the conditions
are what keep a claim true -- a lookup "offers only the rows the person
may choose" because its token is checked again on save; a list is
"filtered" inside the read policy and never widening it -- and dropping
them would make the short version claim more than the tests show, which
`CLAUDE.md` refuses. The records' guards read some of those sections, and
would have nothing to hold.

**A documentation site** built from the Markdown. Rejected for now: a
build and a host of its own for pages GitHub already renders, and the
product's page belongs in formancy.ai's site, not beside it.
