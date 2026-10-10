import { lookup } from 'node:dns/promises'
import { readdir, readFile } from 'node:fs/promises'

/*
 * The network path as the run found it: the proxy variables the client
 * would honour, the order a database host name resolves in, and whether a
 * docker-proxy process carries the published port. Recorded, never assumed.
 */

const PROXY_VARIABLES = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_USE_ENV_PROXY'] as const

/**
 * A proxy setting with anything that may be a user and a password removed:
 * the page names the proxy, never a password. Fails closed, by position
 * rather than by parsing: everything between the scheme, if there is one,
 * and the last `@` goes. A URL parser reads curl's scheme-less
 * `user:password@host:port` as a scheme with no user, and throws on a value
 * it cannot read, and either way handed the password through.
 */
export function withoutCredentials(value: string): string {
  const at = value.lastIndexOf('@')
  if (at === -1) return value
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.exec(value)?.[0] ?? ''
  return `${scheme}${value.slice(at + 1)}`
}

/** The proxy variables, upper case winning over lower, credentials removed; null when unset. */
export function proxySettings(env: Readonly<Record<string, string | undefined>>): Record<string, string | null> {
  const settings: Record<string, string | null> = {}
  for (const name of PROXY_VARIABLES) {
    const value = env[name] ?? env[name.toLowerCase()]
    settings[name] = value === undefined || value === '' ? null : withoutCredentials(value)
  }
  return settings
}

/** Every address `host` resolves to, in the order Node's resolver returns them, which is the order a connect tries. */
export async function lookupOrder(host: string): Promise<string[]> {
  return (await lookup(host, { all: true })).map((entry) => entry.address)
}

/**
 * Whether a docker-proxy process carries `port`, from the command lines in
 * /proc. False when none is visible from here, which a daemon running in
 * another PID namespace also gives: the page says "none found", not "none".
 */
export async function dockerProxyFor(port: number): Promise<boolean> {
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    const command = await readFile(`/proc/${entry}/cmdline`, 'utf8').catch(() => '')
    const args = command.split('\0')
    if (!(args[0] ?? '').endsWith('docker-proxy')) continue
    const at = args.indexOf('-host-port')
    if (at !== -1 && args[at + 1] === String(port)) return true
  }
  return false
}
