# 0109 — A form whose key is its foreign key onto its parent's is shown under the parent's record as one section, while the record holds the value its generation names

- **Status:** accepted; extends [0009](0009-generation-is-deterministic-and-says-what-it-chose.md): a lookup choice may mark its form a section of the records it references, with a condition on a column of theirs; extends [0045](0045-the-runtime-plane-lists-the-forms-a-person-may-read-and-nothing-about-the-others.md): a menu's child says whether it is a section, and under which of the parent's answers it is shown; extends [0047](0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md): the host draws such a child as the record's own section, its one row in a form, or Add
- **Date:** 2026-10-30
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/generate/section.test.ts` -- a lookup marked a
  section carries its condition typed as the referenced table holds the
  column, a section with no condition carries `when: null`, and a lookup
  not marked carries nothing; a yes/no condition is spelled `true` or
  `false`; refused: a foreign key that is not the root's whole key
  (watched failing with that check removed: the order form's customer was
  a section), a column the referenced table lacks, one the account may not
  read, one of a kind with more than one spelling of a value, a value not
  spelled as its column holds it, and two sections on one form.
  `packages/data-core/src/records/menu.test.ts` -- the child of a section's
  lookup is `one`, its condition the parent's field and the answer as that
  field holds it, a whole number as a number (watched failing with the
  condition sent as its canonical text: 1001 went as "1001"); a section
  with no condition, or one on a column the parent does not show this
  person, is shown always (watched failing with the unreadable field kept).
  `packages/data-server/src/bundle.test.ts` -- a stored request whose
  section the bindings do not have, or the reverse, is refused (watched
  failing with the section left out of the comparison), and a section of
  another shape is refused as a lookup of another shape.
  `packages/data-client/src/transport.test.ts` -- a child without `one`, or
  a section whose condition a page could not compare, is `unexpected`
  (watched failing with `one` unchecked). `apps/host/src/sections.test.tsx`,
  on both engines over `parity.party` and `parity.party_company` -- under a
  company party the section says it has none and offers Add, which opens a
  new row preset with the party, the keyboard on it, axe clean; a save
  creates the row under the party, and the party opened again holds it in
  the section's own form, with no grid (watched failing with the section
  drawn as a child grid); under a person party there is no section, its
  kind typed as company changes nothing, and once the save stores it the
  section is there (watched failing with the condition unread, and with
  the stored answers kept as read after a save). `apps/host/src/section.test.ts`
  -- the condition compared with the stored answer as the record holds it,
  and a section shown where there is no condition or no stored record.
  `apps/studio/src/choose.test.tsx` -- a lookup over the root's key is
  offered as a section, with a column and a value, sent to the generator
  and generated, and none is offered over the order's customer (watched
  failing with the section left out of the proposal).
  **Not mechanically enforced:** the browser gates do not reach a section
  or the Choose step's section controls; jsdom and axe hold them.

## Context

A record's details often live in a second table whose key is its own
foreign key onto the first -- a customer and its company details, a party
and its person or company columns -- each holding at most one row per
record, and holding one only while a column of the record says which kind
it is. The backlog asked for such 1:1 extension tables "generated as a
section, with a type column as condition".

The module already knew the shape. A form over the extension table,
generated with its foreign key as a lookup, is a child form of the
parent's (0045): the menu names it under the parent, and the host draws
its rows under each record in a grid, with New preset with the parent
(0047). A grid of one row at most, with a filter, a sort, columns and a
download, is the wrong control for it; and the grid is there under every
record, whatever its kind.

A form is one table: its reads, its writes, its guards and its drift are
decided over one table's description (0015, 0041). Generating the
extension's columns into the parent's form would make every write two
tables' -- two guards, two definitions, two versions, one person's save
landing in one table and refused in the other.

## Decision

**The extension stays its own form, generated as a section of its
parent's records.** A lookup choice may carry `section: { when }`
(`LookupChoice`, `generate/section.ts`): the form's rows are sections of
the records its foreign key references. The generator refuses it unless
the foreign key's columns are the root's whole key, in any order -- so a
record has at most one row here -- and at most one lookup of a form is
one. `when` is `null`, or a column of the referenced table and a value
spelled as that column holds it: a readable column of a kind whose values
have one spelling, text, a whole number, a decimal, a uuid, a date or a
yes/no. The lookup's binding carries the section, its column typed as the
referenced table holds it; a lookup not marked carries none, so every form
generated before this generates as it did. The stored generation request
carries it, and a request and bindings that disagree about it are refused
(`bundle-format2.ts`), as for any part of a lookup choice.

**The menu says where it shows.** A menu child gains `one` and `when`
(`FormMenuChild`, `records/menu.ts`): `one` where the child's field is its
section's lookup, and `when` the parent's field this person may read that
is bound to the condition's column, as the same type, with the condition's
value as that field's answer holds it -- so the page compares the record's
own answer with `===`. `null` shows the section always: no condition, or
one on a column the parent's form does not show this person, since what a
page shows is never a permission.

**The host draws it as the record's own section** (`one-child.tsx`):
listed once, with the record as its parent and a limit of one, when the
record opens; its one row read and opened in the child form's own forms,
as a child row is, with no grid; with none, a line saying so and Add, which
opens a new row preset with the record, the keyboard on its heading, and
the save creates it. The section is shown while the record as stored --
as read, or as its last save left it, never as the person is typing it --
holds the condition's answer (`section.ts`); the record's view and each
Drill down level keep their record's stored answers for it. A new record
shows it waiting, as a child grid waits. Its sessions are its own and the
unsaved-changes guard counts them, as a child section's.

**The Studio offers it** on the Choose step, under a chosen lookup whose
foreign key is the root's key: "Show it under each <table> as one form",
then "Shown while" a column of the referenced table, or always, and
"holds" a value.

## Consequences

**What it buys.** A record's extension is its own form under the record,
written, guarded, versioned and reviewed for drift as one table, with no
change to the write path; and it is there only for the records of its
kind.

**What it costs.**
- Two saves: the record's and its section's, each its own form, each with
  its own Save. A record and its details are never one transaction.
- Shown by the record as stored: a kind changed and not saved shows the
  section as it was, and a person who wants to add company details saves
  the kind first.
- Changing a record's kind away hides the section and leaves its row in
  the database; nothing deletes it, and a section offers no Delete -- the
  child form's own page does (0053).
- A condition is one column and one value: no "either of", no "not".
- A section whose condition is on a column the parent's form does not
  bind, or does not show the person, is shown always.
- Drift review does not name the condition's column. Dropped or retyped,
  the section is shown always, and regenerating the form refuses its
  request until the condition is chosen again.
- The menu child has two properties more, and this release's client
  refuses an older server's menu as `unexpected`: the host and the server
  are upgraded together.
- One list request per section when its record opens, and one read of its
  row.
- The browser gates do not measure a section.

**What it forecloses.** Nothing the grid offered a 1:1 child is lost but
its filter, sort, columns and download, which have one row to act on.

## Alternatives considered

**The extension's columns generated into the parent's form.** One form and
one Save; but every create, update and delete would write two tables in
one guarded statement, decided over two descriptions with two versions,
and drift, policy and the over-posting check would each learn a second
table -- the one-table invariant every planner and both adapters hold.

**Every child whose key is its foreign key drawn as a section, unasked.**
No new choice; but every such child published before would change on the
page with nobody asked, and some are meant as grids.

**The condition in the presentation.** A presentation is the studio's
patch over the generated form (0030), rebased when it is regenerated; the
condition names a column of another table, which neither its rebase nor
its checks read.

**The condition read from the draft as it is typed.** The section would
appear as the kind is chosen; but its row is the stored record's, and a
section shown for a kind not saved yet would hold a row for a record that
is not that kind.

**A hidden section where the condition cannot be read.** A presentation
choice would then hide what the child form's own policy lets the person
read and write.

## Older records

Extended, not edited away: 0009 (a lookup choice may make its form a
section, checked by the generator against the root's key and the
referenced table); 0045 (a menu child says whether it is a section and
under which answer it shows); 0047 (the host draws such a child as the
record's own section, its one row in a form, or Add, without a grid).
