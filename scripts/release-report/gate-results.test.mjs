import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { gateRecorder, recorded } from './gate-results.mjs'

/**
 * The browser gates' recorder (0035): what each gate leaves for the release
 * report, in a temporary directory, with a browser that is two functions.
 */
let dirs = []
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'formancy-data-gate-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

const read = (dir) => JSON.parse(readFileSync(join(dir, 'test-results', 'browser.json'), 'utf8'))

describe('a browser gate’s results', () => {
  // The report holds the browser to Playwright's pin and counts the checks;
  // a recorder that dropped a failed sentence would turn a red gate green in
  // the report while the log said FAIL.
  test('keep every check, the browser as it names itself, axe, the widths and what was measured', () => {
    const lines = []
    const gate = gateRecorder('apps/examples', { log: (line) => lines.push(line) })
    gate.launched({ name: () => 'chromium' }, { version: () => '153.0.8010.12' })
    gate.axe('4.14.0')
    gate.width(320)
    gate.width(320)
    gate.width(1440)
    gate.check('the page does not scroll sideways', null)
    gate.check('the first Tab reaches the skip link', 'focus went somewhere else first')
    gate.measure({ name: 'Chromium resent the create after its connection closed', value: 12.345, unit: 'ms' })
    const dir = scratch()
    const written = gate.write(dir)
    expect(read(dir)).toEqual(written)
    expect(written).toMatchObject({
      gate: 'apps/examples',
      browser: { name: 'chromium', version: '153.0.8010.12', headless: true },
      axe: '4.14.0',
      widths: [320, 1440],
      passes: 3,
      checks: { ok: 1, failed: ['the first Tab reaches the skip link: focus went somewhere else first'] },
      measurements: [{ name: 'Chromium resent the create after its connection closed', value: 12.345, unit: 'ms' }],
    })
    expect(written).not.toHaveProperty('error')
    expect(lines).toContain('  ok    the page does not scroll sideways')
    expect(lines).toContain('  FAIL  the first Tab reaches the skip link\n          focus went somewhere else first')
    expect(gate.failures()).toEqual(written.checks.failed)
  })

  // A gate that threw -- Chromium would not launch, the server would not
  // start -- and left nothing would read to the report as a gate nobody
  // ran. It leaves its file, with what ended it.
  test('are written, with the error, when the gate throws', async () => {
    const dir = scratch()
    await expect(
      recorded(
        'apps/host',
        async (gate) => {
          gate.check('signed out: no sideways scroll', null)
          throw new Error('could not launch Chromium')
        },
        dir,
      ),
    ).rejects.toThrow('could not launch Chromium')
    expect(read(dir)).toMatchObject({ gate: 'apps/host', error: 'could not launch Chromium', checks: { ok: 1, failed: [] }, browser: null })
  })
})
