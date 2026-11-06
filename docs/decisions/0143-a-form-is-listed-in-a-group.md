# 0143 — A form is listed in a group

- **Status:** accepted; extends [0030](0030-presentation-is-a-patch-over-the-generated-base.md): a presentation may name the group its form is listed under; extends [0045](0045-the-runtime-plane-lists-the-forms-a-person-may-read-and-nothing-about-the-others.md): each form in the menu names its group
- **Date:** 2026-11-06
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/presentation/group.test.ts`
  -- the default is the root schema's name in words, "Sales" for `sales`
  and "Order entry" for `order_entry`, and no group for a schema with no
  words in it (watched failing with the schema's name returned as it is:
  `sales` was the default); a group is read by shape, words of at most
  `GROUP_LIMIT` or `null`, an empty or blank one refused (watched failing
  with the shape left unasked: `""` was read as a group); the default
  spelled out is refused at a write (watched failing with every group let
  through: "Sales" over `sales` was not refused); a regeneration carries
  the group as it is, a cleared one included (watched failing with it left
  out of the carried presentation: "Orders" was the default again).
  `packages/data-core/src/records/menu.test.ts` -- each form in the menu
  names its group: the presentation's, `null` where it was cleared, the
  default where the presentation says nothing (watched failing with the
  presentation's group read alone: the employees, which said nothing,
  were in no group). `packages/data-server/src/routes/runtime-menu.test.ts`
  -- the route reads a format-2 version's group, and gives one whose
  presentation says nothing, and a format-1 version, the default, asking
  no database (watched failing with the presentation left unread by the
  route: "Orders" and the cleared group were both "Sales").
  `packages/data-server/src/routes/admin.test.ts` -- the default spelled
  out and an empty group are refused at the write, saying why, and nothing
  is written; a group typed and none publish and read back (watched
  failing with the fit left out of `storable`: "Sales" over `sales` was
  stored). `packages/data-client/src/transport.test.ts` -- a menu entry
  without `group`, or with one that is neither text nor `null`, is
  unexpected (watched failing with `group` unchecked: the entry without
  one was taken; and with only its presence checked: `7` was taken).
  `apps/studio/src/group.test.tsx`, against the real server -- the box
  shows the default before anything is typed and the publish leaves it
  out, a group typed is published without the spaces around it, No group
  publishes `null`, and the default typed again is left out again
  (watched failing with the group left out of the publish: version 2 held
  none; and with the default sent as typed: the server refused version
  1); a group past its length is refused in the box, in words, and the
  form keeps the one it had (watched failing with the length unchecked:
  the box took 86 characters as the group and said nothing); Generate
  again and a regeneration keep it (watched failing with each left at the
  default: the box said Sales). `apps/studio/src/presentation.test.tsx`
  -- the Group region holds its box and No group and nothing else, so the
  step still offers nothing that could break a binding (watched failing
  with a stray button put there). `apps/studio/src/review.test.tsx` -- a
  draft's reviewer is shown its group, No group for one cleared, and
  nothing where it keeps the default (watched failing with the group left
  out of the draft's view). On both engines, needing Docker:
  `packages/data-client/src/forms.integration.test.ts` and
  `apps/live-demo/src/image/publish.integration.test.ts` hold each form of
  the fixture and of the demonstration's image under "Sales" (to be
  watched failing in CI with `group` left out of `formMenu`'s entries).
  `scripts/live-demo-gate/journey.mjs` holds the live demonstration's menu
  to it byte for byte, and `scripts/install-fixture/consume.ts` reads a
  menu with a group through the published packages' own check; neither
  was watched failing: each was brought to the new shape.

## Context

The menu (`GET /v1/forms`,
[0045](0045-the-runtime-plane-lists-the-forms-a-person-may-read-and-nothing-about-the-others.md))
names the forms a person may read in codepoint order of their ids, and the
host page lists them so. The design of finding records gives the host page
a list of tables on the left: a search box over the titles, the forms
grouped, and the forms linked to the one open. A list of forty forms in
the order of their ids is a list a person reads from the top; grouped, it
is a few headings. Nothing published said what a form's group is.

The menu reads each bundle alone and asks no database, so whatever names a
form's group has to be in its bundle. What an administrator chooses over
the generated form is its presentation
([0030](0030-presentation-is-a-patch-over-the-generated-base.md)), and
what a form is about is, for most databases, the schema its table is in.

This record is the group's data: the presentation, the menu, the client's
check and the studio's control. The host's list is the next.

## Decision

**A presentation may name the group its form is listed under**
(`group`, `packages/data-core/src/presentation/group.ts`): text, or `null`
for no group. Left out, the form is listed under **the default: its root
schema's name in words**, as generation words a column's label
(`labelFor`): `sales` is "Sales", `order_entry` and `OrderEntry` are
"Order entry". Where those words would be no group an administrator could
type -- a schema named with spaces or punctuation alone, or one past the
limit in words -- the default is no group.

**Its shape is read on every read** of a version, as the rest of the
presentation is: `null`, or words a person can read, with no space at
either end, no control character and no lone surrogate, as a list view's
name is, of at most 80 UTF-16 code units (`GROUP_LIMIT`). The limit is a
choice, not a measurement: a heading in a list of forms and not a
sentence, the length a person's own view's name has
([0126](0126-a-person-keeps-their-own-list-views-on-the-server-for-themselves-alone.md)).
An empty or blank group is refused, not read as `null`, and the server
trims nothing: no group has one spelling, and a group with a space at an
end is refused rather than stored otherwise than it was sent.

**At a write, the default spelled out is refused** (`groupProblems`, asked
by `storable` at a publish, an import and a draft's submit and approval):
"equals the default; leave it out", as a label equal to the base's is
(0030), so two versions that mean one group are byte-equal. It is asked at
the write and never on read, so a later release that words a schema
otherwise leaves a stored version readable.

**A regeneration carries the group as it is**, a cleared one included: it
is the form's, bound to no field. A regeneration generates from the stored
request, whose root is the same, so its default is too.

**The menu names each form's group** (`FormMenuEntry.group`, `string |
null`): the presentation's, or the default where it says nothing -- as a
version published before groups says nothing, and a format-1 version has
no presentation. It is read from the bundle as the rest of the entry is,
and still asks no database. **`@formancy/data-client` refuses a menu**
whose entry has no `group`, or one that is neither text nor `null`, as
`unexpected`.

**The studio edits it** in the Presentation step, after the state labels:
a region "Group" with one box, "Group", that shows the group the form will
be listed under -- the default until another is typed -- and No group,
which empties it. An empty box is no group. What is kept is the words
without the spaces around them; a group the server would refuse
otherwise, past its length or holding a control character, is refused in
the box, in words, and the form keeps the group it had. The publish leaves
the group out where it is the default. Generate again and a regeneration
keep it, and a draft's reviewer is shown it -- No group for one cleared,
and nothing where it is the default, which the presentation leaves out.

## Consequences

**What it buys.** Every published form has a group without an
administrator doing anything, the one its schema gives it; an
administrator who wants another types it once; and the host's list can
draw headings from the menu alone, still without a statement.

**What it costs.**
- A schema's name is not always a word anybody uses: on SQL Server most
  tables are in `dbo`, and every form over them is listed under "Dbo"
  until an administrator types a group for each.
- A group is one text, not one for each language a form is shown in.
- A group is the form's alone, not a thing of its own: renaming one is an
  edit and a publish of every form in it, and two forms that spell it
  differently, "Sales" and "sales", are in two groups. Nothing compares
  the groups of two forms.
- The default is worded at every read, not stored: a later release that
  words an identifier otherwise moves every form whose presentation names
  no group to another, without a publish; and a stored group that is then
  the default is refused at its next write, which the studio, leaving the
  default out, does not send.
- A group past 80 characters is refused, and a schema whose name past 80
  characters in words is the default lists its forms under no group.
- A server of an earlier release refuses a version whose presentation
  names a group, and this release's `@formancy/data-client` reads an
  earlier server's menu as `unexpected`, so a host upgrades its server
  before its client.
- Until the host's list draws them, the menu names groups the host page
  does not show: its Forms list is as it was.

**What it forecloses.** Nothing: a group of groups, or an order of groups
other than a list's own, can be added beside it.

## Alternatives considered

**Groups in the configuration store**, a document naming the forms each
group holds: one place to rename a group, but a second thing to publish,
validate on every read and keep in step with the forms it names; a form
published without it would be in no group, and the menu would read more
than each form's own bundle (0045).

**Groups on the connection**, in the deployment's allowlist: a form's
group would be the database it is in rather than what it is about, set by
an operator for what is an administrator's presentation, and forms about
one subject in two databases would be apart.

**No default**: every form in no group until an administrator names one.
A deployment of forty forms would be one list of forty under "Forms" until
each was published again with a group.

**The default stored**, the studio writing the schema's words into every
presentation it publishes: the words would not move with a later release,
but a group would have two spellings, and every version published before
groups would still need the default worded at read.

**The schema's name as it is**, `order_entry`: an identifier, which the
generator never shows a person as a label either.

**An empty group for none, or a blank one read as `null`**: two spellings
of one meaning, and the server refuses rather than normalises a stored
presentation, so what it serves is what was sent.
