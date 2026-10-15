import { MAX_LOOKUP_DEADLINE_MS } from '@formancy/data-core'

/** The issuer and audience of the tokens the run mints and the server verifies. */
export const ISSUER = 'https://host.performance.invalid'
export const AUDIENCE = 'formancy-data'

export interface ServerSettingsInput {
  storeDir: string
  connectionsFile: string
  rateLimit: number
  port: number
}

/**
 * What the measured server is configured with, as an operator configures it:
 * settings only, the secrets they name added beside them by the caller.
 */
export function serverSettings(input: ServerSettingsInput): Record<string, string> {
  return {
    FORMANCY_DATA_ISSUER: ISSUER,
    FORMANCY_DATA_AUDIENCE: AUDIENCE,
    FORMANCY_DATA_IDENTITY_SECRET: 'env:PERF_HOST_SECRET',
    FORMANCY_DATA_ATTRIBUTES: 'tenant=tid',
    FORMANCY_DATA_STORE_DIR: input.storeDir,
    FORMANCY_DATA_CONNECTIONS: input.connectionsFile,
    FORMANCY_DATA_ADMIN_ROLES: 'data-admin',
    FORMANCY_DATA_AUDIT_KEY: 'env:PERF_AUDIT_KEY',
    FORMANCY_DATA_RATE_LIMIT: String(input.rateLimit),
    // The longest a timer holds, set as an operator sets it, for the reason
    // the rate limit is set high: no deadline may answer inside a run, and
    // the default deadline is derived from what the run measures (0061). A
    // run cut at today's default could never measure past it, and because no
    // run meets the default, the file that holds it is left out of the
    // measured product (0063).
    FORMANCY_DATA_LOOKUP_DEADLINE_MS: String(MAX_LOOKUP_DEADLINE_MS),
    PORT: String(input.port),
    NODE_ENV: 'production',
  }
}
