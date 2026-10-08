/**
 * The databases the first release speaks, as a tuple so that a `switch` over
 * them is exhaustive and a third one is a compile error everywhere it matters.
 */
export const DATABASE_KINDS = ['postgres', 'sqlserver'] as const

export type DatabaseKind = (typeof DATABASE_KINDS)[number]

/**
 * Whether a value read from configuration names a database this release speaks.
 *
 * A composition root reads the kind from an environment variable or a config
 * file. A typo that passed here would reach an adapter lookup and fail there,
 * with a message about a missing module rather than about the configuration.
 */
export function isDatabaseKind(value: unknown): value is DatabaseKind {
  return typeof value === 'string' && (DATABASE_KINDS as readonly string[]).includes(value)
}

/**
 * What answered a ping: the engine's own name for itself, and its version as
 * the server states it rather than as the driver was configured for.
 */
export interface ServerIdentity {
  kind: DatabaseKind
  /**
   * `major.minor[.…]` as the server reports it: `17.6` from PostgreSQL's
   * `server_version`, `16.0.4205.1` from SQL Server's `ProductVersion`. Kept
   * as the server's own string, because the two do not share a shape and
   * normalising them is a decision the metadata layer will take with the
   * capability model, not one a ping should take alone.
   */
  version: string
}

/**
 * The port every database-specific package implements, and the only thing the
 * core ever talks to.
 *
 * Two implementations from the first day, which is what makes this a port
 * rather than an interface with one implementation: PostgreSQL in
 * `@formancy/data-postgres` and SQL Server in `@formancy/data-sqlserver`. Both
 * run the same conformance cases against a real server (0003).
 *
 * An adapter takes a connected driver. Opening the connection is where a secret
 * is handled, and that happens once, in the composition root, where the secret
 * resolver lives. Nothing behind this port reads configuration.
 */
export interface DatabaseAdapter {
  readonly kind: DatabaseKind

  /**
   * Round-trips to the server and reports what answered.
   *
   * It fails rather than guesses: a ping that answered from the driver's
   * configuration would pass against a server that is not there.
   */
  ping(): Promise<ServerIdentity>

  /** Releases the driver's resources. Calling it twice is allowed and does nothing the second time. */
  close(): Promise<void>
}
