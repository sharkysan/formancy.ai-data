import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, mkdirSync, openSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { loadSizedCustomers, startPostgresFixture, startSqlServerFixture, startTcpHop, WRITER } from '@formancy/data-fixtures'
import type { PostgresFixture, SizedLoad, SqlServerFixture, TcpHop } from '@formancy/data-fixtures'
import mssql from 'mssql'
import { driftingConnection, prepareDrifted } from './drifted.js'
import type { EngineKey } from './results.js'

/*
 * What the measurement runs against (0034): both shared fixtures with the
 * sized customers loaded and the table the refusals' forms are published
 * over (`drifted.ts`), a TCP hop in front of each database, and the shipped
 * server -- `dist/main.mjs` of the copy of `@formancy/data-server` the
 * harness itself resolves -- as a child process configured only through its
 * environment, as an operator configures it.
 *
 * The child's log goes to a file it is handed as its standard output and
 * error: a descriptor, not a pipe, so the harness's event loop never carries
 * the server's logging. Logging stays on, as shipped.
 */

export const ISSUER = 'https://host.performance.invalid'
export const AUDIENCE = 'formancy-data'

/** How the writer reaches one database directly: what the floor and the connections file need. */
export interface WriterEndpoint {
  host: string
  port: number
  database: string
  user: string
  password: string
}

export interface Stack {
  pg: PostgresFixture
  ms: SqlServerFixture
  loads: Record<EngineKey, SizedLoad>
  hops: Record<EngineKey, TcpHop>
  writers: Record<EngineKey, WriterEndpoint>
  /** The host's HS256 secret, per run, never written down: tokens are minted with it. */
  secret: string
  server: { base: string; pid: number; entry: string; storeDir: string; logFile: string; settings: string[]; rateLimit: number }
  /** Stops the server and waits for it to exit, so its log is complete. Idempotent. */
  stopServer(): Promise<void>
  /** Stops everything this stack started: the server, the hops and both fixtures. */
  stop(): Promise<void>
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

/** The server entry the harness runs: `main.mjs` beside the `@formancy/data-server` it imports. */
export function serverEntry(): string {
  return join(dirname(createRequire(import.meta.url).resolve('@formancy/data-server')), 'main.mjs')
}

function writerOf(pg: PostgresFixture, ms: SqlServerFixture): Record<EngineKey, WriterEndpoint> {
  const url = new URL(pg.writer)
  return {
    pg: { host: url.hostname, port: Number(url.port), database: url.pathname.slice(1), user: WRITER.user, password: WRITER.postgresPassword },
    ms: { host: String(ms.writer.server), port: Number(ms.writer.port), database: String(ms.writer.database), user: WRITER.user, password: WRITER.sqlServerPassword },
  }
}

async function waitForHealth(base: string, child: ChildProcess, logFile: string): Promise<void> {
  const deadline = Date.now() + 60_000
  for (;;) {
    if (child.exitCode !== null) throw new Error(`the server exited with ${String(child.exitCode)} before it answered; see ${logFile}`)
    try {
      const response = await fetch(`${base}/health`)
      if (response.ok) return
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error(`the server did not answer /health within a minute; see ${logFile}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  child.kill('SIGTERM')
  const killed = setTimeout(() => child.kill('SIGKILL'), 15_000)
  await exited
  clearTimeout(killed)
}

export async function startStack(options: { runDir: string; rateLimit: number }): Promise<Stack> {
  const [pg, ms] = await Promise.all([startPostgresFixture(), startSqlServerFixture()])
  const started: Array<() => Promise<void>> = [() => pg.stop(), () => ms.stop()]
  try {
    // One after the other, so each load's seconds are its own.
    const loads = { pg: await loadSizedCustomers({ kind: 'postgres', admin: pg.admin }), ms: await loadSizedCustomers({ kind: 'sqlserver', admin: ms.admin }) }
    // Explicitly off, so no plan statistics are kept for any statement the run times.
    const owner = await new mssql.ConnectionPool(ms.admin).connect()
    try {
      await owner.request().batch('alter database scoped configuration set LAST_QUERY_PLAN_STATS = off')
    } finally {
      await owner.close()
    }
    await prepareDrifted({ pg: pg.admin, ms: ms.admin })
    const writers = writerOf(pg, ms)
    const hops = { pg: await startTcpHop(writers.pg), ms: await startTcpHop(writers.ms) }
    started.unshift(() => hops.pg.close(), () => hops.ms.close())

    mkdirSync(options.runDir, { recursive: true })
    const storeDir = join(options.runDir, 'store')
    const connectionsFile = join(options.runDir, 'connections.json')
    const entry = (id: string, engine: EngineKey, host: string, port: number, schemas = ['sales']) => ({
      id,
      kind: engine === 'pg' ? 'postgres' : 'sqlserver',
      host,
      port,
      database: writers[engine].database,
      user: writers[engine].user,
      password: engine === 'pg' ? 'env:PG_WRITER_PASSWORD' : 'env:MS_WRITER_PASSWORD',
      schemas,
      tls: engine === 'pg' ? { enabled: false } : { enabled: false, trustServerCertificate: true },
    })
    writeFileSync(
      connectionsFile,
      `${JSON.stringify(
        [
          entry('pg', 'pg', writers.pg.host, writers.pg.port),
          entry('ms', 'ms', writers.ms.host, writers.ms.port),
          entry('pg-hop', 'pg', '127.0.0.1', hops.pg.port),
          entry('ms-hop', 'ms', '127.0.0.1', hops.ms.port),
          entry(driftingConnection('pg'), 'pg', '127.0.0.1', hops.pg.port, ['drifting']),
          entry(driftingConnection('ms'), 'ms', '127.0.0.1', hops.ms.port, ['drifting']),
        ],
        null,
        2,
      )}\n`,
    )

    const secret = randomBytes(48).toString('base64')
    const port = await freePort()
    const settings: Record<string, string> = {
      FORMANCY_DATA_ISSUER: ISSUER,
      FORMANCY_DATA_AUDIENCE: AUDIENCE,
      FORMANCY_DATA_IDENTITY_SECRET: 'env:PERF_HOST_SECRET',
      FORMANCY_DATA_ATTRIBUTES: 'tenant=tid',
      FORMANCY_DATA_STORE_DIR: storeDir,
      FORMANCY_DATA_CONNECTIONS: connectionsFile,
      FORMANCY_DATA_ADMIN_ROLES: 'data-admin',
      FORMANCY_DATA_AUDIT_KEY: 'env:PERF_AUDIT_KEY',
      FORMANCY_DATA_RATE_LIMIT: String(options.rateLimit),
      PORT: String(port),
      NODE_ENV: 'production',
    }
    const secrets = { PERF_HOST_SECRET: secret, PERF_AUDIT_KEY: randomBytes(32).toString('base64'), PG_WRITER_PASSWORD: writers.pg.password, MS_WRITER_PASSWORD: writers.ms.password }
    const logFile = join(options.runDir, 'server.log')
    const log = openSync(logFile, 'a')
    const entryPath = serverEntry()
    // Only what it is configured with: nothing of the harness's environment leaks into the server.
    const child = spawn(process.execPath, [entryPath], { env: { ...settings, ...secrets }, stdio: ['ignore', log, log] })
    closeSync(log)
    let stopped: Promise<void> | undefined
    const stopServer = (): Promise<void> => (stopped ??= stopChild(child))
    started.unshift(stopServer)
    const base = `http://127.0.0.1:${String(port)}`
    await waitForHealth(base, child, logFile)

    return {
      pg,
      ms,
      loads,
      hops,
      writers,
      secret,
      server: { base, pid: child.pid as number, entry: entryPath, storeDir, logFile, settings: [...Object.keys(settings), ...Object.keys(secrets)].sort(), rateLimit: options.rateLimit },
      stopServer,
      stop: async () => {
        for (const stop of started) await stop()
      },
    }
  } catch (error) {
    for (const stop of started) await stop().catch(() => {})
    throw error
  }
}
