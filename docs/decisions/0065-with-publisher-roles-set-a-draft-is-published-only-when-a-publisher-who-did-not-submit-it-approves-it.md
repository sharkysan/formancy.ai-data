# 0065 — With publisher roles set, a draft is published only when a publisher who did not submit it approves it, and a restore is one publisher's alone

- **Status:** accepted; extended by [0099](0099-a-browse-role-reads-any-table-or-views-rows-as-the-connections-account-does.md): the administration answer also refuses `browse`, review or not, to a caller without a browse role
- **Date:** 2026-10-16
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-server/src/routes/admin-drafts.test.ts` — a server under
  review over a real file store and a fake database whose discovery the
  test changes, as `admin-promotion.test.ts` has it, with two authors, a
  publisher, a submitter holding both roles and a clerk (`test-drafts.ts`,
  which `admin-drafts-store.test.ts` shares): a direct publish or import
  is 403 `review-required` for each of the three, with a body of the right
  shape and of none, and nothing is written; an author's draft approved by
  the publisher is version 1 in exactly the bytes the store writes for the
  bundle submitted, the drafts beside it in `.drafts`; an author approving
  or rejecting a colleague's draft, or restoring, is 403
  `publisher-required`, and the publisher restores alone; the submitter,
  holding both roles, is 403 `own-draft` on their own draft, whose
  `submittedBy` is the token's subject although the body named the
  publisher; a draft whose base another approval replaced is 409 `stale`
  with `current`, for approval and rejection alike, and out of the queue;
  drafts of one bundle on one base all read `published` once one is
  approved, one rejected before it included; a rejection reads `rejected`
  with who rejected it, and a second decision is 409 `rejected`; a
  submitter's own rejection answers and reads `withdrawn`, and takes an
  entry's number, so the next draft is 3; a bound column dropped between
  submit and approval is 409 `incompatible` with that change alone, an
  unreachable database 503 without its address, and the draft is still
  pending, then approved once the column is back; a submit is refused,
  keeping nothing, for an edited snapshot, another form id, a connection
  the allowlist does not have (with this record's sentence), another
  engine, blocking drift, an unreachable database and a base that is not
  the newest (409 `conflict`); a reassigned key is 422 `keys-reassigned`
  at submit until confirmed, the draft keeps the confirmation, and its
  approval publishes; a rejection made while an approval waits on the
  database decides first (watched failing, 201, with the second read of
  the drafts taken out); a rejection that lands while the approval writes
  the version answers 201, the draft then reads `published`, and a later
  rejection is 409 `published` (watched failing, the draft reading
  `rejected`, with a rejection asked before publication, as the
  equal-bytes case above failed too); of two approvals over one base at
  once one writes and the other is refused; without review the draft
  routes are 404, the administration answer is `{ review: false,
  publisher: true, refuses: {} }`, and an administrator publishes and
  restores alone; for an author, a publisher and a submitter, every route
  the router holds, on a deployment of its own with a draft pending --
  someone else's, and for a draft route the caller's own too -- answers
  exactly what the administration answer and that draft's `refuses` say,
  each held to a table, so a server that refused nothing would not pass
  by agreeing with itself; an author sending every route, with a body
  that would write for a publisher, writes no version and changes none;
  and a clerk is 403 for the administration answer, no token 401.
  `packages/data-server/src/routes/admin-drafts-store.test.ts` — over the
  same server: a draft entry edited on disk is 500 for its read, approval,
  rejection and the form's next submit, logged once each naming the form
  and the entry, while the queue lists the other form's draft and names
  this one `unreadable`, and an entry that is not JSON is 500 too; a
  drafts store that cannot list, read or append is 500 naming no path, and
  an append that cannot progress stops; a versions store the gate cannot
  read is 500 `internal` naming no path, for a submit over version 1 and
  an approval of a draft over it, and the operator's log has the error
  (watched failing with the gate's call outside the routes' try: Fastify's
  own 500, the error's code and message and the version file's path in
  it); a draft whose version was damaged on disk reads `stale`; twenty
  concurrent submits are drafts 1 to 20, each its own bundle (watched
  failing with the retry taken out: the losers were 500s); the queue is
  the pending drafts by form and number, each with its `refuses` for a
  publisher, a submitter and an author; a draft number that is not a
  whole number from 1 is 400, and a rejection's number, a number no entry
  has, a form with no drafts or a form id the store cannot hold 404
  `unknown-draft`; and a submit body of another shape is 400 with the
  database down.
  `packages/data-server/src/routes/admin-drafts.integration.test.ts` — on
  PostgreSQL and SQL Server, with real tokens through the shared fixture's
  servers: a publisher's direct publish or import of the order form is
  403 `review-required`, and the author's draft names its submitter by the
  token, not by the `submittedBy` its body claims; with approved_by
  dropped by plan section 14 step 8's DDL, the publisher's approval is 409
  `incompatible` with that one change and no version is written; with the
  column back, the author, who holds no publisher role, is 403
  `publisher-required`, the publisher's approval writes version 1 as the
  bundle submitted, the trail's `draft-approve` events name who was
  refused and who approved, and a clerk creates an order through the
  runtime and reads it back exactly; a publisher's second draft over
  version 1 is 403 `own-draft` for them and queued for the other
  publisher, who holds both roles; approved_by dropped again refuses that
  approval as `incompatible`, with no file written beside version 1
  (watched failing on both engines with the approval's call to `gate`
  removed: 201, version 2 written over the dropped column); and with the
  column back the approval is version 2, the second draft's bytes, which
  the runtime serves, the clerk's order read back through it.
  `packages/data-server/src/publisher-roles.test.ts` — unset is no
  review; roles are comma-separated, trimmed and counted once; `''`, `' '`,
  `','` and `' , ,'` stop with the sentence; a role outside
  `FORMANCY_DATA_ADMIN_ROLES` stops, named; the setting stops without the
  administrator's plane; and an embedder's `admin.publisherRoles` is held
  to the same rule, a value that is no list included: `createDataServer`
  refuses an empty list, a role outside `adminRoles` and a string, each in
  the rule's sentence, and builds with a list it accepts (watched failing
  with the plane's throw taken out: the empty list was built).
  `packages/data-server/src/server-log.test.ts` — through `servedPlanes`,
  publisher roles put the plane under review, a direct publish is audited
  `review-required` in the one log, and without them the administration
  answer says review is off (watched failing with `servedPlanes` leaving
  `publisherRoles` out).
  `packages/data-server/src/config-store.test.ts` — a store with drafts
  beside it lists the same forms, and the drafts store has forms and
  numbers of its own.
  `packages/data-server/src/routes/admin-audit.test.ts` — the route walk
  builds the plane under review, so each draft route sends one 401 event
  under its name and the table names no route the router lacks; and the
  draft routes' whole events: the administration answer, a direct publish
  `review-required`, the submit naming the draft it wrote, the queue, a
  read, a refused and then a granted approval naming the version it wrote,
  a rejection, an unknown draft 404 and two 401s, one naming the draft in
  its path and one whose path holds no draft's number, and no title or
  policy role of the bundle in any.
  `packages/data-server/src/cross-origin.test.ts` — its every-route
  differential, a preflight granted exactly where the request is, runs
  with the plane under review, so the draft routes are among those it
  samples.
  `packages/data-server/src/routes/admin-promotion.test.ts` and
  `admin-promotion.integration.test.ts`, unchanged and passing, which is
  what shows the import's checks moved into `routes/admin-gate.ts`
  unchanged.
  `apps/studio/src/sign-in.test.tsx` — the studio asks for the
  administration answer once the plane lets the token in, and opens the
  reviewed workbench, Submit for Publish and a Review step; and it does
  not sign in, saying why, when the server gives no answer.
  `apps/studio/src/submit.test.tsx` — under review the Publish step is
  Submit, says why in the server's sentence, and submits a draft over the
  version it read, writing no version; the changes that block a draft,
  the drift that does not, a conflict with a version approved meanwhile
  and its rebase, a database that does not answer, without its address,
  and a refused bundle are each shown as the publish step shows them,
  with axe at each.
  `apps/studio/src/import.test.tsx` — under review the Drift step's import
  submits the version file as a draft, as it was read, writing no
  version; confirms the keys the server lists and submits the draft with
  them; and says when a version was approved here since the versions were
  read.
  `apps/studio/src/versions.test.tsx` — under review an author is offered
  no Restore, with the server's sentence in its place, and a publisher
  restores alone.
  `apps/studio/src/review.test.tsx` — the Review step, against a plane
  under review and the tokens of an author, a publisher and someone
  holding both roles: the queue lists each pending draft by form, number,
  submitter and base, and one opened is drawn on the preview's own
  Blueprint paper; its policy is said in the Policy step's words -- the
  operations, each field's grants, the row filters, each lookup's rows and
  the lookups the root is reached through, and the keys a delete acts
  through (watched failing before the step showed a policy); the keys its
  author confirmed are listed; a publisher approves another's draft as the
  next version, its bytes, with the drift that did not block, or rejects
  it; an author is offered only Withdraw on their own draft and nothing on
  another's, and someone holding both roles never Approve on their own,
  with the server's sentence for each refusal; an approval refused for
  drift, and a draft withdrawn, gone stale or decided since it was opened,
  each say what became of it; a decision's answer stays when the draft
  cannot be read again (watched failing with the answer drawn inside the
  draft's read); a form whose drafts cannot be read is named and every
  other form's listed, and a queue in which none could be read does not
  say that nothing waits (watched failing); and axe at every state.
  `apps/studio/src/api.test.ts` — the client's administration answer and
  draft calls, and the refusals of a draft, in the shapes the real server
  sends. `apps/studio/src/journey.test.tsx`, *the journey under review*
  — axe and a name on every control at every state, every request one of
  the administrator plane's routes and every route of review used, and
  the steps listing Submit for Publish and a Review step. The studio's
  browser gate, `apps/studio/scripts/browser/review.mjs`, run by `pnpm
  test:browser` -- a draft submitted, a draft open for review with nothing
  of the studio's stylesheet on its paper, and a draft approved by
  keyboard, the focus then on its heading, each measured as every other
  state of the studio is.
  `scripts/cloudflare/doors.test.mjs` — the doors are read from the built
  server's router under review: the draft routes and `GET
  /v1/administration` are behind Access and not forwarded by the runtime
  door; and a plane under review the test builds apart from the
  generator registers no route doors.json lacks or gives the runtime door
  (watched failing with the generator's `publisherRoles` taken out and
  doors.json written again: the draft routes were named).
  `scripts/install-fixture/consume.ts`, run by `pnpm test:e2e:install` —
  the packed `AdminAuditEvent` carries `draft`.

## Context

Since [0020](0020-administration-is-a-separate-plane.md) the
administrator's plane has one list of roles, and that record named the
cost: "everyone who may propose may also publish", and a team that wants
a reviewer who can propose and not publish "needs a second role, which is
a later change". So one person could put a form in front of every user
alone -- its policy, which says who reads and writes which column,
included -- and the trail ([0033](0033-the-administrator-plane-is-audited.md))
said who had done it afterwards. Comparable administration tools ask
for a second person where this module asked for none: Forest Admin, for
one, can require an approval before an action runs.

Five facts of the code decided the shape.

- **A draft lived only in the browser.** The studio held it in React
  state, and the server first saw a version when it was published. A
  second person approving needs the draft kept on the server, or they
  approve something the first could still change.
- **Roles come only from the token's `roles` claim**: `identity.ts`'s
  `rolesClaim`, whose default `main.ts` never changes.
  `FORMANCY_DATA_ATTRIBUTES` is a form policy's input and is never read for
  administration (0020).
- **Three routes write a version.** A publish and an import
  ([0062](0062-a-published-version-moves-between-deployments-as-its-version-file.md))
  write a new bundle; a restore writes one the store already holds.
- **The version file is the bundle alone**, which `validateBundle` checks
  on every read ([0019](0019-a-published-form-is-checked-every-time-it-is-read.md))
  and 0062 exports as it stands. Who approved, written beside it, is a
  second write that can fail after the first; written into it, a file 0019
  and 0062 no longer read as they do.
- **A store's compare-and-swap is one directory's**
  ([0013](0013-published-configuration-is-files-with-link-based-swap.md)),
  and no form id can start with a dot, since `CONFIGURATION_ID` starts
  `[a-z0-9]`, so `<store>/.drafts` is a directory no form can be.

Four questions were settled on 2026-10-14, before any of it was built:
nobody approves what they submitted, whatever roles they hold; a restore
stays one publisher's action, alone; the composed stack and the
getting-started guide stay single-role; and the other defaults are taken,
each named below as a cost or as something this does not do.

## Decision

**Review is off unless an operator names publisher roles.**
`FORMANCY_DATA_PUBLISHER_ROLES`, comma-separated, space around each role
ignored and each counted once, read by `main.ts` before anything opens and
parsed by `publisherRolesSetting` in `publisher-roles.ts`. Unset, nothing
changes: every administrator publishes, imports and restores alone, as
before. Set and naming no role, naming a role that is not also in
`FORMANCY_DATA_ADMIN_ROLES` -- a publisher is an administrator who may also
approve -- or set beside a server whose administrator's plane is off, it
stops the process with a sentence naming what is wrong. An embedder passes
`admin.publisherRoles` to `createDataServer`, which `adminRoutes` holds to
the same rule (`publisherRolesProblem`). It is read once: changing it is a
restart.

**An author and a publisher.** Under review an administrator who holds a
publisher role is a publisher, and one who does not is an author. Who
someone is, is the token's `sub`; what they hold, its `roles`; never
anything a body says.

**One table and one decision**, in `governance.ts`. `GRANTS` classifies
every operation of the plane, typed `Record<AdminOperation, Grant>`, so an
operation added later without a grant does not compile:

| Grant | Operations | Without review | Under review |
|---|---|---|---|
| `administrator` | the connection list, test and discovery, a proposal, the version list and reads, drift, regeneration (which writes nothing), the administration answer, the queue, a draft's read and a submit | any administrator | any administrator |
| `reviewed` | publish, import | any administrator | nobody: 403 `review-required` |
| `publisher` | restore, approving a draft, rejecting one | any administrator | a publisher: 403 `publisher-required` |

Approving also refuses a draft's own submitter, 403 `own-draft`, whatever
roles they hold. Rejecting is also open to a draft's own submitter, which
is a withdrawal: an author takes back what they submitted without a
publisher. `refusalFor(operation, caller, review, draft?)` is the one
decision: the plane's preHandler asks it for every route before the route
reads its body; the approval and rejection routes ask it again with the
draft once it is read, so a draft that does not exist is 404 first; and
`GET /v1/administration` and every draft's `refuses` are derived from it,
so what the studio is told and what a route answers cannot disagree. The
refusals' sentences are written once, in `REFUSALS`:

- `review-required`: "This deployment reviews publication: submit this
  version as a draft, and a publisher other than you approves it."
- `publisher-required`: "This needs a publisher role: restoring a version,
  and approving or rejecting someone else's draft, are a publisher's."
- `own-draft`: "You submitted this draft: a publisher other than you
  approves it."

**Drafts are kept beside the versions**, in a store of their own that the
versions store makes, `ConfigurationStore.drafts()` -- for the file store,
`<store>/.drafts`, which its listing of forms never reports (`drafts.ts`).
Each form's drafts are numbered entries, written by that store's
compare-and-swap, an append that loses the race taking the next number,
and never edited:

- `{ entry: 'draft', expectedBase, bundle, keysConfirmed, submittedBy }`
- `{ entry: 'rejection', draft, by }`

A draft's number is its entry's, so a rejection takes a number and draft
numbers have gaps. A draft's state is derived whenever it is read, and
never written, the first that holds:

1. `published`, when the version after its base, `(expectedBase ?? 0) + 1`,
   is the same JSON as its bundle: what is served is a fact, so a
   rejection that landed while the approval wrote the version decides
   nothing;
2. `rejected`, when a rejection names it -- the earliest decides;
3. `stale`, when the form's newest version is not its base;
4. `pending`.

A rejection is reported with who made it, and `withdrawn` when that was
its submitter -- a flag, not a state -- on a published draft too.

An entry that does not parse, or whose bundle does not validate for its
form, makes that form's drafts unreadable: its routes answer 500
`internal`, and the log says `a draft entry does not validate, and is not
served`, naming the form and the entry, for the operator to put right. A
drafts or versions store that cannot be read or written -- a volume whose
permissions changed -- is 500 `internal` on the draft routes too, the
error in the operator's log and never in the answer, which would name the
volume's path.

**The routes.** `GET /v1/administration` is always registered and answers
`{ review, publisher, refuses }` for the caller: whether this deployment
reviews, whether they publish, and every operation the grant alone refuses
them, each with its code and sentence. Without review it is `{ review:
false, publisher: true, refuses: {} }`. The draft routes are
registered only under review; without it the router answers 404 for them.

- `POST /v1/forms/:id/drafts`, the publish's body `{ expectedBase, bundle,
  keysConfirmed? }`, a `submittedBy` in it unread, runs everything an
  approval runs short of the four eyes and the write, through the gate an
  import passes (`gate` in `routes/admin-gate.ts`, which the import, the
  submit and the approval share): 400 for a body of another shape; 422
  `invalid-bundle` for what a publish refuses, a connection this allowlist
  does not have saying "No connection is called X in this deployment: a
  version keeps its connection's name, which each deployment's allowlist
  resolves to its own database." -- true of a studio's draft and an
  imported file, which the server cannot tell apart; 503 when the database
  cannot be discovered, with no address; 422 `other-engine`; 409
  `incompatible` with only the blocking changes; 422 `keys-reassigned`
  ([0039](0039-a-publish-says-what-happens-to-the-grants-of-reassigned-keys.md));
  and 409 `conflict` with `current` when its base is not the newest
  version, whatever the keys say, so a draft is not kept over a base that
  was already replaced; a version written in the moment between that
  check and the draft's entry can still make it stale. 201
  answers `{ draft, state: 'pending', drift }`, so its author sees at once
  what drift asks a publisher to review.
- `GET /v1/drafts`, the queue: the pending drafts only, by form id in
  codepoint order and by number within a form -- the order they were
  submitted in; an entry holds no time, so across forms there is no older
  to say -- each with its form, number, base, submitter, title and what
  this caller may not do with it; and `unreadable`, the forms whose drafts
  do not read, which hide no other form's.
- `GET /v1/forms/:id/drafts/:draft`: the draft, its bundle and
  confirmations, its state, the form's newest version and the caller's
  `refuses`; 400 and 404 `unknown-draft` as for an approval.
- `POST /v1/forms/:id/drafts/:draft/approval`, in this order: the draft's
  number (400) and the draft (404 `unknown-draft`); 403
  `publisher-required`; 403 `own-draft`; 409 `rejected`, `published`, or
  `stale` with `current`; the gate again, against the database as it is
  now; the drafts read again, so a rejection that landed while the database
  was asked is 409 `rejected`; then `store.publish(id, expectedBase,
  bundle)`, 409 `conflict` with `current`. 201 answers `{ version, drift
  }`. The version file is the draft's bundle as the store writes every
  version, and nothing else.
- `POST /v1/forms/:id/drafts/:draft/rejection` answers 201 `{ draft, state:
  'rejected', withdrawn }`; 403 `publisher-required` for an author
  rejecting someone else's draft; 409 when it is rejected, published or
  stale already. A stale draft is not rejected: nothing can approve it, so
  a rejection would decide nothing.

A draft's number in a path is a whole number from 1 of at most sixteen
digits that is a safe integer; anything else is 400.

**A restore stays one publisher's, alone.** It takes no draft: the version
it copies was written once already, and restore's drift gate (0030, 0062)
still decides whether the database can serve it. An import under review is
a draft: the studio submits the file, and a publisher approves it like any
other.

**Who approved is the trail's.** `ADMIN_OPERATIONS` gains
`administration`, `draft-queue`, `draft-submit`, `draft-read`,
`draft-approve` and `draft-reject`, and `AdminAuditEvent` gains `draft`:
the number a submit wrote, or the one the path names once it has a draft
number's shape, refusals and 401s included. The draft routes name the
draft's base and connection once it is read, and an approval the version
it wrote. A refusal is audited by its code.

**The studio** asks for the administration answer at sign-in. Under review
its Publish step, called Submit, submits a draft, its Drift step's import
submits the file as one, Restore is not offered to a caller the answer
refuses it, with the server's sentence in its place, and a Review step
lists the queue and draws a draft's form on white paper, as the Preview
step does, says its policy in the Policy step's words, and offers
approval, rejection or withdrawal as the draft's `refuses` allow. A
decision's answer stays on the page when the draft cannot be read again
after it.

## Consequences

**What it buys.** Under review no new form, policy or presentation reaches
the people using a deployment until two token subjects have taken part,
the one who submitted it and a publisher who did not; what was approved is
what is served, byte for byte; and the trail names both. What the studio
is told a person may do and what the server then does are one function.
A deployment that sets nothing is as it was.

**What it costs.**

- **Off unless set.** Upgrading changes nothing, so a deployment that
  wants review has none until its operator sets
  `FORMANCY_DATA_PUBLISHER_ROLES` and restarts.
- **Every submit and every approval discovers the database**, as an import
  does, and a database that cannot be reached refuses both (503): fail
  closed, formancy.ai 0022. Under review a version is written only while
  drift against the database blocks nothing, which a direct publish without
  review does not ask; a form whose database is down cannot be published
  at all.
- **Drafts accumulate.** Nothing deletes one, rejected, published and stale
  ones included. The queue and every draft route read all of a form's
  entries, and the queue every form's, with the versions store, on every
  request; nothing is cached, and the cost is not measured.
- **"Published" is derived by equal bytes**, at the version after a
  draft's base, and before a rejection is asked, so two drafts of one
  bundle on one base both read `published` once either is approved, and
  the other's approval is 409 `published`; a rejected draft of that
  bundle reads `published` too, which is what is served.
- **Who approved is only in the audit trail**, the `draft-approve` event's
  actor. The version file is the bundle alone, so a trail that was not
  kept leaves nothing that says who approved, and the trail is not
  evidence (0023).
- **Nobody is told a draft waits.** A pending draft is seen when a
  publisher opens the queue.
- **No route shows a publisher a draft's drift before approving.** What
  blocks refuses the approval; what drift only asks to review is in the
  approval's answer, after the version is written, and in the submit's
  answer to its author.
- **No self-approve permission.** A deployment under review needs a
  publisher besides each draft's author; one person alone cannot publish
  under it at all.
- **A publisher alone restores any version**, one published by a single
  administrator before review was turned on included, which nobody
  reviewed.
- **Turning review off leaves the drafts on the volume**, which no route
  then reads or publishes; turned on again, they are read as before, and a
  pending one whose base is still the newest version is pending again.
- **Roles are read from the token's `roles` claim only**, publisher roles
  included: an identity provider that puts them elsewhere, Keycloak's
  `realm_access.roles` for one, maps them into `roles` itself.
- **The composed stack and the getting-started guide stay single-role**:
  review is described in `packages/data-server/README.md` and held by the
  suites above, and no gate runs it in the composed stack. Compose hands a
  variable it is given but not set to the container as `""`, which stops a
  server under this setting by design; `compose.yaml` does not list it.
- **An approval and a rejection of the same draft at the same moment can
  both succeed**: the version is written, the rejection answers 201, and
  the draft then reads `published`, the rejection beside it deciding
  nothing. The two writes go to two stores, which share no
  compare-and-swap; reading the drafts again just before the write narrows
  the window to a round trip to the filesystem and does not close it. The
  trail has both events.
- **A draft goes stale when any other version is written** -- another
  draft approved, or a publisher's restore -- and is then never
  approvable: it is submitted again over the newest version, and its
  confirmations of reassigned keys with it.
- **One damaged entry stops its form**: a form one of whose entries no
  longer parses or validates serves none of its drafts and takes no new
  one until the file is put right, since that entry could be the rejection
  of any draft before it. The queue still lists every other form's, and
  names it.
- **An approval waits for a discovery**, as long as the database takes to
  describe itself.
- **The studio shows a draft, not what it changes.** Its Review step draws
  the draft's form on paper and says its description, submitter, base,
  confirmed keys and policy, and nothing compares it with the version it
  replaces.
- **The confirmation of a reassigned key is kept in the draft** (0039), as
  the author made it, and the publisher approves with the author's
  confirmation, not one of their own. The version file still keeps none.
- **The port and the event grew, review or not.** `ConfigurationStore`
  has `drafts()`, which a store an embedder implements must now provide;
  `AdminAuditEvent` has `draft`, and its `operation` the administration
  and draft names, so
  code that builds an event or narrows its operations exhaustively changes
  with this release, as `scripts/install-fixture/consume.ts` did.
- **The published performance figures predate this record.** The server
  files it changed are part of what `docs/performance.md` measured, and
  `node scripts/performance-stale.mjs` names them, so the figures are
  measured again before the next release, which this blocks, not a pull
  request.

**What it does not do.** Approve by more than one publisher, review a
restore, notify anyone, show a draft's drift before approval, compare a
draft with the version it replaces, delete or expire a draft, edit one -- a change is another draft -- take a comment on
one, read roles from another claim, or let anyone approve their own draft.

## Alternatives considered

- **A self-approve permission**, as Forest Admin offers one. A publisher
  who could approve their own draft is one person publishing alone with an
  extra click, which is what review is for.
- **A restore through a draft.** A restore puts back a version that was
  written once already, and is how a bad version is undone quickly; a
  second person in that path delays the undo, not the change.
- **An approval entry written beside the version, or into its file.** Two
  writes, one of which can fail after the other; and a version file that
  held an approval would no longer be the bundle 0019 validates and 0062
  exports.
- **Drafts in the browser only**, as before. The publisher would approve
  something its author could still change, and the server could not say
  who submitted what.
- **Approvals by N of M publishers.** Four eyes needs one second person,
  and no deployment has asked for more; a count can be added to the grant
  when one does.
- **A publisher role mapped from `FORMANCY_DATA_ATTRIBUTES`.** 0020 keeps
  administration on the token's roles; attributes are what a form's
  policy reads.
- **A draft's state written into its entry** on approval or rejection. A
  write per decision that can disagree with the versions store; derived on
  read, there is nothing to disagree.
- **Rejecting a stale draft.** Nothing can approve it, so a rejection
  would decide nothing.
- **Accepting a draft over a base that is not the newest**, as 0039's
  check alone would, when no key needs confirming. It would be stale on
  arrival.
- **Review on by default from this release.** Every deployment that
  upgraded would stop publishing on the day it upgraded.
- **A setting of its own for the drafts' directory**, or an option beside
  the store. Drafts kept beside another deployment's versions would name
  bases from another store's numbers; made from the store, they cannot be.
- **Drafts in each form's own directory.** The store numbers and lists
  what that directory holds as the form's versions, so a draft there would
  be one, or need a second numbering beside them; a store of its own
  leaves the versions as 0013 has them.
- **Refusing the queue when one form's drafts cannot be read.** One
  damaged file would hide every other form's drafts from every publisher.

## Older records

Extended, not edited away: [0013](0013-published-configuration-is-files-with-link-based-swap.md)
(the drafts store beside the versions, written by the same
compare-and-swap); [0020](0020-administration-is-a-separate-plane.md)
(the second role it named as a later change);
[0024](0024-the-studio-speaks-only-the-admin-plane.md) (the studio's
review step); [0033](0033-the-administrator-plane-is-audited.md) (the
draft operations and the event's `draft`);
[0039](0039-a-publish-says-what-happens-to-the-grants-of-reassigned-keys.md)
(a draft keeps the keys its author confirmed);
[0062](0062-a-published-version-moves-between-deployments-as-its-version-file.md)
(an import under review is a draft, and its checks are the gate a submit
and an approval pass too).
