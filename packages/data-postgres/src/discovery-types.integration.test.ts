import { findObject } from '@formancy/data-core'
import type { ColumnMeta, MetadataSnapshot, NormalizedType } from '@formancy/data-core'
import type { PostgresFixture } from '@formancy/data-fixtures'
import { startPostgresFixture } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { discoverPostgres } from './index.js'

/**
 * How each PostgreSQL type is normalised, proved by declaring it and reading
 * the catalog back -- never by feeding a decoder the numbers we believe
 * pg_attribute holds, which would test the belief.
 *
 * The shared fixture covers the types both engines' business model uses. The
 * rest of PostgreSQL's built-in types are declared here, in a schema of this
 * suite's own, because `@formancy/data-fixtures` does not yet describe them;
 * they belong in the shared model when SQL Server's counterparts are written.
 */
interface TypeCase {
  column: string
  declared: string
  type: NormalizedType
}

const INT16 = { kind: 'integer', min: '-32768', max: '32767' } as const
const INT32 = { kind: 'integer', min: '-2147483648', max: '2147483647' } as const
const INT64 = { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' } as const
const UNSUPPORTED = { kind: 'unsupported' } as const

const CASES: TypeCase[] = [
  // A smallint reported with int4's range would let a form accept 40000.
  { column: 'small', declared: 'smallint', type: INT16 },
  { column: 'regular', declared: 'integer', type: INT32 },
  // Bounds as strings: a 64-bit bound in a JavaScript number is already wrong.
  { column: 'big', declared: 'bigint', type: INT64 },
  { column: 'exact', declared: 'numeric(18, 4)', type: { kind: 'decimal', precision: 18, scale: 4 } },
  // Unconstrained numeric stores any value exactly. Reported with a default
  // precision, a form would round what the column holds.
  { column: 'loose', declared: 'numeric', type: { kind: 'decimal', precision: null, scale: null } },
  // PostgreSQL 15 allows a negative scale: numeric(2,-3) rounds to thousands.
  // It is stored as an 11-bit two's complement, and a decoder that read it
  // unsigned would report a scale of 2045.
  { column: 'thousands', declared: 'numeric(2, -3)', type: { kind: 'decimal', precision: 2, scale: -3 } },
  // ... and a scale above the precision: only fractions below 0.01 fit.
  { column: 'tiny', declared: 'numeric(3, 5)', type: { kind: 'decimal', precision: 3, scale: 5 } },
  // atttypmod holds the length plus a four-byte header. Forgetting the header
  // says 34 characters where the column takes 30.
  { column: 'bounded', declared: 'varchar(30)', type: { kind: 'text', maxLength: 30, fixedLength: false } },
  { column: 'unbounded', declared: 'varchar', type: { kind: 'text', maxLength: null, fixedLength: false } },
  { column: 'padded', declared: 'char(3)', type: { kind: 'text', maxLength: 3, fixedLength: true } },
  // `char` without a length is char(1), not an unbounded text.
  { column: 'single', declared: 'char', type: { kind: 'text', maxLength: 1, fixedLength: true } },
  // `bpchar` with no length pads to nothing and still ignores trailing
  // blanks: neither a fixed-length text nor a variable one. Reported as
  // either, a form would promise semantics the column does not have.
  { column: 'blank_padded', declared: 'bpchar', type: UNSUPPORTED },
  { column: 'body', declared: 'text', type: { kind: 'text', maxLength: null, fixedLength: false } },
  { column: 'flag', declared: 'boolean', type: { kind: 'boolean' } },
  { column: 'day', declared: 'date', type: { kind: 'date' } },
  { column: 'clock', declared: 'time(3)', type: { kind: 'time', precision: 3 } },
  // No declared precision is null, not PostgreSQL's effective six.
  { column: 'clock_default', declared: 'time', type: { kind: 'time', precision: null } },
  // The contract's time has no zone. Reported as `time`, a zone would be
  // silently dropped, which is the erasure of time semantics 0004 forbids.
  { column: 'clock_zoned', declared: 'time with time zone', type: UNSUPPORTED },
  // Precision 0 is declared. A decoder that tested truthiness would say null.
  { column: 'local', declared: 'timestamp(0)', type: { kind: 'timestamp', withTimeZone: false, precision: 0 } },
  { column: 'local_default', declared: 'timestamp', type: { kind: 'timestamp', withTimeZone: false, precision: null } },
  { column: 'instant', declared: 'timestamptz(3)', type: { kind: 'timestamp', withTimeZone: true, precision: 3 } },
  { column: 'key', declared: 'uuid', type: { kind: 'uuid' } },
  { column: 'blob', declared: 'bytea', type: { kind: 'binary', maxLength: null } },
  { column: 'single_float', declared: 'real', type: { kind: 'float', bits: 32 } },
  { column: 'double_float', declared: 'double precision', type: { kind: 'float', bits: 64 } },
  // `float(p)` is resolved to real or double precision when the table is made.
  { column: 'float_twenty', declared: 'float(20)', type: { kind: 'float', bits: 32 } },
  // No tested codec: reported, never dropped.
  { column: 'doc', declared: 'jsonb', type: UNSUPPORTED },
  { column: 'span', declared: 'interval', type: UNSUPPORTED },
  // money formats by lc_monetary; not an exact decimal a form can trust.
  { column: 'cash', declared: 'money', type: UNSUPPORTED },
  // An array of text is not text.
  { column: 'tags', declared: 'text[]', type: UNSUPPORTED },
  { column: 'mood', declared: 'types_probe.mood', type: UNSUPPORTED },
  // A domain carries its own checks. Reported as its base type, a form would
  // accept the negative price the domain refuses.
  { column: 'price', declared: 'types_probe.price', type: UNSUPPORTED },
  // A type that is merely NAMED int4, outside pg_catalog, is not PostgreSQL's
  // int4. Matching on the name alone would call this composite an integer.
  { column: 'impostor', declared: 'types_probe.int4', type: UNSUPPORTED },
]

let fixture: PostgresFixture
let owner: Sql
let snapshot: MetadataSnapshot

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
  // Declared from the constants above, which are this file's and not input.
  await owner.unsafe(`
    create schema types_probe;
    create type types_probe.mood as enum ('calm', 'cross');
    create domain types_probe.price as numeric(10, 2) check (value >= 0);
    create type types_probe.int4 as (x integer);
    create table types_probe.everything (${CASES.map((entry) => `${entry.column} ${entry.declared}`).join(', ')});
    create table types_probe.generation (
      always_id integer generated always as identity,
      default_id integer generated by default as identity,
      counter serial,
      doubled integer generated always as (always_id * 2) stored,
      required text not null,
      optional text,
      retired integer,
      after_retired integer
    );
    alter table types_probe.generation drop column retired;
  `)
  snapshot = await discoverPostgres(owner, { schemas: ['types_probe'] })
})

afterAll(async () => {
  await owner?.end()
  await fixture?.stop()
})

function columnsOf(name: string): ColumnMeta[] {
  const object = findObject(snapshot, { schema: 'types_probe', name })
  if (object === undefined) throw new Error(`types_probe.${name} is not in the snapshot`)
  return object.columns
}

function columnOf(table: string, name: string): ColumnMeta {
  const found = columnsOf(table).find((entry) => entry.name === name)
  if (found === undefined) throw new Error(`types_probe.${table} has no column ${name}`)
  return found
}

describe('type normalisation', () => {
  test.each(CASES)('$declared is $type.kind', ({ column, type }) => {
    expect(columnOf('everything', column).type).toEqual(type)
  })

  // A type with no codec is a value, and its spelling is what tells the
  // person reading the report what they have. Lost, "unsupported" says
  // nothing about which type it was.
  test('every column keeps the type as PostgreSQL spells it', () => {
    const spelled = Object.fromEntries(columnsOf('everything').map((entry) => [entry.name, entry.databaseType]))
    expect(spelled).toMatchObject({
      thousands: 'numeric(2,-3)',
      blank_padded: 'bpchar',
      clock_zoned: 'time with time zone',
      float_twenty: 'real',
      tags: 'text[]',
      mood: 'types_probe.mood',
      impostor: 'types_probe.int4',
    })
  })

  // Composite types are pg_class rows of their own (relkind 'c'). An object
  // query that did not filter by kind would report the impostor as a table.
  test('a composite type is not reported as an object', () => {
    expect(snapshot.objects.map((object) => object.ref.name)).toEqual(['everything', 'generation'])
  })
})

describe('generation, defaults and nullability', () => {
  // GENERATED ALWAYS and BY DEFAULT are both identity: the database supplies
  // the value. The contract does not say which, and a form omits it either way.
  test('both kinds of identity column are identity, with no default', () => {
    for (const name of ['always_id', 'default_id']) {
      expect(columnOf('generation', name)).toMatchObject({ generated: 'identity', hasDefault: false, defaultExpression: null })
    }
  })

  // serial is a default of nextval(), not an identity: an explicit value is
  // accepted and an update may change it. Reported as identity, a form would
  // refuse what the column allows.
  test('a serial column is an ordinary column whose default is a sequence', () => {
    expect(columnOf('generation', 'counter')).toMatchObject({
      type: INT32,
      generated: 'none',
      hasDefault: true,
      defaultExpression: "nextval('types_probe.generation_counter_seq'::regclass)",
    })
  })

  test('a stored generated column is computed, with no default', () => {
    expect(columnOf('generation', 'doubled')).toMatchObject({ generated: 'computed', hasDefault: false, defaultExpression: null })
  })

  // Nullability decides whether a form may leave a field empty. A serial or
  // an identity column is NOT NULL without saying so in the DDL.
  test("nullability is the catalog's, including what identity and serial imply", () => {
    const nullable = Object.fromEntries(columnsOf('generation').map((entry) => [entry.name, entry.nullable]))
    expect(nullable).toEqual({ always_id: false, default_id: false, counter: false, doubled: true, required: false, optional: true, after_retired: true })
  })

  // A dropped column stays in pg_attribute, renamed and flagged. Reported, it
  // is a column called "........pg.dropped.7........"; renumbered, the
  // ordinals of the columns after it would shift and the fingerprint with them.
  test('a dropped column is not reported, and leaves a gap in the ordinals', () => {
    expect(columnsOf('generation').map((entry) => [entry.name, entry.ordinal])).toEqual([
      ['always_id', 1],
      ['default_id', 2],
      ['counter', 3],
      ['doubled', 4],
      ['required', 5],
      ['optional', 6],
      ['after_retired', 8],
    ])
  })
})
