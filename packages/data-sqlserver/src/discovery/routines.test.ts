import { describe, expect, test } from 'vitest'
import type { ParameterRow, RoutineRow } from './routines.js'
import { toRoutine } from './routines.js'

const ROW: RoutineRow = { object_id: 1, schema_name: 'sales', routine_name: 'ship_order', type: 'P', access_object: '[sales].[ship_order]', can_execute: 1 }

const PARAMETER: ParameterRow = {
  object_id: 1,
  parameter_id: 1,
  name: '@order_id',
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

describe('toRoutine', () => {
  // HAS_PERMS_BY_NAME answers NULL for a name it could not parse (B7). Read
  // as "no", a quoting slip would quietly mark a routine closed to its
  // account (0158); it is a defect, and the error names the routine.
  test('a NULL answer for EXECUTE is refused as a defect, naming the routine', () => {
    expect(() => toRoutine({ ...ROW, can_execute: null }, [PARAMETER])).toThrow('HAS_PERMS_BY_NAME could not resolve [sales].[ship_order] for EXECUTE')
    expect(toRoutine(ROW, [PARAMETER]).executable).toBe(true)
    expect(toRoutine({ ...ROW, can_execute: 0 }, [PARAMETER]).executable).toBe(false)
  })
})
