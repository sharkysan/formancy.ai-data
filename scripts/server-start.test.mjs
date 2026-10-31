import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

/**
 * The built server's start, `node dist/main.mjs` as the image runs it, with
 * an allowlist that names Entra principals (0074): what it says about them
 * before the first request, and what in its environment stops it. main.ts
 * is a script and no package test runs it, so the sentences
 * connections.test.ts holds would otherwise reach nobody unchecked. Nothing
 * here opens a connection: the registry opens one on first use, and no
 * request is sent.
 *
 * It needs `pnpm build`, as mint-token.test.mjs does.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const MAIN = join(repo, 'packages', 'data-server', 'dist', 'main.mjs')

const TENANT = '7c1f6a2e-3b4d-4e5f-9a8b-0c1d2e3f4a5b'
const CLIENT = '0f9e8d7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f'
// Random per run, so "the secret is not in the output" cannot pass because
// the output happens to avoid one fixed string.
const CLIENT_SECRET = `Zq8~${randomBytes(24).toString('base64url')}`
const TOKEN_FILE = '/var/run/secrets/azure/tokens/azure-identity-token'

/**
 * How long a test waits for its servers: one start took 1.7 to 1.8 s on a
 * Windows 11 workstation alone (2026-10-17), and more than vitest's default
 * 5 s with the rest of `pnpm test:repo` running beside it.
 */
const STARTS = 60_000

const scratch = mkdtempSync(join(tmpdir(), 'server-start-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const ADDRESS = { kind: 'sqlserver', host: 'erp.database.windows.net', port: 1433, database: 'erp', schemas: ['sales'] }
const CONNECTIONS = [
  { id: 'erp-sql', ...ADDRESS, user: 'formancy', password: 'env:ERP_PASSWORD' },
  { id: 'erp-mi', ...ADDRESS, login: { type: 'entra-managed-identity', client: CLIENT } },
  { id: 'erp-sp', ...ADDRESS, login: { type: 'entra-service-principal', tenant: TENANT, client: CLIENT, secret: 'env:ERP_CLIENT_SECRET' } },
]

/**
 * The server in a child process with only the settings it is given: the
 * test's own environment would let a FORMANCY_DATA_* or AZURE_* variable on a
 * developer's machine decide the outcome. Resolves when it says it is
 * listening, and stops it, or when it exits on its own.
 */
function start(extra = {}, connections = CONNECTIONS) {
  const dir = mkdtempSync(join(scratch, 'run-'))
  const store = join(dir, 'store')
  mkdirSync(store)
  const allowlist = join(dir, 'connections.json')
  writeFileSync(allowlist, JSON.stringify(connections))
  const env = {
    PATH: process.env.PATH,
    ...(process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot }),
    PORT: '0',
    FORMANCY_DATA_ISSUER: 'server-start-test',
    FORMANCY_DATA_AUDIENCE: 'formancy-data',
    FORMANCY_DATA_IDENTITY_SECRET: 'env:IDENTITY_SECRET',
    IDENTITY_SECRET: randomBytes(48).toString('base64url'),
    FORMANCY_DATA_STORE_DIR: store,
    FORMANCY_DATA_CONNECTIONS: allowlist,
    ERP_PASSWORD: 'unused-sql-password',
    ERP_CLIENT_SECRET: CLIENT_SECRET,
    ...extra,
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MAIN], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let listening = false
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk
      if (!listening && stdout.includes('Server listening at')) {
        listening = true
        child.kill()
      }
    })
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`the server neither listened nor exited in 30 s:\n${stdout}\n${stderr}`))
    }, 30_000)
    child.on('error', reject)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({
        listening,
        code,
        stdout,
        stderr,
        lines: stdout
          .split('\n')
          .filter((line) => line.startsWith('{'))
          .map((line) => JSON.parse(line)),
      })
    })
  })
}

describe('the built server, with Entra connections in its allowlist', () => {
  // What the operator is told before the first request: once for each
  // connection that logs in as an Entra principal, at warn, that no test
  // of this release logs in as one, naming the connection and nothing of
  // the principal; nothing for a SQL login. Watched failing with main.ts's
  // loop over the sentences removed.
  test(
    'says at start, once for each Entra connection, that no test logs in as one, naming the connection alone',
    async () => {
      const run = await start()
      expect(run.listening, run.stderr).toBe(true)
      const said = run.lines.filter((line) => typeof line.msg === 'string' && line.msg.startsWith('No test of this release'))
      expect(said.map((line) => [line.level, line.msg])).toEqual([
        [40, 'No test of this release logs in as an Entra principal; connection erp-mi logs in as one.'],
        [40, 'No test of this release logs in as an Entra principal; connection erp-sp logs in as one.'],
      ])
      for (const value of [TENANT, CLIENT, CLIENT_SECRET]) expect(run.stdout + run.stderr).not.toContain(value)
    },
    STARTS,
  )

  // With AZURE_FEDERATED_TOKEN_FILE set, @azure/identity's managed identity
  // logs in by workload identity, as the environment's tenant, client and
  // authority (connections.ts). The server stops before it listens,
  // naming the connection and the variable and never the variable's
  // value; a service principal alone starts. Watched failing with the
  // check removed from main.ts (the server listened).
  test(
    'stops at start for a managed identity while AZURE_FEDERATED_TOKEN_FILE is set, naming the variable and never its value',
    async () => {
      const workload = { AZURE_FEDERATED_TOKEN_FILE: TOKEN_FILE, AZURE_TENANT_ID: TENANT, AZURE_CLIENT_ID: CLIENT }
      const run = await start(workload)
      expect(run.listening).toBe(false)
      expect(run.code).toBe(1)
      expect(run.stderr.trim()).toBe(
        'connection erp-mi logs in as a managed identity, which logs in by workload identity while AZURE_FEDERATED_TOKEN_FILE is set, as the tenant, client and authority the environment names; this release does not take workload identity. Unset it, or log in as a service principal (0074).',
      )
      for (const value of [TOKEN_FILE, TENANT, CLIENT]) expect(run.stdout + run.stderr).not.toContain(value)
      const principalOnly = await start(
        workload,
        CONNECTIONS.filter((connection) => connection.id !== 'erp-mi'),
      )
      expect(principalOnly.listening, principalOnly.stderr).toBe(true)
    },
    STARTS,
  )
})
