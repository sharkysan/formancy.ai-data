import type { Sql } from 'postgres'

/**
 * A parameter declared of type `unknown` (`Statement.inferred`): the server
 * types it from where it stands, and the driver sends its text as it is.
 */
export interface Inferred {
  readonly inferred: string
}

/** One parameter's value: text the SQL casts, NULL, or text the server types from its place. */
export type Param = string | null | Inferred

/** pg_type's oid for `unknown`, the type of a literal whose type the statement decides. */
const UNKNOWN = 705

/**
 * One statement's parameters, collected as its text is written, so a value
 * can only ever become a placeholder.
 *
 * No placeholder is left untyped. postgres.js sends an untyped parameter
 * after asking the server what type it is, and then serialises it with its
 * serializer for THAT type: a date becomes `new Date(value).toISOString()`,
 * which throws on `infinity`; a boolean becomes 't' only for the JavaScript
 * `true`, so the text 'true' is written as false. Cast to `text` where it
 * stands, or declared `unknown`, the value is sent as written and the server
 * converts it, with the input function of the type the SQL names or the
 * place it stands in gives it.
 */
export class Statement {
  readonly params: Param[] = []

  /** A parameter, as text. */
  text(value: string | null): string {
    this.params.push(value)
    return `$${String(this.params.length)}::pg_catalog.text`
  }

  /** A parameter, as text, converted by the server to `type` — one of the names in `types.ts`, never input. */
  as(value: string | null, type: string): string {
    return `${this.text(value)}::${type}`
  }

  /**
   * A parameter whose type the server takes from where it stands — the
   * column it is compared with — and whose text it reads with that type's
   * input function, for a value whose type the SQL cannot name.
   *
   * Declared `unknown` rather than left untyped (0): the driver fills in
   * the type the server reports only for a parameter it left untyped, and
   * has no serializer for `unknown`, so the text is sent as written.
   */
  inferred(value: string): string {
    this.params.push({ inferred: value })
    return `$${String(this.params.length)}`
  }
}

/** A row as the server spelled it: one text per output column, `null` for SQL NULL. */
export type TextRow = (string | null)[]

export interface TextResult {
  rows: TextRow[]
  /** Rows the statement affected or returned, from the server's command tag. */
  count: number
}

/**
 * Runs a statement and returns its rows as the server's own text, by position.
 *
 * `raw()` hands over each column's bytes before the driver touches them. A
 * `::text` cast is not enough on its own: the composition root configures
 * the driver, and its `transform` option renames columns (`postgres.camel`)
 * and rewrites every value after parsing, text included. Positional bytes
 * are beyond both. A row transform still runs, so the shape is checked.
 */
export async function run(sql: Sql, text: string, params: readonly Param[]): Promise<TextResult> {
  const bound = params.map((param) => (param === null || typeof param === 'string' ? param : sql.typed(param.inferred, UNKNOWN)))
  const result = await sql.unsafe(text, bound).raw()
  const rows = result.map((row: unknown): TextRow => {
    if (!Array.isArray(row)) throw new Error("The driver's row transform changed a raw row; this adapter reads rows by position.")
    return row.map((value: unknown) => {
      if (value === null) return null
      if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('utf8')
      throw new Error("The driver's row transform changed a raw value; this adapter reads the server's text.")
    })
  })
  return { rows, count: result.count }
}
