import { describe, expect, test } from 'vitest'
import type { CatalogRow, ParameterRow, RoutineRow } from './routines.js'
import { routinesOf } from './routines.js'

const ROW: RoutineRow = {
  object_id: 1,
  schema_name: 'sales',
  routine_name: 'ship_order',
  type: 'P',
  access_object: '[sales].[ship_order]',
  can_execute: 1,
  null_on_null_input: false,
}

const PARAMETER: ParameterRow = {
  parameter_id: 1,
  parameter_name: '@order_id',
  user_type_id: 127,
  max_length: 8,
  precision: 19,
  scale: 0,
  is_output: false,
  type_name: 'bigint',
  type_schema: 'sys',
  is_user_defined: false,
  system_name: 'bigint',
  code_page: null,
}

/** The statement's rows for one routine: one per parameter, or one with none. */
function rows(routine: Partial<RoutineRow> = {}, parameters: readonly Partial<ParameterRow>[] = [{}]): CatalogRow[] {
  const row = { ...ROW, ...routine }
  return parameters.length === 0 ? [{ ...row, parameter_id: null }] : parameters.map((parameter) => ({ ...row, ...PARAMETER, ...parameter }))
}

describe('routinesOf', () => {
  // HAS_PERMS_BY_NAME answers NULL for a name it could not parse (B7). Read
  // as "no", a quoting slip would quietly mark a routine closed to its
  // account (0158); it is a defect, and the error names the routine and the
  // permission asked, which for a table-valued function is SELECT.
  test('a NULL answer for the permission a call needs is refused as a defect, naming the routine and the permission', () => {
    expect(() => routinesOf(rows({ can_execute: null }))).toThrow('HAS_PERMS_BY_NAME could not resolve [sales].[ship_order] for EXECUTE')
    expect(() => routinesOf(rows({ type: 'IF', can_execute: null }))).toThrow('HAS_PERMS_BY_NAME could not resolve [sales].[ship_order] for SELECT')
    expect(routinesOf(rows()).routines[0]?.executable).toBe(true)
    expect(routinesOf(rows({ can_execute: 0 })).routines[0]?.executable).toBe(false)
  })

  // A routine this release does not read -- CLR, or a replication filter --
  // is still one the account can see in scope. Left out with nothing said,
  // a snapshot that asked for routines would read as having none there
  // (0004); each is a routines gap on the routine itself, which no table in
  // its schema can share the name of, and no routine is made of it.
  test('a routine this release does not read is a routines gap on that routine, and is not recorded', () => {
    const unread = [
      ...rows({ object_id: 2, routine_name: 'clr_proc', type: 'PC', can_execute: null }, []),
      ...rows({ object_id: 3, routine_name: 'clr_scalar', type: 'FS', can_execute: null }, []),
      ...rows({ object_id: 4, routine_name: 'clr_rows', type: 'FT', can_execute: null }, []),
      ...rows({ object_id: 5, routine_name: 'filter', type: 'RF', can_execute: null }, []),
    ]
    const { routines, gaps } = routinesOf([...rows(), ...unread])
    expect(routines.map((routine) => routine.ref.name)).toEqual(['ship_order'])
    expect(gaps.map((gap) => [gap.subject, gap.aspect, gap.detail])).toEqual([
      [
        { kind: 'object', object: { schema: 'sales', name: 'clr_proc' } },
        'routines',
        'sales.clr_proc is a CLR procedure, which this release does not read, so it is not among the routines recorded',
      ],
      [
        { kind: 'object', object: { schema: 'sales', name: 'clr_scalar' } },
        'routines',
        'sales.clr_scalar is a CLR scalar function, which this release does not read, so it is not among the routines recorded',
      ],
      [
        { kind: 'object', object: { schema: 'sales', name: 'clr_rows' } },
        'routines',
        'sales.clr_rows is a CLR table-valued function, which this release does not read, so it is not among the routines recorded',
      ],
      [
        { kind: 'object', object: { schema: 'sales', name: 'filter' } },
        'routines',
        'sales.filter is a replication-filter procedure, which this release does not read, so it is not among the routines recorded',
      ],
    ])
  })

  // One statement, a row per parameter: each routine is its own rows'
  // parameters in order, never another's, and a routine with none is one
  // row whose parameter is NULL. SQL Server's catalog keeps no T-SQL
  // parameter's default, so whether one has a default is null, never false.
  test('a routine is its own rows’ parameters, none when the row carries none, and no default is known', () => {
    const { routines, gaps } = routinesOf([
      ...rows({}, [{}, { parameter_id: 2, parameter_name: '@tenant', user_type_id: 56, max_length: 4, precision: 10, type_name: 'int', system_name: 'int' }]),
      ...rows({ object_id: 2, routine_name: 'audit' }, []),
    ])
    expect(routines.map((routine) => [routine.ref.name, routine.parameters.map((parameter) => [parameter.name, parameter.hasDefault])])).toEqual([
      [
        'ship_order',
        [
          ['@order_id', null],
          ['@tenant', null],
        ],
      ],
      ['audit', []],
    ])
    expect(gaps).toEqual([])
  })

  // An alias type the account holds nothing on is not in sys.types for it,
  // though the parameter is: its name comes back NULL. The parameter is
  // recorded as unsupported, as every alias type is, and spelled as its base
  // type -- and, as for a column (columns.ts), a gap says why, rather than a
  // decimal(14,2) that reads as unsupported for no reason given. A hidden
  // table type has no base type to name.
  test('a parameter or a result whose declared type is hidden is a routines gap on the routine', () => {
    const alias = {
      user_type_id: 257,
      max_length: 9,
      precision: 14,
      scale: 2,
      type_name: null,
      type_schema: null,
      is_user_defined: null,
      system_name: 'decimal',
    }
    const table = {
      parameter_id: 2,
      parameter_name: '@keys',
      user_type_id: 258,
      max_length: -1,
      precision: 0,
      type_name: null,
      type_schema: null,
      is_user_defined: null,
      system_name: null,
    }
    const procedure = routinesOf(rows({}, [{ ...alias, parameter_name: '@amount' }, table]))
    expect(procedure.routines[0]?.parameters.map((parameter) => [parameter.databaseType, parameter.type.kind])).toEqual([
      ['decimal(14,2)', 'unsupported'],
      ['unknown', 'unsupported'],
    ])
    expect(procedure.gaps.map((gap) => [gap.subject, gap.detail])).toEqual([
      [
        { kind: 'object', object: { schema: 'sales', name: 'ship_order' } },
        'parameter @amount: its user-defined type is hidden from this account, so it is recorded as unsupported, spelled as its base type decimal(14,2)',
      ],
      [
        { kind: 'object', object: { schema: 'sales', name: 'ship_order' } },
        'parameter @keys: its user-defined type is hidden from this account, so it is recorded as unsupported',
      ],
    ])
    const scalar = routinesOf(rows({ type: 'FN' }, [{ ...alias, parameter_id: 0, parameter_name: '' }]))
    expect(scalar.routines[0]?.result?.type).toEqual({ kind: 'unsupported' })
    expect(scalar.gaps.map((gap) => gap.detail)).toEqual([
      'its result: its user-defined type is hidden from this account, so it is recorded as unsupported, spelled as its base type decimal(14,2)',
    ])
    expect(routinesOf(rows()).gaps).toEqual([])
  })

  // Whether SQL Server calls a routine given a NULL (0167): a function
  // declared RETURNS NULL ON NULL INPUT is not, which the generator and a
  // later SQL Server run must not take for one that is; every procedure
  // is, whatever its module row says, since CREATE PROCEDURE cannot declare
  // otherwise; and a function whose module row the catalog did not show
  // records nothing, never a guess either way. Watched failing on
  // 2026-11-19 with the column read as a procedure's too: "expected
  // 'not-called' to be 'called'"; and with a NULL read as called:
  // "expected 'called' to be 'absent'".
  test('a function declared RETURNS NULL ON NULL INPUT is not called given a NULL, a procedure always is, and an unshown module says nothing', () => {
    const onNull = (routine: Partial<RoutineRow>) => {
      const [found] = routinesOf(rows(routine, [])).routines
      return found === undefined || !Object.hasOwn(found, 'onNull') ? 'absent' : found.onNull
    }
    expect(onNull({ type: 'FN', null_on_null_input: true })).toBe('not-called')
    expect(onNull({ type: 'FN', null_on_null_input: false })).toBe('called')
    expect(onNull({ type: 'TF', null_on_null_input: false })).toBe('called')
    expect(onNull({ type: 'FN', null_on_null_input: null })).toBe('absent')
    expect(onNull({ type: 'P', null_on_null_input: false })).toBe('called')
    expect(onNull({ type: 'P', null_on_null_input: true })).toBe('called')
    expect(onNull({ type: 'P', null_on_null_input: null })).toBe('called')
  })
})
