import type { Row } from '../records/explain.js'
import type { Failed } from './errors.js'

/*
 * What a run keeps of its batch's result sets as mssql streams them (0160).
 * The batch selects two of its own last -- what CATCH recorded, and the
 * moved keys -- and a procedure it calls may return any number of others,
 * each as large as it likes. A row of one of the batch's own is kept; a
 * row of any other is counted and dropped as it arrives, where mssql in
 * query mode would hold every row of every result set until the batch
 * ended (read in mssql 12.7.4's lib/tedious/request.js, and measured,
 * actions.integration.test.ts). Kept apart from the request so that what
 * is kept is held by results.test.ts without a server.
 */

/** The columns of `@failed`, the first of the batch's own result sets. */
export const FAILED_COLUMNS: readonly string[] = ['step', 'number', 'message', 'severity', 'procedure']

/** The columns of the moved keys, the batch's last result set: one per column of the record's key. */
export function keyColumns(identity: readonly unknown[]): string[] {
  return identity.map((_, index) => `k${String(index)}`)
}

const same = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length && left.every((name, index) => name === right[index])

/** One result set as the stream announced it: its columns, and its rows where it is one of the batch's own. */
interface ResultSet {
  columns: string[]
  rows: Row[]
}

/** The result sets of one batch as they stream: `recordset` as each begins, `row` for each row. */
export class BatchResults {
  readonly #keys: readonly string[]
  readonly #sets: ResultSet[] = []
  #kept: ResultSet | undefined
  #dropped = 0

  constructor(keys: readonly string[]) {
    this.#keys = keys
  }

  /** A result set begins with these columns: one of the batch's own two is kept, any other's rows dropped. */
  recordset(columns: readonly string[]): void {
    const set: ResultSet = { columns: [...columns], rows: [] }
    this.#sets.push(set)
    this.#kept = same(columns, FAILED_COLUMNS) || same(columns, this.#keys) ? set : undefined
  }

  /** A row of the result set that began last. */
  row(row: Row): void {
    if (this.#kept === undefined) this.#dropped += 1
    else this.#kept.rows.push(row)
  }

  /** How many rows are held, of every result set: the batch's own alone. */
  get held(): number {
    return this.#sets.reduce((total, set) => total + set.rows.length, 0)
  }

  /** How many rows were dropped as they arrived. */
  get dropped(): number {
    return this.#dropped
  }

  /** The batch's own two, which it selects last; `unanswered` when it ended without them, and nothing says what it did. */
  answer(): { failed: Failed[]; moved: Row[] } | 'unanswered' {
    const [failed, moved] = this.#sets.slice(-2)
    if (failed === undefined || moved === undefined || !same(failed.columns, FAILED_COLUMNS) || !same(moved.columns, this.#keys)) return 'unanswered'
    return { failed: failed.rows as unknown as Failed[], moved: moved.rows }
  }
}
