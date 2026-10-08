# 0008 — Exact values travel as strings, are canonical, and are never rounded

- **Status:** accepted
- **Date:** 2026-10-09
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/codecs/codec.test.ts` — the fixture's
  largest `numeric(18,4)` and its 2^53 + 1 `bigint` survive exactly as strings;
  a JSON number for a decimal is refused, as is 2^53 + 1 as a number; decimals
  canonicalise to the column's scale and refuse an extra digit either side
  instead of rounding; exponents, plus signs, spaces and separators are refused;
  text length is counted in UTF-16 code units; dates must be real days; null is
  accepted only where nullable and an empty string is never null; every decimal
  the generated form's pattern accepts, the codec accepts. Watched failing with
  decimals accepted as numbers, with padding to scale removed, and with length
  counted in code points.

## Context

Plan section 8: no silent loss of precision or time semantics, decimals and
large integers never through a JavaScript `Number`, and a clear line between
omitted, null, empty, zero and false. A JSON number is parsed into a double
before any application code sees it, and a double carries fifteen to seventeen
significant digits; `numeric(18,4)` carries eighteen and `bigint` nineteen.

Two places check a value: formancy's engine in the browser, against the
generated form ([0009](0009-generation-is-deterministic-and-says-what-it-chose.md)),
and this codec on the server. If they disagree, a person passes the form and
fails the save.

## Decision

`codecFor(column)` returns a codec whose `parse` validates and canonicalises one
API value, from metadata alone.

- **Decimals are strings only.** A JSON number is refused, because its digits
  may not be the client's any more. Canonical is what the database returns on
  read: no leading zeros, no negative zero, the fraction padded to the column's
  scale. `12.5` into `numeric(14,2)` is `12.50`.
- **Never rounded.** An extra fractional or whole digit is refused. Rounding is
  a business rule, and applying one silently is how a ledger stops balancing.
- **Integers** may be numbers while they are safe integers, otherwise canonical
  strings; the range is checked with `BigInt`.
- **Text length is UTF-16 code units**, JavaScript's `length`, which is what
  formancy's `maxLength` counts in the browser. It is never fewer than
  characters, so an accepted value fits PostgreSQL `varchar(n)` and SQL Server
  `nvarchar(n)`. NUL is refused on both engines, because PostgreSQL cannot store it.
- **Temporal values use formancy's shapes**, read from `TEMPORAL_SHAPES` in
  `@formancy/spec` rather than restated, and must name a real day from
  0001-01-01 to 9999-12-31.
- **Null is a value only for a nullable column; an empty string is never null;
  `undefined` is not a value.** What an omitted field means in a patch is the
  caller's decision, not a codec's guess.
- **Read-only** when the database writes the value, or when no faithful write
  exists — a timestamp without a zone. **Unsupported** for binary and every type
  the snapshot could not normalise.
- **A rowversion token is sixteen lower-case hex characters**: one spelling per
  value, so comparing tokens as strings says "changed" only when the row did.

## Consequences

**What it buys.** The fixture's edge values round-trip exactly; a value the
browser accepted is a value the server accepts; and a write followed by a read
is not reported as a change.

**What it costs.** A client must send decimals as strings, which an ordinary
JSON client will not do by default; the error says so, but it is friction.
Canonicalising to scale means the API changes what it was sent — `12.5` comes
back `12.50` — which is the database's truth and still a surprise to some. The
code-unit count is stricter than PostgreSQL needs for text outside the Basic
Multilingual Plane. SQL Server's single-byte `varchar` can still refuse a
character its code page lacks; the adapter translates that error rather than
the codec modelling code pages.

**What it forecloses.** Accepting a JSON number for money, ever.

## Alternatives considered

**Accept numbers and convert with `String(n)`.** Rejected: `String` prints the
shortest round-trip form of the double, which is not the client's text once the
value has more digits than a double holds, and nothing here can tell.

**Round to scale, as many ORMs do.** Rejected: a business rule applied silently.

**Count characters (code points).** Rejected: formancy's browser check counts
code units, so the two would disagree on exactly the inputs nobody tests.
