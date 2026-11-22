# What it does

What Formancy Data does, by who meets it -- the administrator in the
studio, the person filling in a form through any host, and the operator --
each line linking the decision record whose **Verified by** names what fails
when the line stops being true. [The README's *What you
get*](../../README.md#what-you-get) is the short version, and
[`CHANGELOG.md`](../../CHANGELOG.md) says which release carries what.

**For the administrator, in the [studio](studio.md):**

- **Sees what one account sees, and says what it cannot.** What the catalog
  hid from the account is a gap, "cannot tell", never taken as absence;
  every column says what the account may read, insert and update, and every
  table whether row-level security applies to it, whether the account may
  delete from it, and which foreign keys, from any schema, refer to it
  ([0004](../decisions/0004-a-snapshot-says-what-it-could-not-see.md),
  [0007](../decisions/0007-sqlserver-discovery-and-what-it-hides.md),
  [0027](../decisions/0027-a-snapshot-says-what-its-account-may-do.md),
  [0049](../decisions/0049-a-snapshot-says-whether-its-account-may-delete-and-what-refers-to-each-table.md)).
  Since 0.2.0, not in 0.1.0: a snapshot records which server it was read
  from -- the product, the major version and, on SQL Server, the database's
  compatibility level -- from which `@formancy/data-core` says whether this
  release was tested on that server, never taking Azure SQL Database for
  the SQL Server 2014 its major would be. Nothing refuses a server for
  being untested; a SQL Server older than 2019, whose catalog lacks a view
  discovery reads, is refused with its release named
  ([0068](../decisions/0068-a-snapshot-records-the-server-it-was-read-from-and-nothing-refuses-a-server-discovery-can-read.md)).
  No test runs on Azure SQL Database or Azure SQL Managed Instance:
  neither has an image a test can start, and a snapshot of either is
  called not tested. Every SQL Server test runs the Developer edition on
  Linux in a container, and another edition or platform of a release the
  matrix runs, SQL Server on Azure Virtual Machines among them, is called
  tested on its strength
  ([0073](../decisions/0073-azure-sql-is-not-tested-and-the-release-says-so.md)).
  A SQL Server connection may log in as an Entra managed identity or
  service principal instead of a SQL login, over TDS 8.0 with the server's
  certificate checked, which SQL Server 2019 and 2022 on Linux do not take,
  its credential built once for each connection and asked for Azure SQL's
  token alone. No test logs in as either: the server says so at start for
  each such connection, and [*What it is tested on*](tested-on.md)
  says so in a row of its own ([0074](../decisions/0074-a-sql-server-connection-may-log-in-as-an-entra-principal-and-no-test-logs-in-as-one.md)).
  Since 0.2.0, not in 0.1.0: a SQL login that asks for TLS keeps TDS 7's,
  which every image of the matrix takes, and is refused before its login
  is sent when the server's first answer says it will not encrypt, as
  MS-TDS says a client ends such a connection; a 0.1.0 server sends the
  login, its password in it, to whoever answered so
  ([0081](../decisions/0081-a-sql-login-that-asks-for-tls-is-refused-when-the-server-answers-that-it-will-not-encrypt.md)).
- **Generates a form deterministically**, and says what it inferred, made
  read-only, excluded and blocked, and why
  ([0009](../decisions/0009-generation-is-deterministic-and-says-what-it-chose.md)).
  Update and delete are offered only where a stale save can be told: by
  SQL Server's rowversion, or by a version column the request confirms,
  which the studio's Choose step says to confirm only if every writer of
  the table increments it on each update, and which a PostgreSQL table,
  having no rowversion, needs to be editable. Without either the form
  reads and creates, and its note says why
  ([0009](../decisions/0009-generation-is-deterministic-and-says-what-it-chose.md),
  [0015](../decisions/0015-a-record-operation-is-one-guarded-statement.md)).
  A key the database numbers or fills -- an identity, or a column with a
  default that is all of the key the policy does not pin, such as a uuid
  from `gen_random_uuid()` or `newsequentialid()` alone or beside a pinned
  tenant -- is shown and never written
  ([0026](../decisions/0026-name-every-column-fact-the-engines-disagree-on.md),
  [0056](../decisions/0056-a-key-the-database-fills-is-never-written-and-a-uuid-is-ordered-as-each-engine-orders-it.md)).
  A field's help text is its column's comment, as the database holds it,
  read out with the control, until the studio's Presentation step replaces
  or removes it
  ([0119](../decisions/0119-a-fields-help-text-is-presentation-the-studio-edits.md));
  the form is formancy's spec 5, which a host's renderer reads from
  `@formancy/*` 0.8.0 on
  ([0118](../decisions/0118-generated-forms-move-to-spec-5-for-help-text-from-column-comments.md)).
  A field a create writes starts at its column's constant default -- text,
  a whole or exact number, or yes or no, read from each engine's spelling
  of it and through the column's codec, so the fixture's order starts at
  `draft` and its customer Active -- and its note says so. A function, a
  sequence, NULL, a date, an instant, a float or a uuid, a lookup's default
  and a constant the field would refuse start empty, left to the database,
  the last two said in a note
  ([0149](../decisions/0149-a-new-record-starts-with-its-columns-constant-default.md));
  the studio's Presentation step gives a field another starting value
  ([0150](../decisions/0150-an-administrator-gives-a-field-another-starting-value.md)).
  A text or whole-number column whose values one enforced, validated check
  lists -- the fixture's `status in ('draft', 'placed', 'shipped')` -- is
  a select of exactly them, read from each engine's spelling of the check
  and labelled as the column holds them, so the order form's Status is a
  choice on both engines; a list not validated, named twice or holding an
  empty value stays a box and says why, anything but a list of literals
  stays a box, and drift review blocks the field's writes when an
  enforced list it reads leaves out a value it offers
  ([0152](../decisions/0152-a-column-whose-values-a-check-lists-is-a-select-of-them.md)).
  On PostgreSQL an enum column is a select of its labels in the order its
  type gives them, its default starting the field, a state field over one
  keeps its moves, and a list sorts, pages, searches and filters it as the
  type does; a domain whose check lists its values is a select of them,
  and a domain over text or a whole number is read as that type. Drift
  review blocks the field's writes when a label is renamed under it, and
  asks for review when one is added; a domain over any other type stays
  unsupported, and SQL Server has no enum
  ([0170](../decisions/0170-an-enum-is-a-select-of-its-labels-and-a-domain-whose-check-lists-its-values-a-select-of-them.md)).
  Who created or last changed a record, and when, can be the server's to
  write: a column the Choose step's stamps tick -- suggested by an audit
  name, never stamped without the tick -- is filled on create, on update or
  on both with the signed-in person's id, one of their attributes, or the
  time by the database's own clock in the same guarded statement, a wall
  clock and a day in UTC on both engines. The field is read-only, a value
  sent for it is refused as over-posting, and a stamp filters nothing:
  everybody who may read sees the records others wrote. Only writes
  through the module are stamped
  ([0153](../decisions/0153-the-server-stamps-who-wrote-a-record-and-when.md)).
- **Writes a policy the server asks on every request.** Who may read, create
  and update which fields; row filters taken from the signed-in person's
  trusted attributes, never from the form
  ([0011](../decisions/0011-every-operation-carries-a-trusted-policy-context.md),
  [0022](../decisions/0022-the-runtime-plane-asks-the-policy-every-time.md)).
  A child table with no tenant column of its own, an order's lines, can be
  kept to its parent's tenant: when its policy names the parent's lookup in
  `through`, a box the Policy step offers, a line of another tenant's order
  is not found on read or update. Nothing requires it: until then any of its
  rows is in reach of a guessed token, which the step notes and never
  refuses. A through is one hop and never over a text key, and on PostgreSQL
  an update racing a move of its parent to another tenant may be written
  ([0043](../decisions/0043-a-child-forms-rows-are-reached-only-through-a-parent-its-policy-admits.md)).
  Who may delete is granted there too, and each foreign key a delete acts
  through -- for the fixture's order, the keys of its lines, its deliveries
  and, past them, their parcels -- is accepted by its own box, never all at
  once; a key that only refuses is listed, what no box can fix is said in
  the server's words, and triggers and rules are said not to be listed. The
  step checks a delete grant with the function the server's publish check
  refuses one by
  ([0052](../decisions/0052-the-studio-says-before-publication-who-may-delete-and-what-a-delete-also-does.md)).
  A status field can be held to the moves the policy lists, each for named
  roles -- a clerk ships a placed order, a dispatcher delivers a shipped
  one, nobody moves one back -- in the Policy step's State moves: any other
  change of it is refused before a statement, checked from the record as
  read and guarded by its version, and the audit says that a record moved,
  never from where or to where. A create that leaves the field to its
  default is not checked
  ([0112](../decisions/0112-a-policy-holds-a-state-field-to-the-moves-it-lists.md)).
  The host page draws the field as the moves its person may make from
  where the record is, and disabled where there is none
  ([0127](../decisions/0127-a-host-page-draws-a-state-field-as-the-moves-its-person-may-make.md)),
  each state by the label the Presentation step's State labels gives it,
  else as its column spells it
  ([0129](../decisions/0129-an-administrator-labels-a-state-fields-states.md)).
- **Keeps presentation as a patch over the generated form** -- labels,
  help text, order, full width, a field moved to another generated
  section, and a field's starting value -- carried through a regeneration
  by what each field stands for
  ([0030](../decisions/0030-presentation-is-a-patch-over-the-generated-base.md),
  [0075](../decisions/0075-a-field-may-move-to-another-generated-section.md),
  [0119](../decisions/0119-a-fields-help-text-is-presentation-the-studio-edits.md),
  [0150](../decisions/0150-an-administrator-gives-a-field-another-starting-value.md)).
  A starting value the database's default changed under is kept and said;
  one the regenerated field stores the same is carried in its new
  spelling, the number 7 as the text “7” once its column is a bigint, and
  said; and one it refuses is dropped and said.
  A key that now names another column keeps its grants only once somebody
  confirms it in the publish over the version they were written in,
  whichever client publishes over a version the server still serves; grants
  removed in one version and given back in the next are not asked about
  ([0039](../decisions/0039-a-publish-says-what-happens-to-the-grants-of-reassigned-keys.md)).
- **Publishes without overwriting anyone.** Of two administrators publishing
  from one version exactly one wins, every version is kept -- a file in the
  configuration store beside the server, nothing in your database -- and
  checked on every read, and an older one is restored only while the
  database still fits it
  ([0013](../decisions/0013-published-configuration-is-files-with-link-based-swap.md),
  [0019](../decisions/0019-a-published-form-is-checked-every-time-it-is-read.md),
  [0030](../decisions/0030-presentation-is-a-patch-over-the-generated-base.md)).
- **Moves a version between deployments** as the file its store wrote: the
  import is checked as a publish is, against the target's allowlist by the
  same connection name, and refused when the target database's drift blocks
  it, as a restore is
  ([0062](../decisions/0062-a-published-version-moves-between-deployments-as-its-version-file.md)).
- **Can have a second person approve publication**, since 0.2.0: not in
  0.1.0. With `FORMANCY_DATA_PUBLISHER_ROLES` set, nobody publishes or imports a
  version alone: an administrator submits a draft, which the server keeps,
  and a publisher who did not submit it approves it, which checks it again
  against the database and writes exactly what was submitted. Restoring a
  version is one publisher's, alone. Unset, as in the composed stack,
  every administrator publishes alone, as before
  ([0065](../decisions/0065-with-publisher-roles-set-a-draft-is-published-only-when-a-publisher-who-did-not-submit-it-approves-it.md)).
- **Lets a browse role read any table or view's rows**, since
  0.4.0. With `FORMANCY_DATA_BROWSE_ROLES` set, each role also an
  administrator role, its holders page through the rows of any table or
  view the connection's account can see, fifty at a time, searched and
  sorted, in the studio's Browse step: as that account reads them, with no
  form or policy between, and nothing written. Unset, as in the composed
  stack, nobody browses
  ([0099](../decisions/0099-a-browse-role-reads-any-table-or-views-rows-as-the-connections-account-does.md)).
  A row follows its foreign keys either way -- to the row it refers to and
  to the rows that refer to it -- each follow a browse of the other end
  narrowed to the row's values, with a trail back; a key holding a NULL
  follows nothing, and one the step cannot follow is named with why
  ([0103](../decisions/0103-a-browsed-row-follows-its-foreign-keys-either-way.md)).
  A page is filtered by the person's own conditions on its columns, as a
  form's list is ([0104](../decisions/0104-a-list-and-a-browse-are-filtered-by-conditions-on-their-columns.md)).
- **Reviews drift** against what a published form's bindings and lookups rest
  on, and says which operations each change blocks
  ([0010](../decisions/0010-drift-is-classified-against-the-bindings.md))
  and which of those the server still allows, where what blocks them is a
  change it does not compare when a request arrives
  ([0041](../decisions/0041-the-runtime-refuses-what-drift-blocks.md)).
  When the database was read from a server this release was not tested
  on, every review says so, for review, and stops nothing, as the
  connection test and the studio's metadata pane say it before a form is
  generated
  ([0068](../decisions/0068-a-snapshot-records-the-server-it-was-read-from-and-nothing-refuses-a-server-discovery-can-read.md)).
- **Chooses a form's rows saved with their record**, since
  0.4.0: on the Choose step, under a lookup whose foreign key is NOT NULL
  and onto another table, "Rows of this form are saved with their order",
  never ticked for anybody, and its "At least" and "At most", starting at
  none and at the cap data-core gives, one row less than a list's page;
  and on a rowversion table, the column a save of a record's rows alone
  sets to itself, chosen from the generator's candidates alone, none
  chosen first. What the generator, the bundle check and publishing would
  refuse of either is said before anything is sent, in their words: a
  lookup the generator refuses -- row security on the table, a section, a
  form over versions, another lookup saved with its record -- is not
  offered, and under one ticked, bounds out of order, a pin outside the
  record's key, and on SQL Server more rows than one batch's parameters
  hold, with the most that fits. A save holds one level, and nothing
  refuses publishing a form saved with its record beside one saved with
  its own records, whose rows are then read-only and, where it requires a
  row, leave those records uncreatable: the box says so once ticked. The
  generator is asked in the browser against the snapshot the step
  discovered, so a database changed since is said by Generate; a check
  constraint's expression is not read, so a column a check names is
  offered as a touch column
  ([0155](../decisions/0155-a-records-rows-may-be-saved-with-it-in-one-transaction-guarded-by-its-version-and-checked-as-a-whole.md)).

**For the person filling in the form, through any host:**

- **Exact values travel as strings**, as [the host page's first picture](./host.md) shows
  ([0008](../decisions/0008-exact-values-travel-as-strings.md)).
- **A lookup offers only the rows the person may choose.** An option's token
  is a reference, not a permission, and the choice is checked again on save
  ([0012](../decisions/0012-a-lookup-token-is-a-reference-not-a-permission.md),
  [0018](../decisions/0018-one-planner-turns-answers-into-requests.md),
  [0028](../decisions/0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md)).
  A search the page abandons, or one that runs past the server's lookup
  deadline, is stopped in the database rather than left to finish for
  nobody; a search still reads every row the filter admits
  ([0061](../decisions/0061-a-lookup-statement-stops-when-its-request-is-abandoned-or-its-deadline-passes.md)).
- **A lookup a person can search is a box to type into.** The generator
  draws it as a typeahead when the columns it shows include text or a whole
  number, which is what a search matches; a lookup that shows neither is a
  plain list of its first page, and the generator's note says so. One that
  would show a binary or unsupported column, which no label can spell, is
  refused before it is published
  ([0066](../decisions/0066-a-lookup-a-person-can-search-is-generated-as-a-typeahead.md)).
  It says when its list goes on, never how long it is, and when matching
  rows cannot be chosen here: under a plain select, where it is seen, and
  from an open typeahead's status line, which the themes of formancy 0.6.0 to 0.13.0
  draw the open list over, so a screen reader hears it and the eye does not
  ([0085](../decisions/0085-a-lookup-says-when-its-list-goes-on-never-how-long-it-is.md)).
- **Every write is one guarded statement.** A stale save is refused instead
  of overwriting
  ([0015](../decisions/0015-a-record-operation-is-one-guarded-statement.md));
  a save whose answer was lost says it may have been saved, and the page
  sends nothing again
  ([0031](../decisions/0031-an-answer-lost-after-a-write-is-unknown.md)).
  Over HTTP/1.1, when a connection the browser reused closes after the server
  read a save and before any byte of an answer, Chromium and Firefox send it
  again on their own, and one server process answers that second sending
  with the first one's answer instead of applying it; WebKit on Linux sends
  every save on a new connection and never sends one twice, so its page says
  the save may have been saved
  ([0058](../decisions/0058-the-browser-gates-run-in-chromium-firefox-and-webkit-and-each-fact-the-browsers-disagree-on-is-named-and-held.md)).
- **A record is saved with its rows in one request**, since
  0.4.0: an order with its lines, its child's lookup marked by an
  administrator on the studio's Choose step as saved with its record,
  between a fewest and a most rows. `POST /v1/forms/:id/records/save`, which `@formancy/data-client`'s
  `save` sends, takes the record -- a create, or an update that may change
  nothing -- and the child's creates, updates and deletes, and stores them
  all in one transaction or none, on both engines; a save past the bound,
  a stale record or row and a refused row are each one refusal naming the
  part it is about, every part's field errors at once, and a save that
  waits too long for a lock one refusal of the whole save. The
  record's version moves on every save, so two people saving lines of one
  order at once are one saved and one stale, and a save sent again after
  a lost answer is stored at most once. Such a child's rows are never
  created or deleted alone, and a record that must hold some is never
  created without them. On SQL Server a trigger that ends the transaction
  can store a save in part. The host page holds such rows in a tab
  beside the record, each change said in words, Add and Remove drawn only
  inside the bound and where the person may, until the record's own Save
  sends them with it; a stale save of lines alone keeps their changes for
  one more press, each line still guarded by its own version
  ([0155](../decisions/0155-a-records-rows-may-be-saved-with-it-in-one-transaction-guarded-by-its-version-and-checked-as-a-whole.md)).
- **A trigger can refuse a write in words the person reads.** A trigger, or
  a function it calls, whose error message starts with exactly
  `formancy: refused: ` has the rest shown to the person who saved, as
  422 `declined`, for a create, an update, a change from a date and a
  delete on both engines; `formancy: refused [column]: ` puts it beside the
  field bound to that column. On PostgreSQL it is a `RAISE EXCEPTION`; on
  SQL Server a `THROW` or a severity-16 `RAISERROR` from 50000, under none
  of the numbers the adapter raises for itself. A message with a control
  character -- a line or paragraph separator and a bidirectional control
  included -- or longer than 2,046 UTF-16 code units with the prefix is
  the server's own sentence, as every other trigger error and any read's
  still is. The bound is one short of the 2,047 that THROW and RAISERROR
  carry whole, since a longer message arrives cut to exactly 2,047,
  measured on SQL Server 2022 (16.0.4295.3) on 2026-11-15. The reason is
  never logged or audited, and nothing checks what it says: a trigger can
  put a value there the person's policy hides. A PostgreSQL trigger
  function's own SQL error is a refusal now, where it was a server error
  that the page read as "it may have been saved"
  ([0156](../decisions/0156-a-trigger-can-refuse-a-write-in-words-the-person-reads.md)).
- **An action runs a routine your database keeps over the open record**,
  since 0.4.0: a PostgreSQL function returning void or a SQL
  Server procedure, bound by an administrator to a form with a source for
  every parameter -- a field, a key, a dialog's answer, the person's
  context or who they are -- and offered by `GET /v1/forms/:id` in
  `actions` to the people its policy names, with the dialog asked first.
  `POST /v1/forms/:id/actions/:action/run`, which `@formancy/data-client`'s
  `runAction` sends, runs it in one transaction on both engines: the
  record locked under the person's filters at the version they read, its
  version moved, the routine called only as it was published and given
  nothing the person may not read, or nothing at all. It is sent once per
  write id and never again, under `FORMANCY_DATA_ACTION_DEADLINE_MS`, on
  a pool of its own that never queues a run: a run with every connection
  busy is refused at once. The answer is the record's token, a refusal in
  the server's words or the routine's own under `formancy: refused: `,
  or a lost answer that names the action and the version sent, so the
  same run sent again is refused as changed if it ran. What the routine
  does is the deployment's: field grants, state moves and the policy's
  cascades do not bind it. A STRICT PostgreSQL function, which PostgreSQL
  does not call when an argument is NULL, is not bound from a snapshot
  that records it so: discovery reads it, the generator refuses it before
  publication, and drift review stops an action whose routine became
  STRICT since. A form published from a snapshot taken before that keeps
  offering one, every run refused, until it is generated again. The
  studio binds one: its routines discovered with Include routines, each
  parameter offered only the sources the generator binds for it, the
  grant made on the Policy step after a note of what the routine does
  that nothing here binds, its words on the Presentation step, and what
  drift leaves of it on the Drift step.
  The host page offers each action in the open record's header, asks its
  dialog and then a confirmation in place, waits for a save of the record
  out, reads the record again once it ran, and checks a run whose answer
  was lost by reading the record, running it again only from the version
  it sent
  ([0159](../decisions/0159-a-form-binds-a-database-routine-as-an-action-over-the-open-record.md),
  [0160](../decisions/0160-an-action-runs-in-one-transaction-that-locks-the-record-moves-its-version-and-calls-the-routine-guarded-and-never-retried.md),
  [0161](../decisions/0161-the-runtime-plane-runs-an-action-once-per-write-id-under-a-deadline-and-never-queues-it.md),
  [0162](../decisions/0162-the-host-page-runs-an-action-from-the-open-records-header-after-its-dialog-and-a-confirmation-in-place-and-reads-the-record-again.md),
  [0163](../decisions/0163-the-studio-binds-a-routine-as-an-action-offering-each-parameter-only-what-the-generator-binds-and-says-what-it-does-before-it-is-granted.md),
  [0167](../decisions/0167-a-snapshot-says-whether-the-engine-calls-a-routine-given-a-null-and-the-generator-refuses-a-strict-one-before-publication.md)).
- **An action runs over a selection of up to a page of records**, since
  0.4.0: an action whose `scope` is `selection` in the
  generation request, bound by the generator's rules for the open
  record's, is run by `POST /v1/forms/:id/actions/:action/run` over one to
  `LIST_PAGE_SIZE` records -- more, or none, refused 400 before any
  statement, two tokens of one key 400 `duplicate-record` -- in one
  transaction on both engines: every record locked in key order under the
  person's filters at the version they read, so two runs over
  overlapping selections wait rather than deadlock -- but over a through
  onto the form's own table -- each version moved, and the routine called
  once for each, given what its record held once locked, all kept or
  none. One record
  changed, gone or ended is `stale`, `not-found` or `version-ended`
  naming the records it is about in `records`, by their tokens, and a
  routine's refusal of one record undoes them all; two keys the
  database's equality makes one row -- a case-insensitive collation on
  SQL Server, a nondeterministic one on PostgreSQL -- are
  `duplicate-record`, rolled back before any call. On SQL Server a
  procedure that ends the transaction commits a selection in part,
  answered `unknown-outcome`. Done is every token in the order sent,
  and the trail names every record by its keyed hash and their count.
  `@formancy/data-client`'s `runAction` sends it and reads the records a
  refusal names. Every record is held until the last call returns, and
  the routine is never called once for the set. The studio's Choose step
  offers each action over the open record or over the records a person
  chooses in the list, and the host page offers it on the Records grid:
  a first column of boxes, each a real checkbox named for its record,
  whose Space is its own and never the row's, and a bar above the grid
  with the actions, how many are chosen, Choose every record on this
  page and Clear the choice -- only on a form that offers its person
  such an action. A choice is of the page shown, which another page, a
  search, a filter, a sort or a view clears, saying so, and a question
  asked over it closes, nothing run, when it changes; the run goes
  through the open record's flow, its confirmation counting the records,
  done saying how many it ran over, and a refusal naming the records it
  is about and offering to read the page again
  ([0165](../decisions/0165-an-action-runs-over-a-selection-of-up-to-a-page-of-records-in-one-transaction-locked-in-key-order-all-or-nothing.md),
  [0166](../decisions/0166-a-person-chooses-a-pages-records-by-a-column-of-boxes-and-runs-an-action-over-them-from-a-bar-above-the-grid.md)).
- **An instant or a time the person may read and did not change is never
  written back**
  ([0040](../decisions/0040-instants-and-times-are-read-to-the-shape-and-an-unedited-one-is-never-written.md)).
- **The server refuses what drift blocks in the form's own table**: opening
  the form, reading and saving, each decided over the table as the catalog
  describes it in that request
  ([0041](../decisions/0041-the-runtime-refuses-what-drift-blocks.md)).
- **Records can be listed a page at a time**, under the read policy and its
  throughs, through the runtime plane and `@formancy/data-client`; the
  [host page](host.md) draws them in an AG Grid Community grid
  ([0044](../decisions/0044-a-forms-records-are-listed-a-page-at-a-time-under-its-read-policy.md),
  [0047](../decisions/0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md)).
  Each page continues after the last row the page before showed, found
  again by its key in the page's own statement, so a row inserted or
  deleted before it moves nothing, and a page deep in an order an index
  serves reads from that row rather than every row before it
  ([0108](../decisions/0108-a-forms-list-pages-after-the-last-row-it-showed-found-again-by-its-key.md)).
  Ordered by a uuid key, a list comes in each engine's own order of uuid --
  PostgreSQL's bytes in turn, SQL Server's byte groups -- total and stable on
  both, and not the same
  ([0056](../decisions/0056-a-key-the-database-fills-is-never-written-and-a-uuid-is-ordered-as-each-engine-orders-it.md)).
  A list is filtered by a person's conditions on its fields -- equals, a
  range, contains, empty or not, as each field's kind offers -- every one
  of which must hold, inside the read policy, never widening it. A value is
  spelled as its column holds it and refused rather than rounded; text
  equals exactly on both engines, whatever the collation; and a
  timestamp's range is whole days, in UTC for an instant
  ([0104](../decisions/0104-a-list-and-a-browse-are-filtered-by-conditions-on-their-columns.md)).
  Either end of a range may leave out its own value -- above 1000, before
  1 November -- compared strictly on both engines
  ([0130](../decisions/0130-a-filters-range-may-leave-out-either-bounds-own-value.md)).
- **An administrator names a form's list views**, each a filter and a sort,
  one of them perhaps the view the grid opens on, in the studio's
  Presentation step; they are published, reviewed, restored and carried
  through a regeneration with the rest of the presentation. A person picks
  one above the grid and may then change it, and is offered only the views
  they could have built themselves: one naming a field they may not read
  is not offered to them at all. A view is sent as the person's own filter
  and sort, so it narrows and never permits, and a regeneration that
  removes a field a view names drops that view and says so
  ([0105](../decisions/0105-a-forms-list-offers-views-its-administrator-named.md)).
  A view may count a date's days from today or compare with the signed-in
  person's attribute, which the server resolves for each person when it
  offers the view, today being its UTC date
  ([0125](../decisions/0125-a-list-view-may-count-days-from-today-and-compare-with-the-signed-in-persons-attribute.md)).
- **A person keeps their own list views**: the filter and the sort a grid
  shows, saved under a name, kept by the server for them alone in the
  configuration store, and offered back beside the form's views wherever
  they open it, only while their list could still run them; the browser
  keeps none of them
  ([0126](../decisions/0126-a-person-keeps-their-own-list-views-on-the-server-for-themselves-alone.md)).
- **A person can download the records a list would show them as one CSV
  file**, for the same search, sort, parent and filter and under the same
  read policy, with no right of its own, through the runtime plane and
  `@formancy/data-client`'s `exportRecords`. The server makes the whole
  file before it sends a byte, so a file is whole or refused with its own
  code, never cut short: refused past 16 MiB or 30 seconds, and while
  another file is being made through the same allowlisted connection.
  Each value is what a read holds, digit for digit, a lookup its label
  beside its key, and a cell a spreadsheet would read as a formula carries
  one apostrophe in front, which taking one off every cell that has one
  undoes. It is not the table at one moment: a record two pages would both
  show refuses the file, and a row deleted meanwhile can be missing
  ([0079](../decisions/0079-a-person-downloads-the-records-a-list-shows-them-as-one-csv-file-made-whole-or-not-at-all.md)).
  The host page saves it from the grid that lists the records, with
  Download CSV ([0080](../decisions/0080-a-host-downloads-the-records-its-grid-lists-and-the-browser-saves-the-servers-file.md)).
- **A record can be duplicated into a new one** of the answers the server
  names for its person: what they may read and give on create, and never a
  column of a key, primary or unique, a value the database fills, a pinned
  tenant or a field they may not write. Nothing is written until they save,
  and the save is a create, checked as every create is. The host page
  copies the open record from its header, as stored, and says which values
  stayed behind
  ([0107](../decisions/0107-a-record-is-duplicated-into-a-new-one-of-the-fields-the-server-names.md)).
- **A form names what each write accepts from its person** -- never a
  pinned tenant, a value the database writes or a field the policy keeps
  from them -- and the host page draws a field no write accepts as
  unwritable and sends it in no save, so no body it sends names a tenant,
  whatever column holds it
  ([0117](../decisions/0117-a-form-names-what-each-write-accepts-and-a-host-page-sends-nothing-none-accepts.md)).
- **A table of versions is changed from a date**: where each row of a
  product's prices is valid from one date until the next starts, a form
  generated with `validity: { from, to }` ends the open version where the
  person says the next one starts and inserts the next, in one write that
  does both or neither -- one statement on PostgreSQL, one transaction on
  SQL Server -- so the module never leaves a gap, an overlap or two open
  versions. Append only: an ended version is read-only through the form,
  no delete is offered, and on PostgreSQL two creates of one chain at once
  need the table's own unique index to stay one chain. The studio's Choose
  step names the chain, and keeps it through a regeneration; the host
  page's record header offers Change from a date on an open version, whose
  next version opens in every pane, and draws an ended one read-only
  ([0113](../decisions/0113-a-form-over-versions-changes-the-open-one-from-a-date.md),
  [0114](../decisions/0114-the-studio-names-a-chain-of-versions-in-the-choose-step.md),
  [0115](../decisions/0115-a-host-page-changes-an-open-version-from-a-date.md)).
- **A record can be deleted, one at a time, by its token and the version its
  person read**, under the policy's `operations.delete`, granted only to
  roles that may read and scoped as an update is, in one guarded statement
  that deletes one row or none, through the runtime plane and
  `@formancy/data-client`; a deletion whose answer was lost is safe to send
  again with the same version. A form offers delete once regenerated from a
  snapshot this release took, where SQL Server's rowversion guards it or
  the database numbers its key: an identity, or a key of one column that
  `gen_random_uuid()` or `newsequentialid()` fills, as the snapshot spells
  the default, and that no foreign key includes -- so PostgreSQL's
  deliveries offer it, and its order lines, whose key people type, do
  not. Triggers that run on a delete are the database's, and on PostgreSQL
  a rule that acts on one makes every delete of its table refused. The host
  page deletes from the open record's detail and from each grid row, after
  a confirmation in place
  ([0050](../decisions/0050-a-record-is-deleted-one-at-a-time-by-its-token-and-the-version-its-person-read.md),
  [0053](../decisions/0053-a-host-deletes-a-record-from-its-detail-or-its-row-after-a-confirmation-in-place.md),
  [0057](../decisions/0057-a-key-of-one-column-filled-by-a-never-repeating-default-counts-as-numbered.md)).
- **A delete reaches other tables only through the foreign keys its policy
  names**, each in `cascades` with what it does -- CASCADE, SET NULL or SET
  DEFAULT -- and only where the account may DELETE from every table it
  reaches: the fixture's deliveries are deleted with their parcels, on both
  engines, once a policy names `fk_parcel_delivery`, and its orders with
  their lines, deliveries and parcels once one names `fk_order_line_order`,
  `fk_delivery_order` and `fk_parcel_delivery`. A key nobody named, one
  whose action changed, a table outside the scope or a SET NULL another
  key follows ON UPDATE refuses the delete, at publish and in the
  database's own statement, and nothing is deleted; on PostgreSQL such a
  delete locks every table it reaches first. The rows a cascade reaches
  are the database's, asked of no form's policy
  ([0051](../decisions/0051-a-delete-reaches-other-tables-only-through-foreign-keys-the-policy-names.md)).
- **The chosen records of a page can be deleted in one request**, up to
  `LIST_PAGE_SIZE`, where the policy's `bulk.delete` grants a role that
  may delete: each record deleted on its own, as a delete of it alone
  would be, in the order sent, and answered with what became of each --
  deleted, refused in its delete's own words, or not sent once a record's
  answer was lost or `FORMANCY_DATA_BULK_DEADLINE_MS`, 14 s unset and
  chosen, has passed. A set can be left half deleted, each record named.
  It is the runtime plane's `POST /v1/forms/:id/records/delete-chosen` and
  `@formancy/data-client`'s `deleteChosen`, which reads a lost request
  record by record (`reconcileChosen`); the host page and the studio
  offer no control for it, and a policy names the grant by hand
  ([0173](../decisions/0173-chosen-records-are-deleted-each-on-its-own-with-one-answer-per-record.md)).
- **A person is shown the forms they may read**, and nothing about any
  other, each with the forms whose rows a page may list below one of its
  records, derived from the published forms' foreign keys and types without
  a statement to any database, and the group it is listed under -- its
  root schema's name in words, "Sales", or none for the engine's own
  default schema, `public` or `dbo`, unless its presentation names another
  or none; the host page lists them under their groups with a search and
  the forms linked to the open one, and an open record's child rows in tabs
  beside it
  ([0045](../decisions/0045-the-runtime-plane-lists-the-forms-a-person-may-read-and-nothing-about-the-others.md),
  [0047](../decisions/0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md),
  [0142](../decisions/0142-a-records-child-forms-are-tabs-beside-it.md),
  [0143](../decisions/0143-a-form-is-listed-in-a-group.md),
  [0144](../decisions/0144-the-host-lists-its-forms-by-group.md)).
  A form that is its own child is shown as a tree of its records, and the
  host page's Drill down shows one level at a time with a trail back
  ([0110](../decisions/0110-a-form-that-is-its-own-child-is-shown-as-a-tree-of-its-records.md),
  [0090](../decisions/0090-a-hosts-workspace-can-drill-down-one-level-at-a-time-with-a-trail-back.md)).
- **One definition, both renderers**, through one client; the host page
  draws a record in React, Angular or both, as the person chooses
  ([0029](../decisions/0029-a-host-renders-a-published-form-through-one-client.md),
  [0047](../decisions/0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md)).
- **Unsaved work is asked about before the host page drops it**: anything
  on the page that would close a form holding unsaved changes asks first;
  a reload or a closed tab does not
  ([0047](../decisions/0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md)).

**For the operator:**

- **The whole product from one command**, as [*Get started*](../../README.md#get-started) says
  ([0032](../decisions/0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)),
  and a guide that puts it behind a Cloudflare Tunnel and Access, through
  which nothing has run yet
  ([0037](../decisions/0037-cloudflare-is-the-edge-not-the-runtime.md)):
  [*Deploying*](deploying.md).
- **Audited and measured.** One audit event for each request that reaches a
  route of either plane, and never a value
  ([0023](../decisions/0023-the-audit-trail-is-operational-not-evidence.md),
  [0033](../decisions/0033-the-administrator-plane-is-audited.md)); a
  delete's only trace is the keyed hash of its token, and without an audit
  key there is none
  ([0050](../decisions/0050-a-record-is-deleted-one-at-a-time-by-its-token-and-the-version-its-person-read.md));
  a save of a record with its rows counts its row changes and names none
  ([0155](../decisions/0155-a-records-rows-may-be-saved-with-it-in-one-transaction-guarded-by-its-version-and-checked-as-a-whole.md));
  performance measured through the shipped server on both engines, for every
  runtime request but a page of records, a file of them, the menu of forms
  and a delete, and held in CI by rows read and round trips, never a
  time -- a page of records deep in key order held by the rows it reads,
  untimed
  ([0034](../decisions/0034-performance-is-measured-through-the-shipped-server-and-held-without-a-clock.md)).
- **A host identity key rotates without a restart.** A JSON Web Key Set
  file, each key selected by the `kid` a token names and read again on
  SIGHUP; a bad file leaves the keys in force, and nothing is fetched
  ([0059](../decisions/0059-the-host-identity-key-is-a-set-selected-by-kid-and-read-again-on-sighup.md)).
- **A host page on another origin is answered when its origin is listed
  exactly**; the administrator's plane answers no other origin, and a
  request riding a grant from before an origin was removed is refused in
  every browser that sends `Sec-Fetch-Site`
  ([0060](../decisions/0060-the-runtime-plane-answers-the-origins-an-operator-lists-and-the-administrators-plane-none.md)).
- **Every CI run ends in a report** of what it was tested on, which a release
  signs and attaches
  ([0035](../decisions/0035-a-release-report-is-derived-from-the-run-that-gated-it.md)),
  and since 0.2.0 it holds every shared case on every image of
  each engine's matrix, failing a run in which one is missing or failed on
  any of them
  ([0067](../decisions/0067-the-adapter-suites-run-on-every-image-of-a-per-engine-matrix.md));
  the built studio and host page carry the licence and notice texts of
  what they bundle, but what Vite folds in as text
  ([0046](../decisions/0046-a-built-app-carries-the-licence-and-notice-texts-of-everything-it-bundles.md)):
  [*Development*](development.md).
