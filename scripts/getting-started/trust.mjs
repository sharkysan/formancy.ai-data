// Whom the composed stack's server trusts as a proxy (0071), for
// scripts/getting-started.mjs and scripts/cloudflare.mjs: what compose's
// resolved configuration says of it, and what the server's log says it
// believed. Pure, like stack.mjs's checks, so trust.test.mjs holds them to
// cases and to the committed files without Docker; Node built-ins only, like
// the gates that run them.

/** An IPv4 address in dotted decimal as a number, or undefined for anything else. */
function ipv4(text) {
  const parts = String(text).split('.')
  if (parts.length !== 4 || !parts.every((part) => /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) < 256)) return undefined
  return parts.reduce((value, part) => value * 256 + Number(part), 0)
}

/** Whether `address`, a number, is inside `cidr`. */
function within(address, cidr) {
  const [base, bits] = String(cidr).split('/')
  const start = ipv4(base)
  return start !== undefined && address >= start && address < start + 2 ** (32 - Number(bits))
}

/** The networks a service joins, each with what it says there: compose's map, a list made one, or compose's default when it names none and has no network_mode. */
function joined(service) {
  if (service.network_mode !== undefined) return {}
  if (service.networks === undefined) return { default: null }
  return Array.isArray(service.networks) ? Object.fromEntries(service.networks.map((name) => [String(name), null])) : service.networks
}

/** The fixed addresses a service holds on the networks named, or on every network it joins. */
function fixedAddresses(service, names) {
  return Object.entries(joined(service))
    .filter(([name, on]) => (names === undefined || names.includes(name)) && on?.ipv4_address !== undefined)
    .map(([, on]) => String(on.ipv4_address))
}

/** The services that proxy to the server: nginx, and cloudflared in front of it in the Cloudflare overlay. */
const PROXIES = new Set(['web', 'cloudflared'])

/**
 * What is wrong with the proxies the server trusts (0071) in compose's
 * resolved configuration, of compose.yaml alone or with the Cloudflare
 * overlay, in sentences that name an entry by its place:
 *
 * - the web front holds no fixed address on a network it shares with the
 *   server, or the server does not trust it, and with the overlay the same
 *   of cloudflared on the network it shares with the web front: every client
 *   would share that proxy's one bucket;
 * - a trusted entry is not one IPv4 address, or is in no network of the file
 *   with a fixed range: a range takes in its network's gateway, from where
 *   any local process reaches a container and could choose its own address;
 * - a trusted address is a network's gateway, or inside the part of its
 *   network Docker hands out, where another container could be given it;
 * - a service that is no proxy holds a trusted address.
 */
export function trustProblems(config) {
  const services = config.services ?? {}
  const { server, web, cloudflared } = services
  if (server === undefined || web === undefined) return ['the configuration has no server or no web front, so whom the server trusts cannot be read']
  const problems = []
  const trusted = String(server.environment?.FORMANCY_DATA_TRUSTED_PROXIES ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
  const front = fixedAddresses(web, Object.keys(joined(server)))
  if (front.length === 0)
    problems.push(
      "the web front holds no fixed address on a network it shares with the server, so the server cannot name it and every client shares nginx's one bucket",
    )
  else if (!front.some((address) => trusted.includes(address)))
    problems.push("the server's FORMANCY_DATA_TRUSTED_PROXIES does not name the web front's address, so every client shares nginx's one bucket")
  if (cloudflared !== undefined) {
    const tunnel = fixedAddresses(cloudflared, Object.keys(joined(web)))
    if (!tunnel.some((address) => trusted.includes(address)))
      problems.push(
        "cloudflared holds no fixed address the server trusts on the network it shares with the web front, so behind the tunnel every visitor shares cloudflared's one bucket",
      )
  }
  const networks = config.networks ?? {}
  for (const [place, entry] of trusted.entries()) {
    const where = `the server's FORMANCY_DATA_TRUSTED_PROXIES entry ${String(place + 1)}`
    const address = ipv4(entry)
    if (address === undefined) {
      problems.push(
        `${where} is not one IPv4 address: a range takes in its network's gateway, from where any local process reaches a container and could choose its own address`,
      )
      continue
    }
    const homes = Object.entries(networks).flatMap(([name, network]) =>
      (network?.ipam?.config ?? []).filter((range) => range?.subnet !== undefined && within(address, range.subnet)).map((range) => ({ name, range })),
    )
    if (homes.length === 0) problems.push(`${where} is in no network of the file with a fixed range, so nothing says who holds it`)
    for (const { name, range } of homes) {
      const gateway = range.gateway === undefined ? (ipv4(String(range.subnet).split('/')[0]) ?? 0) + 1 : ipv4(range.gateway)
      if (address === gateway) problems.push(`${where} is the gateway of ${name}, from where any local process reaches its containers`)
      if (range.ip_range === undefined || within(address, range.ip_range))
        problems.push(`${where} is in the part of ${name} Docker hands out, so another container could be given it`)
    }
    for (const [name, service] of Object.entries(services)) {
      if (!PROXIES.has(name) && fixedAddresses(service).includes(entry)) problems.push(`${name} holds the address of ${where}, and is no proxy`)
    }
  }
  return problems
}

/**
 * What the server's log says of whom it believed (0071): it names no
 * request at all, or names the web front's own fixed address for one,
 * which it logs only when it did not believe nginx's X-Forwarded-For --
 * every request through nginx then counted in one bucket. `logText` is
 * the server's log, `config` compose's resolved configuration.
 */
export function believedProblems(logText, config) {
  const front = fixedAddresses(config.services?.web ?? {})
  const addresses = []
  for (const line of logText.split('\n')) {
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (parsed !== null && typeof parsed === 'object' && parsed.msg === 'incoming request' && typeof parsed.req?.remoteAddress === 'string')
      addresses.push(parsed.req.remoteAddress)
  }
  if (addresses.length === 0) return ["the server's log names no request, so whom it believed cannot be read"]
  const own = addresses.filter((address) => front.includes(address)).length
  return own === 0 ? [] : [`${String(own)} of the ${String(addresses.length)} requests in the server's log name the web front's own address`]
}
