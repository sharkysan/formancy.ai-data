# 11. Risks and technical debt

Written so that a reader can tell what is known and accepted from what is
merely not done yet. The costs below come from the decision records' cost
paragraphs. Their complete list is the register
`docs/release/limitations.json`, an entry for every record, which every
release report prints in full
([0035](../decisions/0035-a-release-report-is-derived-from-the-run-that-gated-it.md));
this section summarises it by area, and where the two differ the register
and its records are right.

## 11.1 The riskiest pieces

Formancy Data connects to a customer's existing database and writes to it.
The first three areas below are among those `SECURITY.md` names as highest
risk; the two others it names, secret exposure and metadata disclosure, are
[8.4](08-crosscutting-concepts.md#84-secrets-handled-once) and
[8.8](08-crosscutting-concepts.md#88-errors-are-fixed-sentences); the last
two are this design's own. Each has a mitigation already applied and a
residual that is not closed.

### Identifiers and values reaching SQL

*Mitigation, already applied:* every identifier comes from approved
metadata -- a snapshot discovered inside the schemas the operator approved
-- and is quoted by the adapter; every value is bound as a parameter; and a
row filter is equality with a trusted value and nothing more expressive, so
it can never become SQL somebody wrote
([0011](../decisions/0011-every-operation-carries-a-trusted-policy-context.md),
[0016](../decisions/0016-postgres-operations.md),
[0017](../decisions/0017-sqlserver-operations.md)). The fixture's own
`sales.order` is a reserved word on both engines, so every suite that reads
it reads a name that only quoting makes work.

*Residual:* no guard searches the code for a statement built from a string
an outsider can influence. That rule is `CLAUDE.md`'s, and review holds it.

### Authorisation and tenancy

*Mitigation, already applied:* every runtime request asks the policy, deny
by default ([0022](../decisions/0022-the-runtime-plane-asks-the-policy-every-time.md));
a lookup token is a reference whose membership the database checks again on
every use ([0012](../decisions/0012-a-lookup-token-is-a-reference-not-a-permission.md));
a child's rows are reached only through a parent its policy admits
([0043](../decisions/0043-a-child-forms-rows-are-reached-only-through-a-parent-its-policy-admits.md)).

*Residual:* the trusted context is only as trustworthy as the host that
builds it, and a host that builds it from a request body defeats every
check (0011). Equality is all a row filter can say: an actor in two tenants
at once is not expressible, nor a rule two foreign-key hops away. A child's
tenant rule restates its parent's, and nothing checks that the two agree.
On PostgreSQL an update or a delete that waits for its row while another
transaction moves the row's parent out of scope is carried out, where SQL
Server answers not found (0043,
[0050](../decisions/0050-a-record-is-deleted-one-at-a-time-by-its-token-and-the-version-its-person-read.md)).
A cascade deletes the rows it reaches whatever the account's row security
says of them
([0051](../decisions/0051-a-delete-reaches-other-tables-only-through-foreign-keys-the-policy-names.md)).

### Lost updates and ambiguous writes

*Mitigation, already applied:* a record operation is one guarded statement
that checks the version its person read and is never retried
([0015](../decisions/0015-a-record-operation-is-one-guarded-statement.md));
an answer lost after a write reaches the host as unknown, which one read
can reconcile with what the database now shows, and a copy the browser
sends again is answered rather than applied
([0031](../decisions/0031-an-answer-lost-after-a-write-is-unknown.md)).

*Residual:* the write id holds in one process, so a resend that reaches
another replica, or this one after a restart, is applied again. "It may
have been saved" is also said where nothing was. A create whose key the
database numbers cannot be reconciled, so a person who confirms "Enter it
again anyway" may make a duplicate.

### Two engines that mean different things

*Mitigation, already applied:* every column fact the engines disagree on is
named in the contract
([0026](../decisions/0026-name-every-column-fact-the-engines-disagree-on.md)),
and filters, labels and refusals are one expectation both adapters run
([0028](../decisions/0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md)).

*Residual, by design and said:* text order and search folding are each
engine's, so a lookup or a list of non-ASCII names can come in another
order, and a search can match other rows, on each engine
([0044](../decisions/0044-a-forms-records-are-listed-a-page-at-a-time-under-its-read-policy.md));
a uuid key is ordered as each engine orders it
([0056](../decisions/0056-a-key-the-database-fills-is-never-written-and-a-uuid-is-ordered-as-each-engine-orders-it.md)).
A filter matches the same rows on both; a search does not.

### Drift between a published form and its database

*Mitigation, already applied:* drift is classified against the form's
bindings ([0010](../decisions/0010-drift-is-classified-against-the-bindings.md)),
and the runtime refuses what drift blocks in the form's own table, decided
over a description read in each request
([0041](../decisions/0041-the-runtime-refuses-what-drift-blocks.md)).

*Residual:* the runtime compares only the form's own table. What drift
blocks for a lookup's table, a privilege, row security or the account is
stopped at review alone, the database still enforcing its own grants. A
column dropped and added again under the same definition is seen by
neither. On SQL Server a column given dynamic data masking after
publication is read as its mask by an account without UNMASK, and a save
that sends every field writes the mask over the stored value.

## 11.2 Known limitations, by area

**Databases.** A snapshot describes the database as one account sees it, so
discovery runs as the account the forms will run as
([0006](../decisions/0006-postgres-discovery-reads-pg-catalog.md),
[0027](../decisions/0027-a-snapshot-says-what-its-account-may-do.md)).
SQL Server discovery is several queries side by side, which a concurrent
`ALTER` can tear
([0007](../decisions/0007-sqlserver-discovery-and-what-it-hides.md)), and
refuses a catalog without `sys.edge_constraints`, every release before
2019, naming its release
([0068](../decisions/0068-a-snapshot-records-the-server-it-was-read-from-and-nothing-refuses-a-server-discovery-can-read.md)).
Nothing else refuses a server this release was not tested on: the runtime
never discovers again, so a server upgraded in place is seen only by the
next discovery, drift review lists `server-untested` until it changes, and
a managed PostgreSQL whose `version()` begins "PostgreSQL " reads as tested
(0068). PostgreSQL 14 and older and SQL Server 2017 and older are not
images of the matrix, and on PostgreSQL 18 a cascaded table's AFTER DELETE
trigger runs with its owner's grants, so it does a delete 15 to 17 refuse
([0067](../decisions/0067-the-adapter-suites-run-on-every-image-of-a-per-engine-matrix.md)).
Every lookup search reads every row its form's row filter admits: no
trigram index, prefix mode or minimum length ships, and the lookup deadline
caps how long a search runs, not how much it reads
([0034](../decisions/0034-performance-is-measured-through-the-shipped-server-and-held-without-a-clock.md),
[0061](../decisions/0061-a-lookup-statement-stops-when-its-request-is-abandoned-or-its-deadline-passes.md)).
The PostgreSQL adapter cancels a lookup through private properties of its
driver, so a driver upgrade that changes them fails its suite (0061).
Triggers that run on a delete are not seen, shown or governed (0050), and
on PostgreSQL a cascaded table's BEFORE DELETE triggers and rules run with
that table's owner's grants (0051). A table outside the approved schemas
that refers to one in scope is named, and a reference the account cannot
see is a gap
([0049](../decisions/0049-a-snapshot-says-whether-its-account-may-delete-and-what-refers-to-each-table.md)).
That `gen_random_uuid()` and `newsequentialid()` never repeat is their
design, not something measured here
([0057](../decisions/0057-a-key-of-one-column-filled-by-a-never-repeating-default-counts-as-numbered.md)).

**Forms.** Decimal fields are text inputs, totals over money are not
offered, a table with a version-looking column is create-only until
somebody confirms it, and generated labels are de-snaked column names
([0009](../decisions/0009-generation-is-deterministic-and-says-what-it-chose.md)).
On spec 3 a whole-number field accepts a fraction in the browser and only
the server's codec refuses it
([0042](../decisions/0042-generated-forms-stay-on-spec-3-after-spec-4-is-released.md)).
A client sends exact decimals as strings, and a value comes back
canonicalised to its column's scale
([0008](../decisions/0008-exact-values-travel-as-strings.md)). An instant
is shown to the second and a time to the minute on both engines
([0040](../decisions/0040-instants-and-times-are-read-to-the-shape-and-an-unedited-one-is-never-written.md)).
Lookup labels are not unique and not localised, and a key too long for a
token, or a boolean, time or timestamp key, cannot be offered as a lookup
(0012, 0028). A list has no total, and a row inserted before the offset
between two pages shows one row twice or skips one (0044). A form published
at 0.1.0 draws its lookups as plain selects until it is regenerated and
published again
([0066](../decisions/0066-a-lookup-a-person-can-search-is-generated-as-a-typeahead.md)).

**Writes.** On SQL Server, a table with an enabled INSTEAD OF trigger cannot
be written that way through the adapter, `returning` is the row before an
AFTER trigger changed it, and a trigger's `RAISERROR` refuses a write the
customer's own application lets commit (0017). An update trusts that the
identity is a key (0016), and every update reads the record first, one
extra query (0022). A delete cannot be undone here, and one refused because
other rows refer to the record names none of them (0050). A reference a
delete clears does not move the referring row's version column (0051).

**Access.** Roles and attributes are only as fine-grained as the host's
token ([0014](../decisions/0014-host-identity-is-verified-offline.md)).
Administration is one list of roles and, under review, a second for
publishers: everyone who may propose may also see every connection's
metadata ([0020](../decisions/0020-administration-is-a-separate-plane.md)).
A snapshot's capabilities are what was true at discovery, and a view is not
followed to its tables (0027). A record token tells anyone who may read the
record its key, whatever the policy says of the key's field
([0018](../decisions/0018-one-planner-turns-answers-into-requests.md)).
The reassigned-key check compares a publish with the version it replaces and
no other, and a key by the name of what it stands for, not its table
([0039](../decisions/0039-a-publish-says-what-happens-to-the-grants-of-reassigned-keys.md)).
Publication is reviewed only when `FORMANCY_DATA_PUBLISHER_ROLES` is set,
and a publisher restores any version alone
([0065](../decisions/0065-with-publisher-roles-set-a-draft-is-published-only-when-a-publisher-who-did-not-submit-it-approves-it.md)).
A client is its address, so people behind one NAT share a rate-limit
bucket, and nothing reports a trusted-proxy list too wide or too narrow
([0071](../decisions/0071-the-server-believes-the-forwarded-address-only-from-the-proxies-an-operator-names.md)).

**The host page.** `hasMore` and `omitted` do not reach the person, the
server's sentences are English, and "Load the saved record" discards the
draft ([0029](../decisions/0029-a-host-renders-a-published-form-through-one-client.md)).
A record is never in the page's address, and a reload or a closed tab does
not ask before leaving unsaved work
([0047](../decisions/0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md)).
There is no bulk delete and no undo
([0053](../decisions/0053-a-host-deletes-a-record-from-its-detail-or-its-row-after-a-confirmation-in-place.md)).
A page on another origin is answered only when its origin is listed
exactly, and a refused preflight reads to the page as an unreachable server
([0060](../decisions/0060-the-runtime-plane-answers-the-origins-an-operator-lists-and-the-administrators-plane-none.md)).
In Playwright's WebKit a pointer press on Save once sent nothing for a
reason not established, and since then no gate presses Save with a pointer
in any browser
([0058](../decisions/0058-the-browser-gates-run-in-chromium-firefox-and-webkit-and-each-fact-the-browsers-disagree-on-is-named-and-held.md)).

**The studio.** It has no list of published forms, its preview shows no
lookup options, and reloading it signs the administrator out
([0024](../decisions/0024-the-studio-speaks-only-the-admin-plane.md)).
A column rename loses its presentation overrides, a publish conflict is a
rebase rather than a merge, and anything outside the presentation edits is
refused at publish
([0030](../decisions/0030-presentation-is-a-patch-over-the-generated-base.md)).
A field moved to another section lands last in it, a section keeps one
field, a move a regeneration cannot carry is dropped and said, and a 0.1.0
server refuses a version holding a move
([0075](../decisions/0075-a-field-may-move-to-another-generated-section.md)).
What a delete also does is listed by foreign key only, never by trigger or
rule ([0052](../decisions/0052-the-studio-says-before-publication-who-may-delete-and-what-a-delete-also-does.md)),
and the Review step does not show what a draft changes from the version it
replaces (0065).

**The server.** Each request for the menu of forms reads and validates every
published form, with nothing cached
([0045](../decisions/0045-the-runtime-plane-lists-the-forms-a-person-may-read-and-nothing-about-the-others.md)).
The connection registry holds one pool per connection for the server's
lifetime, and adding a database is a reviewed file and a restart
([0019](../decisions/0019-a-published-form-is-checked-every-time-it-is-read.md)).
That every audited request writes exactly one event rests on Fastify's and
Node's behaviour as measured on one release of each
([0033](../decisions/0033-the-administrator-plane-is-audited.md)). Nothing
proves where a version file came from
([0062](../decisions/0062-a-published-version-moves-between-deployments-as-its-version-file.md)).
Nothing deletes a draft, and an approval and a rejection of one draft at
the same moment can both succeed (0065). A page of records has neither
cancellation nor a deadline (0061).

**Operations.** An upstream fix reaches an installation only in a release
of this module ([0002](../decisions/0002-depend-on-upstream-never-copy-it.md)),
and an image built within a day of an adopted upstream release skips
pnpm's release age for it
([0055](../decisions/0055-an-upstream-release-is-adopted-the-day-it-is-published.md)).
The file store serves one instance, and finding a form's newest version is
linear in its versions
([0013](../decisions/0013-published-configuration-is-files-with-link-based-swap.md)).
The composed stack is not a production deployment, and `down -v` destroys
its secrets with every token signed by the old key
([0032](../decisions/0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)).
Behind Cloudflare, the price of a tunnel with no inbound port, the edge
decrypts every request and answer, host tokens and record values included,
and the tunnel's login token is the operator's to revoke by hand
([0037](../decisions/0037-cloudflare-is-the-edge-not-the-runtime.md)).
Origins and trusted proxies are read at start, and a key set is read again
only on SIGHUP, which Windows cannot send
([0059](../decisions/0059-the-host-identity-key-is-a-set-selected-by-kid-and-read-again-on-sighup.md)).
A change to the default lookup deadline alone does not mark the published
figures stale
([0063](../decisions/0063-the-default-lookup-deadline-is-outside-the-measured-product.md)).

**What the tests do not reach.** The published figures describe one
machine, with no TLS and warm caches, and leave out tails under an arrival
rate, a page of records, the menu of forms and a delete (0034). The browser
gates run Playwright's builds headless on Linux, and WebKit there is not
Safari (0058). Docker Desktop, Windows and macOS are run by no gate (0032),
and nothing of the Cloudflare deployment has been measured through a real
tunnel (0037). That a host on `@formancy/*` 0.3.0 reads the generated forms
was measured by hand (0042). Most transient error codes are allowlisted from
documentation and provoked by no test (0028). The images are moving tags
(0035), and only the adapter suites and data-fixtures run on every image of
the matrix; every other suite runs the defaults alone (0067).

**Licence and notices.** See [§11.4](#114-the-release-gates-still-open) for
the licence itself. The `@formancy` scope mixes upstream's Apache-2.0
packages with this module's, so an audit reads each package's licence
([0001](../decisions/0001-a-paid-module-in-its-own-repository.md)). A
built app's notices are the texts each bundled package ships, and miss what
Vite folds in as text
([0046](../decisions/0046-a-built-app-carries-the-licence-and-notice-texts-of-everything-it-bundles.md)).
The apps bundle their fonts under the SIL Open Font License 1.1, and a
font fix reaches them only when the catalog's pins move
([0072](../decisions/0072-the-apps-serve-their-own-fonts-and-no-page-asks-another-host-for-anything.md)).
A release's SBOM names what cdxgen finds, which on 2026-10-09 left out
`tedious`, the package under `mssql` that speaks to SQL Server (0035). The
examples demo is the page as `main` holds it, deployed without waiting for
that commit's CI, and what it serves was read by hand once
([0069](../decisions/0069-the-examples-page-is-served-at-formancy-ai-data-examples.md)).

## 11.3 Filed defects, and what is not done yet

Filed in `docs/images/README.md`, because a picture is the product as it
is: fields read-only on update are drawn editable on a loaded record on the
host page, which the server refuses on save and which the runtime plane
gives the page no way to know; a restore's help line already names the
version after the one it made; a moved key's two column names are told
apart by a space set in proportional type; and the studio's preview loses a
field's required marker where the renderer cannot fill its options, which
is upstream's renderer and themes.

The README's *Status* paragraph names what is not there yet: figures for a
page of records, the menu of forms and a delete; a host page on another
origin run in a browser; a run through a real Cloudflare tunnel; anything
that reads what Cloudflare serves at the demo's address; and a licence a
lawyer has reviewed.

## 11.4 The release gates still open

`docs/release/gates.json` names each of the delivery plan's release gates
by number with its evidence, or the reason it has none, and every report
prints it ([0035](../decisions/0035-a-release-report-is-derived-from-the-run-that-gated-it.md)).
These have none:

- **Gate 8, an AI proposal workflow.** None is built; nothing exists to test.
- **Gate 10, legal review.** It needs people: a legal review of
  `LICENSE.md`, the dependency inventory and customer terms. The licence is
  in force without one, by decision, and says so at its top
  ([0048](../decisions/0048-the-licence-is-in-force-before-a-lawyer-has-read-it.md),
  [0054](../decisions/0054-version-1-1-names-the-address-for-a-redistribution-agreement-too.md)):
  where the free rights end and Production Use begins, what Redistribution
  covers and termination rest on terms no lawyer has read, which court the
  licence names is an open question, and no price is published.
  `scripts/licence-status.test.mjs` fails if the gate is given evidence
  while the licence says no lawyer has reviewed it.
- **Gate 12, design partners.** No design-partner acceptance has been run.

Gate 11 is stated by `docs/performance.md`, a document, and is shown as
stated, never as passed in a run.

## 11.5 Accepted architectural risks

Not debt: consequences of decisions made with the downside understood.

**Two adapters written by hand, forever.** Each engine's operations are its
own record, [0016](../decisions/0016-postgres-operations.md) and
[0017](../decisions/0017-sqlserver-operations.md), and `CLAUDE.md` prefers
that duplication to an abstraction over both: every operation is
implemented twice. The business model is written in two dialects
([0005](../decisions/0005-one-fixture-written-twice.md)), and every change
to it is made in both. Paid down by the shared cases, which make a
divergence a failed run rather than a discovery.

**Real databases in every run.** The cost of
[0003](../decisions/0003-real-databases-in-every-test-run.md): a cold run
takes minutes, a developer without Docker cannot run the adapter suites,
and a fast database-free suite is foreclosed.

**A paid module on upstream's releases.** The cost of 0001 and 0002: nothing
here may patch formancy, so a generic improvement the module needs waits
for upstream's contribution rules and its next release.

**Forms on spec 3.** The cost of 0042, bought so that a host on an older
renderer keeps reading generated forms: the format's newer features are not
used, and a whole-number field has no `step` to refuse a fraction with.

**Published configuration is files.** The cost of 0013 and 0062, bought
for no lock, no daemon and no second database: one instance, and a version
moves between deployments as a file whose keeping is the team's to secure.

**The audit trail is not evidence.** The cost of
[0023](../decisions/0023-the-audit-trail-is-operational-not-evidence.md)
and 0033: an event is written after the database or the store commits, by
another system, so a crash between the two loses it, and nothing stops a
privileged operator editing the log.

## 11.6 People and process

**One maintainer.** `GOVERNANCE.md` says plainly that Formancy Data has a
single maintainer, who is the final decision-maker on direction, releases,
licensing and roadmap and the rightsholder `LICENSE.md` names. Everything a
second person would otherwise carry in their head is meant to be in the
decision records, the register and this documentation; nothing makes that
true but the habit of writing them, and the architecture's guard holds its
names, links and paths, not its sentences
([0076](../decisions/0076-the-architecture-is-documented-as-arc42-and-every-change-updates-the-section-it-touches.md)).

**No check is mechanically required.** Every gate runs on every pull request
and fails a release, but `main` requires no status check, so what stops a
red pull request from being merged is the maintainer reading it
(`GOVERNANCE.md`; 0058 names `report` as the check to require if that ever
changes). That is repository configuration, and no file here can assert it.

**A merged branch is deleted by a repository setting** that nothing here
reads ([0036](../decisions/0036-a-merged-branch-is-deleted-by-the-merge.md)).

**The 0.1.0 release notes are a summary written by hand**; why each change
before it was made is in `CHANGELOG.md`, and nothing checks that the summary
says what those entries say
([0064](../decisions/0064-the-first-releases-notes-summarise-the-development-before-it.md)).

## 11.7 Work in progress, not on main

On 2026-10-17 these were on open branches or planned, and **none of it is
described here as done**: a live master-detail demo running the real server
and PostgreSQL in a Cloudflare Container; Azure SQL Database, which a
snapshot already names and calls not tested (0068); and Microsoft Entra
authentication to SQL Server. The numbers the decision index skips are
taken by records on those branches, each placed here when it merges.
