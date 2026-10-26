# 8. Cross-cutting concepts

Concepts that appear in more than one package, and that a reader needs in
order to follow any of them. Each says which record decided it and what
fails when it stops being true; where nothing fails, it says that instead.

## 8.1 Exact values, and the codecs that hold them

A value is never carried by a JavaScript `Number` or a driver's date that
could change it ([0008](../decisions/0008-exact-values-travel-as-strings.md)).
`codecFor(column)` in `packages/data-core/src/codecs/` validates and
canonicalises one API value from metadata alone. Decimals are strings only,
canonical as the database returns them -- `12.5` into `numeric(14,2)` is
`12.50` -- and never rounded: an extra digit either side of the point is
refused, because a rounding applied silently is how a ledger stops
balancing. Integers may be numbers while they are safe, canonical strings
otherwise. Null is a value only for a nullable column, and an empty string
is never null. Both adapters read an instant to the second and a time to the
minute, cut, and never write back one the person did not edit
([0040](../decisions/0040-instants-and-times-are-read-to-the-shape-and-an-unedited-one-is-never-written.md)).

**Where the engines disagree, the fact is named in the snapshot, not smoothed
over in the core**
([0026](../decisions/0026-name-every-column-fact-the-engines-disagree-on.md)):
what a text column's length counts, and the codec counts in that unit;
whether a binary column pads; which kind of identity numbers a key; whether
a check is enforced. A row filter compares the column's canonical value
exactly, so case, accents and trailing spaces count on both engines
whatever the collation
([0028](../decisions/0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md)).
A key the database fills is never written by a form unless the person gives
another part of it
([0056](../decisions/0056-a-key-the-database-fills-is-never-written-and-a-uuid-is-ordered-as-each-engine-orders-it.md),
[0057](../decisions/0057-a-key-of-one-column-filled-by-a-never-repeating-default-counts-as-numbered.md)).

**The browser checks what the server checks.** A decimal is generated as a
`text` field whose pattern encodes its precision and scale, which formancy's
engine checks identically in the browser and in its server replay
([0009](../decisions/0009-generation-is-deterministic-and-says-what-it-chose.md));
generated forms stay on spec 3, since spec 4 brought no exact-decimal type
([0042](../decisions/0042-generated-forms-stay-on-spec-3-after-spec-4-is-released.md)).
The adapters bind values from the text a codec returned and read them as
text converted in SQL, never through the driver's number or date handling
([0015](../decisions/0015-a-record-operation-is-one-guarded-statement.md),
[0016](../decisions/0016-postgres-operations.md),
[0017](../decisions/0017-sqlserver-operations.md)).

**A file of records holds the read's values as text.** Each cell is the
canonical value a read returns, written by `exportText`
(`packages/data-core/src/records/export.ts`): `displayText`'s spelling,
one for both engines, except a time and a timestamp, written as read, so a
zoneless timestamp keeps the fraction a label drops; 2^53 + 1 and the
largest `numeric(18,4)` digit for digit; NULL an empty cell and `''` as
`""`. A cell a spreadsheet would read as a formula carries one apostrophe
in front, and so does one that starts with an apostrophe, so the rule is
undone exactly; the shared case `export: shipments` holds the bytes on
both engines ([0079](../decisions/0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md)).

**Held by** `packages/data-core/src/codecs/codec.test.ts` -- the fixture's
largest `numeric(18,4)` and an integer past 2^53 survive as strings, and a
JSON number for a decimal is refused -- and by both adapters' record suites
against real servers, which read every edge value of the fixture back
exactly ([0003](../decisions/0003-real-databases-in-every-test-run.md),
[0005](../decisions/0005-one-fixture-written-twice.md)).

**What it costs.** A client must send decimals as strings, which an ordinary
JSON client does not do by default. The browser's `maxLength` is looser than
a UTF-8 `varchar`, so that rule is checked on the server only, and so is an
integer's whole-ness (0009). Every read converts every column to text in
SQL, which is slower than letting the driver parse.

## 8.2 Fail closed

Upstream's rule is to fail open on metadata and closed on validation
([formancy.ai 0022](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0022-fail-open-fail-closed.md)).
Here, what decides whether a value reaches a database, or a row reaches a
person, is validation in that sense: a check that cannot answer refuses.

| Where | When it cannot answer | Record | Held by |
|---|---|---|---|
| A policy context without its tenant | a refusal, never a shorter filter | [0011](../decisions/0011-every-operation-carries-a-trusted-policy-context.md) | `packages/data-core/src/policy/evaluate.test.ts` |
| A field nobody granted | readable and writable by nobody | [0011](../decisions/0011-every-operation-carries-a-trusted-policy-context.md) | the same |
| A lookup that cannot answer | the save is refused | [0012](../decisions/0012-a-lookup-token-is-a-reference-not-a-permission.md), [0022](../decisions/0022-the-runtime-plane-asks-the-policy-every-time.md) | `routes/runtime.test.ts` |
| A lookup past its deadline | 503, the statement stopped in the database | [0061](../decisions/0061-a-lookup-statement-stops-when-its-request-is-abandoned-or-its-deadline-passes.md) | `routes/runtime-lookup-limits.integration.test.ts` |
| A catalog the account cannot fully see | a gap in the snapshot, never "no relationships" | [0004](../decisions/0004-a-snapshot-says-what-it-could-not-see.md), [0027](../decisions/0027-a-snapshot-says-what-its-account-may-do.md) | `packages/data-core/src/snapshot.test.ts`, `packages/data-fixtures/src/conformance.test.ts` |
| A form with no proof against lost updates | create-only, saying why | [0009](../decisions/0009-generation-is-deterministic-and-says-what-it-chose.md) | `packages/data-core/src/generate/generate.test.ts` |
| A published bundle, on every read | refused with a reason unless it validates | [0019](../decisions/0019-a-published-form-is-checked-every-time-it-is-read.md) | `bundle.test.ts` |
| Drift that blocks an operation | 409 `drift`, nothing written | [0041](../decisions/0041-the-runtime-refuses-what-drift-blocks.md), [0010](../decisions/0010-drift-is-classified-against-the-bindings.md) | `routes/runtime-drift.integration.test.ts` |
| A grant whose key now names another column | 422 `keys-reassigned`, nothing written, until someone decides | [0039](../decisions/0039-a-publish-says-what-happens-to-the-grants-of-reassigned-keys.md) | `routes/admin-keys-reassigned.integration.test.ts`, `routes/admin-evolution.test.ts` |
| A route with no audit name | its registration throws, or 500 `unaudited-route` | [0033](../decisions/0033-the-administrator-plane-is-audited.md) | `routes/admin-audit.test.ts` |
| A write whose answer was lost | unknown, never refused, never replayed | [0031](../decisions/0031-an-answer-lost-after-a-write-is-unknown.md) | `e2e-lost-answer.integration.test.ts` |
| A SQL Server that answers a SQL login asking for TLS that it will not encrypt, or with an answer that is not a PRELOGIN response | the connection ends before the login is sent, 503 | [0081](../decisions/0081-a-sql-login-that-asks-for-tls-is-refused-when-the-server-answers-that-it-will-not-encrypt.md) | `packages/data-sqlserver/src/encryption.test.ts`, `routes/unencrypted.integration.test.ts` |
| A file of records that cannot be made whole -- past its byte budget or its deadline, rows that moved between pages, text UTF-8 cannot carry, labels that cannot be loaded | a JSON refusal and nothing of the file, never a shorter file sent as whole | [0079](../decisions/0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md) | `routes/runtime-exports.test.ts`, `packages/data-client/src/transport.test.ts` |
| A setting nobody could have meant | the process stops, naming it | [0059](../decisions/0059-the-host-identity-key-is-a-set-selected-by-kid-and-read-again-on-sighup.md), [0060](../decisions/0060-the-runtime-plane-answers-the-origins-an-operator-lists-and-the-administrators-plane-none.md), [0071](../decisions/0071-the-server-believes-the-forwarded-address-only-from-the-proxies-an-operator-names.md) | each setting's test |

Test paths without a package are under `packages/data-server/src/`.

**What it costs.** Closed is visible as refusal. A form is blocked by a gap
until an administrator reviews it, though reads might have worked; a lost
answer is "it may have been saved" where nothing was stored, which 0031
lists; a field a regeneration adds is invisible until it is granted (0011).

## 8.3 Identifiers from approved metadata, values bound

Neither the browser nor a form document ever supplies SQL or a raw identifier
to execute. A lookup's configuration is derived from the form's bindings and
their snapshot, checked by fingerprint, so every identifier an adapter
quotes is approved metadata
([0012](../decisions/0012-a-lookup-token-is-a-reference-not-a-permission.md));
a row filter reaches an adapter as a column it quotes and a value it binds,
never as a predicate
([0011](../decisions/0011-every-operation-carries-a-trusted-policy-context.md));
and a form names a connection only by an id the allowlist holds
([0019](../decisions/0019-a-published-form-is-checked-every-time-it-is-read.md)).

**The adapter quotes, one part at a time**, never with a helper that splits
on dots ([0015](../decisions/0015-a-record-operation-is-one-guarded-statement.md)):
`quoteIdentifier` in `packages/data-postgres/src/sql/identifiers.ts` doubles
double quotes and refuses a name PostgreSQL would truncate into another
table's; `quoteName` in `packages/data-sqlserver/src/sql/quote.ts` brackets
and doubles `]`, as QUOTENAME does. A name no catalog could hold is thrown
before any SQL is built. On PostgreSQL every function, operator, type and
collation is qualified in `pg_catalog`, because an object planted on the
search path changed answers until it was
([0016](../decisions/0016-postgres-operations.md)); on SQL Server, what takes
no parameter -- a decimal's precision and scale, a sort direction -- is
spliced only after it is checked
([0017](../decisions/0017-sqlserver-operations.md)).

**Held by** the adapters' suites against real servers: on PostgreSQL a
table name holding a dot and a column name holding quotes are quoted, and
planted objects change no answer; on SQL Server a tampered precision or sort
direction is refused without its injected insert running (0016's and 0017's
*Verified by*). Both write and read `sales.order`, whose name is a reserved
word. That no function building SQL from an outsider's string merges is
held by review.

## 8.4 Secrets, handled once

**Nothing in a package reads configuration.** An adapter takes a connection
its own package opened, `connectPostgres` or `connectSqlServer`, from its own
copy of its driver ([0025](../decisions/0025-each-adapter-owns-its-driver.md)).
The composition root, `packages/data-server/src/main.ts`, reads every
setting, and names a secret by a reference, `env:NAME` or
`file:/absolute/path`, which `resolveSecret`, from
`@formancy/data-identity` ([0091](../decisions/0091-the-host-identity-verifier-is-a-package-of-its-own-which-the-server-re-exports.md)), resolves without ever
repeating the reference's value. Section 7 has the settings. A service
principal's client secret is such a reference, and an Entra login's
failure is a sentence with at most Entra's AADSTS code: the credential's
guard keeps nothing of what Entra answered, so no error in the chain
holds a tenant, a client, a trace id or a secret. A secret file that
cannot be read is named in the log line that says its connection could
not be opened, as a password's is: the path is the allowlist's, and what
the operator fixes
([0074](../decisions/0074-a-sql-server-connection-may-log-in-as-an-entra-principal-and-no-test-logs-in-as-one.md)).

**A password crosses the network only as its entry says.** A SQL login to
SQL Server with TLS on goes over TDS 7, whose PRELOGIN and its answer cross
in the clear, and tedious starts TLS only when the answer says ON or REQ.
So the adapter opens those connections itself (`encryption.ts`) and puts
a stream in front of each that withholds the server's first answer until
it has read it: OFF or NOT_SUP, or an answer it cannot read, ends the
connection before the LOGIN7, the password in it, is sent, in a fixed
sentence naming nothing of the login, and whoever answered in the
server's place hears nothing more. An Entra login is TDS 8.0, TLS first
(0074). A connection the operator set unencrypted sends its login
unencrypted, and one whose certificate the operator trusts is checked for
TLS, not for whom it is with
([0081](../decisions/0081-a-sql-login-that-asks-for-tls-is-refused-when-the-server-answers-that-it-will-not-encrypt.md)).

**What stays out of logs and answers**: a token, since errors carry jose's
code and never the token
([0014](../decisions/0014-host-identity-is-verified-offline.md)); a driver's
message, which names hosts, ports and logins, since an unreachable database
is 503 with a sentence and the detail goes to the operator's log
([0020](../decisions/0020-administration-is-a-separate-plane.md)); and a
connection string pasted where a name goes, since the request log names
routes, never the path, query or Host header as sent
([0033](../decisions/0033-the-administrator-plane-is-audited.md)).

**Held by** `packages/data-identity/src/secrets.test.ts`; by
`connections.test.ts`, `routes/admin.test.ts`,
`routes/entra.integration.test.ts`, `routes/unencrypted.integration.test.ts`
and `server-log.test.ts` in `packages/data-server/src/`; by
`packages/data-sqlserver/src/entra.test.ts` and `encryption.test.ts`, and by the
getting-started gate, which fails when a secret or a token reaches any log
of the composed stack
([0032](../decisions/0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)).
That no package reads the environment is held by review.

## 8.5 Identity, policy and row filters

**Who is asking comes from a signature.** The host signs a short-lived JWT,
and the server verifies it offline, the algorithm pinned, building the
identity from exactly the claims the operator mapped
([0014](../decisions/0014-host-identity-is-verified-offline.md)), in the
one spelling the host signed, base64url without padding
([0101](../decisions/0101-a-host-token-is-refused-unless-it-is-its-compact-form-exactly.md)); a key set
is selected by `kid` and read again on SIGHUP, and nothing is fetched
([0059](../decisions/0059-the-host-identity-key-is-a-set-selected-by-kid-and-read-again-on-sighup.md)).

**What they may do is a `FormPolicy`**, kept apart from the form and its
bindings, read with a `PolicyContext` the host builds from that identity and
never from request input
([0011](../decisions/0011-every-operation-carries-a-trusted-policy-context.md)).
Deny by default: a field with no entry is nobody's, roles match as exact
strings, and there is no wildcard. A row filter is an equality between a
column from approved metadata and an attribute of the context, and a missing
attribute is a refusal. A pinned column is written from the context, and a
submitted value for it is over-posting. `validatePolicy` refuses a policy
that does not fit its form.

**The policy is asked on every request**, nothing cached per actor, and only
an echo it can prove harmless is removed from a submission
([0022](../decisions/0022-the-runtime-plane-asks-the-policy-every-time.md)),
or one the record moved since the version the person sent, which the
guarded statement then answers stale
([0098](../decisions/0098-an-echo-the-record-moved-since-it-was-read-is-a-stale-save.md)).
The same scoping reaches every operation: a lookup token is a reference,
never a permission
([0012](../decisions/0012-a-lookup-token-is-a-reference-not-a-permission.md));
a child form's rows are reached only through a parent its policy admits
([0043](../decisions/0043-a-child-forms-rows-are-reached-only-through-a-parent-its-policy-admits.md));
a page of records is listed under the read policy
([0044](../decisions/0044-a-forms-records-are-listed-a-page-at-a-time-under-its-read-policy.md));
the menu names only the forms a person may read
([0045](../decisions/0045-the-runtime-plane-lists-the-forms-a-person-may-read-and-nothing-about-the-others.md));
a delete reaches other tables only through foreign keys the policy names
([0051](../decisions/0051-a-delete-reaches-other-tables-only-through-foreign-keys-the-policy-names.md)).
Administration is a separate plane held by a role in the same token, and a
form's policy never grants it
([0020](../decisions/0020-administration-is-a-separate-plane.md)).

**Held by** `packages/data-core/src/policy/evaluate.test.ts` and
`validate.test.ts` beside it; `packages/data-identity/src/identity.test.ts`;
and `packages/data-server/src/e2e.integration.test.ts`, where on both
engines another tenant can neither read the order nor pick its customer.

**What it costs.** Equality is all a row filter can say: "a manager sees
their team's orders" is not expressible. A host that builds the context from
a request body defeats all of it, and no test here can notice.

## 8.6 Optimistic concurrency and write ids

**A record operation is one guarded statement**, never retried
([0015](../decisions/0015-a-record-operation-is-one-guarded-statement.md)).
An update names the key, the trusted filters and the expected version in one
`WHERE` and increments a version column in the same statement, so nothing
can change between check and write; a stale version is 409 `stale`, and a
record outside the filters is `not-found`, exactly as a missing one. Update
is offered only with proof against lost updates, a `rowversion` or a version
column the request confirms
([0009](../decisions/0009-generation-is-deterministic-and-says-what-it-chose.md)),
and a delete names the version its person read
([0050](../decisions/0050-a-record-is-deleted-one-at-a-time-by-its-token-and-the-version-its-person-read.md)).

**An answer lost after a write is unknown** at every layer, and nothing here
sends the write again
([0031](../decisions/0031-an-answer-lost-after-a-write-is-unknown.md)): the
server answers 502 `unknown-outcome`, naming what was addressed, and
`@formancy/data-client` treats a write as known only when the data server
says what happened. The client sends a new `formancy-write-id`
(`WRITE_ID_HEADER` in `data-core`) with every create and update, and the
server acts on an id once per person, form and operation, so a browser's own
resend gets the first sending's answer
(`packages/data-server/src/routes/write-once.ts`). nginx passes `/v1/` with
`proxy_next_upstream off`, so the proxy never sends a write twice either.

**Held by** both adapters' record suites, where two concurrent updates with
one version give one winner and one `stale`;
`packages/data-server/src/e2e-lost-answer.integration.test.ts`, release gate
6, which fails if anything replays a write; `write-once.test.ts` and
`runtime.test.ts` in `packages/data-server/src/routes/`; and the host page's
browser gate, which names what each browser does with a lost POST as a fact
([0058](../decisions/0058-the-browser-gates-run-in-chromium-firefox-and-webkit-and-each-fact-the-browsers-disagree-on-is-named-and-held.md)).

**What it costs.** It over-reports: several failures read as "it may have
been saved" where nothing was. The write id holds in one process, so a
resend that reaches another replica, or this one after a restart, is applied
again, and a create whose key the database numbers cannot be reconciled.

## 8.7 Audit

**One event per request, on both planes, through one set of hooks**,
`auditRequests` in `packages/data-server/src/audit.ts`
([0023](../decisions/0023-the-audit-trail-is-operational-not-evidence.md),
[0033](../decisions/0033-the-administrator-plane-is-audited.md)): the actor,
the operation, the form, the published version, the status and the outcome
code, and never a value. A record is named only by a keyed hash of its token
under the audit key, and is `null` without one. A connection is recorded only
when the allowlist knows it, and a form id only when it has the store's
shape. A route registered without an audit name stops its registration, and
one registered above the hooks is refused 500 `unaudited-route`. A sink that
throws is logged and does not fail the request. A runtime event carries
`rows`: for an `export`, the records its file held, or held when it was
refused, and `null` for every other operation -- a count, never which
([0079](../decisions/0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md)).
An administrator event carries `object`: for a `browse`, the table or view
it read as `schema.name`, once the server's snapshot holds it, and `null`
for every other operation -- never the search or a row
([0099](../decisions/0099-a-browse-role-reads-any-table-or-views-rows-as-the-connections-account-does.md)).

**It is operational, not evidence.** The event is written after the commit,
by another system: a crash between the two loses it, and whoever runs the
log can edit it. A customer who needs tamper-evident audit needs a
transactional outbox of their own. **Held by** `routes/runtime.test.ts` ("the
operational audit trail"), `routes/admin-audit.test.ts` and `audit.test.ts`
in `packages/data-server/src/`.

## 8.8 Errors are fixed sentences

A refusal has a stable code for a program and a sentence a person can be
shown, and the sentence is the server's own
([0015](../decisions/0015-a-record-operation-is-one-guarded-statement.md),
[0022](../decisions/0022-the-runtime-plane-asks-the-policy-every-time.md)).
`RuntimeRefusal` in `packages/data-core/src/runtime.ts` is the one shape, and
`packages/data-server/src/routes/runtime-errors.ts` maps each code to one
status and one fixed sentence, by field where the engine names a column the
form binds. An adapter's message names an error code and the constraint or
column, never the database's own text, which can quote the value, as
PostgreSQL's "Key (id)=(42) already exists" does
(`packages/data-postgres/src/records/errors.ts`) and SQL Server's messages
do ([0017](../decisions/0017-sqlserver-operations.md)). Both engines are held
to one set of failure codes, so a form says the same whichever refused.

**The sentence says what is safe next.** A refusal with no code of its own is
`refused`, 422, "Sending it again will be refused the same way", and
`unavailable` means only what passes
([0028](../decisions/0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md));
an unknown write says whether saving again is safe (0031); a bad setting
stops the process naming the entry by its place, never repeating it (0060,
0071). **Held by** `packages/data-server/src/routes/runtime.test.ts`, where
codec errors and database refusals reach the person by field and never
repeat a value, and the shared refusal expectations in
`packages/data-fixtures/src/parity.ts`, which both adapters' parity suites
run.

## 8.9 The user interface: formancy.ai's concept, applied

The three apps apply formancy.ai's concept; `CLAUDE.md`'s section on the
user interface is the rule, and this is what each part of it rests on.

- **The same room**: a dark bench, glass panels, violet for what the person
  acts on and teal for what the server did, in the admin's palette,
  `@formancy/themes/room.css`, which every app imports from the formancy
  release this repository pins (formancy.ai 0178,
  [0096](../decisions/0096-the-apps-wear-formancys-room-css-rather-than-a-copy-of-admin-css.md)). The studio edits presentation, a patch over the generated base
  ([0030](../decisions/0030-presentation-is-a-patch-over-the-generated-base.md)),
  with controls of its own over `@formancy/builder-core`'s session, so it
  loads no `workbench.css`
  ([0024](../decisions/0024-the-studio-speaks-only-the-admin-plane.md)).
  `scripts/palette.test.mjs` fails when an app reads the palette without
  importing it, or declares one of its variables again; what a moved colour
  does to contrast is the browser gates' axe rules' to find.
- **The room's own faces**: Fontsource's packages at the release
  formancy.ai installs, bundled into each app, so no page asks another
  host for anything
  ([0072](../decisions/0072-the-apps-serve-their-own-fonts-and-no-page-asks-another-host-for-anything.md)):
  `scripts/no-other-host.test.mjs` and the browser gates; review holds the
  pins to upstream's.
- **Forms on white paper, in a shipped theme**, through `@formancy/react` or
  `@formancy/angular`: side by side on the examples page
  ([0021](../decisions/0021-generated-forms-preview-in-both-frameworks.md)),
  and on the host page through one client of the runtime plane
  ([0029](../decisions/0029-a-host-renders-a-published-form-through-one-client.md)),
  in a workspace of linked grids
  ([0047](../decisions/0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md)).
  The studio's and the host page's browser gates fail when their own
  stylesheet reaches the paper; for the examples page, review holds it.
- **Renderers ship no CSS.** Nothing this repository adds to a form carries
  styling, and a control is operable without a theme
  ([formancy.ai 0101](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0101-a-control-is-operable-without-a-theme.md)).
- **Keyboard first**: every drag has a keyboard path
  ([formancy.ai 0046](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0046-keyboard-before-drag.md)).
  A delete is said before it happens: the studio says before publication who
  may delete and what a delete also does
  ([0052](../decisions/0052-the-studio-says-before-publication-who-may-delete-and-what-a-delete-also-does.md)),
  and the host page deletes only after a confirmation in place
  ([0053](../decisions/0053-a-host-deletes-a-record-from-its-detail-or-its-row-after-a-confirmation-in-place.md)).
- **Accessible name only.** Tests find elements by role and accessible name
  ([formancy.ai 0034](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0034-accessible-name-only.md));
  where the tree cannot answer, a test reads the DOM and its header says
  why. axe runs at every step of `apps/studio/src/journey.test.tsx` and in
  every state of `apps/host/src/page.test.tsx`.
- **In three browsers.** `apps/examples/scripts/browser-test.mjs`,
  `apps/studio/scripts/browser-test.mjs` and
  `apps/host/scripts/browser-test.mjs` run every check in Chromium, Firefox
  and WebKit: no sideways scroll down to 320 pixels, the first Tab on the
  skip link, axe's colour-contrast and target-size rules. Where the browsers
  differ, the difference is a named fact in `scripts/browsers.mjs`'s
  `FACTS`, held by a check with one name in every browser
  ([0058](../decisions/0058-the-browser-gates-run-in-chromium-firefox-and-webkit-and-each-fact-the-browsers-disagree-on-is-named-and-held.md)).
- **Pictures are taken, not drawn**, and held to the text they show
  ([0038](../decisions/0038-readme-pictures-are-taken-by-a-script-and-held-to-the-text-they-show.md)).
- **One shell for every page of the site**
  ([formancy.ai 0106](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0106-one-shell-for-every-page-of-the-site.md))
  has nothing to hold yet: `formancy.ai/data` is not a page, the
  examples page is an app with a masthead of its own
  ([0069](../decisions/0069-the-examples-page-is-served-at-formancy-ai-data-examples.md)),
  and the live demo is the host page with its own header
  ([0070](../decisions/0070-the-live-demo-runs-the-real-server-and-postgresql-in-a-cloudflare-container-of-each-visitors-own.md)).

**What it costs.** WebKit here is Playwright's Linux port, not Safari;
nothing runs on a phone; a Playwright release can turn a leg red (0058).

## 8.10 Licences and notices in what is built

**Every package declares the source-available licence**, never Apache-2.0
([0001](../decisions/0001-a-paid-module-in-its-own-repository.md)): its
manifest says `SEE LICENSE IN LICENSE.md`, and `scripts/sync-licenses.mjs`
copies `LICENSE.md` and `NOTICE` into it. `scripts/verify-licenses.mjs`, a
gate, refuses a manifest that says otherwise and a package that would pack
without either file; the realistic mistake is a manifest copied from
upstream. What a document says of the licence's version, its date and its
address is rendered from `LICENSE.md` by `scripts/licence-status.mjs`, and
`scripts/licence-status.test.mjs` fails until every generated block says it
([0048](../decisions/0048-the-licence-is-in-force-before-a-lawyer-has-read-it.md),
[0054](../decisions/0054-version-1-1-names-the-address-for-a-redistribution-agreement-too.md)).
That nothing calls the module open source is held by review.

**A built app carries the licence and notice texts of everything it bundles**
([0046](../decisions/0046-a-built-app-carries-the-licence-and-notice-texts-of-everything-it-bundles.md)).
`scripts/third-party-notices.mjs`, a Vite plugin, writes
`THIRD-PARTY-NOTICES.txt` beside each page: every bundled package once, by
name and version, with the full text of every licence and notice file it
ships. A package with no licence text, a module from outside node_modules
and this repository, and a worker each stop the build. The examples page's
deploy refuses a build without the file
([0069](../decisions/0069-the-examples-page-is-served-at-formancy-ai-data-examples.md)),
and so does the live demo's, of the host page's demo build (0070).
**Held by** `scripts/third-party-notices.test.mjs`, in real Vite builds,
which fails the day Vite reports what the plugin is known to miss: what Vite
folds in as text, and the bundler's own helpers.

## 8.11 Upstream, depended on and never copied

`@formancy/*` packages are dependencies at exact released versions, and this
repository carries none of their code
([0002](../decisions/0002-depend-on-upstream-never-copy-it.md)). One engine,
built once, decides validity in the browser, on formancy's server and here; a
copy that diverged by one rule would make a form this module accepts and
formancy's server refuses. A version moves by hand, with a changelog line
saying why, a generic improvement goes upstream, and there is no `patches/`
directory. An upstream release may be adopted the day it is published: each
upstream package the lockfile installs is exempt from pnpm's minimum release
age, by name and exact version, and nothing else is
([0055](../decisions/0055-an-upstream-release-is-adopted-the-day-it-is-published.md)).

**Held by** `scripts/upstream-deps.test.mjs` in `pnpm test:repo`: a range, a
`workspace:`, `link:`, `file:` or git specifier, and an exemption naming a
package outside the scope, a pattern, or a version the lockfile no longer
installs each fail. That no upstream source is copied is held by review.

**What it costs.** A generic improvement waits for another repository's
release. For an adopted release's first day, only the bump's own review
stands between this repository and a compromised publish.

## 8.12 Every page under a Content-Security-Policy

Every page this repository serves is sent with a Content-Security-Policy
built from one: the examples page's, `POLICY` in
`scripts/demo-headers.mjs`
([0069](../decisions/0069-the-examples-page-is-served-at-formancy-ai-data-examples.md)),
which allows nothing a directive does not name, nothing inline and nothing
evaluated, and scripts, styles, fonts and fetches from the page's own
origin alone, where the build's files and faces are (0072). A page that
needs more names it as an allowance, one source in one directive with
why, which `policyProblems` refuses unless it is named. Two pages need
one, the same: `'unsafe-inline'` in `style-src` for the style elements AG
Grid creates, in the live demo
([0070](../decisions/0070-the-live-demo-runs-the-real-server-and-postgresql-in-a-cloudflare-container-of-each-visitors-own.md))
and in the composed stack's host page; the studio needs none
([0083](../decisions/0083-the-studio-and-the-host-page-are-served-under-a-content-security-policy-each.md)).
The examples page and the live demo are sent their policies by the
`_headers` file their deploys write; the studio and the host page by
`deploy/web/nginx.conf`, from the map `scripts/web-policies.mjs` writes.

**Held by** the browser gates, which serve each page with the policy it
is sent in production and fail on anything the browser refuses under it:
the examples page's, the studio's and the host page's in every browser,
each also putting an inline script in the page at the end of a pass that
must be refused and heard (`scripts/browser-gate.mjs`'s listener and
`canary`), and the host page's failing once a run when, without its
allowance, AG Grid's style elements are no longer refused; the live
demo's in Chromium alone (`apps/host/scripts/browser/demo.mjs`), which
shows its allowance needed too. In
`pnpm test:repo`, `scripts/demo.test.mjs`, `scripts/live-demo.test.mjs`
and `scripts/web-policies.test.mjs` hold each policy to what its built
page loads and to what its deploy or nginx.conf sends.

**What it costs.** A script element an extension, a proxy or a wrapping
page writes into a page does not run, and only the console says so; a
dependency that needs `eval` or an inline script fails the gates before it
ships. `'self'` is the whole origin, not the page's path. A deployment's
own proxy sends the studio's and the host page's policies only if it
copies them, and nothing reads what it sends.
