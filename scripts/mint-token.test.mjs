import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { extractSteps, GUIDE } from './getting-started/steps.mjs'

/**
 * deploy/mint-token.mjs, the composed demo's token minter (0032), run the way
 * compose runs it: `node mint-token.mjs` with the server's root beside it and
 * the server's own identity settings in the environment.
 *
 * It needs `pnpm build`, as `verify` runs it after: the minter imports the
 * built server's `resolveSecret`, and every token here is checked by the built
 * server's `createIdentityVerifier` -- the code that will judge it in the
 * stack, not a second reading of what a token should look like.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const MINTER = join(repo, 'deploy', 'mint-token.mjs')
const SERVER_ROOT = join(repo, 'packages', 'data-server')
const { createIdentityVerifier } = await import(pathToFileURL(join(SERVER_ROOT, 'dist', 'index.mjs')).href)

const ISSUER = 'formancy-data-mint-test'
const AUDIENCE = 'formancy-data'
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

// Random per run, so "the secret is not in the output" cannot pass because the
// output happens to avoid one fixed string.
const SECRET = `Fd1-${randomBytes(48).toString('base64url')}`
const SHORT_SECRET = `Fd1-${randomBytes(20).toString('base64url')}`.slice(0, 31)

const scratch = mkdtempSync(join(tmpdir(), 'mint-token-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/** A secret file the way most tools write one: the value and a newline. */
function secretFile(name, value) {
  const path = join(scratch, name)
  writeFileSync(path, `${value}\n`)
  return path
}
const SECRET_FILE = secretFile('host-token-secret', SECRET)
const SHORT_SECRET_FILE = secretFile('short-secret', SHORT_SECRET)

/**
 * The minter in a child process, with only the settings compose gives it: the
 * test's own environment would let a FORMANCY_DATA_* variable on a developer's
 * machine decide the outcome. `undefined` removes a setting.
 */
function mint(args, settings = {}) {
  const env = {
    PATH: process.env.PATH,
    ...(process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot }),
    FORMANCY_DATA_SERVER_ROOT: SERVER_ROOT,
    FORMANCY_DATA_ISSUER: ISSUER,
    FORMANCY_DATA_AUDIENCE: AUDIENCE,
    FORMANCY_DATA_IDENTITY_SECRET: `file:${SECRET_FILE}`,
    FORMANCY_DATA_ATTRIBUTES: 'tenant=tid',
    ...settings,
  }
  for (const [name, value] of Object.entries(env)) if (value === undefined) delete env[name]
  return spawnSync(process.execPath, [MINTER, ...args], { env, encoding: 'utf8' })
}

/** The server's verifier, configured as compose configures the server. */
function verifier(attributes = { tenant: 'tid' }) {
  return createIdentityVerifier({ key: { kind: 'secret', secret: SECRET }, issuer: ISSUER, audience: AUDIENCE, attributes })
}

function payload(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
}

describe('a minted token', () => {
  // The secret file ends in a newline, and the server strips one before it
  // uses the key (resolveSecret). A minter that read the file raw would sign
  // with the newline included, and every token it printed would be refused by
  // the server it was minted for -- with nothing but a 401 to say why.
  test("verifies under the server's own verifier, as the subject, with its roles and tenant", async () => {
    const run = mint(['--subject', 'clara', '--role', 'clerk', '--tenant', '1'])
    expect(run.status).toBe(0)
    const outcome = await (await verifier())(run.stdout.trim())
    expect(outcome).toEqual({ ok: true, identity: { actor: { id: 'clara', roles: ['clerk'] }, attributes: { tenant: '1' } } })
  }, 15_000)

  // The claim name is the deployment's (FORMANCY_DATA_ATTRIBUTES), shared with
  // the server through compose's x-identity anchor. A minter that wrote `tid`
  // because that is what compose says today would mint tokens whose tenant the
  // server silently ignores the day the anchor names another claim.
  test('carries the tenant under the claim the deployment names', async () => {
    const run = mint(['--subject', 'clara', '--role', 'clerk', '--tenant', '1'], { FORMANCY_DATA_ATTRIBUTES: 'region=reg, tenant=org' })
    expect(run.status).toBe(0)
    const outcome = await (await verifier({ tenant: 'org' }))(run.stdout.trim())
    expect(outcome.ok && outcome.identity.attributes).toEqual({ tenant: '1' })
    expect(payload(run.stdout.trim())).not.toHaveProperty('tid')
  }, 15_000)

  // Several roles, and an hour unless asked otherwise: the guide says tokens
  // expire after sixty minutes, and a minter that defaulted to a day would make
  // that sentence false without a test noticing.
  test('holds every role given and expires after sixty minutes by default', async () => {
    const before = Math.floor(Date.now() / 1000)
    const run = mint(['--subject', 'ada', '--role', 'data-admin', '--role', 'clerk'])
    expect(run.status).toBe(0)
    const outcome = await (await verifier())(run.stdout.trim())
    expect(outcome.ok && outcome.identity).toEqual({ actor: { id: 'ada', roles: ['data-admin', 'clerk'] }, attributes: {} })
    const { exp } = payload(run.stdout.trim())
    expect(exp - before).toBeGreaterThanOrEqual(60 * 60)
    expect(exp - before).toBeLessThanOrEqual(60 * 60 + 5)
  }, 15_000)

  // The guide's commands and the gate take stdout as the token, whole. Anything
  // else on it -- a banner, the sentence, a second line -- is pasted into the
  // sign-in field with the token, and the gate classifies no token at all.
  // The sentence a person reads goes to stderr, naming whom the token is for.
  test('is the only thing on stdout, and stderr says whom it is for and until when', () => {
    const run = mint(['--subject', 'otto', '--role', 'clerk', '--tenant', '2', '--minutes', '720'])
    expect(run.status).toBe(0)
    expect(run.stdout.endsWith('\n')).toBe(true)
    expect(run.stdout.trimEnd().split('\n')).toHaveLength(1)
    expect(run.stdout.trimEnd()).toMatch(JWT)
    const sentence = run.stderr.trim()
    expect(sentence.split('\n')).toHaveLength(1)
    expect(sentence).toContain('otto')
    expect(sentence).toContain('clerk')
    expect(sentence).toContain(new Date(payload(run.stdout.trim()).exp * 1000).toISOString())
  }, 15_000)

  // The guide's section 3 shows the sentence an operator will see, in a
  // ```text block the gate does not run. Minted with the arguments of the
  // guide's own command for the subject that sentence names, the minter must
  // say exactly that, but for the time: a rewording here would otherwise
  // leave the guide showing a sentence nothing prints.
  test("says what the guide's section 3 shows it saying", () => {
    const guide = readFileSync(GUIDE, 'utf8').replaceAll('\r\n', '\n')
    const shown = [...guide.matchAll(/^```text\n([\s\S]*?)\n```$/gm)].map((match) => match[1].trim()).find((block) => block.startsWith('A token for '))
    expect(shown, 'a ```text block in the guide showing the sentence').toBeDefined()
    const subject = /^A token for (\S+) /.exec(shown ?? '')?.[1]
    const subjectOf = (words) => words[words.indexOf('--subject') + 1]
    const command = extractSteps(guide).run.map((step) => step.command.split(' ')).find((words) => words.includes('token') && subjectOf(words) === subject)
    expect(command, `the guide's command minting for ${String(subject)}`).toBeDefined()
    const run = mint(command.slice(command.indexOf('token') + 1))
    expect(run.status).toBe(0)
    const until = new Date(payload(run.stdout.trim()).exp * 1000).toISOString()
    expect(run.stderr.trim()).toBe(shown.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/, until))
  }, 15_000)
})

describe('the minter refuses', () => {
  // Each refusal is a sentence naming what is wrong and an exit status of 1,
  // never a token, and never the secret: the commonest mistakes here are made
  // with the secret in hand, and an error that echoed it would print it into a
  // terminal's scrollback or a CI log.
  const refusals = [
    // The server will not start with a key under 32 bytes; a minter that
    // signed with one would print tokens for a server that cannot exist.
    { why: 'a secret shorter than the server accepts', args: ['--subject', 'ada'], settings: { FORMANCY_DATA_IDENTITY_SECRET: `file:${SHORT_SECRET_FILE}` }, says: /32 bytes/, secret: SHORT_SECRET },
    // A deployment that verifies with a public key mints with its identity
    // provider's private key, which this minter does not have and must not
    // pretend to: HS256 only, said.
    { why: 'a public-key identity', args: ['--subject', 'ada'], settings: { FORMANCY_DATA_IDENTITY_SECRET: undefined, FORMANCY_DATA_IDENTITY_PUBLIC_KEY_FILE: '/run/keys/host.pem' }, says: /HS256/ },
    { why: 'no identity at all', args: ['--subject', 'ada'], settings: { FORMANCY_DATA_IDENTITY_SECRET: undefined }, says: /FORMANCY_DATA_IDENTITY_SECRET/ },
    // The mistake resolveSecret's own wording is for: the secret pasted where
    // its reference belongs.
    { why: 'the secret itself where its reference belongs', args: ['--subject', 'ada'], settings: { FORMANCY_DATA_IDENTITY_SECRET: SECRET }, says: /secret reference/ },
    // A misspelt --tenant that was ignored would mint a token with no tenant,
    // and the clerk would see every tenant's rows the policy does not filter.
    { why: 'an unknown flag', args: ['--subject', 'clara', '--tennant', '1'], says: /--tennant/ },
    { why: 'no subject', args: ['--role', 'clerk'], says: /--subject/ },
    { why: 'a tenant the deployment has no claim for', args: ['--subject', 'clara', '--tenant', '1'], settings: { FORMANCY_DATA_ATTRIBUTES: undefined }, says: /FORMANCY_DATA_ATTRIBUTES/ },
    // Twelve hours is the ceiling: a demo token that outlived a working day
    // would be a credential nobody remembers minting.
    { why: 'minutes past the ceiling', args: ['--subject', 'ada', '--minutes', '721'], says: /--minutes/ },
    { why: 'zero minutes', args: ['--subject', 'ada', '--minutes', '0'], says: /--minutes/ },
    { why: 'minutes that are not a whole number', args: ['--subject', 'ada', '--minutes', '1.5'], says: /--minutes/ },
  ]

  test.each(refusals)('$why', ({ args, settings, says, secret = SECRET }) => {
    const run = mint(args, settings)
    expect(run.status).toBe(1)
    expect(run.stdout).toBe('')
    expect(run.stderr).toMatch(says)
    expect(run.stderr).not.toContain(secret)
    expect(run.stderr).not.toContain(SECRET)
  }, 15_000)
})
