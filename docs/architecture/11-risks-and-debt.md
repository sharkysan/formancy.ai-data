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
One download reads every row a list would show the person
([0079](../decisions/0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md)): nothing they could not have, since a script holding their
token can page the list, but a stolen token reads a tenant's rows in one
request rather than fifty a request, and no policy lets a person browse
and not download -- only a proxy can drop the route, for everybody.
A state field's moves hold the runtime plane's writes and nothing else: a
create that leaves the field to its default, and a write by another
application or by SQL, move it unchecked, and a move is a pair of values
with no condition on anything else
([0112](../decisions/0112-a-policy-holds-a-state-field-to-the-moves-it-lists.md)).

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
again anyway" may make a duplicate. A chain of versions is kept whole only by
the runtime plane's writes: on PostgreSQL two creates of one chain at once
can both start it, two open versions, unless the table's own unique index
over the chain's key where the end is NULL refuses the second, and a write
by another application can leave a gap or an overlap
([0113](../decisions/0113-a-form-over-versions-changes-the-open-one-from-a-date.md)).

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
(0068). No test runs on Azure SQL Database or Azure SQL Managed
Instance, which a snapshot names and calls not tested, and every boxed SQL
Server edition is called tested on the strength of the Developer edition
on Linux in a container
([0073](../decisions/0073-azure-sql-is-not-tested-and-the-release-says-so.md)).
A SQL Server connection may log in as an Entra managed identity or
service principal, and no test logs in as either: a partner makes the
first successful login, and nothing shows a token refreshed, a pool
outliving its token or Azure SQL's resource passing the guard. Only the
public cloud is reached, only over TDS 8.0, which SQL Server 2019 and 2022
on Linux do not take, an Entra entry refuses a certificate the operator
must trust, a managed identity cannot log in where AKS workload identity
is turned on, a login refused after its pool opened is `unavailable` with
no reason in discovery's log line, and what @azure/identity reads from the
environment -- the region, the proxy, the log level, a managed identity's
platform -- is outside the reviewed allowlist
([0074](../decisions/0074-a-sql-server-connection-may-log-in-as-an-entra-principal-and-no-test-logs-in-as-one.md)).
A SQL login still goes over TDS 7. One that asks for TLS is refused before
its login is sent when the server's first answer says it will not
encrypt, by a stream of the adapter's own in front of tedious, written
against what tedious 20.3.3 uses of its socket: a tedious release could
break it, which the suites through it would show, and nothing would show
tedious fixing the downgrade itself. With the server's certificate
trusted, whoever answers can still complete TLS with a certificate of
its own, and a connection with TLS off sends its login unencrypted, by
the operator's choice
([0081](../decisions/0081-a-sql-login-that-asks-for-tls-is-refused-when-the-server-answers-that-it-will-not-encrypt.md)).
PostgreSQL 14 and older and SQL Server 2017 and older are not
images of the matrix, and on PostgreSQL 18 a cascaded table's AFTER DELETE
trigger runs with its owner's grants, so it does a delete 15 to 17 refuse
([0067](../decisions/0067-the-adapter-suites-run-on-every-image-of-a-per-engine-matrix.md)).
A NOT NULL that PostgreSQL 18 added NOT VALID is read as a nullable column
until it is validated, so a form generated over it may offer a create every
insert then refuses, and one published before the reading changed has its
page refused when its unique key covers such a column, and its update and
delete when its version column is one, until review
([0077](../decisions/0077-a-not-null-added-not-valid-is-read-as-the-unvalidated-check-it-is.md)).
Every lookup search reads every row its form's row filter admits: no
trigram index, prefix mode or minimum length ships, and the lookup deadline
caps how long a search runs, not how much it reads
([0034](../decisions/0034-performance-is-measured-through-the-shipped-server-and-held-without-a-clock.md),
[0061](../decisions/0061-a-lookup-statement-stops-when-its-request-is-abandoned-or-its-deadline-passes.md)).
The PostgreSQL adapter cancels a lookup through private properties of its
driver, so a driver upgrade that changes them fails its suite (0061).
postgres.js 3.4.9 places a statement's rows after empty slots when the one
before it on the connection ended part-way; the adapter collects its own
rows, and its catalog reads still take the driver's array
([0078](../decisions/0078-a-postgresql-statements-rows-are-collected-as-the-driver-reads-them.md)).
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
A whole-number field accepts a fraction in the browser and only the
server's codec refuses it: generated forms carry no `step`
([0118](../decisions/0118-generated-forms-move-to-spec-5-for-help-text-from-column-comments.md)). A field's help text is its column's comment, which drift
review does not compare, until the studio's Presentation step replaces or
removes it ([0119](../decisions/0119-a-fields-help-text-is-presentation-the-studio-edits.md)).
A client sends exact decimals as strings, and a value comes back
canonicalised to its column's scale
([0008](../decisions/0008-exact-values-travel-as-strings.md)). An instant
is shown to the second and a time to the minute on both engines
([0040](../decisions/0040-instants-and-times-are-read-to-the-shape-and-an-unedited-one-is-never-written.md)).
Lookup labels are not unique and not localised, and a key too long for a
token, or a boolean, time or timestamp key, cannot be offered as a lookup
(0012, 0028). A list has no total and is walked a page at a time, never
jumped to; a page continues after where its row is now, so that row edited
between two pages in a sorted column moves the next page with it, and that
row deleted starts the grid again at its first page
([0108](../decisions/0108-a-forms-list-pages-after-the-last-row-it-showed-found-again-by-its-key.md)).
A browse still pages by offset, and a row inserted before its offset between
two pages shows one row twice or skips one (0044, 0099). A form published
at 0.1.0 draws its lookups as plain selects until it is regenerated and
published again
([0066](../decisions/0066-a-lookup-a-person-can-search-is-generated-as-a-typeahead.md)).
A file of records is not the table at one moment: the row a page continues
after, deleted meanwhile, refuses the file, and so does a record whose
sorted column moved it past that row (0108).
A text cell that starts as a formula, or with an apostrophe, carries one
apostrophe the database does not hold; on SQL Server text UTF-8 cannot
carry refuses the whole file, and so, on either engine, does a lookup
whose key is too long for a token, a row the grid shows; a header can
repeat a label; and what a
spreadsheet shows of the file -- its byte-order mark, a `;` locale, 17
digits -- was not tried ([0079](../decisions/0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md)).
A filter's conditions are joined by AND, one per field, with no OR, no
"not equal", no "starts with" and no range over text; a float and a time
are filtered by NULL alone, a timestamp by whole days, and a lookup field
not at all.
Equality on text is exact on both engines, so `muster ag` does not find
`Muster AG` under a case-insensitive collation, where `contains` does. An
instant's range is whole days of UTC, which is shifted for a person in
another zone; a range to 9999-12-31 has no upper end, and on PostgreSQL
holds a timestamp after that year; a decimal with more fraction digits
than its column holds is refused, not rounded; and what a filter costs on
a large table is not measured
([0104](../decisions/0104-a-list-and-a-browse-are-filtered-by-conditions-on-their-columns.md)).
A list view an administrator named is only what a person could have built,
so no view is relative to the day or the person; it is the same for every
person who may read its fields and kept to no role, and the host keeps a
picked one in the viewer's browser alone (0106). A person who may not read a field a view
names is not offered it; a stored view a later release no longer runs is
not offered either, and nothing says so until a publish refuses it
([0105](../decisions/0105-a-forms-list-offers-views-its-administrator-named.md)).
A grid's columns, sort and view are kept by the viewer's browser, not the
person: they follow nobody to another device, everybody signed in on one
browser shares them, every child section of one form under one field
shares one arrangement, and a person's own filter conditions are never kept; a
hidden column is still read, and its width is still its content's
([0106](../decisions/0106-a-hosts-grid-keeps-its-columns-sort-and-view-in-the-viewers-browser.md)).
Duplicate record copies a record alone, never its child rows, and is
offered on the record and not on a child row or a level below it; every
column of a key is left out of a copy, a part a person would keep
included; and a copy holds what a read returns, an instant to the second
and a time to the minute
([0107](../decisions/0107-a-record-is-duplicated-into-a-new-one-of-the-fields-the-server-names.md)).

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
A holder of a role `FORMANCY_DATA_BROWSE_ROLES` names reads every row the
connection's account can read, with no form or policy between; each page
discovers the scope again, unmeasured, and a view's rows equal in every
shown column may trade places between pages
([0099](../decisions/0099-a-browse-role-reads-any-table-or-views-rows-as-the-connections-account-does.md)).
A client is its address, so people behind one NAT share a rate-limit
bucket, and nothing reports a trusted-proxy list too wide or too narrow
([0071](../decisions/0071-the-server-believes-the-forwarded-address-only-from-the-proxies-an-operator-names.md)).

**The host page.** The server's sentences are English, and "Load the
saved record" discards the draft
([0029](../decisions/0029-a-host-renders-a-published-form-through-one-client.md)).
A lookup's list says that more rows match, never how many, and in a
typeahead it says so only while the list is open, on a line every
reference theme of formancy 0.6.0 to 0.11.0 draws the open list over: a screen
reader hears it, the eye does not
([0085](../decisions/0085-a-lookup-says-when-its-list-goes-on-never-how-long-it-is.md)).
A form the person may only read, chosen with no record open, holds each
renderer's empty form hidden, whose lookups each ask for their first page
(found while 0085 was written, and not changed by it).
A record is never in the page's address, and a reload or a closed tab does
not ask before leaving unsaved work
([0047](../decisions/0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md)).
There is no bulk delete and no undo
([0053](../decisions/0053-a-host-deletes-a-record-from-its-detail-or-its-row-after-a-confirmation-in-place.md)).
Download CSV drops a file in the making when the person leaves the form or
signs out, and a child section's when they open another record, says
nothing about it, names no count of records, and says the page handed the
file over, not that the browser kept it; its save is
measured in Playwright's three browsers and nowhere else
([0080](../decisions/0080-a-host-downloads-the-records-its-grid-lists-and-the-browser-saves-the-servers-file.md)).
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
replaces (0065). The Browse step follows a row only through foreign keys
over key kinds -- not a timestamp, a boolean or binary -- whose columns the
account may read at both ends, both in the approved schemas, and onto a
table it can see; the rest are named, a key with a NULL in it follows
nothing, and a relationship the catalog does not declare is not offered. A
follow compares with the database's equality, as the key does, so under a
case-insensitive collation it finds what the key matches. Following what
refers to a row may read the whole referring table, since neither engine
indexes those columns by itself, unmeasured; the step offers what its own
discovery holds, which the server plans again and may refuse; the trail is
lost on a reload; and the audit names the object followed to, never the
values
([0103](../decisions/0103-a-browsed-row-follows-its-foreign-keys-either-way.md)).

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
cancellation nor a deadline (0061). A file of records is refused past
16 MiB or 30 s, a budget and a derivation from nginx's default read
timeout, and one is made at a time per allowlisted connection in each
process; on PostgreSQL a page past nginx's 60 s gets the person a 504
while the server makes the file for nobody, and a page still running after
its export was refused or left keeps that connection's gate, every other
export through it refused `export-busy` until the statement returns
(0079).

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
Nothing refuses a release whose figures were measured on an earlier
product: the performance page names the commit it measured, the version's
changelog section says so by review alone, and the default lookup deadline
stays what the older figures derived until somebody measures again
([0084](../decisions/0084-a-release-does-not-wait-for-the-performance-figures-to-be-measured-again.md)).
The studio's and the host page's Content-Security-Policies are sent by the
composed stack's nginx; a deployment's own proxy sends them only if it
copies them, nothing reads what it sends, and a host page on an origin of
its own needs a `connect-src` the composed policy refuses. The host page's
allows inline styles, for AG Grid's style elements, until a nonce per
response or AG Grid's legacy stylesheets take their place, neither of them
measured; and a script element an extension or a proxy writes into either
page is refused, which only the console says
([0083](../decisions/0083-the-studio-and-the-host-page-are-served-under-a-content-security-policy-each.md)).

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
the matrix; every other suite runs the defaults alone (0067). Why two
SQL Server 2025 containers stopped before they were ready on CI on
2026-10-17 is not known: a start that fails so now says how Docker says
it ended, no container's memory is bounded, and the job still fails until
it is rerun
([0082](../decisions/0082-a-sql-server-container-that-never-becomes-ready-says-how-it-ended-and-is-given-no-memory-bound.md)).

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
A release's SBOM is the inventory of a consumer's install of its tarballs
on the day: a runtime dependency may be newer than the suites ran, which
the release body says, and packages of types alone and the peers are not
in it
([0092](../decisions/0092-the-sbom-describes-what-a-consumer-installs-and-is-held-to-that-install.md)). The
examples demo is the page as `main` holds it, deployed without waiting for
that commit's CI, and what it serves was read by hand once
([0069](../decisions/0069-the-examples-page-is-served-at-formancy-ai-data-examples.md)).

**The live demo.** Accepted rather than fixed, for a demo that is not a
deployment of the product: it costs the rightsholder money while anybody
uses it, bounded only by its cap, and one visitor can take every place;
every change goes when a visitor's container sleeps or a deploy changes the
image; it shows PostgreSQL alone; Cloudflare runs its code on formancy.ai's
zone and holds what a visitor types until their container stops; the
cookie is the container's credential; with observability off a failed start
leaves no kept log, only a line in the Worker's live log for whoever tails
it then
([0086](../decisions/0086-a-failed-start-of-the-live-demo-says-why-in-the-workers-live-log.md));
its page allows inline styles for AG Grid; and its lookup
deadline is four times the product's default, for a quarter of a CPU. What
no gate reaches: the Durable Object's code on Cloudflare, what the cap
answers, how long a container outlives its visitor, a start's time there,
and the page in Firefox and WebKit
([0070](../decisions/0070-the-live-demo-runs-the-real-server-and-postgresql-in-a-cloudflare-container-of-each-visitors-own.md)).

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
that reads what Cloudflare serves at the examples page's address; the live
demo's Worker, which nobody has created, and anything read of the demo on
Cloudflare; and a licence a lawyer has reviewed.

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

**Forms on spec 5.** The cost of 0118, bought for a field's help text from
its column's comment: a host whose renderer is older than `@formancy/*`
0.8.0 refuses every form published since, and a deployment rolled back
before 0118 refuses them too until an earlier version is restored. A
whole-number field still has no `step` to refuse a fraction with.

**Published configuration is files.** The cost of 0013 and 0062, bought
for no lock, no daemon and no second database: one instance, and a version
moves between deployments as a file whose keeping is the team's to secure.

**The audit trail is not evidence.** The cost of
[0023](../decisions/0023-the-audit-trail-is-operational-not-evidence.md)
and 0033: an event is written after the database or the store commits, by
another system, so a crash between the two loses it, and nothing stops a
privileged operator editing the log.

**A file of records read a page at a time, not in one snapshot.** The cost of
[0079](../decisions/0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md), bought to keep every statement a guarded list page (0015) and
no transaction across pages, which would hold a connection and VACUUM's
horizon on PostgreSQL, and needs a database setting or blocks writers on
SQL Server. Since
[0108](../decisions/0108-a-forms-list-pages-after-the-last-row-it-showed-found-again-by-its-key.md)
each page continues after the last row of the one before, so a page in key
order reads from that row and a row inserted or deleted before it moves
nothing; a row whose sorted column moves it past that row between two
pages is shown twice, which refuses the file `moved`, or skipped unseen,
and an order no index serves still reads every admitted row for each
page.

**One verifier, two products, two installs.** The cost of
[0091](../decisions/0091-the-host-identity-verifier-is-a-package-of-its-own-which-the-server-re-exports.md),
bought so that a product verifying the server's tokens runs the server's
code without the server: the two share the code, not the release. Each
verifies under the `@formancy/data-identity` it installed, a fix reaches
the other only when it moves to that release, and nothing here can see
the other product's. Two import paths name the one verifier, and the
server's stays while anything imports it from there.

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

**The host page's suite is the longest a pull request waits for.** Each of
its page tests mounts both renderers against the real server on both
engines, so the suite grows by minutes with a feature: 1292 s under
coverage on 2026-10-28, its job 22 minutes. The job's limit was raised
from 25 to 40 minutes (`.github/workflows/gates.yml`) rather than the suite
split across runners, which is the next step when that is not enough.

**A merged branch is deleted by a repository setting** that nothing here
reads ([0036](../decisions/0036-a-merged-branch-is-deleted-by-the-merge.md)).

**The format is remembered by commit.** `.git-blame-ignore-revs` names the
commits that formatted the code by their SHAs, so the pull request that
brings them merges with a merge commit, which the repository allows
beside a squash and a rebase and nothing makes it choose. A branch begun
before the format conflicts with it;
`node "$MAIN/scripts/prettier-merge.mjs" origin/main`, in the branch's
worktree, `$MAIN` a checkout of main at least as new as the `origin/main`
it merges with `pnpm install` run there, merges main into it with each
side formatted first. What both sides changed, and code main moved to
another file, are still the branch's to carry across by hand
([0116](../decisions/0116-every-typescript-and-javascript-file-is-linted-and-formatted-by-the-rules-the-four-repositories-share.md)).

**The 0.1.0 release notes are a summary written by hand**; why each change
before it was made is in `CHANGELOG.md`, and nothing checks that the summary
says what those entries say
([0064](../decisions/0064-the-first-releases-notes-summarise-the-development-before-it.md)).

## 11.7 Work in progress, not on main

On 2026-10-17 nothing this documentation describes was on an open branch:
the live master-detail demo and Microsoft Entra authentication to SQL
Server, which this section named, have merged and are described where
they belong, and the decision index skips no number. Work on an open
branch is named here while it is open, and taken out when it merges.
