import { describe, expect, test } from 'vitest'
import { releaseNotes } from './release-notes.mjs'

const changelog = ['# Changelog', '', '## Unreleased', '', 'pending', '', '## 0.1.0 — 2026-11-01', '', 'first', '', '## [0.0.1] — 2026-10-08', '', 'zero'].join('\n')

describe('releaseNotes', () => {
  // The body of a GitHub release is one version's section, and the release
  // step is the last one -- after the packages are on npm. An empty body there
  // is the failure this exists to prevent, so a missing section throws.
  test('throws when the version has no section', () => {
    expect(() => releaseNotes(changelog, '0.2.0')).toThrow(/no section for 0\.2\.0/)
  })

  // Both heading spellings the changelog uses, and the section stops at the
  // next release rather than running to the end of the file.
  test('returns exactly one version, in either heading spelling', () => {
    expect(releaseNotes(changelog, '0.1.0')).toBe('## 0.1.0 — 2026-11-01\n\nfirst')
    expect(releaseNotes(changelog, '0.0.1')).toBe('## [0.0.1] — 2026-10-08\n\nzero')
  })

  // "0.1.0" must not match a heading for "0.1.0-rc.1".
  test('does not match a version that merely starts with the digits', () => {
    const withRc = changelog.replace('## 0.1.0 —', '## 0.1.0-rc.1 —')
    expect(() => releaseNotes(withRc, '0.1.0')).toThrow()
  })
})
