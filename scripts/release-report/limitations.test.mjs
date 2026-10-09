import { describe, expect, test } from 'vitest'
import { problemsHere, readRecords, registerProblems, stamp } from './limitations.mjs'

/**
 * The known-limitations register (0035), held to the decision records: an
 * entry for every record, read as the record stands now, and the rules each
 * entry keeps -- checked once on registers this file writes, and on the
 * committed one, because a validator that only ever saw fixtures proves
 * nothing about the file the report prints.
 */
const HASH = (digit) => `sha256:${digit.repeat(64)}`
const RECORDS = [
  { number: '0001', file: '0001-a.md', title: 'A', status: 'accepted', hash: HASH('1') },
  { number: '0002', file: '0002-b.md', title: 'B', status: 'superseded by 0003', hash: HASH('2') },
  { number: '0003', file: '0003-c.md', title: 'C', status: 'accepted; narrowed by 0004', hash: HASH('3') },
]
const OPTIONS = { covered: ['packages/data-core', 'apps/host'], exists: (path) => path !== 'apps/host/src/gone.test.tsx' }
const line = (says, extra = {}) => ({ area: 'forms', says, ...extra })
const register = (overrides = {}) => ({
  records: {
    '0001': { reviewed: HASH('1'), limitations: [line('A form is generated once.')] },
    '0002': { reviewed: HASH('2'), none: 'Superseded by 0003, which states what remains.' },
    '0003': { reviewed: HASH('3'), limitations: [line('A lookup is offset-paged.', { area: 'operations', heldBy: 'packages/data-core/src/page.test.ts' })] },
    ...overrides,
  },
})

describe('the register against the records', () => {
  // A clean register is clean: a check that is red on good input is noise.
  test('finds nothing wrong with a register that keeps every rule', () => {
    expect(registerProblems(register(), RECORDS, OPTIONS)).toEqual([])
  })

  // A record nobody read for limitations, or an entry for a record that is
  // gone, would be a register that silently stopped describing the records.
  test('needs an entry for every record, and a record for every entry', () => {
    const { '0001': _, ...rest } = register().records
    expect(registerProblems({ records: { ...rest, '0099': { reviewed: HASH('9'), none: 'x' } } }, RECORDS, OPTIONS)).toEqual([
      '0001 has no entry: read it and add its limitations, or why it has none',
      '0099 is in the register and no record has that number',
    ])
  })

  // A later record changing an old one's Status line is how a cost gets
  // answered; the line must be read again, not matched by wording.
  test('refuses an entry read before its record last changed, naming the command that stamps it', () => {
    const changed = RECORDS.map((record) => (record.number === '0003' ? { ...record, hash: HASH('4') } : record))
    expect(registerProblems(register(), changed, OPTIONS)).toEqual([
      '0003 changed since it was read: read it again, then run node scripts/release-report/limitations.mjs --stamp 0003',
    ])
  })

  // Each rule, broken once.
  test('refuses each way an entry can be malformed', () => {
    const problems = (overrides) => registerProblems(register(overrides), RECORDS, OPTIONS)
    expect(problems({ '0001': { reviewed: HASH('1'), limitations: [line('Once.')], none: 'and none' } })).toEqual(['0001 has both limitations and none; it needs exactly one'])
    expect(problems({ '0001': { reviewed: HASH('1'), limitations: [] } })).toEqual(['0001 has neither limitations nor none; it needs exactly one'])
    expect(problems({ '0002': { reviewed: HASH('2'), limitations: [line('Still costs.')] } })).toEqual(['0002 is superseded by 0003, so its limitations are a later record\'s: give it none'])
    expect(problems({ '0001': { reviewed: HASH('1'), limitations: [line('Wrong place.', { area: 'billing' })] } })).toEqual([
      "0001's limitation 1 has the area billing, which is not one of licence, databases, forms, access, writes, server, studio, host, operations, testing",
    ])
    expect(problems({ '0001': { reviewed: HASH('1'), limitations: [line('No full stop')] } })).toEqual(["0001's limitation 1 must say one sentence, ending with a full stop"])
    expect(problems({ '0001': { reviewed: HASH('1'), limitations: [line('A lookup is offset-paged.')] } })).toEqual(["0003's limitation 1 says what another line already says"])
    for (const heldBy of ['scripts/palette.test.mjs', 'packages/data-core/src/page.ts', 'apps/host/src/gone.test.tsx']) {
      expect(problems({ '0001': { reviewed: HASH('1'), limitations: [line('Held.', { heldBy })] } })).toEqual([
        `0001's limitation 1 is held by ${heldBy}, which is not a test file of a package with a suite`,
      ])
    }
  })

  // The committed register, against the committed records: every record on
  // main read as it is now -- 0020, 0023 and 0030 since 0033 changed their
  // Status lines included.
  test('holds for the repository as it stands', () => {
    expect(readRecords().length).toBeGreaterThan(30)
    expect(problemsHere()).toEqual([])
  })
})

describe('stamping a record as read', () => {
  // A stamp that rewrote the file -- or another record's hash -- would make
  // reading one record pass for reading several.
  test('rewrites that record’s hash and nothing else', () => {
    const text = `${JSON.stringify(register(), null, 2)}\n`
    const stamped = stamp(text, '0003', HASH('5'))
    expect(JSON.parse(stamped)).toEqual(register({ '0003': { ...register().records['0003'], reviewed: HASH('5') } }))
    const before = text.split('\n')
    expect(stamped.split('\n').filter((row, index) => row !== before[index])).toEqual([`      "reviewed": "${HASH('5')}",`])
    expect(() => stamp(text, '0042', HASH('5'))).toThrow(/no entry for 0042/)
  })
})
