/**
 * Whom the server believes about a client's address (0071).
 *
 * `FORMANCY_DATA_TRUSTED_PROXIES` is read by the composition root (main.ts)
 * and parsed here, so the rule is tested without starting a process;
 * createDataServer holds an embedder's `trustedProxies` to the same rule and
 * hands the list to Fastify's `trustProxy`. Unset, nothing is trusted, as
 * before 0071: every request is counted and logged by the address of the
 * peer that connected.
 *
 * Listed, a request whose peer is in the list is counted and logged by the
 * address Fastify reads from X-Forwarded-For: walking from the right, the
 * first address that is not in the list -- or the leftmost, when every one
 * is. Only X-Forwarded-For; RFC 7239's Forwarded is not read.
 */
import { isIP } from 'node:net'
import type { FastifyRequest } from 'fastify'

const SETTING = 'FORMANCY_DATA_TRUSTED_PROXIES'

/** What every refusal asks for instead. */
const ASK = 'name each proxy by its address, or the range its addresses are in'

/** A prefix length as a CIDR range writes it: decimal, no sign, no leading zero. */
const PREFIX = /^(0|[1-9][0-9]{0,2})$/

/**
 * The address's bits, most significant first: 4 bytes or 16. `address` is
 * one `isIP` accepted, with no zone, so each group is hexadecimal and an
 * IPv6 address holds at most one `::` and, at its end, at most one dotted
 * IPv4 address.
 */
function addressBytes(address: string, family: 4 | 6): number[] {
  if (family === 4) return address.split('.').map(Number)
  const last = address.lastIndexOf(':')
  const dotted = address.includes('.') ? address.slice(last + 1).split('.').map(Number) : undefined
  const hex = dotted === undefined ? address : `${address.slice(0, last + 1)}0:0`
  const groups = (part: string) => (part === '' ? [] : part.split(':').map((group) => Number.parseInt(group, 16)))
  const [head = '', tail] = hex.split('::')
  const before = groups(head)
  const after = tail === undefined ? [] : groups(tail)
  const bytes = [...before, ...new Array<number>(8 - before.length - after.length).fill(0), ...after].flatMap((group) => [group >> 8, group & 0xff])
  if (dotted !== undefined) bytes.splice(12, 4, ...dotted)
  return bytes
}

/** Whether any bit past the first `prefix` is set. */
function hostBitsSet(bytes: readonly number[], prefix: number): boolean {
  return bytes.some((byte, index) => (byte & (0xff >> Math.max(0, Math.min(8, prefix - index * 8)))) !== 0)
}

/**
 * Why `entry` is not a proxy this server trusts, as the end of a sentence
 * that never repeats it, or `undefined`. An entry is an IP address as
 * Node's `isIP` reads one -- dotted decimal with no leading zero, or IPv6
 * with no zone -- alone or with `/` and a prefix length of 1 to 32 or 128,
 * with no bit set past the prefix.
 */
function entryProblem(entry: unknown): string | undefined {
  if (typeof entry !== 'string') return 'is not a string'
  if (entry === '') return 'is empty, which is where a value written into the list went missing'
  const everybody = `trusts every peer, which lets any client name its own address in X-Forwarded-For and so choose its own rate-limit bucket and the address the log gives it: ${ASK}`
  if (entry === '*' || entry.toLowerCase() === 'true') return everybody
  if (/^[0-9]+$/.test(entry)) return `counts hops, which trusts by position rather than by who connected: ${ASK}`
  const slash = entry.indexOf('/')
  const address = slash === -1 ? entry : entry.slice(0, slash)
  const family = address.includes('%') ? 0 : isIP(address)
  const notAddress = `is not an IP address or a CIDR range -- an address, a slash and a prefix length: ${ASK}`
  if (family !== 4 && family !== 6) return notAddress
  if (slash === -1) return undefined
  const prefix = entry.slice(slash + 1)
  if (!PREFIX.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128)) return notAddress
  if (Number(prefix) === 0) return everybody
  if (hostBitsSet(addressBytes(address, family), Number(prefix))) {
    return 'has bits set past its prefix, as an interface address with its prefix does, so it names a whole network where one address was likely meant: write the one address alone, or the range by its first address'
  }
  return undefined
}

/** ::ffff:0:0/96, where an IPv4 address is written as IPv6, as a 128-bit number. */
const MAPPED = 0xffffn << 32n

/** An entry's addresses, first and past the last, as a number of its family's width. */
function rangeOf(entry: string): { family: 4 | 6; start: bigint; end: bigint } {
  const slash = entry.indexOf('/')
  const address = slash === -1 ? entry : entry.slice(0, slash)
  const family = isIP(address) === 4 ? 4 : 6
  const width = family === 4 ? 32 : 128
  const prefix = slash === -1 ? width : Number(entry.slice(slash + 1))
  const start = addressBytes(address, family).reduce((value, byte) => (value << 8n) | BigInt(byte), 0n)
  return { family, start, end: start + (1n << BigInt(width - prefix)) }
}

/** Whether `ranges`, each first and past the last, together hold every number below `size`. */
function covers(ranges: ReadonlyArray<readonly [bigint, bigint]>, size: bigint): boolean {
  let reached = 0n
  for (const [start, end] of [...ranges].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (start > reached) return false
    if (end > reached) reached = end
  }
  return reached >= size
}

/**
 * The family whose every peer `entries`, each one entryProblem passed,
 * together trust, or `undefined`. Read as @fastify/proxy-addr matches a
 * peer: an IPv4-mapped peer is compared as IPv4, against an IPv4 range or a
 * mapped one of /96 or narrower; any other IPv6 peer against the other IPv6
 * ranges. A prefix of 0 is one entry's problem; this is the same rule held
 * by the list, whose entries the server believes together (0099).
 */
function everybodyOf(entries: readonly string[]): 4 | 6 | undefined {
  const ipv4: Array<readonly [bigint, bigint]> = []
  const ipv6: Array<readonly [bigint, bigint]> = [[MAPPED, MAPPED + (1n << 32n)]]
  for (const entry of entries) {
    const { family, start, end } = rangeOf(entry)
    if (family === 4) ipv4.push([start, end])
    else if (start >= MAPPED && end <= MAPPED + (1n << 32n)) ipv4.push([start - MAPPED, end - MAPPED])
    else ipv6.push([start, end])
  }
  if (covers(ipv4, 1n << 32n)) return 4
  if (covers(ipv6, 1n << 128n)) return 6
  return undefined
}

/** The sentence for a list that trusts every peer of `family`, after the words naming the list. */
function everybodySentence(family: 4 | 6): string {
  return `cover every IPv${String(family)} address, which trusts every peer, as a prefix of 0 does: ${ASK}`
}

export type TrustedProxiesSetting = { ok: true; trustedProxies: string[] } | { ok: false; problem: string }

/**
 * `FORMANCY_DATA_TRUSTED_PROXIES` as written: addresses and CIDR ranges
 * separated by commas, space around each ignored, each kept once. Unset,
 * empty or only space trusts nothing. Any entry that is not one -- an empty
 * one included -- refuses the whole setting, named by its place and never
 * quoted.
 */
export function trustedProxiesSetting(text: string | undefined): TrustedProxiesSetting {
  if (text === undefined || text.trim() === '') return { ok: true, trustedProxies: [] }
  const entries = text.split(',').map((entry) => entry.trim())
  for (const [index, entry] of entries.entries()) {
    const problem = entryProblem(entry)
    if (problem !== undefined) return { ok: false, problem: `${SETTING}: entry ${String(index + 1)} ${problem}.` }
  }
  const family = everybodyOf(entries)
  if (family !== undefined) return { ok: false, problem: `${SETTING}: its entries together ${everybodySentence(family)}.` }
  return { ok: true, trustedProxies: [...new Set(entries)] }
}

/** What is wrong with `trustedProxies` as an embedder passed it, by place, or `undefined`: the setting's rule, with no trimming. */
export function trustedProxiesProblem(list: unknown): string | undefined {
  if (!Array.isArray(list)) return 'trustedProxies is not a list of addresses and ranges.'
  for (const [index, entry] of list.entries()) {
    const problem = entryProblem(entry)
    if (problem !== undefined) return `trustedProxies[${String(index)}] ${problem}.`
  }
  const family = everybodyOf(list as string[])
  return family === undefined ? undefined : `trustedProxies together ${everybodySentence(family)}.`
}

/**
 * The address a request is counted and logged by: the one Fastify derived,
 * when it is an IP address, and the peer's otherwise. Fastify gives back
 * whatever text stands at the place the walk stops: from a trusted proxy
 * that writes an address with its port, a new rate-limit bucket per
 * connection, and from one that forwards a client's own header without
 * adding to it, whatever the client typed, in the bucket's key and in the
 * log. Not believed, the request is counted as its peer's, as without the
 * setting. An address the client typed there is still believed: such a
 * proxy is never safe to name (0071).
 */
export function clientAddress(request: FastifyRequest): string {
  const derived = request.ip
  if (isIP(derived) !== 0) return derived
  return request.socket.remoteAddress ?? derived
}
