import { readFile } from 'node:fs/promises'
import { createDataServer } from './app.js'
import type { DataServerOptions } from './app.js'
import { createFileConfigurationStore } from './config-store.js'
import { createConnectionRegistry, parseConnections } from './connections.js'
import type { ConnectionRegistry } from './connections.js'
import { DRIVER_FACTORIES } from './drivers.js'
import { createIdentityVerifier } from './identity.js'
import type { IdentityOptions } from './identity.js'
import { servedPlanes } from './planes.js'
import { rateLimitSetting } from './rate-limit.js'
import { resolveSecret } from './secrets.js'

/**
 * The runnable server: `node dist/main.mjs`.
 *
 * Every setting is read here and nowhere else, and every missing one stops the
 * process with a sentence saying which, rather than starting a server that
 * accepts tokens from nobody or from everybody.
 *
 *   FORMANCY_DATA_ISSUER, FORMANCY_DATA_AUDIENCE   what the host's tokens say
 *   FORMANCY_DATA_IDENTITY_SECRET                  a secret reference: env:NAME or file:/path (HS256)
 *   FORMANCY_DATA_IDENTITY_PUBLIC_KEY_FILE         or a PEM public key, with
 *   FORMANCY_DATA_IDENTITY_ALGORITHM               RS256, ES256 or EdDSA
 *   FORMANCY_DATA_ATTRIBUTES                       e.g. "tenant=tid,region=reg"
 *   FORMANCY_DATA_RATE_LIMIT                       requests a minute per client address, default 600
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

async function identityKey(): Promise<IdentityOptions['key']> {
  const secretReference = process.env['FORMANCY_DATA_IDENTITY_SECRET']
  const publicKeyFile = process.env['FORMANCY_DATA_IDENTITY_PUBLIC_KEY_FILE']
  if ((secretReference === undefined) === (publicKeyFile === undefined)) {
    console.error('Set exactly one of FORMANCY_DATA_IDENTITY_SECRET and FORMANCY_DATA_IDENTITY_PUBLIC_KEY_FILE.')
    process.exit(1)
  }
  if (secretReference !== undefined) return { kind: 'secret', secret: await resolveSecret(secretReference) }
  const algorithm = required('FORMANCY_DATA_IDENTITY_ALGORITHM')
  if (algorithm !== 'RS256' && algorithm !== 'ES256' && algorithm !== 'EdDSA') {
    console.error('FORMANCY_DATA_IDENTITY_ALGORITHM is RS256, ES256 or EdDSA.')
    process.exit(1)
  }
  return { kind: 'public-key', pem: await readFile(publicKeyFile ?? '', 'utf8'), algorithm }
}

// Read before anything opens: a limit nobody chose stops the process here,
// not after the planes have connected.
const limit = rateLimitSetting(process.env['FORMANCY_DATA_RATE_LIMIT'])
if (!limit.ok) {
  console.error(limit.problem)
  process.exit(1)
}

const verifyIdentity = await createIdentityVerifier({
  key: await identityKey(),
  issuer: required('FORMANCY_DATA_ISSUER'),
  audience: required('FORMANCY_DATA_AUDIENCE'),
  attributes: attributeMap(process.env['FORMANCY_DATA_ATTRIBUTES']),
})

/**
 * The two planes, each on only when its configuration is present:
 *
 *   FORMANCY_DATA_STORE_DIR     the configuration store's volume (0013)
 *   FORMANCY_DATA_CONNECTIONS   the allowlist file, JSON (0019)
 *   FORMANCY_DATA_ADMIN_ROLES   comma-separated roles that administer (0020)
 *   FORMANCY_DATA_AUDIT_KEY     a secret reference naming records in the audit trail (0023)
 *
 * The store and the allowlist turn on the runtime plane; admin roles as well
 * turn on the administrator's plane. Without them the server verifies tokens
 * and nothing else, which is how a host is wired in before any form exists.
 */
const storeDirectory = process.env['FORMANCY_DATA_STORE_DIR']
const connectionsFile = process.env['FORMANCY_DATA_CONNECTIONS']
const adminRoles = (process.env['FORMANCY_DATA_ADMIN_ROLES'] ?? '').split(',').map((role) => role.trim()).filter((role) => role !== '')

let registry: ConnectionRegistry | undefined
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
  registry = createConnectionRegistry(parsed.connections, DRIVER_FACTORIES)
  const store = createFileConfigurationStore(storeDirectory)
  const auditReference = process.env['FORMANCY_DATA_AUDIT_KEY']
  const auditKey = auditReference === undefined ? undefined : await resolveSecret(auditReference)
  // One trail for both planes, the server's own log (0033).
  planes = servedPlanes({ registry, store, adminRoles, auditKey, log: () => app.log })
}

const app = await createDataServer({ verifyIdentity, logger: true, rateLimit: limit.rateLimit, ...planes })
app.log.info({ runtime: planes.runtime !== undefined, admin: planes.admin !== undefined, connections: registry?.ids() ?? [] }, 'planes')

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
