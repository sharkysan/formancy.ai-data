# 0099 — A proxy list whose entries together trust every peer of a family is refused

- **Status:** accepted; narrows [0071](0071-the-server-believes-the-forwarded-address-only-from-the-proxies-an-operator-names.md): the list as a whole, not only each entry, may not trust every peer
- **Date:** 2026-10-22
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-server/src/trusted-proxies.test.ts`.
  *Refuses … whose entries together trust every IPv4 peer* and *… every IPv6
  peer*, for `0.0.0.0/1, 128.0.0.0/1`; `::ffff:0.0.0.0/96`; `0.0.0.0/1,
  ::ffff:128.0.0.0/97`; four entries that tile IPv4 with a range inside them;
  and `::/1, 8000::/1` -- each refused with a sentence that repeats none of
  them (watched failing before this record: every one accepted). *Accepts
  entries that together stop short of every peer of a family* -- half of
  IPv4 and a quarter more; half of IPv4 and half of IPv6, since a wide IPv6
  range matches no IPv4 peer; half of IPv6, a quarter and a mapped half
  (watched failing with every IPv6 range that touches the mapped block
  counted as all of IPv4). *trustedProxies, as createDataServer checks it*
  refuses `['0.0.0.0/1', '128.0.0.0/1']` the same way. The rest of the file
  and `forwarded.test.ts` pass as before.

## Context

`FORMANCY_DATA_TRUSTED_PROXIES` names the peers whose `X-Forwarded-For` the
server believes; a client behind one of them is counted by the rate limit,
and named in the log, by the address that header gives
([0071](0071-the-server-believes-the-forwarded-address-only-from-the-proxies-an-operator-names.md)).
0071 refuses an entry that trusts every peer -- `true`, `*`, a prefix of 0 --
because then any client can name its own address, and so choose its own
rate-limit bucket and what the log says of it.

It held each entry to that rule, and not the list: `0.0.0.0/1` and
`128.0.0.0/1` are each half of IPv4 and together all of it, and
`::ffff:0.0.0.0/96` is all of IPv4 written as IPv6, which
`@fastify/proxy-addr` 5.1.1 matches against every IPv4 peer, since it
compares an IPv4-mapped peer as IPv4 and lets a mapped range of /96 or
narrower match it. Both started, trusting everybody. Found by the
formancy.ai-report repository's review of its own server, which takes this
repository's identity package and checked its proxy setting against the same
lists.

## Decision

**The entries are read together, as `@fastify/proxy-addr` matches a peer,
and a list that trusts every IPv4 peer or every IPv6 peer is refused**, at
start for the setting and by `createDataServer` for an embedder's list, with
the sentence a prefix of 0 gets.

- An IPv4 peer is matched against the IPv4 entries and the IPv4-mapped ranges
  of /96 or narrower, read as the IPv4 ranges they map.
- Any other IPv6 peer is matched against the other IPv6 entries; the mapped
  block is never such a peer, so it counts as covered for this question.
- Each entry is first held to 0071's rules, so the ranges read here are
  addresses and well-formed ranges.

## Alternatives

- **Refuse any range wider than some size.** It would refuse a cloud
  provider's published proxy ranges, which an operator may rightly name, and
  the size would be a number nobody measured.
- **Leave it to the operator.** The rule against trusting everybody exists
  because the mistake is easy and silent; two halves are the same mistake.

## Consequences

**What it buys.** No list, however written, trusts every peer of a family.

**What it costs.** A list that trusts all but a sliver -- `0.0.0.0/1` and
`128.0.0.0/2`, say -- still starts: the rule refuses everybody, not nearly
everybody, and what the operator names short of that is theirs. The list is
read again at every start, which is linear in its length and nothing an
operator will notice.
