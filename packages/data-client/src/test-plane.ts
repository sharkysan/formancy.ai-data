import { createSecretKey } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EMPTY_PRESENTATION } from '@formancy/data-core'
import type { FieldBinding, FormPolicy } from '@formancy/data-core'
import { createConnectionRegistry, createDataServer, createFileConfigurationStore, createIdentityVerifier, DRIVER_FACTORIES } from '@formancy/data-server'
import type { ConnectionConfig } from '@formancy/data-server'
import { SignJWT } from 'jose'
import { inject } from 'vitest'
import { createDataClient } from './client.js'
import type { DataClient } from './client.js'

/*
 * One file's server: the real data server over the run's two databases, with
 * the real drivers and the real identity verifier, listening on a loopback
 * port so every call the client makes crosses real HTTP -- path encoding,
 * headers and bodies included. Nothing here is a fake but the host that
 * signs the tokens, and that signs them with the same HS256 a host would.
 *
 * Read by the integration suites only; never part of the package.
 */

const SECRET = 'a-client-suite-host-secret-of-32-bytes!'
const ISSUER = 'https://host.example'
const AUDIENCE = 'formancy-data'

/** The engines every runtime behaviour is proved on (0003), with what each needs to offer update. */
export const ENGINES = [
  { engine: 'PostgreSQL', connection: 'pg', versionColumn: 'row_version' as string | undefined },
  { engine: 'SQL Server', connection: 'ms', versionColumn: undefined },
] as const

/** One request as it left the client: what the server, and anybody on the wire, saw. */
export interface Sent {
  method: string
  url: string
  headers: Record<string, string>
  body: string | undefined
}

export interface Plane {
  /** `http://127.0.0.1:<port>`: the server, across real HTTP. */
  base: string
  tokens: { admin: string; clerk: string; otherClerk: string }
  /** Every request the spied fetch carried, in order. Cleared by `clear()`. */
  sent: Sent[]
  /** Node's own fetch, recording what it is asked to send. */
  fetch: typeof fetch
  /** A client over the spied fetch, for one held token. */
  client(token?: string | (() => string)): DataClient
  close(): Promise<void>
}

async function sign(subject: string, claims: Record<string, unknown>): Promise<string> {
  return new SignJWT({ sub: subject, ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime('10m')
    .sign(createSecretKey(Buffer.from(SECRET, 'utf8')))
}

/** A clerk may do everything the form offers, on the fields it writes, inside their tenant; the e2e journey's policy. */
function clerkPolicy(fields: readonly FieldBinding[]): FormPolicy {
  return {
    version: 1,
    operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
    fields: Object.fromEntries(fields.map((binding) => [binding.field, { read: ['clerk'], write: binding.writes.create || binding.writes.update ? ['clerk'] : [] }])),
    rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
    lookups: { customer: [{ column: 'tenant_id', attribute: 'tenant' }] },
  }
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return Object.fromEntries(new Headers(init?.headers).entries())
}

/** Starts the server and publishes `pg-order` and `ms-order` through the administrator's plane. */
export async function startPlane(): Promise<Plane> {
  const { pg, ms } = inject('databases')
  const connections: ConnectionConfig[] = [
    { id: 'pg', kind: 'postgres', ...pg, password: 'env:PG_PASSWORD', schemas: ['sales'], tls: { enabled: false } },
    { id: 'ms', kind: 'sqlserver', ...ms, password: 'env:MS_PASSWORD', schemas: ['sales'], tls: { enabled: false, trustServerCertificate: true } },
  ]
  const registry = createConnectionRegistry(connections, DRIVER_FACTORIES, {
    env: { PG_PASSWORD: pg.password, MS_PASSWORD: ms.password },
    readFile: async () => '',
  })
  const root = await mkdtemp(join(tmpdir(), 'formancy-data-client-'))
  const store = createFileConfigurationStore(root)
  const verifyIdentity = await createIdentityVerifier({ key: { kind: 'secret', secret: SECRET }, issuer: ISSUER, audience: AUDIENCE, attributes: { tenant: 'tid' } })
  const app = await createDataServer({ verifyIdentity, admin: { registry, store, adminRoles: ['data-admin'] }, runtime: { registry, store } })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const base = `http://127.0.0.1:${String((app.server.address() as AddressInfo).port)}`
  const tokens = {
    admin: await sign('admin-1', { roles: ['data-admin'] }),
    clerk: await sign('clerk-1', { roles: ['clerk'], tid: 1 }),
    otherClerk: await sign('clerk-2', { roles: ['clerk'], tid: 2 }),
  }

  const admin = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokens.admin}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const parsed = (await response.json()) as Record<string, unknown>
    if (!response.ok) throw new Error(`${path} answered ${String(response.status)}: ${JSON.stringify(parsed)}`)
    return parsed
  }
  for (const { connection, versionColumn } of ENGINES) {
    const formId = `${connection}-order`
    const { form, bindings, snapshot, generation } = await admin('/v1/form-proposals', {
      connection,
      root: { schema: 'sales', name: 'order' },
      formId,
      title: 'Order',
      lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
      ...(versionColumn === undefined ? {} : { versionColumn }),
    })
    const policy = clerkPolicy((bindings as { fields: FieldBinding[] }).fields)
    await admin(`/v1/forms/${formId}/versions`, { expectedBase: null, bundle: { format: 2, connection, generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot } })
  }

  const sent: Sent[] = []
  const spied: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    sent.push({ method: init?.method ?? 'GET', url, headers: headersOf(init), body: typeof init?.body === 'string' ? init.body : undefined })
    return fetch(input, init)
  }

  return {
    base,
    tokens,
    sent,
    fetch: spied,
    client: (token = tokens.clerk) => createDataClient({ token: typeof token === 'function' ? token : () => token, base, fetch: spied }),
    close: async () => {
      await app.close()
      await registry.close()
      await rm(root, { recursive: true, force: true })
    },
  }
}
