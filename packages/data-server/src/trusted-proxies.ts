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
  return { ok: true, trustedProxies: [...new Set(entries)] }
}

/** What is wrong with `trustedProxies` as an embedder passed it, by place, or `undefined`: the setting's rule, with no trimming. */
export function trustedProxiesProblem(list: unknown): string | undefined {
  if (!Array.isArray(list)) return 'trustedProxies is not a list of addresses and ranges.'
  for (const [index, entry] of list.entries()) {
    const problem = entryProblem(entry)
    if (problem !== undefined) return `trustedProxies[${String(index)}] ${problem}.`
  }
  return undefined
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
