# 0159 — A form binds a database routine as an action over the open record

- **Status:** accepted
- **Date:** 2026-11-16
- **Deciders:** Daniel Bacher
- **Verified by:** what data-core decides of an action, the part of this
  decision built so far; the adapters' run, the route, the client and the
  pages are later records', and nothing serves or runs an action yet.
  Every case was watched failing with its rule taken out, the file put
  back byte for byte, on 2026-11-16.
  `packages/data-core/src/generate/actions.test.ts` -- an action is bound
  with its routine, each parameter in the routine's order with its source,
  a key and a field as the column the locked row is read by, and the move
  (watched failing with the actions left out of the bindings); a form that
  binds none carries no `actions`, and its bindings equal the ones it had
  before this record (watched failing with `actions` written for every
  form); a note names the routine, the move and what the policy does not
  bind, and a routine that reaches past its caller's grants (watched
  failing with the note left out); the dialog is one formancy's validator
  accepts and the generator writes again byte for byte (watched failing
  with its layout naming a field twice), and asks a yes or no as a
  checkbox that starts unticked rather than one a person must tick
  (watched failing with every field required: the engine reported
  `required` on an unticked checkbox). Every refusal is a note naming its
  rule, and the action is left out: a view, no key, no confirmed
  concurrency, a version column the account may not read and UPDATE, a
  version that does not prove the record -- the rule delete keeps, asked
  through the same function -- and a rowversion form without a confirmed
  touch column (watched failing with each check in `actionUnoffered` and
  `actionMove` taken out); a snapshot discovered without routines, a
  routine not in it, and one behind a routines gap, each in its own words
  (watched failing with each taken out); a routine the account may not
  execute, a PostgreSQL procedure, a function that returns a value or rows,
  an OUT, INOUT or VARIADIC parameter, an unnamed one, a domain-typed one
  (watched failing with each check in `routineProblem` taken out in turn);
  a SQL Server parameter whose name is not a regular identifier, and a SQL
  Server function (watched failing with each taken out); a PostgreSQL
  routine every call of which is ambiguous beside an overload whose further
  parameters all have defaults (watched failing with `ambiguousBeside`
  unasked); a parameter given nothing, given twice, one the routine lacks,
  and one input given to two parameters (watched failing with each check in
  `parametersFor` taken out); a field that is no column field, a field of
  another kind, a key column that is not the record's key, an input no
  dialog field can write, and an attribute given to a yes-or-no parameter
  (watched failing with each check in `boundSource` taken out). A request
  that is not one is thrown, naming it: a name no URL can carry, two of one
  name, a selection's scope, a routine named without its signature, a
  source of no kind this release reads, an input that is no field key
  (watched failing with each check in `assertChoices` taken out). A
  column fits a parameter only where the parameter holds every value it
  holds -- its length in the same unit, its range, its precision and scale,
  its float width, its zone (watched failing with each case of
  `fitProblem` answering null); an input's type is one a dialog field
  writes (watched failing with the read-only control unasked); a key is
  held to its parameter as a field is (watched failing with the key's fit
  unasked).
  `packages/data-core/src/policy/actions.test.ts` -- an action no grant
  names is nobody's, and a policy without `actions` keeps its meaning
  (watched failing with an absent grant read as every reader's); a role
  needs read and the action, and not update: the auditor, who updates
  nothing, runs `ship` (watched failing with update asked of every role an
  action names); refused, each in its own words: a role that may not read
  (watched failing with the read check taken out); a role that may not
  read a field the action passes (watched failing with the field check
  taken out); an attribute no row filter or through of the form compares
  with (watched failing with it unasked), where a through's attribute is
  one (watched failing with throughs left out of what is established); an
  action granted on a form whose records nothing scopes while a lookup's
  options are filtered (watched failing with the scope check taken out);
  and an action the form does not bind (watched failing with that check
  taken out). A key is passed whatever the role may read (watched failing
  with a key held to the field rule). `actions` is read as every grant is
  (watched failing with it left out of the properties read: every policy
  naming one refused), and a context that cannot scope a run is refused
  `missing-attribute` (watched failing with the filter unresolved in
  `authorizeAction`).
  `packages/data-core/src/actions/plan.test.ts` -- a run is planned as the
  record by its key and the version read, under the clerk's tenant, the
  move, and each argument in the routine's order: the key and the amount as
  columns of the locked row, each answer canonical, the actor's id from the
  context (watched failing with the field source not read from the row: the
  actor's id was passed in its place); a context value goes through its
  parameter's codec, a UUID in lower case whatever case the token carried
  (watched failing with the context's text passed as it was). Refused before
  anything is sent: a key named twice, `duplicate-record` (watched failing
  with that check taken out: the count check answered in its place); more or
  fewer than one record (watched failing with the count unchecked); every
  answer its parameter refuses, collected by input, naming no value (watched
  failing with the first error returned alone); an answer for no field of
  the dialog (watched failing with it ignored); a person the policy does not
  let run it, before any token is read, and a context without its tenant
  (watched failing with the policy unasked: a garbled token answered); a
  token, a version, an action or a body that is not one (watched failing
  with each check taken out); a context value its parameter cannot hold,
  naming no value (watched failing with the codec's refusal ignored); a row
  filter that pins the column a run moves (watched failing with it
  unchecked). Decided over the request's description: a root whose key is
  gone and a routine whose parameters changed are refused `drift`, in words
  that name neither, and a routine whose reach alone changed runs (watched
  failing with the routine's shape uncompared); a stored binding the
  generator would not write -- another type, another move, a field key that
  is not the column's -- is refused (watched failing with `bindingProblem`
  answering null).
  `packages/data-core/src/presentation/actions.test.ts` -- a patch that
  edits words alone publishes, the form the base itself, and the actions a
  page is offered carry the words, the dialog still one formancy accepts
  (watched failing with the words not applied to the dialog); a field's
  type, a routine, an empty list are no property a presentation holds
  (watched failing with an input's unknown properties ignored); refused at
  publish: an action the bindings lack, a label equal to the base's, an
  entry that says nothing, an input the dialog lacks, an input's label equal
  to the field's, a removal of help text the field has not, inputs out of
  the dialog's order, inputs over an action with no dialog, actions out of
  the bindings' order, a refresh out of its order, an action named twice
  (watched failing with each check taken out in turn). Rebased, the words
  follow the action by its name and each input by its key, and those of an
  action no longer bound and of an input no longer asked are dropped and
  said (watched failing with the actions' words left out of the rebase);
  an action whose every word is dropped leaves no entry, and a form with
  none leaves `actions` out (watched failing with an entry carried however
  little it says: the rebase threw on its own presentation).
  `packages/data-core/src/drift/routines.test.ts` -- a bound routine
  dropped blocks its action alone, in review and at the runtime (watched
  failing with the routines family left out of `diffSnapshots`); changed in
  what a call rests on blocks it (watched failing with `callShape`
  comparing names alone); no longer executable blocks it (watched failing
  with the check taken out); reaching past its caller's grants is for
  review and stops nothing (watched failing with reach compared as a
  call's); changed in what a call does not rest on is for review (watched
  failing with it read as a call's); behind a routines gap blocks it, the
  gap said once (watched failing with gaps unasked); out of scope blocks it
  (watched failing with scope unasked); unknown, where the current snapshot
  records no routines, blocks every action (watched failing with the
  routines family returning nothing there); made ambiguous by a new
  overload blocks it, said once on the overload (watched failing with the
  ambiguity unasked). A routine nothing binds, new, changed or gone between
  two snapshots that both record routines, is a note (watched failing with
  a new one stopping an action). A change of the root stops the actions
  that pass a column their parameter no longer holds, and not the others
  (watched failing with the column rule taken out); every action where a
  run cannot move the version, and none for the DELETE grant (watched
  failing with every privilege change read as the record's address); and
  every action where the record's key is gone or out of sight (watched
  failing with the rule for a change that stops update and delete together
  taken out: the keys gap left both running). `drift/fixture.ts`, which
  every drift suite passes through, holds that the runtime runs every
  action review lets run. `packages/data-core/src/drift/diff.test.ts` -- a
  routine nothing binds that changed between two snapshots that both record
  routines is a `routine-changed` note, which 0158 left unsaid (watched
  failing with the notes of unbound routines left out).

## Context

Administrator-named actions -- DATA-36 -- run logic the deployment keeps in
its database over the open record, after asking the person something
first, as a confirmation or a small form. The design weighed three
mechanisms and chose one: a routine of the form's own database, called in
one transaction with the record locked, because it is the shape the module
already has -- the catalog discovered, a binding generated and checked
against the snapshot, a policy that decides who may, a guarded statement,
drift -- and nothing new runs in the server's process or calls out.
Handlers the operator registers and an allowlisted HTTP call are other
designs. A deployment's refusal in words the person reads arrived first
(0156), and the routines in scope, when a discovery asks (0158).

This record decides what data-core holds of an action before anything runs
one: which routines can be bound and how each parameter gets its value,
the dialog asked first, who may run it, what a run is planned as, and what
drift stops. The adapters' run -- the transaction, the routine's guard, the
outcomes -- the route, `data-client`'s call and the studio's and host's
panes are later records'. Two questions were answered before it was
written: on a SQL Server form whose concurrency is a rowversion, a run
moves the rowversion by setting a column to itself, rather than locking
it alone; and a text the deployment wrote under `formancy: refused: `
reaches the person from a routine as from a trigger (0156).

The data server reads a generation request property by property, and a
stored request that holds one it does not read is refused as not in its
normalised form (`packages/data-server/src/generation.ts`, 0030). It reads
no `actions`.

## Decision

1. **A form's actions are named in its generation request, and the
   generator binds each or says why not.** `GenerationRequest.actions` is
   a list of `ActionChoice`: a name -- lower-case letters, digits and
   hyphens, at most 64, what a run's URL will carry -- unique in the form,
   the routine as schema, name and signature, the scope `record`, and for
   each parameter where its value comes from. `generateForm` binds each it
   can into `FormBindings.actions` and writes a `blocked` note naming the
   rule that refused any other, which it leaves out (0009). A refusal is a
   note, never a throw: a regeneration against a database whose routine
   changed must still produce the form. A request no generator could
   honour -- a name no URL carries, two actions of one name, another scope,
   a source of no kind this release reads, an input that is no formancy
   field key -- is thrown, as an unknown root is. `bindings.actions` is
   absent for a form that binds none, so every form published before keeps
   comparing equal to its regeneration. `generate/actions.ts`'s
   `bindAction` is the one rule, which the planner asks again of a stored
   binding.
2. **Which routines.** One the account may execute; on PostgreSQL a
   function returning void -- a procedure may COMMIT inside itself, and a
   value a run would throw away -- and on SQL Server a procedure, since a
   function cannot write; only `in` parameters, all named, of a type the
   adapter's closed table holds (0158); on SQL Server each name a regular
   identifier, which an EXEC passes unquoted; and on PostgreSQL none beside
   an overload whose arguments begin with all of its own and whose further
   arguments all have defaults, beside which every call of it is ambiguous,
   cast or named (0158, R7).
3. **Every parameter is mapped exactly once**, none left to a default --
   SQL Server's catalog keeps none (0158) -- from one of five sources,
   each typed by the parameter: `field`, a column a column field of the
   form is bound to, by the column's name; `key`, a column of the record's
   key; `input`, a field of the dialog; `attribute`, one of the verified
   context's; `actor`, the actor's id. A column passes only where the
   parameter holds every value it holds -- the kind, the range, the length
   in the same unit, the precision and scale, the float width, the zone
   (`fitProblem`). A PostgreSQL parameter keeps no length, precision or
   scale (0158), so there only the kind and the range are compared: the
   catalog says less, the rule is the same. An input is a type
   `controlFor` makes a writable field of. An attribute and the actor's id
   are text, and go to a text, whole-number or UUID parameter only.
4. **A run needs the delete's ground, and moves the version.** An action
   is offered only on a table with a key, a confirmed token, and a version
   that proves the record -- `versionProvesRecord`, the rule delete keeps,
   asked through `actionUnoffered` beside `deleteUnoffered` so the two
   cannot disagree (0050): a run's effect is as opaque as a delete's reach,
   and a version that cannot tell a record from one created again under
   its key would let an old read act on the new one. The binding names how
   a run moves the version, `move`: a version column incremented, which
   the account must read and UPDATE; on a rowversion form, the touch
   column 0155 confirms, set to itself, which moves the rowversion, held to
   0155's `touchColumnProblem` -- no key's or foreign key's column, not
   generated, readable and updatable -- and never inferred, so a run and a
   save of rows move one rowversion through one column. A rowversion form
   whose request confirms no touch column offers no action, and says so.
5. **The dialog is generated, stored and served as stored.** One field per
   `input` source, in the routine's order, made by `controlFor` from the
   parameter's type and labelled from the input's name, in a spec 5
   document whose id is the form's and the action's: `bindings.actions[]
   .dialog`, `null` where nothing is asked. Every field is required, so a
   parameter never receives a NULL its person did not choose -- but a
   checkbox, which formancy counts as answered only when ticked, starts
   unticked, so false is an answer. It is in the bindings because they are
   what every write compares with the generator (0030), so no bundle part
   is added, and a later release whose generator writes another dialog
   changes no published one.
6. **Its words are the presentation's.** `PresentationOverrides.actions`,
   in the bindings' order, holds per action only what differs from the
   generator's: a `label` over the action's name in words, a `confirm`
   sentence asked before a run, a `done` sentence in place of "Done.", the
   views to read again -- `list`, `children` -- and each input's label and
   help text. Words alone: nothing there can retype, add or require a
   dialog field or bind a routine. `applyPresentation` fits them to the
   bindings at publish, as a field's entry is fitted (0030), and
   `presentedActions` gives the actions as a page will be offered them,
   the words applied. A rebase carries them by the action's name and each
   input's key (`presentation/rebase-actions.ts`); an action no longer
   bound and an input no longer asked drop their words, and say so.
7. **Who may run it: read and the action, never update.**
   `FormPolicy.actions` names, per action, the roles that may run it.
   Absent, or an action it does not name, is nobody's, so a policy
   written before keeps its meaning. A role needs read -- a run names the
   version its person read -- and the action, and not update: an action is
   an operation of its own, as a database grants EXECUTE without UPDATE,
   and requiring update would make every action an editor's. The module's
   own write, the version move, is the guard's bookkeeping, not the
   person's edit. `validatePolicy` refuses an action the bindings do not
   bind, a role that may not read, a role that may not read every field
   the action passes -- the routine would be handed a value its person is
   kept from (0011) -- an attribute no row filter or through of the form
   compares with, which a context need not carry, and, as for a delete, a
   grant on a form whose records nothing scopes while a lookup's options
   are filtered. A key is always passable: the token is the address the
   person holds. `authorizeAction` is asked before any statement, as
   `authorizeOperation` is, and `runnableActions` names the actions one
   person may run, each one it lets through.
8. **What the policy does not bind, said before publication.** The
   routine's own writes are the deployment's, as a trigger's are: it may
   write fields no grant lets the person write, move a state field
   outside the listed moves (0112), delete through keys the policy does not
   name (0050, 0051), and with `reach: 'owner'` act beyond the account's own
   grants. The generator's note on every bound action says so. What the
   module holds: the routine is given nothing the person may not read, and
   a run acts only on the row the person's filters and throughs admit, at
   the version they read, the open version alone on a form over versions
   (0113).
9. **A run is planned in data-core** (`actions/plan.ts`, `planAction`, the
   request in `actions/types.ts`): the bindings against their snapshot and
   the action against the generator's own rule; the body; the policy, fitted
   and scoped as a read is; a row filter pinning the move column refused, as
   an update's is; the root and the routine as the request described them,
   the root by drift review's root families and the routine by the call
   shape `routine-changed` compares (0041); each token, once -- a key named
   twice is `duplicate-record`, the action planner's own refusal, beside the
   record planners' codes -- and exactly one record; the version; every
   answer through its parameter's codec, every error collected by input; an
   answer for no field over-posting; each context value through its codec.
   The request names the record by key and version, the filters, the
   throughs, the open-version column, the move, and each argument in the
   routine's order: a field or a key as a column of the locked row, so its
   value never leaves the database; anything else a canonical value (0008).
10. **Drift reads the routines an action binds** (`drift/routines.ts`,
    0010). A bound routine gone, changed in what a call rests on -- its
    kind, what it returns, its parameters' names, type identities, modes
    and order -- no longer executable, behind a routines gap, out of scope,
    or made ambiguous by a new overload blocks the actions over it and only
    them; one that started or stopped reaching past its caller's grants, or
    changed otherwise, is for review. A change of the root stops every
    action where it breaks reads or stops update and delete together -- the
    key and the token a run locates and guards its record by -- or stops
    delete for another reason than what a delete alone does, and the
    actions that rest on the column it is about where that column no longer
    serves them. `DriftVerdict.actions` is the actions still runnable,
    present exactly when the bindings bind one; a change that stops one
    blocks. Where the current snapshot records no routines, every bound
    action stops: whether its routine is there cannot be said. Between two
    snapshots that both record routines, a routine nothing binds that is
    new, changed or gone is a note; 0158 said nothing of one. **The body is
    not compared**: its text is the deployment's logic, and on SQL Server
    reading it needs VIEW DEFINITION, which an account that may execute
    need not hold. A changed body is not drift.
11. **The wire is declared** (`actions/wire.ts`): `FormAction`, an action
    as a page is offered it; a run's body; its answer, the tokens and never
    a version, since the routine may move it after the run did; and its
    lost answer, which names what was addressed.
12. **Today's server publishes no action.** It reads no `actions` in a
    generation request, so a stored request naming one is refused as not in
    its normalised form, and a policy or a presentation that names one is
    refused against bindings that bind none.

## Consequences

**What it buys.** An action can be named, checked, governed, worded and
reviewed for drift on both engines from one contract, before any adapter
runs one, and every rule a run rests on is the generator's, asked again by
the planner of a stored binding and by drift of the database as it is
now, so the three cannot disagree.

**What it costs.**

- **No action on a table whose version cannot prove the record.** A table
  keyed by values people type, with a version column, offers no action, as
  it offers no delete (0050).
- **A rowversion form needs a confirmed touch column**, and the generator
  of this release writes none: the request's `touchColumn` is 0155's, and
  until its generator half lands no SQL Server form with a rowversion
  offers an action. Every run fires the table's UPDATE triggers with
  `UPDATE()` true for that column, adds a row to temporal history, and is a
  change to CDC and change tracking, whether or not the routine changes the
  row: a cost a deployment with those meets on every run.
- **An attribute an action passes must be one a row filter or a through
  compares with**, the attributes every request of the form resolves. A
  `region` the host establishes and no filter reads cannot be passed.
- **Every dialog field must be answered.** No dialog passes NULL to a
  parameter, and a yes or no starts as no.
- **A role granted an action must read every field it passes**, which may
  mean granting an approver read of a field they never see on the page.
- **A PostgreSQL parameter is compared by kind and range alone**, since
  pg_proc keeps no length, precision or scale: a `varchar(20)` parameter
  takes a `text` column, and the database decides what it does with a
  longer value. SQL Server's sizes are compared.
- **The routine is opaque.** Field grants, state moves and cascades do not
  bind what it does, and a routine with `reach: 'owner'` is not bounded by
  the grants the snapshot records (0027).
- **Drift review of a form with actions needs a discovery that records
  routines.** One that does not stops every action as unknown, and nothing
  in the server asks for routines yet, so review in this release can never
  clear an action -- none can be published either.
- **More notes.** Between two snapshots that both record routines, every
  routine change in scope that no action binds is said, on every form whose
  snapshots record routines.
- **A label that is a message reference** words the dialog's section and
  not its title, which formancy holds to a literal.
- **Rolling back.** A server older than this record refuses a policy and a
  presentation that name actions, as it refuses every property it does not
  read; none can be published before the server reads `actions`.
- The drift check's lines and the studio's name a routine as
  `describeRoutine` spells it. Nothing reaches either until a snapshot the
  server takes records routines, so neither is tested yet.

**What it does not do.** Nothing runs an action: there is no port, no
adapter run, no route, and `GET /v1/forms/:id` offers none. A selection of
records, a preview the database words and a check routine bound to a
write are later records'. The run's deadline is the route's to set. No
routine's body is read.

**Forecloses:** nothing.

## Alternatives considered

**The generator infers a rowversion's touch column**, a column of no key or
foreign key, not computed, chosen deterministically -- the question's first
wording. Lost: 0155 confirms one and never infers it, and two rules for the
one column a rowversion is moved by would let a run and a save fire
different triggers' `UPDATE(column)`, and choose a column a trigger guards.

**Lock a rowversion record without moving it.** Lost: a second press from
the same read on another replica would run again, and a lost answer could
not be checked by the version.

**An action needs update.** Lost: every action would be an editor's, and
an approver who may not edit an invoice could not close it.

**The dialog in a bundle part of its own, or generated when the form is
served.** Lost: the bindings are already what every write compares with the
generator, and a dialog generated at serving would change under a later
release's generator.

**A routine that cannot be bound thrown.** Lost: a regeneration against a
database whose routine changed would fail whole, where the form without
the action is what a person reviewing needs.

**A `field` source by field key.** Lost: a key renumbers (0030); the
request names columns, as `pinned` and `versionColumn` do, and the binding
adds the key the policy grants read on.

**Any attribute the host may establish.** Lost: one no filter compares
with is one no context need carry, and every run would then be refused.

**`duplicate-record` among the record planners' codes.** Lost: the
server's mapping of every such code would change in a release that serves
no action.

**A required checkbox.** Lost: formancy counts it answered only when
ticked, so every person would be made to tick it.

**Unbound routines left unsaid**, as 0158 left them. Lost: a form whose
snapshot records routines is one an administrator discovered to bind
them, and a routine that appeared or changed is what they review.

## Older records

Extended, not edited away: 0009 (a form's actions bound or refused with a
note, and a request naming none generated as before); 0010 (a routines
family, the actions a root change stops, and `DriftVerdict.actions`);
0011 (`FormPolicy.actions`, deny by default, a role needing read and the
action); 0018 (`planAction`, the planner's order for a run); 0030 (a
dialog generated into the bindings and served as stored, and its words a
patch rebased by the action's name and each input's key); 0041 (a run
decided over the root and the routine as the request describes them);
0050 (`versionProvesRecord` asked of a run as of a delete); 0155 (the touch
column a rowversion's run moves); and 0158 (drift reads a routine an action
binds, and between two snapshots that both record routines says one
nothing binds).
