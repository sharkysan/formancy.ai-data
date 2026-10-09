import { describe, expect, test } from 'vitest'
import { BODY_LIMIT, bodySection, releaseBody, releaseNotes } from './release-notes.mjs'

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

describe('releaseBody', () => {
  // The body is the version's notes, then what the release was tested on:
  // the report's summary, under a heading of its own.
  test('appends the report summary to the section', () => {
    expect(releaseBody(changelog, '0.1.0', '12 of 12 tests passed.\n')).toBe('## 0.1.0 — 2026-11-01\n\nfirst\n\n## What this release was tested on\n\n12 of 12 tests passed.\n')
  })

  // GitHub refuses a body over 125,000 characters with a 422 -- after npm
  // already holds the version, if nothing refused it first.
  test('throws over the 125,000 characters GitHub accepts, and not at them', () => {
    const fits = '## Unreleased\n\n' + 'x'.repeat(BODY_LIMIT - 64)
    const body = releaseBody(fits, 'Unreleased', 's')
    expect(body.length).toBeLessThanOrEqual(BODY_LIMIT)
    const padded = fits + 'x'.repeat(BODY_LIMIT - body.length)
    expect(releaseBody(padded, 'Unreleased', 's').length).toBe(BODY_LIMIT)
    expect(() => releaseBody(`${padded}x`, 'Unreleased', 's')).toThrow(/is 125001 characters, over the 125000/)
  })
})

describe('bodySection', () => {
  // A rehearsal on the release commit must render the body that will be
  // released, so it uses the version's section once the changelog has one.
  test('rehearses with the version’s section when there is one, and Unreleased otherwise', () => {
    expect(bodySection(changelog, { release: 'dry-run', version: '0.1.0' })).toBe('0.1.0')
    expect(bodySection(changelog, { release: 'dry-run', version: '0.2.0' })).toBe('Unreleased')
    expect(bodySection(changelog, { release: '', version: '0.2.0' })).toBe('Unreleased')
  })

  // A tag's notes are the tag's version's, whatever else the changelog holds.
  test('releases a tag with its version’s section', () => {
    expect(bodySection(changelog, { release: 'v0.0.1', version: '0.1.0' })).toBe('0.0.1')
  })
})
