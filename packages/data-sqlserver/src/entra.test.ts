import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { inspect } from 'node:util'
import { AuthenticationError } from '@azure/identity'
import type { AccessToken, GetTokenOptions, TokenCredential } from '@azure/identity'
import mssql from 'mssql'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { connectSqlServer, sqlServerConfig } from './connect.js'
import {
  AZURE_SQL_SCOPE,
  ENTRA_NO_TOKEN,
  ENTRA_REFUSED,
  ENTRA_SCOPE_REFUSED,
  ENTRA_UNCHECKED,
  ENTRA_UNENCRYPTED,
  entraCredential,
  entraLoginFailure,
  scopedToAzureSql,
} from './entra.js'

/*
 * An Entra login's credential and its failures, without a server and
 * without Entra (0074). No container sends the FEDAUTHINFO token that makes
 * tedious ask for a token (entra.integration.test.ts, on 2025 over TDS 8.0),
 * and no test asks Entra, so the token's path is reached here alone.
 *
 * @azure/identity's two classes are wrapped, not replaced: each records what
 * it was constructed with and is the real class, because both keep the
 * client id and the authority they were given where nothing can read them
 * back. Nothing here asks Entra for a token: the scope guard is given a
 * credential of the test's, and the real ones are only constructed.
 */

const constructed = vi.hoisted(() => [] as Array<{ name: string; args: unknown[] }>)
vi.mock('@azure/identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@azure/identity')>()
  class ManagedIdentityCredential extends actual.ManagedIdentityCredential {
    constructor(...args: unknown[]) {
      // Copied first: the class writes into the options object it is given.
      const given = structuredClone(args)
      super(...(args as [object]))
      constructed.push({ name: 'ManagedIdentityCredential', args: given })
    }
  }
  class ClientSecretCredential extends actual.ClientSecretCredential {
    constructor(...args: unknown[]) {
      const given = structuredClone(args)
      super(...(args as ConstructorParameters<typeof actual.ClientSecretCredential>))
      constructed.push({ name: 'ClientSecretCredential', args: given })
    }
  }
  return { ...actual, ManagedIdentityCredential, ClientSecretCredential }
})

const TENANT = '7c1f6a2e-3b4d-4e5f-9a8b-0c1d2e3f4a5b'
const CLIENT = '0f9e8d7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f'
const SECRET = 'Zq8~entra-client-secret-value-e81'
const TRACE = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789'
const SERVICE_PRINCIPAL = { type: 'service-principal', tenantId: TENANT, clientId: CLIENT, clientSecret: SECRET } as const

/** What Entra answers a service principal it does not know, as @azure/identity raises it: the tenant, the client and a trace id in its text. */
function unknownClient(): AuthenticationError {
  return new AuthenticationError(400, {
    error: 'unauthorized_client',
    error_description: `AADSTS700016: Application with identifier '${CLIENT}' was not found in the directory '${TENANT}'. Trace ID: ${TRACE} Correlation ID: ${TRACE} Timestamp: 2026-10-17 10:00:00Z`,
    error_codes: [700016],
    trace_id: TRACE,
    correlation_id: TRACE,
  })
}

/** Every place an error could carry something: its message, its whole inspected graph, causes and hidden properties included, and its JSON. */
function everywhere(error: unknown): string {
  return [String((error as Error).message), inspect(error, { depth: Infinity, showHidden: true }), JSON.stringify(error)].join('\n')
}

function expectNothingOf(text: string): void {
  for (const value of [TENANT, CLIENT, SECRET, TRACE]) expect(text).not.toContain(value)
}

/** A credential of the test's, counting what it is asked. */
function counting(answer: () => Promise<AccessToken | null>): TokenCredential & { asked: Array<string | string[]> } {
  const asked: Array<string | string[]> = []
  return {
    asked,
    getToken: async (scopes: string | string[], _options?: GetTokenOptions) => {
      asked.push(scopes)
      return answer()
    },
  }
}

const TOKEN: AccessToken = { token: 'a-token', expiresOnTimestamp: Date.now() + 3_600_000 }

beforeEach(() => {
  constructed.length = 0
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('entraCredential', () => {
  // The login's tenant, client and secret are the principal, and the
  // public cloud's host its authority, written down: left out, the class
  // reads AZURE_AUTHORITY_HOST, so a variable set on the host for another
  // program would send this secret to another authority. The environment
  // here names another principal and another authority, and changes
  // nothing. How the allowlist's entry becomes this login is the server's
  // (drivers.test.ts). Watched failing with the authority left out, and
  // with the tenant and client swapped.
  test('builds a service principal as a ClientSecretCredential of the login’s ids at the public cloud, whatever the environment names', () => {
    vi.stubEnv('AZURE_TENANT_ID', '11111111-1111-4111-8111-111111111111')
    vi.stubEnv('AZURE_CLIENT_ID', '22222222-2222-4222-8222-222222222222')
    vi.stubEnv('AZURE_CLIENT_SECRET', 'an-environment-secret')
    vi.stubEnv('AZURE_AUTHORITY_HOST', 'https://login.example.invalid')
    entraCredential(SERVICE_PRINCIPAL)
    expect(constructed).toEqual([{ name: 'ClientSecretCredential', args: [TENANT, CLIENT, SECRET, { authorityHost: 'https://login.microsoftonline.com' }] }])
  })

  // A user-assigned identity is chosen by its client id; without one the
  // host's system-assigned identity logs in. A client id dropped would log
  // in as the system-assigned identity, another principal with other grants.
  test('builds a managed identity as a ManagedIdentityCredential, user-assigned by its client id or system-assigned without one', () => {
    entraCredential({ type: 'managed-identity', clientId: CLIENT })
    entraCredential({ type: 'managed-identity' })
    expect(constructed).toEqual([
      { name: 'ManagedIdentityCredential', args: [{ clientId: CLIENT }] },
      { name: 'ManagedIdentityCredential', args: [{}] },
    ])
  })

  // What a pool is given is the guard, not the class: asked by a server for
  // another resource's token, the real credential is never called. Watched
  // failing with the class handed out unguarded.
  test('hands out the guard, so the real credential is never asked for another resource', async () => {
    const { ClientSecretCredential } = await vi.importActual<typeof import('@azure/identity')>('@azure/identity')
    const asked = vi.spyOn(ClientSecretCredential.prototype, 'getToken').mockRejectedValue(new Error('not here'))
    await expect(entraCredential(SERVICE_PRINCIPAL).getToken('https://management.azure.com/.default')).rejects.toThrow(ENTRA_SCOPE_REFUSED)
    expect(asked).not.toHaveBeenCalled()
  })
})

describe('scopedToAzureSql', () => {
  // A token is a bearer token for whatever resource it names. tedious asks
  // for the resource the server's FEDAUTHINFO names, so a server that is not
  // Azure SQL -- or one a DNS answer put in its place -- could have this
  // principal's token for Azure Resource Manager or Graph. The guard asks
  // Entra for Azure SQL's alone and never calls the credential for another.
  // Watched failing with the comparison removed.
  test('passes Azure SQL’s scope to the credential, and refuses any other without calling it', async () => {
    const inner = counting(async () => TOKEN)
    const guarded = scopedToAzureSql(inner)
    expect(await guarded.getToken(AZURE_SQL_SCOPE)).toBe(TOKEN)
    expect(await guarded.getToken([AZURE_SQL_SCOPE])).toBe(TOKEN)
    for (const other of [
      'https://management.azure.com/.default',
      'https://graph.microsoft.com/.default',
      'https://database.windows.net.example/.default',
      [AZURE_SQL_SCOPE, 'https://graph.microsoft.com/.default'],
      [],
    ]) {
      await expect(guarded.getToken(other), JSON.stringify(other)).rejects.toThrow(ENTRA_SCOPE_REFUSED)
    }
    expect(inner.asked).toEqual([AZURE_SQL_SCOPE, AZURE_SQL_SCOPE])
  })

  // What Entra answers names the client and the tenant, and a trace id; it
  // would reach the error tedious builds, and whoever inspects that -- a
  // diagnostics-channel subscriber, a log of the whole object. The guard
  // rejects with the sentence and the AADSTS code alone, and keeps no cause.
  // Watched failing with the inner error rethrown.
  test('rejects a refused token with the sentence and the AADSTS code alone', async () => {
    const guarded = scopedToAzureSql(counting(async () => Promise.reject(unknownClient())))
    const error = await guarded.getToken(AZURE_SQL_SCOPE).then(
      () => undefined,
      (rejected: unknown) => rejected,
    )
    expect((error as Error).message).toBe(`${ENTRA_NO_TOKEN} Entra ID answered AADSTS700016.`)
    expect((error as Error).cause).toBeUndefined()
    expectNothingOf(everywhere(error))
  })

  // tedious treats a null token as a failure of its own (connection.js,
  // "Security token could not be authenticated or authorized."); the guard
  // passes the null on for tedious to say so.
  test('passes on a credential’s null', async () => {
    expect(await scopedToAzureSql(counting(async () => null)).getToken(AZURE_SQL_SCOPE)).toBeNull()
  })
})

/** tedious's ConnectionError, as it builds one: a message and a code. */
function tediousError(message: string, code: string): Error {
  return Object.assign(new Error(message), { name: 'ConnectionError', code })
}

/** What mssql rejects `connect()` with for each of tedious's failures: its own ConnectionError, the original kept enumerable. */
const asMssql = (original: Error) => new mssql.ConnectionError(original)

describe('entraLoginFailure', () => {
  // tedious 20.3.3 rejects a token failure with an AggregateError whose
  // message is empty (connection.js:2551), and mssql copies that message, so
  // every log line this server writes -- they log `.message` -- would say
  // nothing; and the AggregateError's second error is @azure/identity's,
  // holding the client, the tenant and a trace id. A credential other than
  // the guard would put it there, so the raw shape is translated too: to the
  // sentence and the AADSTS code, with nothing kept. Watched failing with
  // mssql's error returned as it came.
  test('says a token failure in a sentence with the AADSTS code, and keeps nothing of what Entra answered', () => {
    const failure = entraLoginFailure(
      asMssql(new AggregateError([tediousError('Security token could not be authenticated or authorized.', 'EFEDAUTH'), unknownClient()])),
    )
    expect(failure.message).toBe(`${ENTRA_NO_TOKEN} Entra ID answered AADSTS700016.`)
    expectNothingOf(everywhere(failure))
    expect(everywhere(failure)).not.toContain('AggregateError')
  })

  // connection.js:2556: a credential that answered null. No code to give.
  test('says a null token in the sentence alone', () => {
    const failure = entraLoginFailure(asMssql(new AggregateError([tediousError('Security token could not be authenticated or authorized.', 'EFEDAUTH')])))
    expect(failure.message).toBe(ENTRA_NO_TOKEN)
  })

  // The guard's own refusal, which tedious wraps like any other.
  test('says a refused scope in its own sentence', async () => {
    const refused = await scopedToAzureSql(counting(async () => TOKEN))
      .getToken('https://management.azure.com/.default')
      .then(
        () => undefined,
        (rejected: unknown) => rejected,
      )
    const failure = entraLoginFailure(
      asMssql(new AggregateError([tediousError('Security token could not be authenticated or authorized.', 'EFEDAUTH'), refused as Error])),
    )
    expect(failure.message).toBe(ENTRA_SCOPE_REFUSED)
  })

  // The server's own refusal -- a principal it does not know, or a server
  // that does not take Entra logins at all, which is what the 2022
  // container answers -- is "Login failed for user ''." from tedious,
  // which says nothing of Entra. It is said as the server's refusal.
  test('says the server’s refusal as one', () => {
    const failure = entraLoginFailure(asMssql(tediousError("Login failed for user ''.", 'ELOGIN')))
    expect(failure.message).toBe(ENTRA_REFUSED)
    expect(failure).toMatchObject({ code: 'ELOGIN' })
  })

  // A failure before any login -- a host that does not answer, a timeout --
  // carries no credential, and says where it failed as a SQL login's does.
  test('passes on a failure before the login as it came', () => {
    const socket = asMssql(tediousError('Failed to connect to erp.database.windows.net:1433 - getaddrinfo ENOTFOUND', 'ESOCKET'))
    expect(entraLoginFailure(socket)).toBe(socket)
  })
})

/** A TCP listener that answers nothing: it keeps the first bytes each connection sends, and closes it. */
async function firstBytes(): Promise<{ port: number; seen: Buffer[]; close: () => Promise<void> }> {
  const seen: Buffer[] = []
  const server = createServer((socket) => {
    socket.on('error', () => {})
    socket.once('data', (chunk: Buffer) => {
      seen.push(chunk)
      socket.destroy()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { port, seen, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

describe('connectSqlServer, for an Entra principal', () => {
  const NOWHERE = { host: '127.0.0.1', port: 1, database: 'erp' } as const

  // Without encrypt, tedious offers the server no TLS at all
  // (prelogin-payload.js: ENCRYPT.NOT_SUP), and the token, a bearer token
  // for every database the principal reaches, would cross the network in
  // the clear. Refused before any connection is opened: port 1 here would
  // otherwise be refused by the operating system, which is a different
  // sentence. Watched failing with the check removed.
  test('refuses to log in without TLS, before it connects', async () => {
    await expect(connectSqlServer({ ...NOWHERE, encrypt: false, trustServerCertificate: false, entra: { type: 'managed-identity' } })).rejects.toThrow(
      ENTRA_UNENCRYPTED,
    )
  })

  // A trusted certificate is a token handed to whichever server answered.
  // Under TDS 8.0 tedious checks the certificate whatever it is told
  // (connection.js, wrapWithTls passes no rejectUnauthorized), so this is
  // the adapter saying so rather than an embedder's setting ignored in
  // silence. Watched failing with the check removed: the operating
  // system's refusal of port 1 came back instead.
  test('refuses to log in with the server’s certificate trusted, before it connects', async () => {
    await expect(connectSqlServer({ ...NOWHERE, encrypt: true, trustServerCertificate: true, entra: { type: 'managed-identity' } })).rejects.toThrow(
      ENTRA_UNCHECKED,
    )
  })

  // `encrypt: true` is TDS 7's: TLS is started only if the server's
  // PRELOGIN answer asks for it (connection.js, performTlsNegotiation), so
  // an on-path attacker who answers ENCRYPT_NOT_SUP receives the LOGIN7
  // and then the token in the clear -- shown by review on 2026-10-17 with
  // the guard and Azure SQL's SPN. `'strict'` is TDS 8.0: TLS before the
  // first TDS message, the certificate checked, nothing to negotiate
  // down. Watched failing before 0074 took strict: the pool was given
  // `true`.
  test('opens every connection of the pool over TDS 8.0, the certificate checked', () => {
    for (const entra of [{ type: 'managed-identity' } as const, SERVICE_PRINCIPAL]) {
      const { options } = sqlServerConfig({ ...NOWHERE, encrypt: true, trustServerCertificate: false, entra })
      expect(options).toEqual({ encrypt: 'strict', trustServerCertificate: false })
    }
  })

  // A pool whose open failed is forgotten, and the next request opens
  // another (the server's registry, 0019). Were each pool given a new
  // credential, each would start with an empty token cache: a principal
  // the server refuses after its token -- no contained user, the commonest
  // first-run mistake -- would cost a request to Entra, or to the host's
  // identity endpoint, on every request the server answers. The same
  // login object is the same credential, its cache included; another
  // object, which the composition root makes when a secret changes, is
  // another. Watched failing with the credential built for each pool
  // (two constructed for one object).
  test('opens a pool again with the credential the last one had, for the same login, and a new one for another', async () => {
    const login = { type: 'managed-identity', clientId: CLIENT } as const
    const open = (entra: typeof login) =>
      connectSqlServer({ ...NOWHERE, encrypt: true, trustServerCertificate: false, entra }).then(
        () => undefined,
        (rejected: unknown) => rejected,
      )
    expect(await open(login)).toMatchObject({ code: 'ESOCKET' })
    expect(await open(login)).toMatchObject({ code: 'ESOCKET' })
    expect(constructed).toHaveLength(1)
    const credentialOf = (entra: typeof login) =>
      (sqlServerConfig({ ...NOWHERE, encrypt: true, trustServerCertificate: false, entra }).authentication?.options as { credential: unknown }).credential
    expect(credentialOf(login)).toBe(credentialOf(login))
    expect(credentialOf({ ...login })).not.toBe(credentialOf(login))
    expect(constructed).toHaveLength(2)
  })

  // The attack itself, on the wire: whatever listens on the server's port
  // and does not speak TLS -- here a listener that answers nothing -- is
  // sent a TLS ClientHello (record type 0x16) and never a PRELOGIN (TDS
  // packet type 0x12), so it has no PRELOGIN to answer ENCRYPT_NOT_SUP to,
  // and no credential is asked for a token. Watched failing with
  // `encrypt: true` in sqlServerConfig: the first byte was 0x12.
  test('sends a TLS ClientHello before any TDS message, and asks for no token', async () => {
    const { ManagedIdentityCredential } = await vi.importActual<typeof import('@azure/identity')>('@azure/identity')
    const asked = vi.spyOn(ManagedIdentityCredential.prototype, 'getToken').mockRejectedValue(new Error('not here'))
    const listener = await firstBytes()
    try {
      const error = await connectSqlServer({
        host: '127.0.0.1',
        port: listener.port,
        database: 'erp',
        encrypt: true,
        trustServerCertificate: false,
        entra: { type: 'managed-identity' },
      }).then(
        () => undefined,
        (rejected: unknown) => rejected,
      )
      expect(error).toMatchObject({ code: 'ESOCKET' })
      expect(listener.seen.map((chunk) => chunk[0])).toEqual([0x16])
      expect(asked).not.toHaveBeenCalled()
    } finally {
      await listener.close()
    }
  })
})
