import type { ConnectionPool, ISqlType, Request } from 'mssql'

/** One bound value: a generated name, the driver type it travels as, and the value. */
export interface Parameter {
  readonly name: string
  readonly type: ISqlType | (() => ISqlType)
  readonly value: unknown
}

/** SQL text that holds no value, and the values it names. */
export interface Statement {
  readonly sql: string
  readonly parameters: readonly Parameter[]
}

/**
 * The parameters of one statement as it is built: each value gets the next
 * generated name, `@p0`, `@p1`, and only that name reaches the SQL text. A
 * value is never spliced into a statement, whatever it holds.
 */
export class Parameters {
  readonly #list: Parameter[] = []

  /** Binds a value and returns its name, for the SQL being built. */
  add(type: ISqlType | (() => ISqlType), value: unknown): string {
    const name = `p${String(this.#list.length)}`
    this.#list.push({ name, type, value })
    return `@${name}`
  }

  statement(sql: string): Statement {
    return { sql, parameters: [...this.#list] }
  }
}

/** A request for one statement, its values bound. A value the driver will not take is thrown here, before anything is sent. */
export function prepare(pool: ConnectionPool, statement: Statement): Request {
  const request = pool.request()
  for (const parameter of statement.parameters) request.input(parameter.name, parameter.type, parameter.value)
  return request
}

/**
 * Sends a prepared statement and returns its last result set: a write batch
 * selects what it wrote after its own bookkeeping, and a read selects once.
 *
 * Every statement travels as `sp_executesql`, with or without parameters —
 * `tedious` sends a query no other way — which is what keeps the values out of
 * the SQL text, and what ends a `SET` with the request. What this rejects
 * with is always the driver's.
 */
export async function send<Row>(request: Request, statement: Statement): Promise<Row[]> {
  const result = await request.query<Row>(statement.sql)
  return [...(result.recordsets.at(-1) ?? [])]
}

/**
 * Runs one statement. Errors are the driver's own and reach the caller as they
 * are: the lookup half lets them propagate, because a lookup that cannot
 * answer refuses (0012). The record half prepares and sends apart, so that it
 * translates only what the driver rejected with.
 */
export async function run<Row>(pool: ConnectionPool, statement: Statement): Promise<Row[]> {
  return send<Row>(prepare(pool, statement), statement)
}
