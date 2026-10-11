import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { readBlock } from './generated-block.mjs'
import { GENERATOR, gateProblems, linkFrom, readLicence, render, stale } from './licence-status.mjs'
import { readGates } from './release-report/gates.mjs'

/**
 * What a document says of the licence's state, derived from LICENSE.md
 * (0048, 0054): its version, that it is in force and from when, that no
 * lawyer has reviewed it, and where a production licence is requested. Read
 * from the licence's own version line and its section on obtaining a
 * production licence, never from what another document's wording happens to
 * be.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

/** A licence with `head` as its version line and `section` as its section on a production licence. */
const licence = (head, section = '## 9. Obtaining a production licence\n\nProduction licences are requested from the Rightsholder at info@formancy.ai.\n') =>
  `# Formancy Data Source-Available Licence\n\n${head}\n\nThis text states the terms.\n\n## 8. No warranty\n\nAS IS.\n\n${section}\n## 10. Governing law\n\nSwiss law.\n`

const VERSION_1 = '**Version 1 — in force from 11 October 2026. Not reviewed by a lawyer.**'
const VERSION_1_1 = '**Version 1.1 — in force from 11 October 2026. Not reviewed by a lawyer.**'
const VERSION_1_1_SECTION =
  '## 9. Obtaining a production licence\n\nProduction licences are requested from the Rightsholder at info@formancy.ai.\nThe separate commercial agreement that Redistribution requires, which section 3\ndescribes, is requested at the same address.\n'
const VERSION_0 = '**Version 0 — DRAFT of 8 October 2026. Not yet reviewed by a lawyer.**'
const VERSION_0_SECTION = "## 9. Obtaining a production licence\n\nThe Software is new and has no published price. Until it does, write to the\nRightsholder through the repository's contact details.\n"

describe('reading the licence', () => {
  // The line at the top, and the one address its section 9 names, are what
  // every document's block is rendered from. Version 1.1 (0054) put a minor
  // number in the line: read as a whole number only, the licence in force
  // would be refused and every block left saying Version 1. The version is
  // kept as written, so a 1.10 is not rendered as the 1.1 a number makes of
  // it.
  test('reads the version line of the licence in force, N or N.N, with the address its section names', () => {
    expect(readLicence(licence(VERSION_1_1, VERSION_1_1_SECTION))).toEqual({ version: '1.1', date: '11 October 2026', section: 9, address: 'info@formancy.ai' })
    expect(readLicence(licence(VERSION_1))).toEqual({ version: '1', date: '11 October 2026', section: 9, address: 'info@formancy.ai' })
    expect(readLicence(licence('**Version 1.10 — in force from 1 December 2026. Not reviewed by a lawyer.**')).version).toBe('1.10')
  })

  // The licence is in force (0048). A draft's line rendered into the README
  // would let LICENSE.md go back to a draft with every gate green; refusing
  // it fails test:repo instead. A reviewed licence's line is refused too:
  // what the documents say of one is decided when it exists, not assumed
  // here. A line nobody wrote would otherwise render a guess.
  test('refuses a draft, a reviewed licence, and a version line it does not read', () => {
    expect(() => readLicence(licence(VERSION_0, VERSION_0_SECTION))).toThrow(/version line, \*\*Version 0 — DRAFT of 8 October 2026\. Not yet reviewed by a lawyer\.\*\*, is not one scripts\/licence-status\.mjs reads/)
    expect(() => readLicence(licence(VERSION_0))).toThrow(/is not one scripts\/licence-status\.mjs reads/)
    expect(() => readLicence(licence('**Version 2 — in force from 1 December 2026. Reviewed by a lawyer.**'))).toThrow(/is not one scripts\/licence-status\.mjs reads/)
    expect(() => readLicence(licence('**Version 1.1 — DRAFT of 11 October 2026. Not yet reviewed by a lawyer.**'))).toThrow(/is not one scripts\/licence-status\.mjs reads/)
    expect(() => readLicence(licence('**Version 1.1 — in force from 1 December 2026. Reviewed by a lawyer.**'))).toThrow(/is not one scripts\/licence-status\.mjs reads/)
    expect(() => readLicence(licence('**Version 1 — in force from 31 Octember 2026. Not reviewed by a lawyer.**'))).toThrow(/is not one/)
    expect(() => readLicence(licence('**Version 1.1.1 — in force from 11 October 2026. Not reviewed by a lawyer.**'))).toThrow(/is not one/)
    expect(() => readLicence(licence('**Version 1. — in force from 11 October 2026. Not reviewed by a lawyer.**'))).toThrow(/is not one/)
    expect(() => readLicence(licence('Some preamble.'))).toThrow(/no version line under its title/)
  })

  // A licence in force that does not say where a production licence is had
  // would put "can be had" in the documents with nowhere to go; two
  // addresses leave the documents to pick one. Version 1.1 names the address
  // for the agreement Redistribution requires in the same section (0054), so
  // that agreement given an address of its own there is refused too.
  test('refuses a licence with no address for a production licence, or two', () => {
    expect(() => readLicence(licence(VERSION_1, VERSION_0_SECTION))).toThrow(/'s section 9 names no address/)
    expect(() => readLicence(licence(VERSION_1, ''))).toThrow(/has no section "Obtaining a production licence"/)
    expect(() => readLicence(licence(VERSION_1, '## 9. Obtaining a production licence\n\nWrite to a@formancy.ai or b@formancy.ai.\n'))).toThrow(
      /names 2 addresses: a@formancy\.ai, b@formancy\.ai/,
    )
    expect(() =>
      readLicence(
        licence(
          VERSION_1_1,
          '## 9. Obtaining a production licence\n\nProduction licences are requested at info@formancy.ai.\nThe separate commercial agreement that Redistribution requires is requested at sales@formancy.ai.\n',
        ),
      ),
    ).toThrow(/names 2 addresses: info@formancy\.ai, sales@formancy\.ai/)
  })
})

describe('what a document says', () => {
  // The sentence is the licence's facts and nothing else, linked from where
  // the document is.
  test('renders the version, its date, the review and the address, linked from the document', () => {
    expect(render(readLicence(licence(VERSION_1_1, VERSION_1_1_SECTION)), linkFrom('README.md'))).toBe(
      '[`LICENSE.md`](./LICENSE.md) has the terms. It is Version 1.1, in force from 11 October 2026, and says at the top that no lawyer has reviewed it. A production licence is requested from [info@formancy.ai](mailto:info@formancy.ai), as its section 9 says.',
    )
    expect(render(readLicence(licence(VERSION_1_1, VERSION_1_1_SECTION)), linkFrom('docs/deploy/cloudflare.md'))).toBe(
      '[`LICENSE.md`](../../LICENSE.md) has the terms. It is Version 1.1, in force from 11 October 2026, and says at the top that no lawyer has reviewed it. A production licence is requested from [info@formancy.ai](mailto:info@formancy.ai), as its section 9 says.',
    )
  })
})

describe('the repository', () => {
  // The README naming another version, date or address than the licence's,
  // or LICENSE.md going back to a draft, is the drift this exists to stop.
  // Watched failing on 2026-10-11 with section 9's address changed (README.md
  // named stale) and with LICENSE.md's version line put back to Version 0's
  // (the line refused, whatever the README says); and, for 0054, with
  // LICENSE.md at Version 1.1 before the script read a minor number (the line
  // refused) and after it did, before --write (README.md and
  // docs/deploy/cloudflare.md named stale).
  test('every document holding the block says what LICENSE.md says, README.md among them', () => {
    expect(readBlock(readFileSync(join(repo, 'README.md'), 'utf8'), GENERATOR)).not.toBe('')
    expect(
      stale(repo).map(({ file }) => file),
      'run node scripts/licence-status.mjs --write',
    ).toEqual([])
  })

  // Gate 10 needs a lawyer's review of LICENSE.md. The only version line
  // this script reads says no lawyer has reviewed it, and readLicence throws
  // on any other, so while this passes the release report must not show that
  // gate as anything but open. Watched failing with gate 10 given the
  // evidence of a document. That gate 10's open reason names the review is
  // held by review, not here.
  test('keeps gate 10 open while the licence says no lawyer has reviewed it', () => {
    expect(() => readLicence(readFileSync(join(repo, 'LICENSE.md'), 'utf8'))).not.toThrow()
    expect(gateProblems(readGates(repo))).toEqual([])
    expect(gateProblems({ gates: [{ gate: 10, evidence: [{ document: 'LICENSE.md' }] }] })).toEqual([
      'gate 10 has evidence, but LICENSE.md says no lawyer has reviewed it, and that review is what gate 10 waits for: give it its open reason back',
    ])
    expect(gateProblems({ gates: [] })).toEqual(['gate 10 is not in docs/release/gates.json'])
  })
})
