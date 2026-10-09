/**
 * A host token for the composed demo (0032), minted inside the server image:
 *
 *   docker compose run --rm token --subject ada --role data-admin
 *   docker compose run --rm token --subject clara --role clerk --tenant 1
 *
 * A demo needs somebody to vouch for an administrator and a clerk, and in a
 * deployment that is the host application's identity provider. Here it is this
 * file, run by compose's `token` service with the server's own identity
 * settings (the x-identity anchor) and the secrets volume. It is never copied
 * into the image, never published, and never run under a Node on the host: the
 * only secret it touches is read where the server reads it.
 *
 * The key is read by the server's own `resolveSecret` and checked by the
 * server's own `createIdentityVerifier`, from the image's built server, so how
 * a trailing newline is treated and how short a secret may be are each decided
 * once, in data-server, and not a second time here.
 *
 * stdout is the token and nothing else; stderr is one sentence saying whom it
 * is for and until when. It refuses, with a sentence and exit status 1, an
 * identity it cannot sign for, an unknown flag and a lifetime out of range.
 * It never prints the secret and writes no file.
 *
 * scripts/mint-token.test.mjs runs it against the built server.
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const USAGE = 'Usage: --subject <id> [--role <role>]... [--tenant <id>] [--minutes <1-720>]'

/** An hour unless asked; at most twelve, so a demo token does not outlive the working day it was minted for. */
const DEFAULT_MINUTES = 60
const MAX_MINUTES = 720

function refuse(sentence) {
  process.stderr.write(`${sentence}\n`)
  process.exit(1)
}

function setting(name) {
  const value = process.env[name]
  if (value === undefined || value === '') refuse(`${name} is required: set it as the server's is.`)
  return value
}

/** The claim the deployment reads an attribute from, in FORMANCY_DATA_ATTRIBUTES' own form: "tenant=tid,region=reg". */
function claimFor(attribute) {
  for (const pair of (process.env.FORMANCY_DATA_ATTRIBUTES ?? '').split(',')) {
    const [name, claim, extra] = pair.split('=').map((part) => part.trim())
    if (name === attribute && claim !== undefined && claim !== '' && extra === undefined) return claim
  }
  return undefined
}

let options
try {
  ;({ values: options } = parseArgs({
    options: {
      subject: { type: 'string' },
      role: { type: 'string', multiple: true, default: [] },
      tenant: { type: 'string' },
      minutes: { type: 'string', default: String(DEFAULT_MINUTES) },
    },
    strict: true,
    allowPositionals: false,
  }))
} catch (error) {
  // parseArgs names the flag it did not know; a misspelt --tenant ignored
  // would mint a token with no tenant at all.
  refuse(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`)
}

const subject = options.subject
if (subject === undefined || subject === '') refuse(`--subject is required. ${USAGE}`)
if (!/^[0-9]+$/.test(options.minutes) || Number(options.minutes) < 1 || Number(options.minutes) > MAX_MINUTES) {
  refuse(`--minutes is a whole number from 1 to ${String(MAX_MINUTES)}.`)
}
const minutes = Number(options.minutes)

const claims = { roles: options.role }
if (options.tenant !== undefined) {
  const claim = claimFor('tenant')
  if (claim === undefined) refuse('FORMANCY_DATA_ATTRIBUTES names no claim for tenant, so a token cannot carry one the server would read.')
  claims[claim] = options.tenant
}

if (process.env.FORMANCY_DATA_IDENTITY_PUBLIC_KEY_FILE !== undefined) {
  refuse('This minter signs with a shared secret (HS256) only. A server that verifies with a public key takes its tokens from the identity provider holding the private one.')
}
const reference = setting('FORMANCY_DATA_IDENTITY_SECRET')
const issuer = setting('FORMANCY_DATA_ISSUER')
const audience = setting('FORMANCY_DATA_AUDIENCE')

// The image's built server, and jose as the server resolves it.
const root = process.env.FORMANCY_DATA_SERVER_ROOT ?? '/app'
const server = await import(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
const { SignJWT } = await import(pathToFileURL(createRequire(join(root, 'package.json')).resolve('jose')).href)

let secret
try {
  secret = await server.resolveSecret(reference)
  // The server's own check of the key, so this cannot sign with a secret the
  // server would refuse to start with. Its sentences never contain the key.
  await server.createIdentityVerifier({ key: { kind: 'secret', secret }, issuer, audience, attributes: {} })
} catch (error) {
  refuse(`FORMANCY_DATA_IDENTITY_SECRET: ${error instanceof Error ? error.message : String(error)}`)
}

const issuedAt = Math.floor(Date.now() / 1000)
const expires = issuedAt + minutes * 60
const token = await new SignJWT(claims)
  .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
  .setIssuer(issuer)
  .setAudience(audience)
  .setSubject(subject)
  .setIssuedAt(issuedAt)
  .setExpirationTime(expires)
  .sign(new TextEncoder().encode(secret))

const roles = options.role.length === 0 ? 'no roles' : `roles ${options.role.join(', ')}`
const tenant = options.tenant === undefined ? '' : `, tenant ${options.tenant}`
process.stderr.write(`A token for ${subject} with ${roles}${tenant}, valid until ${new Date(expires * 1000).toISOString()}.\n`)
process.stdout.write(`${token}\n`)
