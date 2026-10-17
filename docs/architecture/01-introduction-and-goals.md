# 1. Introduction and goals

## What Formancy Data is

A paid, self-hosted, source-available module for
[formancy](https://github.com/sharkysan/formancy.ai). It discovers an
existing PostgreSQL or Microsoft SQL Server database as the account an
operator connects it with, generates a formancy form from what that account
may do, and serves the form's records and foreign-key lookups under a policy
the server asks on every request, with the identity the host application
already has. One database-neutral core, an adapter for each engine, a server
with an administrator's plane and a runtime plane, and a browser client; a
published form renders in React or Angular through formancy's own renderers.

It is not open source, and nothing here calls it that. Reading the source,
forking it, evaluating, developing and testing are free; running it in
production is a paid licence, and redistributing it inside another product a
separate agreement. [The README's licence table](../../README.md#licence-in-one-table)
is the explanation and `LICENSE.md` the terms
([0001](../decisions/0001-a-paid-module-in-its-own-repository.md)).

Why a paid module exists at all, and why in a repository of its own: formancy
is Apache-2.0 with no proprietary edition, ever
([formancy.ai 0002](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0002-apache-2-0.md)),
and draws its commercial line at operating the platform rather than using it
([formancy.ai 0003](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0003-open-core-line.md)).
A module a developer installs and pays to run in production is on the using
side of that line, and inside formancy.ai it would be the proprietary
edition formancy.ai 0002 rules out. It lives here, depends on formancy's
released packages, and contains none of their code (0001).

## The problems it fixes

The delivery plan this repository started from names the audience:
application teams with existing SQL databases who need maintenance screens,
portals and reference-data forms inside their own Angular or React
application. The plan is a working document kept out of the repository, as
`.gitignore` says; what it asked for became the decision records. The
problems that drive the design are each a way a form over an existing
database goes wrong without anybody noticing:

1. **The form restates the database, and stops being true.** Every column's
   type, length, nullability and key is written a second time, in the form,
   and a schema change lands under it. What that does was reproduced here on
   2026-10-10, before the runtime compared the table: a narrower scale stored
   `1234.5678` as `1234.57` and the save answered 200
   ([0041](../decisions/0041-the-runtime-refuses-what-drift-blocks.md)).
   The form is generated from the catalog
   ([0009](../decisions/0009-generation-is-deterministic-and-says-what-it-chose.md)),
   a change is classified against what a published form rests on
   ([0010](../decisions/0010-drift-is-classified-against-the-bindings.md)),
   and the server refuses what that review blocks (0041).
2. **Values change on the way through JavaScript.** A JSON number cannot
   hold 2^53 + 1, and an amount parsed into a float is no longer the
   customer's amount. Exact values travel as canonical strings and are never
   rounded
   ([0008](../decisions/0008-exact-values-travel-as-strings.md)).
3. **What the browser hides is not authorisation.** A disabled field, a
   tenant the page sends, an option list the page filtered: each is the
   browser's word. The tenant comes from a token the server verified
   ([0014](../decisions/0014-host-identity-is-verified-offline.md)), every
   request is decided by a policy on the server
   ([0011](../decisions/0011-every-operation-carries-a-trusted-policy-context.md),
   [0022](../decisions/0022-the-runtime-plane-asks-the-policy-every-time.md)),
   and an option's token names a row without granting it
   ([0012](../decisions/0012-a-lookup-token-is-a-reference-not-a-permission.md)).
4. **A restricted account's catalog lies by omission.** PostgreSQL's
   `information_schema` shows an account that may only read a table none of
   its constraints, as 0006's suite shows on the fixture's orders
   ([0006](../decisions/0006-postgres-discovery-reads-pg-catalog.md)), and
   SQL Server's catalog views are scoped by permission
   ([0007](../decisions/0007-sqlserver-discovery-and-what-it-hides.md)). A
   snapshot says what it could not see, as a gap, and never reports an
   absence it cannot prove
   ([0004](../decisions/0004-a-snapshot-says-what-it-could-not-see.md),
   [0027](../decisions/0027-a-snapshot-says-what-its-account-may-do.md)).
5. **Two people save one record, and an answer goes missing.** A save that
   overwrites another's, or one sent again because its answer never arrived,
   changes data nobody chose. A write is one guarded statement that refuses a
   stale version
   ([0015](../decisions/0015-a-record-operation-is-one-guarded-statement.md)),
   and an answer lost after the write was sent is unknown, said so, and never
   replayed
   ([0031](../decisions/0031-an-answer-lost-after-a-write-is-unknown.md)).

## Quality goals, in priority order

| # | Goal | What it means concretely |
|---|---|---|
| 1 | **Values arrive as the database holds them** | Decimals and wide integers are canonical strings, never rounded; text is measured in the column's own unit; an instant or a time a person did not change is never written back |
| 2 | **Fail closed** | Deny by default; the context from a verified token, never from the request; the policy asked on every request; a row outside it answered as a missing one is; a lookup that cannot answer refuses the save |
| 3 | **What an account cannot see is said** | Every gap in what discovery read, and what the account may do with each column and table, is in the snapshot and in front of the administrator |
| 4 | **No lost update, and no write sent twice** | One guarded statement per write, a stale version refused, an unknown outcome said and never retried |
| 5 | **A changed database stops what it breaks** | Drift is classified against what a form rests on, the runtime refuses what review blocks, and a person's choices are carried to the next generated form or refused by name |
| 6 | **Both engines mean the same, on real servers** | Every adapter behaviour proved on PostgreSQL and SQL Server, on every image of each engine's matrix, each shared case's expectation written once |
| 7 | **The screens are formancy's room, keyboard first** | Forms previewed in both renderers on white paper; every control reached by keyboard and found by role and accessible name, in three browsers |
| 8 | **A claim fails when it stops being true** | Each record names what verifies it; numbers are measured with what they ran on and held in CI without a clock |

What decided each, and where [section 9](09-quality-requirements.md) turns
it into scenarios, each naming the test or gate that fails:

1. [0008](../decisions/0008-exact-values-travel-as-strings.md),
   [0026](../decisions/0026-name-every-column-fact-the-engines-disagree-on.md),
   [0040](../decisions/0040-instants-and-times-are-read-to-the-shape-and-an-unedited-one-is-never-written.md):
   Q1, Q2 and Q5.
2. [0011](../decisions/0011-every-operation-carries-a-trusted-policy-context.md),
   [0014](../decisions/0014-host-identity-is-verified-offline.md),
   [0022](../decisions/0022-the-runtime-plane-asks-the-policy-every-time.md),
   inheriting
   [formancy.ai 0022](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0022-fail-open-fail-closed.md):
   Q8 to Q18. That the server builds the context only from a verified
   identity is held by the runtime suites; the policy functions cannot
   check it, and 0011 says so.
3. [0004](../decisions/0004-a-snapshot-says-what-it-could-not-see.md),
   [0027](../decisions/0027-a-snapshot-says-what-its-account-may-do.md),
   [0049](../decisions/0049-a-snapshot-says-whether-its-account-may-delete-and-what-refers-to-each-table.md):
   Q4. That every adapter makes its snapshot through `createSnapshot` is
   held by review.
4. [0015](../decisions/0015-a-record-operation-is-one-guarded-statement.md),
   [0031](../decisions/0031-an-answer-lost-after-a-write-is-unknown.md),
   [0050](../decisions/0050-a-record-is-deleted-one-at-a-time-by-its-token-and-the-version-its-person-read.md):
   Q12 to Q14. A write's id is remembered in one server process only.
5. [0010](../decisions/0010-drift-is-classified-against-the-bindings.md),
   [0041](../decisions/0041-the-runtime-refuses-what-drift-blocks.md),
   [0030](../decisions/0030-presentation-is-a-patch-over-the-generated-base.md),
   [0039](../decisions/0039-a-publish-says-what-happens-to-the-grants-of-reassigned-keys.md):
   Q11 and Q19 to Q21.
6. [0003](../decisions/0003-real-databases-in-every-test-run.md),
   [0005](../decisions/0005-one-fixture-written-twice.md),
   [0028](../decisions/0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md),
   [0035](../decisions/0035-a-release-report-is-derived-from-the-run-that-gated-it.md),
   [0067](../decisions/0067-the-adapter-suites-run-on-every-image-of-a-per-engine-matrix.md):
   Q3, Q43 and Q44, and [section 10](10-verification.md)'s first two
   parts. That no mocked driver exists is held by review.
7. [0021](../decisions/0021-generated-forms-preview-in-both-frameworks.md),
   [0024](../decisions/0024-the-studio-speaks-only-the-admin-plane.md),
   [0047](../decisions/0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md),
   [0058](../decisions/0058-the-browser-gates-run-in-chromium-firefox-and-webkit-and-each-fact-the-browsers-disagree-on-is-named-and-held.md):
   Q26 to Q29. What a picture of a page looks like is held by review
   alone.
8. [0034](../decisions/0034-performance-is-measured-through-the-shipped-server-and-held-without-a-clock.md),
   [0035](../decisions/0035-a-release-report-is-derived-from-the-run-that-gated-it.md),
   [0038](../decisions/0038-readme-pictures-are-taken-by-a-script-and-held-to-the-text-they-show.md),
   [0063](../decisions/0063-the-default-lookup-deadline-is-outside-the-measured-product.md):
   Q30 to Q33, and the release report
   ([section 10](10-verification.md#109-the-release-report-and-its-registers)).
   A time is measured and published, never gated.

**How the order was arrived at.** No record ranks these goals against each
other. The order is this document's, by what a customer loses when each one
fails and how late they would find out: a rounded amount, a row shown to
another tenant and an overwritten record cannot be taken back once they
happen, which is why goals 1, 2 and 4 cannot be retrofitted. Where a record
bought one goal with another, its cost paragraph says so, and those are the
places the order shows:

- 0041 adds round trips to record requests, counted on 2026-10-10 in its
  cost paragraph, and gives up
  [0016](../decisions/0016-postgres-operations.md)'s promise that a
  PostgreSQL session's default isolation and `search_path` never change an
  answer: goal 5 over speed, and over that promise.
- [0061](../decisions/0061-a-lookup-statement-stops-when-its-request-is-abandoned-or-its-deadline-passes.md)
  refuses a search that runs past the lookup deadline rather than serve it
  slowly; a deployment past the measured size sees `lookup-timeout` in its
  audit trail: goal 2 over availability.
- 0031 tells a person "it may have been saved" about some saves that were
  not, rather than "not saved" about one that was: goal 4 over a precise
  message.
- [0042](../decisions/0042-generated-forms-stay-on-spec-3-after-spec-4-is-released.md)
  keeps a whole-number field's whole-ness the server's, so a person who
  types `1.5` learns it from the server's refusal after Save: the stored
  value stays exact, and a host on an older renderer keeps reading the form,
  at the cost of a check in the browser.

## Scope

**What `main` does.** Discovery on both engines; generation, with lookups
drawn as a typeahead where a search can match them
([0066](../decisions/0066-a-lookup-a-person-can-search-is-generated-as-a-typeahead.md));
a policy for who may read, create, update and delete; presentation as a
patch; publication, restore and import between deployments
([0062](../decisions/0062-a-published-version-moves-between-deployments-as-its-version-file.md)),
reviewed by a second person when the operator names publisher roles
([0065](../decisions/0065-with-publisher-roles-set-a-draft-is-published-only-when-a-publisher-who-did-not-submit-it-approves-it.md));
records read, listed a page at a time
([0044](../decisions/0044-a-forms-records-are-listed-a-page-at-a-time-under-its-read-policy.md)),
created, updated and deleted one at a time, a delete reaching other tables
only through the foreign keys the policy names
([0051](../decisions/0051-a-delete-reaches-other-tables-only-through-foreign-keys-the-policy-names.md));
lookups; the menu of forms a person may read
([0045](../decisions/0045-the-runtime-plane-lists-the-forms-a-person-may-read-and-nothing-about-the-others.md));
drift review and the runtime's refusal; a snapshot that records the server
it was read from, and says to an administrator when this release was not
tested on it
([0068](../decisions/0068-a-snapshot-records-the-server-it-was-read-from-and-nothing-refuses-a-server-discovery-can-read.md));
the studio, the host page and the examples page; the composed stack, a
Cloudflare guide checked offline, and a live demo of the runtime with a
server and a database of each visitor's own on Cloudflare
([0070](../decisions/0070-the-live-demo-runs-the-real-server-and-postgresql-in-a-cloudflare-container-of-each-visitors-own.md)).
Which of these the latest release carries, and which are on `main` only,
the README's *Status* paragraph and `CHANGELOG.md`'s *Unreleased* say, and
this section does not repeat them; the first release's notes summarise the
development before it
([0064](../decisions/0064-the-first-releases-notes-summarise-the-development-before-it.md)).

**Not built, and said so** in the README, `CHANGELOG.md`'s known gaps or the
record that left it out:

- A host page that draws a field an update may not write as read-only: the
  host page draws it editable, and the server refuses a changed value, which
  [`docs/images/README.md`](../images/README.md) files.
- A bulk delete, and an undo of anything written.
- A host page on another origin, run in a browser; the server's suites test
  the origins it answers
  ([0060](../decisions/0060-the-runtime-plane-answers-the-origins-an-operator-lists-and-the-administrators-plane-none.md)).
- A run through a real Cloudflare tunnel
  ([0037](../decisions/0037-cloudflare-is-the-edge-not-the-runtime.md)).
- Performance figures for a page of records, the menu of forms and a delete
  ([0034](../decisions/0034-performance-is-measured-through-the-shipped-server-and-held-without-a-clock.md)).
- More than one server process
  ([0013](../decisions/0013-published-configuration-is-files-with-link-based-swap.md)),
  which [section 9](09-quality-requirements.md#94-qualities-deliberately-not-pursued)
  says is not pursued, and why.
- Create idempotency in the database: a create whose key the database
  numbers and whose answer was lost cannot be reconciled here (0031).
- A licence a lawyer has reviewed
  ([0048](../decisions/0048-the-licence-is-in-force-before-a-lawyer-has-read-it.md)).

**Outside the product altogether.** A language model: generation uses no
model, no clock and no randomness (0009). A regulatory claim: formancy.ai's
IEC 62304 documentation describes formancy, and this repository claims none;
if it ever does, the claim is a decision record first.

## Stakeholders

| Stakeholder | What they need from the architecture |
|---|---|
| Administrator | To see what one account sees and what it cannot; to generate, govern, arrange and publish a form, and review drift, without ever touching a record ([0020](../decisions/0020-administration-is-a-separate-plane.md), [0024](../decisions/0024-the-studio-speaks-only-the-admin-plane.md)) |
| Publisher, where review is on | To approve only what somebody else submitted, checked again against the database (0065) |
| Person filling in a form, through a host | Only the rows the policy lets them choose, values as stored, a save that neither overwrites nor doubles, and a plain sentence when an answer was lost (0022, 0015, 0031) |
| Host application developer | One client over the runtime plane, the identity they already have, and formancy's renderers ([0029](../decisions/0029-a-host-renders-a-published-form-through-one-client.md)) |
| Operator | One composed stack from a clean checkout, every setting read at start, a key that rotates without a restart, and an audit trail that never holds a value ([0032](../decisions/0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md), [0059](../decisions/0059-the-host-identity-key-is-a-set-selected-by-kid-and-read-again-on-sighup.md), [0023](../decisions/0023-the-audit-trail-is-operational-not-evidence.md)) |
| Database owner | To know that the module reaches the database only as the accounts an allowlist names, in the schemas it approves, one guarded statement at a time ([0019](../decisions/0019-a-published-form-is-checked-every-time-it-is-read.md), 0015) |
| Evaluator or customer | The reasoning, not only the result, about the licence and about what the module refuses to do with their database ([`../decisions/README.md`](../decisions/README.md)) |
| Contributor | Why the obvious simpler thing was not done, and the CLA a contribution is taken under (`GOVERNANCE.md`, `CLA.md`) |
