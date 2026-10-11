# 0045 — The runtime plane lists the forms a person may read, and nothing about the others

- **Status:** accepted
- **Date:** 2026-10-11
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/records/children.test.ts` -- a lookup onto the
  parent form's identity, column for column in its order and of the same
  normalized types, makes a child: an order's lines through `order`, and an
  order through the two columns of its customer's key, and across two
  snapshots that agree on both; nothing on another connection, through a
  foreign key onto a unique key that is not the identity (a customer's onto
  its country's `iso_code`), through the identity's columns in another
  order, under a parent with no identity, through a `numeric(12,4)` key
  onto a `numeric(12,2)` one -- where a `numeric(12,2)` key onto it is a
  child -- where the child's snapshot retypes its foreign key, or where
  the parent's snapshot alone retypes its key; a text key makes a child;
  an employee managed by an employee is its own child, and an order names
  the employee twice, through who created and who approved it (watched
  failing with only the target table compared: five of these named a
  child; with the identity compared and the types not: the wider key and
  both retyped ones; with the parent's key types read from the child's
  snapshot: the order whose key only the parent's snapshot retyped was
  named; and with text keys refused: the depot was not named under its
  region). `records/menu.test.ts` -- `grantedOperations` is
  what the policy grants of what the form offers, an operation the
  context cannot scope not granted; `formMenu`, over each bundle read
  alone by `menuForm`, names, in codepoint order whatever order the
  bundles came in, only the forms a person may read --
  none for a person who may only create, has no tenant, or holds no role
  -- and a child only where the child form is named, its list is offered
  to that person and the field is one they may read: no line list for an
  auditor who may not read the lines' key, none for a line form published
  before `through`, no order under the employee for a clerk who may not
  read who created it, nothing on another connection (watched failing with
  every form named, whatever the policy: the intake clerk's create-only
  forms were named, and so was a line form only managers read; with
  `listable` replaced by the readable fields: the
  unscoped line form was named under the order; and with no check at all:
  the auditor's lines were).
  `packages/data-server/src/routes/runtime-menu.test.ts` -- over a real
  file store and a registry that refuses every connection: a clerk is told
  of the order form with its lines as a child, a buyer of the order alone,
  a person granted nothing of nothing, without a token 401, and no
  connection is asked for; the answer is the same to the byte after a form
  the clerk may only create with is published, twice, and another beside
  it (watched failing with the core's read check removed: the managers'
  form was named); a version edited by hand and one that is not JSON are
  left out, the rest answered 200, and the log names each (watched
  failing with each form loaded as `GET /v1/forms/:id` loads it: the
  whole menu was 500 `corrupt-bundle`); so are a version whose bindings'
  fields a hand edit made `null`, one whose identity it made a string,
  which still validates, and a version that is a directory, for a form
  the clerk may not read among them, the log naming each (watched
  failing: the menu was 500, its body "Cannot read properties of null
  (reading 'map')" before the check stopped throwing, "EISDIR: illegal
  operation on a directory, read" before a version that cannot be read
  was left out, and "names.map is not a function" with `menuForm` read
  outside that); a form bound to a connection the allowlist does not have
  is left out, and the log says so (watched failing: the clerk was told
  of it); a store whose listing fails is 500 `store-unavailable`, its
  body naming no path (watched failing: Fastify's own 500 carried the
  error's message, the store's path in it); the audit event is
  `form-list`, with no form, version or record.
  `routes/runtime.test.ts` -- over fake ports whose database allows
  everything, for every form and every person, a form the menu names opens
  with exactly the menu's operations, and one it does not name is not
  offered to be read (watched failing with `GET /v1/forms/:id` asking only
  whether the person holds a role the policy names: a clerk with no tenant
  was offered every operation of a form whose tenant filter they cannot
  supply). `bundle.test.ts` -- bindings whose fields are `null`, an
  object or hold `null`, whose root or operations are `null` or whose
  identity is a number are each refused with a reason in both formats, and
  never thrown on (watched failing: each threw a TypeError).
  `routes/admin-audit.test.ts` -- the route is read from the router, and
  emits one event under its name (watched failing with the route
  registered before its name: "GET /v1/forms has no audit name (0023,
  0033)"). `packages/data-client/src/forms.integration.test.ts`, against
  `postgres:17-alpine` and `mcr.microsoft.com/mssql/server:2022-latest`
  loaded with the shared fixture, over forms proposed from what discovery
  reports on each: a clerk's menu holds both engines' order and line
  forms, each line form a child of its own engine's order form and never
  of the other's, whose tables have the same names and types (watched
  failing with the connection left uncompared: `pg-order` named
  `ms-order-line`); a person the policies grant nothing is told of
  nothing; the menu is a GET with no body and the token in its header; and
  on each engine a child it names, listed with each token the order form's
  own list hands out -- the seeded order's and one made in the test with
  no lines -- holds that order's lines alone (watched failing with the
  list's parent dropped by the planner: the new order listed the seeded
  order's line).
  `packages/data-client/src/transport.test.ts` -- `forms()` is
  `GET /v1/forms`, and an answer whose entries lack a title, operations or
  children, or whose children lack a form or a field, is `unexpected`
  (watched failing with only `forms` checked for being a list).
  `scripts/install-fixture/consume.ts` -- `forms()` and `FormMenu`
  through the published entry points. `scripts/cloudflare/ingress.test.mjs`
  -- `deploy/web/nginx.conf`'s server for the runtime door passes every
  runtime route's sample to the server, the menu by a location of its own,
  and nothing else (watched failing with that location removed:
  "/v1/forms"). The test models how nginx chooses a location; nginx itself
  was asked once, on 2026-10-11, by running `nginx.conf` in the web front's
  image (`nginxinc/nginx-unprivileged:1.30.5-alpine`) in front of the built
  server, with `scripts/cloudflare/web-front.mjs` as the Cloudflare gate
  runs them and Node's own image in place of the tools image, and sending
  every runtime route's sample to 8081: without the location, `GET
  /v1/forms` was nginx's own 301 to `/v1/forms/`; with it, the server's
  401, as every other runtime route was both times. The Cloudflare gate
  (`pnpm test:cloudflare`, 0037's job), which sends every runtime route's
  sample and every hostile path through that server, passed on 2026-10-11,
  and without the location failed: `GET /v1/forms` answered 301, and so
  did two hostile paths that climb to it with `%2F`, which nginx decodes.
  `scripts/cloudflare/doors.test.mjs` -- `deploy/cloudflare/doors.json` and
  the Cloudflare guide's generated blocks are what the built server's
  router renders, the menu among the runtime routes. **Not mechanically
  enforced:** what a menu costs, measured once (below) and held by
  nothing; that a child's rows spell their foreign key as the parent's
  token does, which holds only where the database's equality is bytewise
  (below).

## Context

A host application's workspace opens with a choice of forms. Until now
the runtime plane answered for one form a person names --
`GET /v1/forms/:id` -- and a host had to know every id it might open; the
host page asks for one in a text field. The configuration store could
list every id with a version, and nothing on the runtime plane called it.

`GET /v1/forms/:id` tells a form that does not exist (404) from one this
person may not use (403). It is asked for one id a person already has. A
list of every id the store holds would hand every person the name of
every form, those of other tenants' processes and of other departments
included.

A published form is a bundle: the form, its bindings, its policy and the
snapshot the bindings were generated from, checked on publish and on
every read (0019). Since 0041, opening a form also asks the database what
the table allows now, in a statement of its own.

A page of a form's records may be narrowed to the rows whose lookup field
references one row, by that row's token (0044's `parent`), and the token
is decoded through the child's own foreign-key columns' codecs, which take
only the spelling the column holds. Which forms' rows reference which
other forms' records is already in the bundles: each lookup binding names
its foreign key, the columns it holds and the target's columns, and each
snapshot the columns' types. The fixture has an order's lines through
`fk_order_line_order`, an order's customer through a two-column key, two
foreign keys from an order to an employee, an employee's manager, and a
customer's country through a unique key that is not the country's
primary key.

## Decision

`GET /v1/forms` answers `{ forms: [{ id, title, operations, children:
[{ form, field }] }] }`: the published forms this person may read, in
codepoint order of their ids, and nothing about any other. The audit names
the operation `form-list`, and no form, version or record.

- **What is read.** Every id the store lists, its newest version, checked
  as every read is (0019), bound to a connection the deployment's
  allowlist has, and read alone (`menuForm`). A form is left out, and the
  server's log says which and why, when its version no longer validates,
  does not parse or cannot be read, when its connection is not in the
  allowlist -- opening it would be refused `unknown-connection`, and the
  allowlist says so without a statement -- or when its bindings are of a
  shape the check passes and the menu cannot read, as a hand edit can
  leave an identity that is a string; the person is told nothing. A 500
  for the whole menu would let one bad file hide every form from
  everybody, and answer with what the error said, a path or a form's id.
  `validateBundle` reports a part of another shape than it reads as a
  problem rather than throwing, so `GET /v1/forms/:id` and a publish say
  so too. A store that cannot list its forms is a 500
  `store-unavailable` that names nothing it was told; the log keeps the
  error.
- **Who is told of what: `menuForm`, then `formMenu`.** Each bundle is
  read once, alone, for this person into a `MenuForm` -- its operations,
  the fields its list may be narrowed by, what its records offer a child
  and what its lookups reference -- and `formMenu` compares only those,
  so nothing it does can throw on one form's bundle. A form is named when
  its policy lets this person read (`authorizeOperation`, so a context
  that cannot scope the read is not), and otherwise not at all. A form a person may
  only create with is not named: the menu opens grids, and a grid reads.
  Its `title` is the served form's; its `operations` are
  `grantedOperations` -- what the policy grants this person of what the
  form offers as published -- the one function `GET /v1/forms/:id` now
  starts from too, so the two cannot disagree about the policy, which
  `routes/runtime.test.ts` holds for every form and person of its fixture. Nothing
  about a form the person may not read is in the answer, its id, its
  title or how many there are: publishing one leaves a person's answer the
  same to the byte.
- **Children are derived, never declared: `childFields`.** A form C is
  listed under a form P through C's field f when both are bound to the
  same connection, f is a lookup whose foreign key references P's root on
  exactly P's identity, column for column in the identity's order, and
  each of f's columns has, in C's snapshot, the normalized type its
  referenced column has in P's. Then P's record token is a value f takes,
  and a page lists that record's children by asking C's list with
  `parent: { field: f, record }`, which holds the rows whose f references
  that record by the database's own equality, the one the foreign key was
  checked by. Where that equality is bytewise, each of those rows' f
  spells P's token byte for byte; on a text key under a collation that
  ignores case or trailing spaces it need not: on SQL Server's
  case-insensitive fixture a row holding `ch` references `CH` and is
  listed under it, its f spelling `k1:ch` (0044's `text-parent`). A text
  key makes a child all the same. A foreign key onto a unique key that is
  not P's identity -- a customer's onto its country's `iso_code` --
  is no child: P's token spells another column. One of another type is
  none either: a `numeric(12,4)` key onto a `numeric(12,2)` one holds
  `1.5000` where P's token spells `1.50`, which C's codec refuses. A form
  can be its own child, as an employee is through its manager, and one
  form can be a child twice, as an order is of an employee through who
  created and who approved it.
- **A child is named only where its grid would be served.** C is in this
  person's menu, its list is offered to them (`listable`, which the list
  route asks), and f is a field they may read, which a list's `parent`
  must be (0044). C's own policy still decides, on every request, which of
  its rows a page holds; the menu adds no permission.
- **No database is asked.** The menu is decided from the bundles and the
  policy alone, so it is no statement however many forms there are, and a
  database out of reach hides no form on another. What the table allows
  now is decided when the form is opened, as 0041 decided: opening a form
  the menu names can still be 409 `drift`, its operations narrower, and
  its `list` `null` though the menu named it as a child.
- **The client.** `@formancy/data-client`'s `forms(signal?)`, with the
  answer taken only in the server's shape.
- **The runtime door.** The menu is a runtime route with no name below
  `/v1/forms/`, so `deploy/web/nginx.conf`'s server for the runtime door
  (0037) passes `/v1/forms` to the server by a location of its own;
  without it, nginx answered the path itself with a redirect to
  `/v1/forms/`. The tunnel's pattern, generated from the router, forwards
  it.

## Consequences

**What it buys.** A host can draw a choice of the forms a person may read,
and below a record the grids of its children, without anybody declaring
either, from one request that says nothing about any other form and asks
no database.

**What it costs.**
- Every menu request reads and validates every published form's newest
  version, and asks the policy of each, with nothing cached (0019, 0022).
  Measured once, on 2026-10-11, in-process through `inject` on a 20-core
  i9-10900K under Node 22.22.1, with a file store on local disk and
  format-2 order forms over the studio's captured PostgreSQL snapshot, a
  version of 45,838 bytes: the median menu took 2.9 ms with one form
  published, 19 ms with ten and 180 ms with a hundred for a person the
  policies grant nothing, and 3.0, 21 and 197 ms for one who may read them
  all -- about 2 ms a form either way: close to the published fixed cost
  of reading and checking one version, 1.63 ms at the median
  (`docs/performance.md`), and the store's listing. So the time of the
  answer says how many forms there are, which its body does not, and the
  work is any host token's to ask for: at the server's default limit of
  600 requests a minute from one address -- every client's together
  behind the composed stack's nginx -- menus over a hundred forms are
  about 108 s of work a minute for one event loop. Nothing bounds that
  but the limit.
- A version that fails validation, cannot be read or names a connection
  the allowlist does not have leaves the menu silently: only the server's
  log says so, where `GET /v1/forms/:id` answers 500.
- The file store lists its forms by reading each form's directory, so one
  form directory it cannot read fails the listing, and the menu is 500
  `store-unavailable` for everybody. Read from the store's code, not
  tested.
- Under a collation that ignores case or trailing spaces, a child's rows
  listed under a parent can spell a text foreign key otherwise than the
  parent's token does: a page that matched rows to a parent by token
  rather than asking the list would disagree with the database.
- A form a person may create with and not read is not in the menu.
- The menu's operations and children are the policy's and the published
  bundles', not what the database allows now: a form it names can be
  refused as drift when opened, and a child it names can be offered no
  list then.
- A foreign key onto a key that is not the parent's identity, or of
  another type than the key it references, makes no child, though its rows
  reference the parent's.
- An operator behind Cloudflare runs `tunnel-config` again, and rebuilds
  the web image so the runtime door forwards `/v1/forms` -- until then the
  menu is not forwarded, which fails closed.

**What 0034's evidence would need to add.** None of it is in the published
figures: a menu block in `catalogue.ts`, and its time with one, ten and a
hundred published forms of the fixture snapshot's size.

**What it forecloses.** A parent link declared in a bundle, until a record
reverses this one.

## Alternatives considered

**Every id the store has, filtered by the page.** It hands every person
the name of every form, and the filter is a page's to forget.

**Including forms a person may only create with.** The menu opens grids,
and a grid reads; a create-only form has nothing to show in one.

**A 500 for one bundle that does not validate.** One edited file would hide
every form from everybody; a form's own route still answers 500 for it.

**Operations as `GET /v1/forms/:id` answers them, from the database.** One
statement per form on every menu request, and a database out of reach
would hide, or fail, the forms of every other. Opening the form asks, and
`grantedOperations` keeps the two answers' policy part one decision.

**A parent link declared in the bundle.** A second spelling of what the
foreign key and the snapshot already say, and one more thing to republish
when either changes.

**A children configuration in the host.** Each host would restate it, and
nothing would hold it to the policy that decides whether its grid is
served.

**Children by target table alone.** A foreign key onto a unique key, or
onto the key's columns in another order, would name a child whose parent
token names another row or none; one of another type a child whose list
refuses the parent's token.

**Comparing types from the child's snapshot alone.** The parent's token is
made through the parent's codecs, from the parent's snapshot; a parent
retyped since the child was published would be trusted to match.

**A cache of the validated bundles.** Keyed by id and version alone, a
hand-edited version would be served until the cache noticed (0019). Keyed
by the version file's inode, size and modification time, an edit that
keeps all three -- written in place, of the same length, its time put
back -- would be served. Keyed by
a digest of the bytes read on every request, nothing edited would be, and
a menu over a hundred forms would cost a read and a digest a form rather
than a check; it needs the store to hand out bytes, which its port does
not, and holds a copy of every published bundle in memory. Not taken here,
with the cost above measured instead; it is the remedy if a deployment's
forms make the menu's work matter.

**A lower rate limit of the menu's own.** `@fastify/rate-limit` runs one
limiter a request, so the menu's would be a bucket apart from the
server's, and behind the composed stack's nginx every client shares it:
at a tenth of the server's limit, sixty menus a minute for everybody
together, past which every person's menu is 429. Not taken: it trades
the work for a refusal that falls on the people the menu is for.

**Children only through keys whose equality is bytewise.** `through`
refuses a text key until snapshots record collations (0043), because a
person's reach must not rest on a comparison nobody wrote down. A child is
no reach: its list narrows by the equality the foreign key itself was
checked by, and C's own policy decides its rows. Refusing text keys here
would leave a region's depots without a grid under the region.

## Older records

Extended, not edited away: 0019 (the menu reads every published form's
newest version, validated as every read is, and leaves out one that does
not validate, parse or read, or is bound to a connection the allowlist
does not have, saying so in the log, rather than answer 500; and the check
reports a part of another shape than it reads as a problem rather than
throwing); 0022
(the menu asks the policy of every form on every request and asks no
database: what the database allows now is decided when the form is
opened, and `GET /v1/forms/:id` starts from the same `grantedOperations`);
0023 (the audit operation `form-list`, which names no form, version or
record); and 0037 (the runtime door's server passes `/v1/forms`, the menu,
as well as what is below `/v1/forms/`).
