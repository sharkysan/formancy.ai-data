import { readFile } from 'node:fs/promises'
import { createDataServer } from './app.js'
import type { DataServerOptions } from './app.js'
import { createFileConfigurationStore } from './config-store.js'
import { createConnectionRegistry, entraEnvironmentProblems, parseConnections, untestedLogins } from './connections.js'
import type { ConnectionRegistry } from './connections.js'
import { corsOriginsSetting } from './cors.js'
import { DRIVER_FACTORIES } from './drivers.js'
import { identityKeySource, openIdentity, readAgainOnSignal } from './identity-settings.js'
import { servedPlanes } from './planes.js'
import { lookupDeadlineSetting } from './lookup-deadline.js'
import { publisherRolesSetting } from './publisher-roles.js'
import { rateLimitSetting } from './rate-limit.js'
import { resolveSecret } from './secrets.js'
import { trustedProxiesSetting } from './trusted-proxies.js'

/**
 * The runnable server: `node dist/main.mjs`.
 *
 * Every setting the server runs on is read here -- the identity key's
 * parsed and opened by identity-settings.ts, which identity-keys-cli.mjs
 * shares -- and every missing one stops the process with a sentence saying
 * which, rather than starting a server that accepts tokens from nobody or
 * from everybody.
 *
 *   FORMANCY_DATA_ISSUER, FORMANCY_DATA_AUDIENCE   what the host's tokens say
 *   FORMANCY_DATA_IDENTITY_SECRET                  a secret reference: env:NAME or file:/path (HS256)
 *   FORMANCY_DATA_IDENTITY_PUBLIC_KEY_FILE         or a PEM public key, with
 *   FORMANCY_DATA_IDENTITY_ALGORITHM               RS256, ES256 or EdDSA
 *   FORMANCY_DATA_IDENTITY_KEYS_FILE               or the absolute path of a JSON Web Key Set, with
 *   FORMANCY_DATA_IDENTITY_ALGORITHM               RS256, ES256, EdDSA or HS256; read again on SIGHUP (0059)
 *   FORMANCY_DATA_ATTRIBUTES                       e.g. "tenant=tid,region=reg"
 *   FORMANCY_DATA_RATE_LIMIT                       requests a minute per client address, default 600
 *   FORMANCY_DATA_TRUSTED_PROXIES                  the proxies whose X-Forwarded-For names the client address,
 *                                                  IP addresses and CIDR ranges, comma-separated; unset: none (0071)
 *   FORMANCY_DATA_CORS_ORIGINS                     origins the runtime plane answers, comma-separated, each
 *                                                  exactly as a browser sends Origin; empty or unset: none (0060)
 *   FORMANCY_DATA_LOOKUP_DEADLINE_MS               how long a lookup statement may run before it is stopped,
 *                                                  1 to 2147483647 ms; default DEFAULT_LOOKUP_DEADLINE_MS, derived
 *                                                  from docs/performance/results.json (0061)
 *   PORT                                           default 4390
 */
function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    console.error(`${name} is required.`)
    process.exit(1)
  }
  return value
}

function attributeMap(text: string | undefined): Record<string, string> {
  const map: Record<string, string> = {}
  for (const pair of (text ?? '').split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')) {
    const [attribute, claim, extra] = pair.split('=')
    if (attribute === undefined || claim === undefined || extra !== undefined || attribute === '' || claim === '') {
      console.error(`FORMANCY_DATA_ATTRIBUTES: "${pair}" is not attribute=claim.`)
      process.exit(1)
    }
    map[attribute] = claim
  }
  return map
}

// Read before anything opens: a limit nobody chose stops the process here,
// not after the planes have connected.
const limit = rateLimitSetting(process.env['FORMANCY_DATA_RATE_LIMIT'])
if (!limit.ok) {
  console.error(limit.problem)
  process.exit(1)
}

// Read before anything opens, as the limit is: a list that would believe
// every client about itself -- `true`, `*`, a prefix of 0, a hop count --
// an empty entry, or anything that is not an address or a range stops the
// process here (trusted-proxies.ts, 0071). Read once: changing it is a
// restart.
const proxies = trustedProxiesSetting(process.env['FORMANCY_DATA_TRUSTED_PROXIES'])
if (!proxies.ok) {
  console.error(proxies.problem)
  process.exit(1)
}

// Read before anything opens, as the limit is: a deadline of 0, junk, or one
// longer than a timer holds stops the process here (lookup-deadline.ts, 0061).
const deadline = lookupDeadlineSetting(process.env['FORMANCY_DATA_LOOKUP_DEADLINE_MS'])
if (!deadline.ok) {
  console.error(deadline.problem)
  process.exit(1)
}

// Read before anything opens, as the limit is: an origin list nobody could
// have meant -- a wildcard, a pattern, a spelling no browser sends -- or one
// beside a server with no runtime plane, whose routes are all it grants,
// stops the process here (cors.ts, 0060). Read once: changing it is a
// restart.
const origins = corsOriginsSetting(process.env['FORMANCY_DATA_CORS_ORIGINS'], {
  runtime: process.env['FORMANCY_DATA_STORE_DIR'] !== undefined && process.env['FORMANCY_DATA_CONNECTIONS'] !== undefined,
})
if (!origins.ok) {
  console.error(origins.problem)
  process.exit(1)
}

// The planes' settings, read here so that review can be checked against
// them before anything opens. The administrator's plane is on with a store,
// an allowlist and at least one administrator role.
const storeDirectory = process.env['FORMANCY_DATA_STORE_DIR']
const connectionsFile = process.env['FORMANCY_DATA_CONNECTIONS']
const adminRoles = (process.env['FORMANCY_DATA_ADMIN_ROLES'] ?? '').split(',').map((role) => role.trim()).filter((role) => role !== '')

// Read before anything opens, as the limit is: review that names no
// publisher, names a role the administrator's plane does not admit, or
// is set beside a server with no administrator's plane stops the process
// here (publisher-roles.ts, 0065). Read once: changing it is a restart.
const review = publisherRolesSetting(process.env['FORMANCY_DATA_PUBLISHER_ROLES'], {
  adminRoles,
  admin: storeDirectory !== undefined && connectionsFile !== undefined && adminRoles.length > 0,
})
if (!review.ok) {
  console.error(review.problem)
  process.exit(1)
}

// Which key, decided before any file is opened, and then opened
// (identity-settings.ts): every refusal of it -- a secret or a file that
// cannot be read, a short secret, a public key that does not import, a key
// set refused -- stops the process here with one sentence.
const identity = identityKeySource(process.env)
if (!identity.ok) {
  console.error(identity.problem)
  process.exit(1)
}
const opened = await openIdentity(
  identity.source,
  { env: process.env, readFile: (path) => readFile(path, 'utf8') },
  { issuer: required('FORMANCY_DATA_ISSUER'), audience: required('FORMANCY_DATA_AUDIENCE'), attributes: attributeMap(process.env['FORMANCY_DATA_ATTRIBUTES']) },
)
if (!opened.ok) {
  console.error(opened.problem)
  process.exit(1)
}
const { verifyIdentity, file: keyFile } = opened

/**
 * The two planes, each on only when its configuration is present:
 *
 *   FORMANCY_DATA_STORE_DIR         the configuration store's volume (0013)
 *   FORMANCY_DATA_CONNECTIONS       the allowlist file, JSON (0019)
 *   FORMANCY_DATA_ADMIN_ROLES       comma-separated roles that administer (0020)
 *   FORMANCY_DATA_PUBLISHER_ROLES   comma-separated roles, each also an admin role, that approve
 *                                   another administrator's draft; set, publication is reviewed (0065)
 *   FORMANCY_DATA_AUDIT_KEY         a secret reference naming records in the audit trail (0023)
 *
 * The store and the allowlist turn on the runtime plane; admin roles as well
 * turn on the administrator's plane, and publisher roles put it under
 * review. Without them the server verifies tokens and nothing else, which is
 * how a host is wired in before any form exists.
 */
let registry: ConnectionRegistry | undefined
let untested: string[] = []
let planes: Pick<DataServerOptions, 'admin' | 'runtime'> = {}
if ((storeDirectory === undefined) !== (connectionsFile === undefined)) {
  console.error('Set both FORMANCY_DATA_STORE_DIR and FORMANCY_DATA_CONNECTIONS, or neither.')
  process.exit(1)
}
if (storeDirectory !== undefined && connectionsFile !== undefined) {
  const parsed = parseConnections(JSON.parse(await readFile(connectionsFile, 'utf8')) as unknown)
  if (!parsed.ok) {
    console.error(`${connectionsFile}:\n  ${parsed.problems.join('\n  ')}`)
    process.exit(1)
  }
  // A managed identity that the environment would turn into workload
  // identity, another principal at another authority, stops the process
  // here, naming the variable and never its value (0074).
  const environment = entraEnvironmentProblems(parsed.connections, process.env)
  if (environment.length > 0) {
    console.error(environment.join('\n'))
    process.exit(1)
  }
  registry = createConnectionRegistry(parsed.connections, DRIVER_FACTORIES)
  untested = untestedLogins(parsed.connections)
  const store = createFileConfigurationStore(storeDirectory)
  const auditReference = process.env['FORMANCY_DATA_AUDIT_KEY']
  const auditKey = auditReference === undefined ? undefined : await resolveSecret(auditReference)
  // One trail for both planes, the server's own log (0033).
  planes = servedPlanes({ registry, store, adminRoles, publisherRoles: review.publisherRoles, auditKey, origins: origins.origins, lookupDeadlineMs: deadline.ms, log: () => app.log })
}

const app = await createDataServer({ verifyIdentity, logger: true, rateLimit: limit.rateLimit, trustedProxies: proxies.trustedProxies, ...planes })
const identityKeys = keyFile === undefined ? {} : { identityKeys: { kids: keyFile.current().kids, leftOut: keyFile.current().leftOut } }
app.log.info({ runtime: planes.runtime !== undefined, admin: planes.admin !== undefined, review: planes.admin?.publisherRoles !== undefined, connections: registry?.ids() ?? [], trustedProxies: proxies.trustedProxies, ...identityKeys }, 'planes')
// Once for each connection that logs in as an Entra principal, naming the
// connection and nothing of the principal: no test of this release logs
// in as one (0074).
for (const sentence of untested) app.log.warn(sentence)

// SIGHUP reads the key set file again, and with a one-key setting says it
// read nothing; either way it no longer stops the server, which is Node's
// default. Installed before listen, so no signal arrives without it.
readAgainOnSignal(process, keyFile, app.log)

// On SIGTERM a container stops taking requests, finishes the ones in flight,
// and closes every database pool, so a rolling deploy leaves no half-open sessions.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void (async () => {
      await app.close()
      await registry?.close()
      process.exit(0)
    })()
  })
}

await app.listen({ host: '0.0.0.0', port: Number(process.env['PORT'] ?? 4390) })
