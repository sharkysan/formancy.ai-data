import type { DatabaseAdapter, LookupAdapter, RecordAdapter } from '@formancy/data-core'
import { describe, expect, test } from 'vitest'
import type { ConnectionConfig, ConnectionFactory, OpenConnection } from './connections.js'
import { createConnectionRegistry, parseConnections } from './connections.js'

const ERP: ConnectionConfig = {
  id: 'erp',
  kind: 'sqlserver',
  host: 'db.internal',
  port: 1433,
  database: 'erp',
  user: 'formancy',
  password: 'env:ERP_PASSWORD',
  schemas: ['sales'],
}

/** A connection whose ports are inert: the registry is what is under test, not a database. */
function fakeConnection(onClose: () => void = () => {}): OpenConnection {
  const adapter = { kind: 'sqlserver', ping: async () => ({ kind: 'sqlserver', version: 'x' }), discover: async () => { throw new Error('unused') }, close: async () => onClose() } as DatabaseAdapter
  return { adapter, lookups: {} as LookupAdapter, records: {} as RecordAdapter }
}

const secrets = { env: { ERP_PASSWORD: 'p@ss' }, readFile: async () => '' }

describe('parseConnections', () => {
  // The happy path, as an operator would write it.
  test('accepts an allowlist with secret references', () => {
    expect(parseConnections([ERP])).toEqual({ ok: true, connections: [ERP] })
  })

  // Every mistake at once, so a broken file is one fix and one restart. And the
  // commonest mistake — the password itself where its reference belongs — is
  // refused without being repeated.
  test('lists every problem, and never repeats a password', () => {
    const outcome = parseConnections([
      { ...ERP, password: 'hunter2-the-actual-password' },
      { ...ERP, id: 'Bad Id', kind: 'oracle', port: 70000, schemas: [] },
      ERP,
      { ...ERP },
      'not an object',
    ])
    expect(outcome.ok).toBe(false)
    const problems = outcome.ok ? [] : outcome.problems
    expect(problems).toEqual(
      expect.arrayContaining([
        'connections[0].password must be a secret reference, env:NAME or file:/path',
        expect.stringMatching(/connections\[1\]\.id must be lower-case/),
        'connections[1].kind must be postgres or sqlserver',
        'connections[1].port must be a port number',
        'connections[1].schemas must list at least one approved schema',
        'connections[3].id erp is used twice',
        'connections[4] is not an object',
      ]),
    )
    expect(problems.join(' ')).not.toContain('hunter2')
    expect(parseConnections({})).toEqual({ ok: false, problems: ['the connections file is a list'] })
  })
})

describe('createConnectionRegistry', () => {
  // A form names a connection; this is where that name becomes a database. A
  // name the operator did not list reaches nothing.
  test('opens only allowlisted connections, once, with the resolved password', async () => {
    const calls: Array<{ id: string; password: string }> = []
    const factory: ConnectionFactory = async (config, password) => {
      calls.push({ id: config.id, password })
      return fakeConnection()
    }
    const registry = createConnectionRegistry([ERP], { sqlserver: factory }, secrets)
    expect(registry.ids()).toEqual(['erp'])
    expect(registry.scope('erp')).toEqual({ schemas: ['sales'] })
    expect(registry.scope('elsewhere')).toBeUndefined()
    expect(await registry.open('elsewhere')).toBeUndefined()
    const [first, second] = await Promise.all([registry.open('erp'), registry.open('erp')])
    expect(first).toBe(second)
    expect(calls).toEqual([{ id: 'erp', password: 'p@ss' }])
  })

  // A database restarting is not a reason to restart the server: a failed open
  // is forgotten, so the next request tries again.
  test('tries again after a failed open', async () => {
    let attempts = 0
    const registry = createConnectionRegistry([ERP], {
      sqlserver: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('ECONNREFUSED')
        return fakeConnection()
      },
    }, secrets)
    await expect(registry.open('erp')).rejects.toThrow('ECONNREFUSED')
    await expect(registry.open('erp')).resolves.toBeDefined()
    expect(attempts).toBe(2)
  })

  // A kind with no driver configured, and a password that cannot be resolved,
  // are both loud — never a connection opened without credentials.
  test('refuses a kind with no driver and a secret that cannot be resolved', async () => {
    await expect(createConnectionRegistry([ERP], {}, secrets).open('erp')).rejects.toThrow(/no driver is configured for sqlserver/)
    const noSecret = createConnectionRegistry([ERP], { sqlserver: async () => fakeConnection() }, { env: {}, readFile: async () => '' })
    await expect(noSecret.open('erp')).rejects.toThrow(/ERP_PASSWORD is unset or empty/)
  })

  // Shutdown closes what was opened, and only that; calling it twice is harmless.
  test('closes every open connection, once', async () => {
    let closed = 0
    const registry = createConnectionRegistry([ERP, { ...ERP, id: 'idle' }], { sqlserver: async () => fakeConnection(() => (closed += 1)) }, secrets)
    await registry.open('erp')
    await registry.close()
    await registry.close()
    expect(closed).toBe(1)
  })
})
