import mssql from 'mssql'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { SqlServerFixture } from '@formancy/data-fixtures'
import { EDGE_VALUES, startSqlServerFixture } from '@formancy/data-fixtures'

/**
 * The SQL Server half of the phase-1 spike, kept as tests: what the driver does
 * with the fixture's edge values when nobody asks it for anything, the read
 * path that loses nothing, what a text length counts, and optimistic
 * concurrency on rowversion between two independent connections.
 *
 * These characterise mssql, tedious and the server as they are today. A driver
 * upgrade that changes one of them fails here, by name, before a codec that
 * relied on it does something quietly different.
 */
let fixture: SqlServerFixture
let pool: mssql.ConnectionPool

beforeAll(async () => {
  fixture = await startSqlServerFixture()
  pool = await new mssql.ConnectionPool(fixture.admin).connect()
})

afterAll(async () => {
  await pool?.close()
  await fixture?.stop()
})

describe('reading the edge values', () => {
  // The plan's worry, measured. bigint is safe by default -- tedious hands it
  // over as a decimal string -- and decimal is not: the largest numeric(18,4)
  // becomes a double, which rounds it to the next integer. A codec that trusted
  // the driver's number would put 100000000000000 in front of a person who
  // stored 99999999999999.9999.
  test('by default, bigint arrives as an exact string and decimal(18,4) as a number that is not the stored value', async () => {
    const { recordset } = await pool.request().query<{ id: unknown; amount: unknown }>('select id, amount from sales.[order]')
    const row = recordset[0]
    expect(typeof row?.id).toBe('string')
    expect(row?.id).toBe(EDGE_VALUES.beyondSafeInteger)
    expect(typeof row?.amount).toBe('number')
    expect(String(row?.amount)).toBe('100000000000000')
    expect(String(row?.amount)).not.toBe(EDGE_VALUES.largestAmount)
  })

  // The lossless path: the server converts to text, so the driver never holds
  // the value as a number. Both edge values come back digit for digit.
  test('converted to text by the server, both read back exactly', async () => {
    const { recordset } = await pool
      .request()
      .query<{ id: string; amount: string }>('select convert(varchar(40), id) as id, convert(varchar(40), amount) as amount from sales.[order]')
    expect(recordset[0]).toEqual({ id: EDGE_VALUES.beyondSafeInteger, amount: EDGE_VALUES.largestAmount })
  })

  // A calendar date has no zone, and the driver gives it one: midnight UTC.
  // Rendered in a browser west of Greenwich, 8 October is 7 October. The date
  // codec has to read the parts, never format the instant.
  test('a date arrives as a JavaScript Date at midnight UTC', async () => {
    const { recordset } = await pool.request().query<{ order_date: unknown }>('select order_date from sales.[order]')
    const value = recordset[0]?.order_date
    expect(value).toBeInstanceOf(Date)
    expect((value as Date).toISOString()).toBe(`${EDGE_VALUES.orderDate}T00:00:00.000Z`)
  })

  // The other direction. 2^53 + 1 as a JavaScript number is 2^53, so a key
  // bound as one addresses a different row -- here none, in a larger table
  // possibly a real one, and an UPDATE would change it. Bound as the decimal
  // string, the driver sends the exact bigint.
  test('an id past 2^53 bound as a number finds nothing; bound as its decimal string it finds the row', async () => {
    const count = async (id: string | number): Promise<number | undefined> => {
      const { recordset } = await pool
        .request()
        .input('id', mssql.BigInt, id)
        .query<{ n: number }>('select count(*) as n from sales.[order] where id = @id')
      return recordset[0]?.n
    }
    expect(await count(Number(EDGE_VALUES.beyondSafeInteger))).toBe(0)
    expect(await count(EDGE_VALUES.beyondSafeInteger)).toBe(1)
  })
})

describe('what a text length counts', () => {
  // Discovery reports nvarchar(n) as maxLength n. That n is UTF-16 code units --
  // what JavaScript's String length counts -- not characters: two emoji fill
  // nvarchar(4), and a third is refused though it makes only three
  // characters. PostgreSQL's varchar(4) counts characters and holds all three.
  // varchar(n) under a UTF-8 collation counts BYTES: three e-acutes are six
  // bytes and are refused, though their String length is 3.
  test('nvarchar(n) holds n UTF-16 code units, and a UTF-8 varchar(n) holds n bytes', async () => {
    await pool.request().batch('create schema spike')
    await pool
      .request()
      .batch('create table spike.text_length (n nvarchar(4) null, v varchar(4) collate Latin1_General_100_CI_AS_SC_UTF8 null)')
    const insert = (columnName: 'n' | 'v', value: string) =>
      pool.request().input('value', mssql.NVarChar(mssql.MAX), value).query(`insert into spike.text_length (${columnName}) values (@value)`)

    const twoEmoji = '\u{1F600}\u{1F600}'
    const threeEmoji = '\u{1F600}\u{1F600}\u{1F600}'
    expect(twoEmoji.length).toBe(4)
    await expect(insert('n', twoEmoji)).resolves.toBeDefined()
    // 2628: "String or binary data would be truncated".
    await expect(insert('n', threeEmoji)).rejects.toMatchObject({ number: 2628 })

    const threeAcutes = 'ééé'
    expect(threeAcutes.length).toBe(3)
    await expect(insert('v', 'éé')).resolves.toBeDefined()
    await expect(insert('v', threeAcutes)).rejects.toMatchObject({ number: 2628 })
  })
})

describe('optimistic concurrency on rowversion', () => {
  // The plan's preferred strategy on SQL Server, proved with two independent
  // connections rather than asserted. Each reads the same 8-byte token; the
  // first update that names it wins, and the second -- naming a token that no
  // longer exists -- changes nothing. Without the token in the WHERE clause the
  // second would silently overwrite the first, which is the lost update the
  // phase-3 gate forbids.
  test('the first update with the token wins, and the stale one changes nothing', async () => {
    const id = EDGE_VALUES.beyondSafeInteger
    const first = await new mssql.ConnectionPool(fixture.admin).connect()
    const second = await new mssql.ConnectionPool(fixture.admin).connect()
    try {
      const read = async (connection: mssql.ConnectionPool) => {
        const { recordset } = await connection
          .request()
          .input('id', mssql.BigInt, id)
          .query<{ row_version: Buffer; status: string }>('select row_version, status from sales.[order] where id = @id')
        const row = recordset[0]
        if (row === undefined) throw new Error('the fixture order is missing')
        return row
      }
      const update = async (connection: mssql.ConnectionPool, status: string, token: Buffer) => {
        const result = await connection
          .request()
          .input('id', mssql.BigInt, id)
          .input('status', mssql.VarChar(20), status)
          .input('token', mssql.VarBinary(8), token)
          .query('update sales.[order] set status = @status where id = @id and row_version = @token')
        return result.rowsAffected[0]
      }

      const seenByFirst = await read(first)
      const seenBySecond = await read(second)
      expect(Buffer.isBuffer(seenByFirst.row_version)).toBe(true)
      expect(seenByFirst.row_version).toHaveLength(8)
      expect(seenBySecond.row_version.equals(seenByFirst.row_version)).toBe(true)

      expect(await update(first, 'shipped', seenByFirst.row_version)).toBe(1)
      expect(await update(second, 'draft', seenBySecond.row_version)).toBe(0)

      // Read through the second connection with the same binding: the row is
      // there for it, so its 0 was the token's doing, not the address's.
      const after = await read(second)
      expect(after.status).toBe('shipped')
      expect(after.row_version.equals(seenByFirst.row_version)).toBe(false)
    } finally {
      await second.close()
      await first.close()
    }
  })
})
