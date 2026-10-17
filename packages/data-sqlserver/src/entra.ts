import { AzureAuthorityHosts, ClientSecretCredential, ManagedIdentityCredential } from '@azure/identity'
import type { AccessToken, GetTokenOptions, TokenCredential } from '@azure/identity'

/**
 * A SQL Server login as a Microsoft Entra principal (0074): a managed
 * identity, user-assigned by its client id or the host's own, or a service
 * principal with a client secret. Plain strings, so no @azure type reaches
 * this package's declarations. No test of this release logs in as either:
 * no container takes an Entra login, and no test asks Entra.
 */
export type EntraLogin = { type: 'managed-identity'; clientId?: string } | { type: 'service-principal'; tenantId: string; clientId: string; clientSecret: string }

/** The one resource a token is asked for: Azure SQL's, whatever the server names. */
export const AZURE_SQL_SCOPE = 'https://database.windows.net/.default'

const FAILED = 'The SQL Server login as an Entra principal failed:'
/** A token Entra did not issue, or a credential that answered none. An AADSTS code follows when Entra gave one. */
export const ENTRA_NO_TOKEN = `${FAILED} Entra ID issued no token for Azure SQL.`
/** A server that asked for a token for another resource, which the guard did not ask Entra for. */
export const ENTRA_SCOPE_REFUSED = `${FAILED} the server asked for a token for a resource other than Azure SQL's, and none was asked for.`
/** The server's own refusal: a principal it does not know, or a server that takes no Entra login. */
export const ENTRA_REFUSED = `${FAILED} the server refused it.`
/** An Entra login over a connection without TLS, refused before it is opened. */
export const ENTRA_UNENCRYPTED = 'An Entra login needs TLS to the server: without it the token would cross the network in the clear.'
/** An Entra login told to trust the server's certificate, refused before it is opened. */
export const ENTRA_UNCHECKED = "An Entra login checks the server's certificate: trusted, the token would go to whichever server answered."

/**
 * What the guard rejects with when no token comes: a sentence and, at most,
 * Entra's AADSTS code. It keeps no cause, because what Entra answered names
 * the client, the tenant and a trace id.
 */
class EntraTokenFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EntraTokenFailure'
  }
}

/** The first `AADSTS` code in a text, which is all of Entra's answer that is said. */
function aadsts(text: string): string | undefined {
  return /\bAADSTS\d+\b/.exec(text)?.[0]
}

function noToken(answered: unknown): EntraTokenFailure {
  const code = aadsts(answered instanceof Error ? answered.message : String(answered))
  return new EntraTokenFailure(code === undefined ? ENTRA_NO_TOKEN : `${ENTRA_NO_TOKEN} Entra ID answered ${code}.`)
}

/**
 * `inner`, asked for Azure SQL's token alone. tedious asks for the resource
 * the server's FEDAUTHINFO names (connection.js, `new URL('/.default',
 * spn)`), and a token is a bearer token for whatever resource it names: a
 * server that was not Azure SQL could otherwise have this principal's token
 * for another service. Any other scope, or more than one, is refused before
 * `inner` is called; a failure of `inner` is said in a sentence that keeps
 * nothing of what Entra answered.
 */
export function scopedToAzureSql(inner: TokenCredential): TokenCredential {
  return {
    async getToken(scopes: string | string[], options?: GetTokenOptions): Promise<AccessToken | null> {
      const asked = typeof scopes === 'string' ? [scopes] : scopes
      if (asked.length !== 1 || asked[0] !== AZURE_SQL_SCOPE) throw new EntraTokenFailure(ENTRA_SCOPE_REFUSED)
      try {
        return await inner.getToken(AZURE_SQL_SCOPE, options)
      } catch (error) {
        throw noToken(error)
      }
    },
  }
}

/**
 * The credential a login logs in with, which connect.ts builds once for each
 * login object and mssql hands every connection of every pool opened with
 * it (0074). tedious's own Entra types would build one per login and leave
 * the scope to the server.
 *
 * A service principal's tenant, client and secret are the login's, and its
 * authority is the public cloud's, written here so that the class never
 * reads AZURE_AUTHORITY_HOST. @azure/identity and MSAL still read what they
 * read for every credential: the region (AZURE_REGIONAL_AUTHORITY_NAME,
 * MSAL_FORCE_REGION, REGION_NAME), the log level (AZURE_LOG_LEVEL) and the
 * proxy (HTTPS_PROXY, HTTP_PROXY, NO_PROXY). A managed identity reads its
 * platform's endpoint from the environment, which is how it is found, and
 * with AZURE_TENANT_ID, AZURE_FEDERATED_TOKEN_FILE and a client id set takes
 * workload identity's token exchange instead, which the server refuses at
 * start (data-server's connections.ts).
 */
export function entraCredential(login: EntraLogin): TokenCredential {
  const inner =
    login.type === 'managed-identity'
      ? new ManagedIdentityCredential(login.clientId === undefined ? {} : { clientId: login.clientId })
      : new ClientSecretCredential(login.tenantId, login.clientId, login.clientSecret, { authorityHost: AzureAuthorityHosts.AzurePublicCloud })
  return scopedToAzureSql(inner)
}

/** What tedious and mssql may hang an error on, read without trusting any of it. */
interface Wrapped {
  code?: unknown
  originalError?: unknown
}

/**
 * What an Entra pool's `connect()` rejects with, said. A token failure is
 * tedious's AggregateError, whose message is empty, under mssql's
 * ConnectionError, which copies it: it becomes ENTRA_NO_TOKEN, with the
 * AADSTS code when one was given, or the guard's own sentence, and keeps
 * nothing else. The server's refusal, `ELOGIN`, becomes ENTRA_REFUSED. A
 * failure before any login -- a host that does not answer, a timeout -- is
 * returned as it came: it carries no credential, and says where it failed.
 */
export function entraLoginFailure(error: unknown): Error {
  const wrapped = (typeof error === 'object' && error !== null ? error : {}) as Wrapped
  const original = wrapped.originalError ?? error
  if (original instanceof AggregateError) {
    const answered: unknown = original.errors[1]
    const failure = answered instanceof EntraTokenFailure ? answered.message : answered === undefined ? ENTRA_NO_TOKEN : noToken(answered).message
    return Object.assign(new Error(failure), { code: 'EFEDAUTH' })
  }
  if (wrapped.code === 'ELOGIN') return Object.assign(new Error(ENTRA_REFUSED), { code: 'ELOGIN' })
  return error instanceof Error ? error : new Error(String(error))
}
