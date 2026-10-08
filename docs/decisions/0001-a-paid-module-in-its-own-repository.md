# 0001 — A paid module lives in its own repository, under its own licence

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Daniel Bacher
- **Verified by:** `scripts/verify-licenses.mjs`, run by `ci.yml` on every
  pull request and by `release.yml` before publishing, refuses any publishable
  package whose `license` field is not `SEE LICENSE IN LICENSE.md` or whose
  tarball would ship without `LICENSE.md` and `NOTICE`. That nothing here is
  copied from formancy.ai is held by [0002](0002-depend-on-upstream-never-copy-it.md)'s
  guard for dependencies and by review for source. That formancy.ai itself is
  unchanged by this decision is verifiable there: its licence, its packages'
  `license` fields and its decision records are untouched.

## Context

formancy.ai made two decisions on its first day that this product has to be
read against.
[formancy.ai 0002](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0002-apache-2-0.md)
is Apache-2.0 for everything, no dual licensing, and in its own words "there
will never be a proprietary edition of this code".
[formancy.ai 0003](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0003-open-core-line.md)
draws the commercial line "at operating the platform rather than at using it":
sold are managed hosting, multi-tenancy, SSO, audit, PDF, e-signature, analytics
and support; a self-hoster "never hits a paywall, which is the adoption argument
and only works if it is true without qualification". It considered and
rejected a source-available licence for formancy.

Formancy Data is a paid, self-hosted module. By 0003's own terms it is on the
*using* side of the line: a developer installs it and runs it, and pays to run
it in production. It is therefore not something 0003 contemplated selling, and
putting it inside formancy.ai would either break 0002 — a proprietary edition
of that code — or require relicensing part of that repository, which 0002 says
will not happen.

At the same time, formancy.ai's governance kept the option open on purpose:
contributions there are taken under a CLA precisely "because the open-core line
intends a proprietary build of code that also lives here"
([formancy.ai 0069](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0069-contributions-under-a-cla.md)).

## Decision

Formancy Data is a separate repository with a separate licence — the Formancy
Data Source-Available Licence in `LICENSE.md` — that **depends on** the
released Apache-2.0 `@formancy/*` packages and contains none of their code.
formancy.ai is not changed by this decision: not its licence, not its packages,
not its promise.

The packages are published under the same `@formancy` npm scope, with a
`license` field that says what they are and a `LICENSE.md` in every tarball.

## Consequences

**What it buys.** A revenue line that does not touch formancy's licence or its
adoption argument. "A self-hoster never hits a paywall" stays true of formancy
without qualification, because the paywall is in a different product with a
different name, and a developer evaluating formancy never encounters it.

**What it costs.** Two repositories to keep in step, with upstream's package
APIs explicitly not frozen before 1.0 — that cost has its own record
([0002](0002-depend-on-upstream-never-copy-it.md)). And a scope that mixes
eleven Apache-2.0 packages with three that are not, which is a confusion
waiting to happen in a dependency audit. The `license` field, the shipped
`LICENSE.md`, the NOTICE and the word "source-available" in every README are
what answer it, and the guard above is what keeps a copied manifest from
undoing it.

**What it forecloses.** Moving this code into formancy.ai later, without
relicensing it under Apache-2.0 first. And describing Formancy Data as open
source, anywhere, ever: it is not, and formancy.ai's whole positioning depends
on the two not being blurred.

**What it asks of formancy.ai.** A record there, amending 0003's sold list to
name a paid database module beside the operating-the-platform items, so that
0003's "the sold list is thin at v1 and every item on it is unbuilt" is updated
rather than silently outgrown. That record is formancy.ai's to write; this one
notes that it is owed.

## Alternatives considered

**A directory inside formancy.ai under a different licence.** Rejected: it is
the proprietary edition of that code 0002 rules out, and a monorepo with two
licences is exactly the thing an open-source programme office refuses to
approve.

**Apache-2.0 for this module too, selling only support and hosting.** Rejected
for now: 0003's sold list is "thin at v1 and every item on it is unbuilt", and
a module that writes to a customer's database is the one thing in the family
with a clear production-use boundary to price against. The plan's price
hypothesis is tested with design partners before launch; if it fails, this
record is the one to reverse.

**Business Source License 1.1.** Considered in the plan's appendix. Not chosen
because each version converts to an open-source licence by a fixed date, and
that is a promise the project is not yet in a position to make deliberately.
Choosing it by default would be making it by accident.
