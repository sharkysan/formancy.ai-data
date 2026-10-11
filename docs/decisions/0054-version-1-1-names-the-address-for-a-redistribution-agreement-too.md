# 0054 — Version 1.1 of the licence names the address for a redistribution agreement too

- **Status:** accepted; extends [0048](0048-the-licence-is-in-force-before-a-lawyer-has-read-it.md)
- **Date:** 2026-10-11
- **Deciders:** Daniel Bacher
- **Verified by:** `scripts/licence-status.test.mjs`, in `pnpm test:repo` —
  `scripts/licence-status.mjs` reads a version line numbered N or N.N, keeps
  the number as written, and renders it into the README's block and the
  Cloudflare guide's, so neither can say Version 1 while `LICENSE.md` says
  1.1; it still refuses a draft's line, a reviewed licence's and any other,
  `1.1.1` among them. Section 9 may name one address only, so the agreement
  Redistribution requires cannot be given an address of its own there
  without the test failing. Watched failing on 2026-10-11: the test, changed
  first, against the script's whole-number pattern (three cases, each
  refusing the 1.1 line); with `LICENSE.md` at 1.1 and that script (five
  cases, and `--write` refused and left the README as it was); and with the
  script taught, before `--write` (README.md and `docs/deploy/cloudflare.md`
  named stale). **Not mechanically enforced, and said:** that section 9's
  new sentence gives that agreement the production licence's address, and
  that nothing else in the terms changed, held by review; a sentence about
  the licence outside a generated block, as 0048 says; and that mail to the
  address is read.

## Context

Version 1 of `LICENSE.md`, in force from 11 October 2026
([0048](0048-the-licence-is-in-force-before-a-lawyer-has-read-it.md)), says
in section 3 that Redistribution -- shipping the Software inside a product, a
platform or a managed service that other parties run -- requires a separate
commercial agreement, and names info@formancy.ai in section 9 for production
licences only. 0048 lists that among its costs: where a redistribution
agreement is asked for, the licence does not say. A vendor who wanted to ship
the module inside a product of their own was told they needed an agreement
and not where to ask for one.

## Decision

On 2026-10-11 the Rightsholder decided that info@formancy.ai is also the
address for the agreement Redistribution requires. `LICENSE.md` is
**Version 1.1, in force from 11 October 2026**, and says that it replaces
Version 1 of the same day, which named no address for that agreement, and
Version 0. Section 9 keeps its heading and adds one sentence: the separate
commercial agreement that Redistribution requires, which section 3
describes, is requested at the same address. Nothing else in the terms
changes, no legal term is added, and Version 1.1 says at the top, as
Version 1 did, that no lawyer has reviewed it.

`scripts/licence-status.mjs` reads a version of the form N or N.N, so the
generated block says Version 1.1.

## Consequences

**What it buys.** A redistributor finds where to ask in the licence itself,
and the cost 0048 named is closed for Version 1.1. Because section 9 names
one address and the guard refuses two, the agreement and the production
licence cannot be given different addresses in that section without
`pnpm test:repo` failing.

**What it costs.**

- **An address is not terms.** The agreement's terms, its price and what it
  covers are not published, as a production licence's are not. The licence
  says where to ask, not that the answer is yes. And the line 0048 found
  between the two -- whether a managed service you run for a client needs
  this agreement or a production licence -- is where it was: Version 1.1
  does not settle it.
- **One mailbox for both.** 0048's "can be had depends on a mailbox" now
  holds for redistribution too. Nothing in this repository checks that mail
  to info@formancy.ai arrives or is answered.
- **Two versions in force on one day.** Version 1 was in force from 11
  October 2026 and is replaced the same day. Whether Version 1.1 changes
  anything for someone who received the Software under Version 1 is the
  question 0048 left open for a later version, asked now by a real one.
  Version 1.1 changes no term and says nothing on it; it is a lawyer's
  question.
- **The block names a production licence only.** The README's and the
  Cloudflare guide's generated sentence says what section 9's heading names,
  a production licence, and not the agreement. Saying that too would have
  meant reading it from the section's wording, a phrase match that passes for
  the wrong reason the moment the phrase appears for another one. A reader of
  the block is pointed at section 9, which says both.
- **A version number with a dot.** The script keeps the number as written,
  so a 1.10 is not rendered as 1.1. A `1.1.1`, or any other shape, fails
  `pnpm test:repo` until the script is taught it, as 0048 meant for any line
  it does not read.
- **Still unreviewed.** Version 1.1 is as unreviewed as Version 1. Gate 10
  stays open, held by 0048's guard, and a release made before the review
  ships under Version 1.1.

**What it forecloses.** An address of the agreement's own in section 9: the
guard refuses a section 9 naming two, and a separate address would be a new
decision and a new version.

## Alternatives considered

- **Leave Version 1, answer redistribution requests at the address anyway,
  and say so in the README.** The licence would still name no address, and
  the README would say what the licence does not: two documents that
  disagree.
- **Edit Version 1 in place.** Two texts would carry the name Version 1, one
  of them in history and in every copy taken that day, naming no address. A
  version number that names two texts names neither.
- **Version 2.** The script would have read it unchanged. A new whole number
  reads as new terms to anyone comparing versions; the terms are unchanged,
  and the Rightsholder named it 1.1.
- **Rename section 9 "Obtaining a production licence or a redistribution
  agreement"**, so the block could name both from the heading. More of the
  licence's text changes, the guard's heading with it, and 0048's
  **Verified by**, which names the section by its heading; the section's new
  sentence already says what the heading would.
- **A block that names the agreement too, read from section 9's wording.**
  The phrase match above.

## Older records

[0048](0048-the-licence-is-in-force-before-a-lawyer-has-read-it.md) is
extended, and its Status line says so. What it says of Version 1 -- the
agreement's missing address among its costs -- stays true of Version 1 and
is left. One sentence spoke of the repository rather than of Version 1, that
a release made before the lawyer's review ships under Version 1; it now says
the version in force. Its line in `docs/release/limitations.json` saying the
licence names no address for the agreement is dropped, because a release
carries Version 1.1; this record's line says where the agreement is asked
for instead.
