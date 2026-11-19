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
spec 5, which generated forms are in, brought no exact-decimal type either
([0118](../decisions/0118-generated-forms-move-to-spec-5-for-help-text-from-column-comments.md)). A whole number is a bounded `number` with `step: 1`, so a
fraction is refused in the browser as the server's codec refuses it
([0120](../decisions/0120-a-whole-number-field-refuses-a-fraction-in-the-browser.md)).
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

**A starting value is read as a record holding it is read back.** A
column's constant default (`startingAnswer`,
[0149](../decisions/0149-a-new-record-starts-with-its-columns-constant-default.md))
and a starting value an administrator gives a field in the presentation
(`givenStart`,
[0150](../decisions/0150-an-administrator-gives-a-field-another-starting-value.md))
are one reading in `packages/data-core/src/generate/defaults.ts`: through
the column's codec -- the binding's type's, `codecForType`, where a
presentation is applied without the snapshot -- and `formValue`, and only
where the field's box draws it as the column holds it, no control
character in a one-line box, and holds it, in UTF-16 code units. A value
spelled otherwise than it reads back, `9.5` for a `numeric(18,4)`, is
refused with the spelling to give, so a presentation has one; formancy's
engine is not asked at run time, and `presentation/starting-value.test.ts`
holds what the reading takes to the released validator and
`acceptsDefault`. The database is not asked: a CHECK constraint or a SQL
Server code page meets the value at the save, as any answer.

**A check's list is read, never run.** A column whose values one
enforced, validated check lists is a select of exactly them, each value
as a record holding it reads back -- a whole number's canonical text, a
bigint past 2^53 among them -- and a select's answer is that text
(`generate/listed.ts`, `records/answers.ts`). The list is read out of
the spelling the snapshot holds, per engine, by a cursor that takes one
column compared by `=` with literals in the shape each server writes and
nothing else (`generate/check-lists.ts`); it never evaluates the
expression, executes it or builds SQL from it, and a spelling it does not
take is no list, so the column keeps its box. The database still decides:
the server does not check an answer against the list, and a value the
check no longer names is refused by it with a check violation
([0152](../decisions/0152-a-column-whose-values-a-check-lists-is-a-select-of-them.md)).

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
| A catalog the account cannot fully see | a gap in the snapshot, never "no relationships", and when the scope asks for routines never "no routine" | [0004](../decisions/0004-a-snapshot-says-what-it-could-not-see.md), [0027](../decisions/0027-a-snapshot-says-what-its-account-may-do.md), [0158](../decisions/0158-a-snapshot-records-the-routines-in-scope-when-asked-and-only-then.md) | `packages/data-core/src/snapshot.test.ts`, `packages/data-fixtures/src/conformance.test.ts`, `packages/data-sqlserver/src/discovery-routines.integration.test.ts` |
| A form with no proof against lost updates | create-only, saying why | [0009](../decisions/0009-generation-is-deterministic-and-says-what-it-chose.md) | `packages/data-core/src/generate/generate.test.ts` |
| A routine an action binds that is gone, changed in what a call rests on, no longer executable, out of sight, or not recorded by the snapshot review is against | the action blocked by review, and only it; a run planned over a routine whose call shape differs from the one the bindings' snapshot holds, or over a root whose change stops the action, refused `drift` -- what a request does when it finds no routine to describe is the route's, a later record's | [0159](../decisions/0159-a-form-binds-a-database-routine-as-an-action-over-the-open-record.md) | `packages/data-core/src/drift/routines.test.ts`, `packages/data-core/src/actions/plan.test.ts` |
| A run whose record is not where its person read it, or whose root or routine is not the one it was decided over | rolled back with nothing called: `not-found`, `stale`, `version-ended` or `schema-changed`; a routine's error of any kind but what passes is the deployment's, `declined` or `refused`, never a 500 | [0160](../decisions/0160-an-action-runs-in-one-transaction-that-locks-the-record-moves-its-version-and-calls-the-routine-guarded-and-never-retried.md) | `packages/data-postgres/src/actions.integration.test.ts`, `packages/data-sqlserver/src/actions.integration.test.ts` |
| A published bundle, on every read | refused with a reason unless it validates | [0019](../decisions/0019-a-published-form-is-checked-every-time-it-is-read.md) | `bundle.test.ts` |
| Drift that blocks an operation | 409 `drift`, nothing written | [0041](../decisions/0041-the-runtime-refuses-what-drift-blocks.md), [0010](../decisions/0010-drift-is-classified-against-the-bindings.md) | `routes/runtime-drift.integration.test.ts` |
| A grant whose key now names another column | 422 `keys-reassigned`, nothing written, until someone decides | [0039](../decisions/0039-a-publish-says-what-happens-to-the-grants-of-reassigned-keys.md) | `routes/admin-keys-reassigned.integration.test.ts`, `routes/admin-evolution.test.ts` |
| A route with no audit name | its registration throws, or 500 `unaudited-route` | [0033](../decisions/0033-the-administrator-plane-is-audited.md) | `routes/admin-audit.test.ts` |
| A trigger's reason for the person that may have been cut, holds a control character or says nothing | the server's own sentence, never the reason cut | [0156](../decisions/0156-a-trigger-can-refuse-a-write-in-words-the-person-reads.md) | `packages/data-sqlserver/src/records-failures.integration.test.ts`, `packages/data-postgres/src/records-failures.integration.test.ts` |
| A write whose answer was lost | unknown, never refused, never replayed | [0031](../decisions/0031-an-answer-lost-after-a-write-is-unknown.md) | `e2e-lost-answer.integration.test.ts` |
| A SQL Server that answers a SQL login asking for TLS that it will not encrypt, or with an answer that is not a PRELOGIN response | the connection ends before the login is sent, 503 | [0081](../decisions/0081-a-sql-login-that-asks-for-tls-is-refused-when-the-server-answers-that-it-will-not-encrypt.md) | `packages/data-sqlserver/src/encryption.test.ts`, `routes/unencrypted.integration.test.ts` |
| A file of records that cannot be made whole -- past its byte budget or its deadline, rows that moved between pages, text UTF-8 cannot carry, labels that cannot be loaded | a JSON refusal and nothing of the file, never a shorter file sent as whole | [0079](../decisions/0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md) | `routes/runtime-exports.test.ts`, `packages/data-client/src/transport.test.ts` |
| A stamp the context cannot fill -- an attribute the token lacks, an id its column's codec refuses, longer than the column | 403 `missing-attribute` or `unstampable`, nothing written, never cut to fit; an id the codec accepts and the database refuses, a SQL Server code page lacking one of its characters, is the database's 422 on the stamped field | [0153](../decisions/0153-the-server-stamps-who-wrote-a-record-and-when.md) | `packages/data-core/src/records/plan-stamps.test.ts`, `routes/runtime-stamps.integration.test.ts` |
| A starting value a field does not take, or one no case holds -- a lookup's, a date's | refused at publish, saying why; dropped and said by a regeneration | [0150](../decisions/0150-an-administrator-gives-a-field-another-starting-value.md) | `packages/data-core/src/presentation/starting-value.test.ts`, `routes/admin.test.ts` |
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
a browse narrowed to equal values names its columns in the body, and each
reaches an adapter only as the server's own snapshot spells a column the
page shows, its value bound (0103); a filter's condition names a field or a
column and an operator from a closed set, and reaches an adapter as a
column the snapshot spells, the operator's own predicate and values bound
as the column's type, never as text of a query
([0104](../decisions/0104-a-list-and-a-browse-are-filtered-by-conditions-on-their-columns.md));
and a form names a connection only by an id the allowlist holds
([0019](../decisions/0019-a-published-form-is-checked-every-time-it-is-read.md)).
A routine's parameter carries the engine's own identity for its type --
PostgreSQL's oid, SQL Server's user_type_id with its sizes -- and its
spelling for a person; a cast to it is spelled only from the adapter's
closed table of the built-in types a codec speaks, keyed by that identity,
and a type outside the table is `unsupported`, so no type name a catalog
holds becomes SQL
([0158](../decisions/0158-a-snapshot-records-the-routines-in-scope-when-asked-and-only-then.md)).
An action names its routine by the snapshot's schema, name and signature
and each parameter by the catalog's name and type identity; a run's
request names the action alone, and its plan hands an adapter a field or a
key as a column of the locked row, its value never leaving the database,
and every other value canonical, through its parameter's codec
([0159](../decisions/0159-a-form-binds-a-database-routine-as-an-action-over-the-open-record.md)).

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
submitted value for it is over-posting. So is a value for a column the
server stamps -- who wrote a record, from the verified context, or when,
by the database's clock -- which no grant can make a person's, and which,
unlike a pinned column, filters nothing; a row filter on one is refused
([0153](../decisions/0153-the-server-stamps-who-wrote-a-record-and-when.md)). `validatePolicy` refuses a policy
that does not fit its form. A field holding a record's state can be held to
the moves the policy lists, each a pair of values for named roles, any
other change refused from the record as read and the move guarded by the
version its person read
([0112](../decisions/0112-a-policy-holds-a-state-field-to-the-moves-it-lists.md));
the form tells each person the moves their roles may make, read as the
check reads them, so a page draws the field as those and nothing else
([0127](../decisions/0127-a-host-page-draws-a-state-field-as-the-moves-its-person-may-make.md)).

**The policy is asked on every request**, nothing cached per actor, and only
an echo it can prove harmless is removed from a submission
([0022](../decisions/0022-the-runtime-plane-asks-the-policy-every-time.md)),
or one the record moved since the version the person sent, which the
guarded statement then answers stale
([0098](../decisions/0098-an-echo-the-record-moved-since-it-was-read-is-a-stale-save.md)).
A form names what each write accepts from its person, by the same check,
and the host page sends no field that no write accepts: the echo the
server removes is another client's
([0117](../decisions/0117-a-form-names-what-each-write-accepts-and-a-host-page-sends-nothing-none-accepts.md)).
The same scoping reaches every operation: a lookup token is a reference,
never a permission
([0012](../decisions/0012-a-lookup-token-is-a-reference-not-a-permission.md));
a child form's rows are reached only through a parent its policy admits
([0043](../decisions/0043-a-child-forms-rows-are-reached-only-through-a-parent-its-policy-admits.md));
a page of records is listed under the read policy
([0044](../decisions/0044-a-forms-records-are-listed-a-page-at-a-time-under-its-read-policy.md)),
and the row a page continues after is found under it too, one the person
may not read answered as one that is gone, so its place in the order is
never told
([0108](../decisions/0108-a-forms-list-pages-after-the-last-row-it-showed-found-again-by-its-key.md));
the menu names only the forms a person may read
([0045](../decisions/0045-the-runtime-plane-lists-the-forms-a-person-may-read-and-nothing-about-the-others.md));
a delete reaches other tables only through foreign keys the policy names
([0051](../decisions/0051-a-delete-reaches-other-tables-only-through-foreign-keys-the-policy-names.md));
an action is run by the roles the policy names for it and nobody else, each
of which may read, and may read every field the action passes, and needs
no update -- what the routine then writes is the deployment's, bound by no
field grant, state move or cascade of the policy
([0159](../decisions/0159-a-form-binds-a-database-routine-as-an-action-over-the-open-record.md)).
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

**A record saved with its rows is one transaction, guarded by its
version** ([0155](../decisions/0155-a-records-rows-may-be-saved-with-it-in-one-transaction-guarded-by-its-version-and-checked-as-a-whole.md)). The
rows of a together child -- a lookup an administrator marks as saved with
its record, with bounds -- are created, changed and deleted with their
record or not at all, through one request,
`POST /v1/forms/:id/records/save`. `planSave` makes the one request: the record's
step, then each changed child's deletes, updates and creates, each the
request today's planners make under that form's own policy, the child
pinned to the record's key, then each child's count and the record read
back. Every plan moves the record's version, by its update or, where its
own answers change nothing, by a touch -- a version column incremented, a
rowversion's confirmed touch column set to itself -- so that one row lock
serialises every save of its rows, a resend over a saved record is
`stale`, and one read of the record reconciles a lost answer. Each statement is
still one guarded statement, none retried. Both adapters run it as one
transaction (`RecordAdapter.save`): on PostgreSQL one `sql.begin` on the
path the record's definition chooses, its lock and statement timeouts the
save's deadline, the locked path's one LOCK of every table it writes
first; on SQL Server one batch that owns its transaction, its lock
timeout the deadline, the deadline checked in the batch before each step,
and CATCH recording the step it stopped at. A step that changes nothing
is explained after the rollback by the read a write alone asks, pinned as
the step was. The route sends the request once per write id and never
again, after every part's policy has been asked before any read, and
answers a refusal at the part of the body it is about; a lost answer is a
502 naming the record and the version sent. A record that must hold rows
of a together child is never created alone, and never in a save by a
person who could not make it: 403 before any statement, naming no child.
A together child's rows are never created or deleted alone: 403 with
nothing written, after its table is described.

**The save's deadline is one setting.** `FORMANCY_DATA_SAVE_DEADLINE_MS`,
read by `main.ts` and parsed in `save-deadline.ts`, `DEFAULT_SAVE_DEADLINE_MS`
unset. Where a SQL Server connection is allowed, the server refuses to
start unless twice it is below mssql's request timeout, since a step may
start just before the deadline and wait for a lock as long again, and a
save past that timeout would be `unknown-outcome` where the deadline rolls
it back.

**The deadline bounds each wait and when a step may start, not the
transaction.** No step starts after it and no lock is waited for longer
than it, on both engines. On PostgreSQL no statement runs longer than it
either: one that would is cancelled at its step. On SQL Server one slow
for another reason than a lock runs to its end, holding its locks, and
the save is stopped before its next step; such a statement, and a
batch's compile, are bounded only by mssql's request timeout of 15 s,
which ends in `unknown-outcome` -- the shared case `slow-statement` holds
both engines' answer. How long a save holds its locks is not measured
apart from its whole time. `DEFAULT_SAVE_DEADLINE_MS` and `SAVE_MAX_ROWS`
(`packages/data-core/src/records/save-limits.ts`) are measured, and say on
what: one child's creates, of one shape.

**Held by** the shared cases `SAVE_PARITY`
(`packages/data-fixtures/src/saves.ts`), which each adapter's
`save.integration.test.ts` and `save-lost-answer.integration.test.ts`
assert through `covers()` on both engines -- every change committed, a
refusal at every step rolling everything back, the pin in each located
statement and in its explaining read, the bounds, the deadline, two saves
at once and a lost answer; on SQL Server, the batch of every save its
save suite plans, and of each size its sized suite saves, against
`saveParameters`' prediction, and in
`packages/data-sqlserver/src/save-facts.integration.test.ts` the lock
facts its batch's checks after only the first step on a table rest on;
each adapter's `save-sized.integration.test.ts` for the round trips;
for the plan, `packages/data-core/src/records/save.test.ts`,
`together.test.ts` and `menu.test.ts`, with no database; for the route,
`packages/data-server/src/routes/runtime-save.test.ts` over fake ports,
`save-deadline.test.ts` for the setting, and
`e2e-lost-answer.integration.test.ts` for a lost answer on both engines;
for the host page, which holds the rows until the record's own Save and
sends them with it, `apps/host/src/together.test.tsx` and
`stale-set.test.tsx` on both engines -- the second of two saves of one
order's lines stale at the order, Keep my line changes keeping each
line's change at the version it was read at, and a line both changed
refused at that line; and `unknown-child.test.tsx`, where a lost save
that created the record holds a press in either renderer's pane, since
the rows are one set for both.

**What it costs.** What 0155 records: the second of two
people saving different lines of one order at once is `stale`, the
record's UPDATE triggers fire on a save of its rows alone, a touch stamps
nothing, and on SQL Server a trigger that ends the transaction can store a
save in part, saves of different records wait on each other at the count
where the child's foreign key has no index, and DELETE taken away while a
save runs is seen by the first delete of each reach alone.

**An action's run is one transaction, guarded by its version** ([0160](../decisions/0160-an-action-runs-in-one-transaction-that-locks-the-record-moves-its-version-and-calls-the-routine-guarded-and-never-retried.md)).
It locks the open record under the person's filters and throughs, at the
version they read, holds the parent each through scopes it by to the end,
moves the version -- a version column incremented, a rowversion's
confirmed touch column set to itself -- and calls the routine once, only
while the root and the routine have the definitions the run was decided
over. A run from a read the first already moved is `stale`, so a second
press, a resend or another replica runs it at most once, and a lost answer
is `unknown-outcome`, never sent again. On PostgreSQL it is two
statements -- after a table lock on the locked path -- each under a
statement timeout of what remains of the deadline; on SQL Server one batch, its lock wait at most half the
deadline and the whole under mssql's per-request timeout at it, past
which a run reads "it may have run".

**Held by** the shared cases `ACTION_PARITY`
(`packages/data-fixtures/src/actions.ts`), which each adapter's
`actions.integration.test.ts` and `actions-lost-answer.integration.test.ts`
assert through `covers()` on both engines.

**What it costs.** What 0160 records: a run holds its record and the
parent for up to its deadline, fires the root's UPDATE triggers, needs
UPDATE on a through's parent on PostgreSQL, refuses a STRICT routine
there -- which the generator refuses to bind wherever the snapshot says
so, and review stops where a bound one became so, while a form
published from a snapshot that did not say keeps offering it
([0167](../decisions/0167-a-snapshot-says-whether-the-engine-calls-a-routine-given-a-null-and-the-generator-refuses-a-strict-one-before-publication.md)) -- answers EXECUTE revoked as the procedure gone on SQL Server where
the account held no other permission on it, and over-reports a lost
answer on PostgreSQL and any run past its deadline on SQL Server as "it
may have run".

**A selection's run is one transaction, its records locked in key order, all or nothing**
([0165](../decisions/0165-an-action-runs-over-a-selection-of-up-to-a-page-of-records-in-one-transaction-locked-in-key-order-all-or-nothing.md)).
An action over a selection runs over one to `LIST_PAGE_SIZE` records of
the page a list shows, each under the person's filters and throughs at
the version they read: PostgreSQL's one lock statement sorts them by key
before it locks them, and SQL Server's batch runs one UPDATE per record in
the adapter's key order, so two runs over overlapping selections wait for
each other rather than deadlock on the records they share -- but where a
through targets the form's own table, whose parents are locked as each
record is located rather than in their own key order, and two runs can
still deadlock, `unavailable`. The routine is called once per record,
each call given what its record held once locked, and any record's
refusal -- a change since it was read, the routine's own -- rolls back
every record; a refusal about records names them, by data-core's one
reading of what each record not locked was (`unmovedFailure`). Two keys
the database's own equality makes one row are `duplicate-record`, found
before any call: on SQL Server among the rows the batch moved, on
PostgreSQL by the positions the lock returns. **Held by** the shared `selection-*` cases of
`ACTION_PARITY`, which each adapter's `actions-selection.integration.test.ts`
asserts through `covers()`, first run in CI, and
`packages/data-sqlserver/src/actions/statements.test.ts`. **What it
costs.** Every record is held until the last call returns; there is no
set-level call; a selection is one page at most; SQL Server's key order
is the adapter's own, not the index's; and on SQL Server a procedure
that ends the transaction commits a selection in part, `unknown-outcome`.

**A run is sent once per write id, under one deadline, and never queued**
([0161](../decisions/0161-the-runtime-plane-runs-an-action-once-per-write-id-under-a-deadline-and-never-queues-it.md)). The runtime plane's route answers a sending of a
write id it already acted on as it was, whatever was published since,
and otherwise asks the policy before the connection is opened; then,
once per sending of the write id -- each action an operation of its
own -- holds a connection of the actions' pool
for the run from its description to its answer, counted against the bound
the connection reports, and refuses a run the pool cannot take at once
503 with nothing sent: a deadline spent in the queue would be spent on
nothing the run did. `FORMANCY_DATA_ACTION_DEADLINE_MS` is the run's
deadline, 15 s unset, chosen and not measured. A form offers an action as
the root described when it is opened leaves it runnable; the routine is
described by the run. **Held by** `packages/data-server/src/routes/runtime-actions.test.ts`
and, on both engines, `e2e-lost-answer.integration.test.ts`. **What it
costs.** A full pool refuses at once however soon a run would answer, each
replica counts its own runs, and a routine changed since publication is
offered until its run is refused, 409 `schema-changed` or `drift`.


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
refused, for a `save` the row changes it carried, and `null` for every
other operation -- a count, never which
([0079](../decisions/0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md), [0155](../decisions/0155-a-records-rows-may-be-saved-with-it-in-one-transaction-guarded-by-its-version-and-checked-as-a-whole.md)).
An `action` event carries `action`, the name of the action run, once the
published form binds one of that name, and no other event has the key --
never an answer, an input or the routine's message
([0161](../decisions/0161-the-runtime-plane-runs-an-action-once-per-write-id-under-a-deadline-and-never-queues-it.md));
over a selection it carries `records`, every record's keyed hash in the
order sent, `null` without an audit key, and `rows` their count, its
`record` `null`
([0165](../decisions/0165-an-action-runs-over-a-selection-of-up-to-a-page-of-records-in-one-transaction-locked-in-key-order-all-or-nothing.md)).
And `moved`: whether a create or an update moved its policy's state field,
never from where or to where
([0112](../decisions/0112-a-policy-holds-a-state-field-to-the-moves-it-lists.md)).
An administrator event carries `object`: for a `browse`, the table or view
it read as `schema.name`, once the server's snapshot holds it, and `null`
for every other operation -- never the search or a row
([0099](../decisions/0099-a-browse-role-reads-any-table-or-views-rows-as-the-connections-account-does.md)),
nor the values a follow of a foreign key narrowed the browse to, so the
trail tells that a table was browsed and not which row led there
([0103](../decisions/0103-a-browsed-row-follows-its-foreign-keys-either-way.md)).
No event has a field for a filter's conditions, on either plane
([0104](../decisions/0104-a-list-and-a-browse-are-filtered-by-conditions-on-their-columns.md)).
A write the deployment declined in words for the person is the outcome
`declined`, and no event has a field for its reason, which may hold a
value
([0156](../decisions/0156-a-trigger-can-refuse-a-write-in-words-the-person-reads.md)).

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

**One sentence is the deployment's, not the server's.** A write a trigger
refuses with a message starting `formancy: refused: ` is 422 `declined`, and
its `message` is the rest of that message, beside the field bound to the
column `formancy: refused [column]: ` names. Which error may carry one is
each engine's -- PostgreSQL's P0001 on a write, SQL Server's user error
from 50000 at severity 16 under none of the adapter's own numbers -- and
what it says, and whether its shape is passed on, is read once in
`packages/data-core/src/records/refusal.ts`: one line of at most
`REFUSAL_LONGEST` UTF-16 code units, one short of what SQL Server's THROW
carries whole, or the server's own sentence, as every other trigger error
is. The adapter's message for the log says only that it was declined, and
the route logs the code and the form; the reason goes to the person and
nowhere else
([0156](../decisions/0156-a-trigger-can-refuse-a-write-in-words-the-person-reads.md)).
**Held by** both adapters' `records-failures.integration.test.ts` on
`DECLINE_PARITY` (`packages/data-fixtures/src/declines.ts`),
`refusal.test.ts` beside the reader, and `routes/runtime.test.ts`.

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
  acts on and teal for what the server did -- on the host page, as it is
  said, a line's words fading to muted after a moment, and changing
  without a transition under reduced motion
  ([0146](../decisions/0146-the-page-says-what-the-server-did.md)) -- in the admin's palette,
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
  ([formancy.ai 0046](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0046-keyboard-before-drag.md)):
  a grid header's edge, which a pointer drags, has the Columns panel's
  Wider, Narrower and Fit, named for the column
  ([0151](../decisions/0151-a-person-sets-a-grid-columns-width-and-the-browser-keeps-it.md)).
  A delete is said before it happens: the studio says before publication who
  may delete and what a delete also does
  ([0052](../decisions/0052-the-studio-says-before-publication-who-may-delete-and-what-a-delete-also-does.md)),
  and the host page deletes only after a confirmation in place
  ([0053](../decisions/0053-a-host-deletes-a-record-from-its-detail-or-its-row-after-a-confirmation-in-place.md)),
  and runs an action only after one too, Keep it the next Tab in both
  ([0162](../decisions/0162-the-host-page-runs-an-action-from-the-open-records-header-after-its-dialog-and-a-confirmation-in-place-and-reads-the-record-again.md)).
  A choice of records is a column of real checkboxes, never the grid's
  own selection, which stays the open row: each box in a cell the arrow
  keys reach, out of the Tab order so the grid stays one stop, its Space
  its own, 24 pixels square by its own style attribute in the room's
  violet, since no rule of the host's reaches into a grid, and AG Grid's
  live region says what Space does on it, as on a row's Delete what Space
  and Enter do there, never that they open the record; an action pressed
  with nothing chosen is `aria-disabled` and says what to do first, each
  press in a new element of the bar's line so a sentence said again is
  heard again, as the pager and the Columns panel say what cannot be
  done; and a question asked over a choice closes, nothing run, when the
  choice changes under it
  ([0166](../decisions/0166-a-person-chooses-a-pages-records-by-a-column-of-boxes-and-runs-an-action-over-them-from-a-bar-above-the-grid.md)).
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

The lint rules and the format are such a dependency too:
`@formancy/code-style`, which formancy.ai publishes for the four
repositories, pinned exactly as a root devDependency, which
`scripts/upstream-deps.mjs` reads along with the packages' manifests. A
rule changes in that package and not here; until 2026-10-31 it was a copy
of Formancy Health's
([0116](../decisions/0116-every-typescript-and-javascript-file-is-linted-and-formatted-by-the-rules-the-four-repositories-share.md)).

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
