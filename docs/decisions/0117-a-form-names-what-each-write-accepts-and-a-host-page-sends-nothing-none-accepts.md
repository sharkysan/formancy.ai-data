# 0117 — A form names the fields each write accepts from its person, and a host page neither offers nor sends one that no write accepts

- **Status:** accepted; extends [0022](0022-the-runtime-plane-asks-the-policy-every-time.md): `GET /v1/forms/:id` names, for each write it offers, the fields that write accepts from this person, by the over-posting check, so a page can leave out what the server would otherwise remove as an echo; extends [0029](0029-a-host-renders-a-published-form-through-one-client.md): the host page draws a field no write accepts from its person disabled, and sends it in no body; extends [0115](0115-a-host-page-changes-an-open-version-from-a-date.md): the plane test's journey changes a price from a date on the page's own origin; narrowed by [0122](0122-a-host-page-draws-a-saved-record-for-the-update-and-a-new-one-for-the-create.md): a field written on create only is drawn disabled on a record opened for update
- **Date:** 2026-10-31
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/policy/evaluate.test.ts` -- `writableFields`
  names, operation by operation, what the over-posting check accepts from
  an actor: never a pinned tenant, a field written on create only on
  create alone, nothing for an operation that is not theirs (watched
  failing with every binding named).
  `packages/data-server/src/routes/runtime-supersede.test.ts`, over fake
  ports -- a clerk's price names the chain's key, the start and the amount
  on create and the amount alone on update, and a reader's names neither
  write (watched failing with `writable` left out of the reply).
  `packages/data-client/src/transport.test.ts` -- a reply without
  `writable`, one that names a write the form does not offer or offers one
  without naming it, or names anything but field keys, is no form the
  server sent (watched failing with `writable` left unchecked).
  `apps/host/src/session-work.test.ts`, without a server -- a field no
  write accepts is drawn disabled on a new record and a saved one, and one
  a create alone accepts is not (watched failing with nothing new drawn
  disabled). `apps/host/src/change.test.tsx`, against the real server on
  both engines -- on an open price the tenant, the end and the note the
  clerk may only read are drawn disabled, the note on a new price too, and
  an update's body names the amount, the product and the start alone
  (watched failing, in CI while Docker was down on the workstation, with
  nothing new drawn disabled: the note was writable on both engines).
  `apps/host/src/plane.test.tsx` -- on the page's own origin the journey
  also creates a price, changes its amount and changes it from a date:
  every runtime route is sent, and no body names a tenant (watched
  failing, in CI, with every answer sent: the tenant in the price's update
  and in its change from a date, on both engines), nor does a write of the
  price's name a field outside the server's `writable`.
  `apps/host/src/temporal-round-trip-page.test.ts` -- an instant and a time
  the policy alone withholds are drawn disabled, as those the account may
  not write are, and the note beside them saves (with the page's half
  mutated, both were drawn enabled, as that file then expected).

## Context

formancy's renderers submit every field, disabled ones included, and the
runtime plane removes the echo it can prove: an empty one on create, an
unchanged one on update (0022), or any while the record has moved on
(0098). So a form saves as a renderer submits it. But the host page sent,
in every body, every field the form holds, those its person may never
write among them, and two things followed.

- A form whose tenant is a column of its own -- a product's prices, a
  party, the column pinned so that its value is the token's -- carried the
  tenant in the body of every update and every change from a date. The
  tenant is the token's (0011), and the plane test holds that no body the
  page sends names one; its journey left out a change from a date because
  its one form over versions would have broken that rule (0115).
- A field the policy lets a person read and not write was drawn writable,
  because the published form draws disabled only what nothing writes. An
  edit of it was refused after Save, as over-posting. 0107 met the same gap
  for a copy and answered it with `copied`.

## Decision

**The server names what each write accepts.** `GET /v1/forms/:id` adds
`writable: { create, update }`: for each write the form offers this
person, the fields `writableFields`
(`packages/data-core/src/policy/evaluate.ts`) names -- each field the
over-posting check accepts alone, for that operation, in the bindings'
order -- and `null` for a write it does not offer. The rule is the
check's, asked one field at a time as the route asks it of an echo, and
`copiedFields` now asks it through the same function, so no second list of
what may be written exists to disagree with it. A pinned tenant, a field
the database writes, one the account may not INSERT or UPDATE (0027) and
one the policy does not let this person write are outside it; a field
written on create only is in `create` and not in `update`.

**The host page leaves out what no write accepts.** The session
(`apps/host/src/session.ts`) takes the fields in neither list -- its person
writes them in no operation -- draws them disabled, as the generator draws
a field nothing writes, and drops them from the answers of every create,
update and change from a date before the client sends them. What the
renderer submitted is kept whole for the session's own comparisons, so a
field left out is never counted as changed.

**A field written on create only stays as it was**: drawn writable on an
opened record and sent, its unchanged echo removed by the server and a
change refused. The engine a create made is kept for the updates after it
(0029), so one drawing serves both writes, and dropping such a field from
an update would silently drop a change the person made to a field drawn
writable -- what 0022 forecloses.

**The server accepts what it accepted.** It still removes an echo it can
prove and refuses any other value in a field the person may not write: a
client other than this page may send every field.

## Consequences

**What it buys.** No body the host page sends names a field its person
writes in no operation, the tenant included, whatever column holds it. The
plane test's journey sends every runtime route on the page's own origin, a
change from a date included. A field a person may read and not write is
drawn as one, not refused after Save.

**What it costs.**
- A field written on create only is still drawn writable on an opened
  record, and a change to it is refused after Save.
- `@formancy/data-client` reads a form without `writable`, or with a write
  named that the form does not offer, as unexpected, so a host upgrades its
  server before its client.
- `GET /v1/forms/:id` asks the policy once per field for each write it
  offers, as the copy and the echo removal already do.
- Through the demo's door the plane test's journey still sends no change
  from a date: the live demo publishes no form over versions.

**What it forecloses.** Nothing.

## Alternatives considered

**Read the published form's `disabled` rules.** The generator writes one
for a field nothing writes, which covers a pinned tenant. It does not
cover a field the policy keeps from one person, and a page reading a
rule's expression would be reading the generator's wording, not the
policy's decision.

**Send only the answers the person changed.** It would change every save,
not the fields at issue, and a create has nothing to compare against.

**Drop, from each write, what that write does not accept.** An update
would then drop a change to a field written on create only, which the page
draws writable after a create.

**Exempt a form whose tenant is a column from the plane test's rule.** The
rule is the page's promise (0029), and such a form is where it is easiest
to break.
