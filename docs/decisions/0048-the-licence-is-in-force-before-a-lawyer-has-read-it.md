# 0048 — The licence is in force before a lawyer has read it

- **Status:** accepted; extended by [0054](0054-version-1-1-names-the-address-for-a-redistribution-agreement-too.md): Version 1.1 names section 9's address for the agreement Redistribution requires too, and the script reads a version numbered N or N.N; amended by [0064](0064-the-first-releases-notes-summarise-the-development-before-it.md): the first release's notes carry Version 0 and Version 1 as a summary, and their entries stay in `CHANGELOG.md` under *Development before 0.1.0*
- **Date:** 2026-10-11
- **Deciders:** Daniel Bacher
- **Verified by:** `scripts/licence-status.test.mjs`, in `pnpm test:repo` —
  the README's licence block, and any other tracked document's, is what
  `scripts/licence-status.mjs` renders from `LICENSE.md` itself: the version,
  the day it is in force from, that no lawyer has reviewed it, and the one
  address its section "Obtaining a production licence" names. The script
  reads one shape of version line, a licence in force that no lawyer has
  reviewed; a draft's, a reviewed licence's and any other are refused rather
  than rendered, and so is a section 9 that names no address or two. Watched
  failing on 2026-10-11 with section 9's address changed (README.md named
  stale), and with `LICENSE.md`'s version line put back to Version 0's and
  with the whole of Version 0 restored (the line refused both times, by the
  test and by `--write`, which left the README as it was). The same file
  holds gate 10 of `docs/release/gates.json` open while the version line says
  no lawyer has reviewed the licence; watched failing with gate 10 given a
  document as evidence. **Not mechanically enforced, and said:** that
  `LICENSE.md` says what was decided -- the law, the place of jurisdiction,
  the address, and the table and sections 1 to 8 unchanged in substance --
  held by review; that gate 10's open reason names the review of
  `LICENSE.md`, held by review; a sentence about the licence outside a
  generated block -- in the CHANGELOG, a record, this one included, a guide,
  a package README, or this record's lines in `docs/release/limitations.json`
  -- held by review; and that mail to the address is read.

## Context

`LICENSE.md` was published with the first commit as Version 0, a draft of
8 October 2026 ([0001](0001-a-paid-module-in-its-own-repository.md)). It said
that it had not had legal review, that "the definitions of production and
redistribution, the governing law and the mechanics of termination all need a
lawyer's reading before this is relied on either way", and that "until a
reviewed version replaces it, the rightsholder grants the free rights in the
table below and nothing beyond them". So no production licence could be had
at all. Section 9 asked a reader to write "through the repository's contact
details", and the repository named no address for it.

0001 says "the plan's price hypothesis is tested with design partners before
launch". Under Version 0 a design partner could evaluate the module without
limit and could not run it in production: section 3 makes that a breach, and
the draft granted nothing that would cure it. A lawyer's review of
`LICENSE.md` is part of release gate 10, which is people's work and open; no
lawyer has read the text.

The README said "a draft awaiting legal review", typed by hand. Nothing
failed when the licence changed, and nothing would have.

## Decision

On 2026-10-11 the Rightsholder decided that `LICENSE.md` is **Version 1, in
force from 11 October 2026**, replacing Version 0. It says plainly that this
version has not been reviewed by a lawyer. The sentence granting only the
free rights until a reviewed version replaces it is gone: production
licences can be had, and are requested from info@formancy.ai (section 9),
with no price published yet and the design-partner plan kept. A last
section, 10, says the licence is governed by Swiss law, excluding its
conflict-of-laws rules, and that the place of jurisdiction is the
Rightsholder's domicile in Switzerland, as the Rightsholder chose them. The
terms table and sections 1 to 8 keep their substance. No other legal term is
added -- not a court called exclusive, not a clause on the UN sales
convention, not a word on what a later version does to a copy received under
Version 1 -- and what that leaves open is listed below.

What a document says of the licence's version, the day it is in force from,
its review and the address is rendered from `LICENSE.md`, in a generated
block the README must hold and any other tracked document may.

## Consequences

**What it buys.** A production licence can be had. A design partner can run
the module in production under a written agreement, and the price 0001 says
design partners test can be tested at all. The text now names the law that
governs it, without the conflict-of-laws rules that could point to another,
and the country where a dispute is heard, which Version 0 left to a lawyer.
And the README's licence block cannot name another version, day or address
than `LICENSE.md`'s, nor can `LICENSE.md`'s version line be put back to a
draft's, without `pnpm test:repo` failing.

**What it costs.** Terms nobody reviewed now bind both sides. A licensee
relies on Version 1 as written, and so does the Rightsholder: what it grants
free -- Development Use with no limit of time, people or size of
organisation, and sharing for others' Development Use -- is granted in the
words it has, not in the words a lawyer would have chosen. Read on
2026-10-11, not by a lawyer, these are the places where the words can be read
two ways:

- **Production Use** turns on "real end users or real business operations"
  and on an application "people other than its developers and testers rely
  on". A pilot a handful of colleagues use, a demonstration run for a
  prospective customer, or a form a team fills in once for a migration can
  each be read as either. "A staging environment that real users depend on"
  moves the line to what "depend" means.
- **Redistribution** lists "a managed service" among its forms, and then
  requires delivery "such that the third party runs it rather than you". A
  managed service you operate for a client is one you run. Whether it needs
  the separate commercial agreement or a production licence, the text does
  not settle; nor does it for a consultancy that installs the module on a
  client's servers and operates it there, or hands it over.
- **The table and section 5 name different owners.** The table's last row
  says customer data and generated form definitions "remain the customer's";
  section 5 says Generated Definitions "remain yours", the licensee's. For an
  integrator who builds forms for a client, the two name different people.
  The table's Redistribution row speaks of "another software product", where
  section 1 also counts a managed service, a platform or a toolkit. Both were
  in Version 0 and are unchanged, since the table and sections 1 to 8 keep
  their substance; the table says the rest of the document says what each
  row means, and whether that makes the sections govern is a lawyer's
  question.
- **Termination** (section 7) ends the rights of a licensee who does not
  cure a breach within thirty days "of becoming aware of it", a date only the
  licensee knows; and the text does not say what the end of this licence
  does to a production licence, which is a separate written agreement.
- **The production licence itself** is "a separate written agreement" whose
  terms -- the customer terms gate 10 also waits for -- are not in this
  repository; section 3's description of it is, in its own words,
  intentions.
- **The commercial agreement Redistribution needs** has no address. Section
  9 names one for a production licence, and the Rightsholder decided an
  address for that alone; where a redistribution agreement is asked for, the
  licence does not say.

**What it leaves open.** Version 1 says nothing on each of these, and each is
a lawyer's question, not answered here:

- whether "replaces Version 0" binds someone who received the Software under
  Version 0 -- section 10 and the availability of production licences
  included -- when Version 0 said that a reviewed version would replace it,
  and Version 1 is not one;
- whether a later version of the licence changes anything for someone who
  received the Software under Version 1;
- whether the place of jurisdiction is exclusive, or one a party may choose
  among others;
- which court "the Rightsholder's domicile in Switzerland" names. The text
  names the country and no town or canton, so a reader cannot find the court
  from the document; nor does it say which domicile counts when the
  Rightsholder moves within Switzerland -- the one when the licence was
  received, or when a dispute arises -- where a dispute is heard while the
  Rightsholder has no domicile in Switzerland, or what the section means for
  a Rightsholder designated in a revision, as section 1 allows, which may be
  a company, with a seat rather than a domicile;
- whether section 10 governs a production licence, which section 3 makes a
  separate written agreement;
- whether the UN Convention on Contracts for the International Sale of Goods
  applies to the licence or to a production licence, and whether it should
  be excluded;
- whether section 8's exclusion of warranty and liability holds as written
  under Swiss law, and whether the choice of Swiss law and of the
  Rightsholder's domicile as the place of jurisdiction holds against a
  licensee whose own law limits such a choice;
- what law governs a contribution under `CLA.md`, which names none and is
  unchanged: its text is what every signature's hash is of (`check-cla`).

**Gate 10 stays open.** Its open reason in `gates.json` still names the legal
review of `LICENSE.md`, which is held by review, and the guard above keeps
the gate open while the version line says no lawyer has reviewed the
licence. A release made before that review ships under the version in force
as it is.

**"Can be had" depends on a mailbox.** Production licences are requested
from info@formancy.ai, and that is true only while somebody reads it.
Nothing in this repository checks that mail arrives or is answered.

**The README's sentence is generated.** A change to the version line's
number or day, or to section 9's address, needs `node
scripts/licence-status.mjs --write`. A version line in a shape the script
does not read fails `pnpm test:repo` until the script learns it, on purpose:
a draft's, which putting `LICENSE.md` back would need, because the licence
is in force; a reviewed licence's, because what a document says of one is
decided then, not guessed now. Only blocks are held. The CHANGELOG, the
records, the getting-started guide and the package READMEs speak of the
licence in prose; what they say of production -- that it takes a paid
licence -- is true under either version, and nothing fails if one of them
calls the licence a draft. The CHANGELOG's entry for Version 0 is under
*Unreleased* beside this one, so the first release's notes carry both; it
says that Version 1 replaced it. This record's lines in the release report
name no address and point at section 9 instead: nothing would fail if
section 9's address changed and they still named the old one.

**What it forecloses.** Telling anyone who received the Software under
Version 1 that it was only a draft.

## Alternatives considered

- **Stay a draft.** Honest about the review, and it grants nothing beyond the
  free rights, so nobody can run the module in production without breaching
  section 3, and 0001's price is never tested.
- **A draft under which production licences are sold by agreement.** Each
  agreement would rest on a public text saying the Rightsholder grants
  nothing beyond the free rights, so it would have to restate the whole
  licence to be read alone, and the README would say "draft" beside a sold
  licence: two documents that disagree, which is what this repository's
  guards exist to stop.
- **Wait for a lawyer.** The order Version 0 promised. It loses on time
  alone: until a review happens nothing can be sold, and every design
  partner's production use waits for it. The review is still owed, as gate
  10; what it changes will be a record of its own.
- **No governing-law section until a lawyer advises one.** Version 0's
  position. It leaves which law and which court to the first dispute.
- **A section 10 worded past what was decided** -- the court called
  exclusive, the UN sales convention excluded, a sentence on what a later
  version does to a copy received under Version 1. Each is a legal term the
  Rightsholder did not decide, and each is listed as open above, for a
  lawyer, instead.
- **A test that looks for "draft" in the documents.** It would pass for the
  wrong reason the moment the word appears for another one -- the README
  speaks of a pane's draft of a record, the studio of a regeneration as "a
  draft to review" -- and fail on history, the CHANGELOG's entry for
  Version 0 among it. The guard reads the licence and renders what a
  document says, instead.
- **A hand-typed README sentence.** What Version 0 had, and what nothing
  failed on.

## Older records

[0001](0001-a-paid-module-in-its-own-repository.md) is extended: the licence
it names is in force, and its Status line says so. Its decision -- a separate
repository, a separate licence, nothing copied -- is unchanged, and so is its
guard. 0035's gate register is unchanged; gate 10 is now also held open by
this record's guard.

[0037](0037-cloudflare-is-the-edge-not-the-runtime.md) and its guide,
`docs/deploy/cloudflare.md`, said no production licence could be had. The
guide now carries the same generated block as the README, which this
record's guard renders and holds, and 0037's cost line drops the clause; its
decision is unchanged.
