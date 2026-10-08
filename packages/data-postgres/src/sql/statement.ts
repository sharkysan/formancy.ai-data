import type { Sql } from 'postgres'

/**
 * One statement's parameters, collected as its text is written, so a value
 * can only ever become a placeholder.
 *
 * Every placeholder is cast to `text` where it stands. postgres.js sends an
 * untyped parameter after asking the server what type it is, and then
 * serialises it with its serializer for THAT type: a date becomes
 * `new Date(value).toISOString()`, which throws on `infinity`; a boolean
 * becomes 't' only for the JavaScript `true`, so the text 'true' is written
 * as false. Typed as text, the value is sent as written and the server
 * converts it, with the input function of the type the SQL names.
 */
export class Statement {
  readonly params: (string | null)[] = []

  /** A parameter, as text. */
  text(value: string | null): string {
    this.params.push(value)
    return `$${String(this.params.length)}::text`
  }

  /** A parameter, as text, converted by the server to `type` — one of the names in `types.ts`, never input. */
  as(value: string | null, type: string): string {
    return `${this.text(value)}::${type}`
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
export async function run(sql: Sql, text: string, params: readonly (string | null)[]): Promise<TextResult> {
  const result = await sql.unsafe(text, [...params]).raw()
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
