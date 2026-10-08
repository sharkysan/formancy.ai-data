import { readFile } from 'node:fs/promises'
import { createDataServer } from './app.js'
import { createIdentityVerifier } from './identity.js'
import type { IdentityOptions } from './identity.js'
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

const verifyIdentity = await createIdentityVerifier({
  key: await identityKey(),
  issuer: required('FORMANCY_DATA_ISSUER'),
  audience: required('FORMANCY_DATA_AUDIENCE'),
  attributes: attributeMap(process.env['FORMANCY_DATA_ATTRIBUTES']),
})

const app = await createDataServer({ verifyIdentity, logger: true })
await app.listen({ host: '0.0.0.0', port: Number(process.env['PORT'] ?? 4390) })
