import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { AGREEMENT, agreementHash, readRecord, unsigned } from './check-cla.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('the CLA record', () => {
  // Editing CLA.md -- even a typo -- makes every recorded signature stale, and
  // the pull-request check would say so only when somebody next opens one.
  // This says so on the commit that changed the text, which is when the
  // maintainer can re-sign in the same change rather than being surprised later.
  test('every signature names the current text', () => {
    const hash = agreementHash(readFileSync(join(root, AGREEMENT), 'utf8'))
    const record = readRecord(root)
    expect(record.signatories.length).toBeGreaterThan(0)
    for (const signatory of record.signatories) {
      expect(signatory.agreement, `${signatory.name} signed an earlier version of ${AGREEMENT}`).toBe(hash)
    }
  })

  // The address this repository commits under is the one CLAUDE.md names. A
  // record that did not cover it would fail the first pull request.
  test('covers the maintainer', () => {
    const record = readRecord(root)
    const hash = agreementHash(readFileSync(join(root, AGREEMENT), 'utf8'))
    expect(unsigned({ authors: ['dbacher@gmail.com'], record, hash })).toEqual([])
  })
})

describe('agreementHash', () => {
  // A checkout with CRLF line endings must not read as changed terms.
  test('is the same over LF and CRLF', () => {
    expect(agreementHash('a\r\nb\r\n')).toBe(agreementHash('a\nb\n'))
  })
})

describe('unsigned', () => {
  const record = readRecord(root, {
    agreement: 'CLA.md',
    signatories: [
      { name: 'Signed', emails: ['Signed@Example.ch'], signed: '2026-10-08', agreement: 'sha256:current' },
      { name: 'Stale', emails: ['stale@example.ch'], signed: '2026-10-01', agreement: 'sha256:old' },
    ],
    machines: [{ name: 'bot', emails: ['bot@example.ch'], reason: 'cannot hold copyright' }],
  })

  // Addresses are not case-sensitive in git; a capitalised one is not a stranger.
  test('names the unsigned and the stale, and nobody else', () => {
    const out = unsigned({
      authors: ['signed@example.ch', 'STALE@example.ch', 'nobody@example.ch', 'bot@example.ch'],
      record,
      hash: 'sha256:current',
    })
    expect(out).toEqual([
      { email: 'STALE@example.ch', reason: 'stale' },
      { email: 'nobody@example.ch', reason: 'unsigned' },
    ])
  })

  // An empty range looks exactly like a passing one. It is refused instead.
  test('refuses a range with no authors rather than passing it', () => {
    expect(() => unsigned({ authors: ['', ' '], record, hash: 'sha256:current' })).toThrow(/refusing/)
  })
})
