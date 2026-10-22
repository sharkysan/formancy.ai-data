import { describe, expect, test } from 'vitest'
import { trustedProxiesProblem, trustedProxiesSetting } from './trusted-proxies.js'

/*
 * `FORMANCY_DATA_TRUSTED_PROXIES` as main.ts reads it, and `trustedProxies`
 * as createDataServer checks it (0071): the proxies whose X-Forwarded-For
 * the server believes, each an IP address or a CIDR range. What the server
 * does with the list is forwarded.test.ts's; this is what the list may hold.
 */

describe('FORMANCY_DATA_TRUSTED_PROXIES', () => {
  // Unset is how every deployment before 0071 ran, and nothing is trusted:
  // a default that trusted anybody would let a client of an upgraded server
  // choose its own address without a line of its configuration changing.
  // Compose passes "" for a variable it was given no value for, and that too
  // trusts nothing, which is the closed side.
  test('unset, empty or only space trusts nothing', () => {
    for (const text of [undefined, '', '   ']) expect(trustedProxiesSetting(text)).toEqual({ ok: true, trustedProxies: [] })
  })

  // What an operator writes: one proxy's address, a range its proxies are
  // in, both families, an IPv4 address as a dual-stack socket reports it,
  // space around an entry, and an entry written twice, kept once. The
  // composed stack's own value is among them.
  test('accepts addresses and CIDR ranges of either family', () => {
    expect(trustedProxiesSetting('172.16.238.250,172.16.239.250')).toEqual({ ok: true, trustedProxies: ['172.16.238.250', '172.16.239.250'] })
    expect(trustedProxiesSetting(' 10.0.0.0/8 , 192.0.2.7,2001:db8::/32, ::1, ::ffff:10.0.0.2, ::ffff:10.0.0.0/104, 2001:DB8::5/128, 10.0.0.0/8')).toEqual({
      ok: true,
      trustedProxies: ['10.0.0.0/8', '192.0.2.7', '2001:db8::/32', '::1', '::ffff:10.0.0.2', '::ffff:10.0.0.0/104', '2001:DB8::5/128'],
    })
  })

  // Each row is a list that would believe a client about itself, or one that
  // says less than the operator meant, so the server stops rather than
  // starting with it. `true` and `*` trust every peer, and a prefix of 0 is
  // every address: any client could then send an X-Forwarded-For naming
  // whatever address it liked, and so pick its own rate-limit bucket and the
  // address the log gives it. A hop count trusts by position, not by who
  // connected -- @fastify/proxy-addr would even read `2` as the address
  // 0.0.0.2. An empty entry is where a value interpolated into the list went
  // missing. A range with bits set past its prefix is what `ip addr` prints
  // for one interface, 172.16.238.250/24, pasted where the one address was
  // meant: it trusts the whole network, its gateway included. The rest are
  // spellings @fastify/proxy-addr reads differently or not at all: a
  // netmask, a zone, a name it expands to ranges, a port, a URL. Each row
  // names the rule that refuses it, so a row another rule happens to catch
  // does not stand for this one; the sentence names the entry by its place
  // and never repeats it. Watched failing with `true` read as an address
  // (refused as one, not as trusting everybody), with the prefix-0 rule off
  // (both were accepted), with the empty-entry rule off (`10.0.0.1,` was
  // accepted), with the host-bits rule off (the three pasted ranges were
  // accepted), and with the entry put into the sentence.
  const EVERYBODY = /trusts every peer/
  const HOPS = /counts hops/
  const EMPTY = /is empty/
  const HOST_BITS = /has bits set past its prefix/
  const NOT_ADDRESS = /is not an IP address or a CIDR range/
  test.each([
    ['true', 1, 'true', EVERYBODY],
    ['TRUE', 1, 'true in capitals', EVERYBODY],
    ['*', 1, 'a wildcard', EVERYBODY],
    ['0.0.0.0/0', 1, 'every IPv4 address', EVERYBODY],
    ['::/0', 1, 'every IPv6 address', EVERYBODY],
    ['2', 1, 'a hop count', HOPS],
    ['10.0.0.1,', 2, 'a trailing comma', EMPTY],
    ['10.0.0.1,,10.0.0.2', 2, 'two commas', EMPTY],
    [', 10.0.0.1', 1, 'a leading comma', EMPTY],
    ['172.16.238.250/24', 1, 'an interface address with its prefix', HOST_BITS],
    ['2001:db8::1/64', 1, 'an IPv6 interface address with its prefix', HOST_BITS],
    ['::ffff:10.0.0.1/104', 1, 'an IPv4-mapped range with a host bit', HOST_BITS],
    ['10.0.0.0/255.0.0.0', 1, 'a netmask', NOT_ADDRESS],
    ['10.0.0.0/08', 1, 'a prefix with a leading zero', NOT_ADDRESS],
    ['10.0.0.0/33', 1, 'a prefix past 32', NOT_ADDRESS],
    ['2001:db8::/129', 1, 'a prefix past 128', NOT_ADDRESS],
    ['10.0.0.0/', 1, 'a slash and nothing', NOT_ADDRESS],
    ['fe80::1%eth0', 1, 'a zone', NOT_ADDRESS],
    ['loopback', 1, 'a name proxy-addr expands', NOT_ADDRESS],
    ['010.0.0.1', 1, 'a leading zero, which proxy-addr reads as octal, 8.0.0.1', NOT_ADDRESS],
    ['10.1', 1, 'a short form', NOT_ADDRESS],
    ['10.0.0.1:8080', 1, 'a port', NOT_ADDRESS],
    ['[2001:db8::1]', 1, 'brackets', NOT_ADDRESS],
    ['http://user:S3cret-pw-e81@proxy.example', 1, 'a URL with a password', NOT_ADDRESS],
    ['proxy.example', 1, 'a host name', NOT_ADDRESS],
  ] as const)('refuses %j, entry %i, %s', (text, place, _what, rule) => {
    const outcome = trustedProxiesSetting(text)
    expect(outcome.ok).toBe(false)
    const problem = outcome.ok ? '' : outcome.problem
    expect(problem).toMatch(new RegExp(`^FORMANCY_DATA_TRUSTED_PROXIES: entry ${String(place)} `))
    expect(problem).toMatch(rule)
    const entries = text.split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')
    for (const entry of entries) expect(problem).not.toContain(entry)
  })

  // A prefix of 0 is refused, and two entries that are its two halves were
  // not: 0.0.0.0/1 and 128.0.0.0/1 trust every IPv4 peer as surely, and so
  // does ::ffff:0.0.0.0/96, the whole of IPv4 as @fastify/proxy-addr reads a
  // mapped range, which compares an IPv4-mapped peer as IPv4 (0099). The
  // list as a whole is what the server believes, so it is the whole that is
  // held to the rule: every peer of a family, by any number of entries, is
  // everybody. Watched failing before 0099 with every row accepted.
  test.each([
    ['0.0.0.0/1, 128.0.0.0/1', 'IPv4', 'the two halves of IPv4'],
    ['::ffff:0.0.0.0/96', 'IPv4', 'the whole of IPv4, mapped'],
    ['0.0.0.0/1, ::ffff:128.0.0.0/97', 'IPv4', 'one half plain and one mapped'],
    ['10.0.0.0/8, 0.0.0.0/2, 64.0.0.0/2, 128.0.0.0/1', 'IPv4', 'quarters and a half, and a range inside them'],
    ['::/1, 8000::/1', 'IPv6', 'the two halves of IPv6'],
  ] as const)('refuses %j, whose entries together trust every %s peer: %s', (text, family, _what) => {
    const outcome = trustedProxiesSetting(text)
    expect(outcome).toEqual({ ok: false, problem: expect.stringMatching(new RegExp(`^FORMANCY_DATA_TRUSTED_PROXIES: its entries together cover every ${family} address, which trusts every peer`)) as unknown })
    for (const entry of text.split(',').map((part) => part.trim())) expect(outcome.ok ? '' : outcome.problem).not.toContain(entry)
  })

  // What stops short of everybody is the operator's to name: half of IPv4 is
  // a mistake this rule does not catch, and a wide IPv6 range covers no IPv4
  // peer, since proxy-addr matches an IPv4 peer only against an IPv4 range or
  // a mapped one of /96 or narrower.
  test('accepts entries that together stop short of every peer of a family', () => {
    expect(trustedProxiesSetting('0.0.0.0/1, 128.0.0.0/2').ok).toBe(true)
    expect(trustedProxiesSetting('0.0.0.0/1, ::/1').ok).toBe(true)
    expect(trustedProxiesSetting('::/1, 8000::/2, ::ffff:0.0.0.0/97').ok).toBe(true)
  })

  // One refused entry refuses the list: starting with the rest would trust
  // fewer proxies than written, and the operator would read one bucket for
  // everybody as the setting not working, or more than written.
  test('refuses the whole list for one bad entry, naming the first', () => {
    expect(trustedProxiesSetting('10.0.0.1, *, 10.0.0.0/33')).toEqual({ ok: false, problem: expect.stringMatching(/^FORMANCY_DATA_TRUSTED_PROXIES: entry 2 trusts every peer/) as unknown })
  })
})

describe('trustedProxies, as createDataServer checks it', () => {
  // An embedder's list is held to the setting's rule, entry by entry and
  // without trimming, named by its index: the same list cannot start one way
  // and not the other.
  test('takes a list of addresses and ranges, and an empty one', () => {
    expect(trustedProxiesProblem(['10.0.0.2', '2001:db8::/32'])).toBeUndefined()
    expect(trustedProxiesProblem([])).toBeUndefined()
  })

  test.each([
    [['*'], /^trustedProxies\[0\] trusts every peer/],
    [['10.0.0.2', true], /^trustedProxies\[1\] is not a string/],
    [['10.0.0.2', ' 10.0.0.3'], /^trustedProxies\[1\] is not an IP address or a CIDR range/],
    [['10.0.0.2', ''], /^trustedProxies\[1\] is empty/],
    [['10.0.0.5/24'], /^trustedProxies\[0\] has bits set past its prefix/],
    [['0.0.0.0/1', '128.0.0.0/1'], /^trustedProxies together cover every IPv4 address, which trusts every peer/],
    [true, /^trustedProxies is not a list/],
    ['10.0.0.2', /^trustedProxies is not a list/],
  ] as const)('refuses %j', (list, sentence) => {
    expect(trustedProxiesProblem(list)).toMatch(sentence)
  })
})
