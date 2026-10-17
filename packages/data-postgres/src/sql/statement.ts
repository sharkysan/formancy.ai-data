import type { Sql, TransactionSql } from 'postgres'

/** One parameter's value: text the SQL casts where it stands, or NULL. */
export type Param = string | null

/**
 * One statement's parameters, collected as its text is written, so a value
 * can only ever become a placeholder.
 *
 * No placeholder is left untyped. postgres.js sends an untyped parameter
 * after asking the server what type it is, and then serialises it with its
 * serializer for THAT type: a date becomes `new Date(value).toISOString()`,
 * which throws on `infinity`; a boolean becomes 't' only for the JavaScript
 * `true`, so the text 'true' is written as false. Cast to `text` where it
 * stands, the value is sent as written and the server converts it, with the
 * input function of the type the SQL names. A row filter is no exception:
 * its term carries its column's type (0028), so it is bound like any other
 * value. Before, a term had no type and was declared `unknown`, which let the
 * server compare it in the column's collation (C3c).
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
}

/** A row as the server spelled it: one text per output column, `null` for SQL NULL. */
export type TextRow = (string | null)[]

export interface TextResult {
  rows: TextRow[]
  /** Rows the statement affected or returned, from the server's command tag. */
  count: number
}

/** A statement on its way: the driver's handle, which can cancel it, and its rows as the server's text. */
export interface Started {
  readonly query: { cancel(): void }
  readonly rows: Promise<TextResult>
}

/**
 * Sends a statement and returns its rows as the server's own text, by
 * position, with the handle that can stop it (0061).
 *
 * postgres.js sends a query when it is first awaited, so this awaits it at
 * once: by the time the caller holds the handle, the query is on its way to
 * the pool. A lookup cancels through it; records only ever await `rows`.
 *
 * `raw()` hands over each column's bytes before the driver touches them. A
 * `::text` cast is not enough on its own: the composition root configures
 * the driver, and its `transform` option renames columns (`postgres.camel`)
 * and rewrites every value after parsing, text included. Positional bytes
 * are beyond both. A row transform still runs, so the shape is checked.
 *
 * The rows are collected here, one at a time as the driver reads them
 * (`forEach`), never taken from the array the driver resolves with (0078).
 * postgres.js 3.4.9 places each row in that array at an index it counts per
 * connection and resets only when a statement completes: after a statement
 * that ended part-way -- cancelled, or failed in a later row -- the next
 * statement's rows came after that many empty slots, which a lookup read as
 * rows and threw on, and a one-row read counted as more than one
 * (porsager/postgres#1119, #1253; the fix, #1254, is unreleased). The slots
 * held nothing: the protocol ends one statement's rows before the next one's
 * begin, and the driver starts a new array between them. Collected here, a
 * statement's rows are exactly the ones the driver read for it.
 */
export function start(sql: Sql | TransactionSql, text: string, params: readonly Param[]): Started {
  const read: unknown[] = []
  const query = sql.unsafe(text, [...params]).raw()
  // `forEach` returns the query itself, whose outcome `rows` below handles.
  void query.forEach((row: unknown) => {
    read.push(row)
  })
  const rows = query.then((result): TextResult => {
    const converted = read.map((row: unknown): TextRow => {
      if (!Array.isArray(row)) throw new Error("The driver's row transform changed a raw row; this adapter reads rows by position.")
      return row.map((value: unknown) => {
        if (value === null) return null
        if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('utf8')
        throw new Error("The driver's row transform changed a raw value; this adapter reads the server's text.")
      })
    })
    return { rows: converted, count: result.count }
  })
  return { query, rows }
}

/** Runs a statement to its end and returns its rows as the server's own text, by position: `start` without the handle. */
export function run(sql: Sql | TransactionSql, text: string, params: readonly Param[]): Promise<TextResult> {
  return start(sql, text, params).rows
}
