# 0140 — A form names the forms each lookup's record opens in

- **Status:** accepted
- **Date:** 2026-11-05
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/records/menu.test.ts` -- a
  lookup's record opens in every form this person may read over its target
  keyed by what its foreign key references, in codepoint order, the form
  itself included where the lookup is its own table's; a lookup no such form
  is over is not named (watched failing with every lookup named under no
  form), and nothing is named of a form the person may not read, under a
  lookup they may not read, or on another connection (watched failing with
  the lookups they may not read named too);
  `packages/data-server/src/routes/runtime-lists.test.ts` -- `GET
  /v1/forms/:id` names a line's order under the order form the clerk may
  read and not the managers', and a customer's country, whose key no form
  is keyed by, under none (watched failing with the route answering no
  opens); `packages/data-client/src/transport.test.ts` -- a reply without
  `opens`, or with a form named without its id or title, is not the
  server's (watched failing with `opens` left unchecked).

## Context

A lookup shows the record it points to by its label: "Muster AG". A person
reading an order who wants the customer itself -- its address, its other
orders -- leaves the order, opens the customer form, and finds Muster AG
again by searching. The design of finding records asked for Open beside
each foreign key's record, opening it in a form the person may read over
the referenced table. The page cannot tell which forms those are: the menu
names forms and their children (0045), and a child is the other way round,
a form whose lookup holds the open record.

## Decision

**`GET /v1/forms/:id` sends `opens`**: each lookup field this person may
read, with the published forms they may read its record in, by id and
title, in codepoint order of their ids; a lookup no such form is over is
not named. A form qualifies by the rule that makes a child (`children.ts`'s
`referencingFields`), read the other way: its root is the lookup's target
on the same connection, and its key is, in order and type, the columns the
lookup's foreign key references -- so the lookup's value is a record token
of that form, and Open is a read by it (`packages/data-core/src/records/menu.ts`'s
`lookupOpens`).

**From every bundle, asking no other database.** The route reads every
published form's newest version as the menu does (`runtime-menu.ts`'s
`menuForms`): validated, on a connection the allowlist has, each read
alone, a damaged one left out and logged. A store that cannot list its
forms leaves `opens` empty rather than refusing the form. Whether the
referenced record is there, or inside that form's row filters, is the
read's to say when it opens.

## Consequences

**What it buys.** A page can offer "Open in Customers" under the customer
of an order, and nothing it would be refused: every form named is one this
person may read, keyed by what the lookup holds.

**What it costs.**
- Opening a form reads every published bundle, as the menu does, on top of
  its own description of the root: the store's cost grows with the number
  of forms, and nothing is cached.
- A lookup whose foreign key references a unique key rather than the
  target's primary key opens in no generated form, which is keyed by the
  primary key: the customer's country by its iso code, here.
- A form named may still not show the record: its row filters can hide it,
  which only the read says.
- A server older than this sends no `opens`, and `@formancy/data-client`
  answers its form `unexpected`: a host upgrades its server first.

**What it forecloses.** Nothing: which form opens, and how, is the page's.

## Alternatives considered

**The page works it out from the menu.** The menu names a form's children,
not the forms over a lookup's target, and holds no keys: the page would
match tables it is never told.

**One form per lookup, chosen by a rule or a studio property.** Two forms
over the customers -- "Customers", "My customers" -- are both the person's
to choose between; the design names them both.

**A route of its own.** A page asks for the form's definition every time it
opens it; a second request would answer from the same bundles.
