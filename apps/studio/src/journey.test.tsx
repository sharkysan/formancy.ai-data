import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { audit, discover, generateOrder, goTo, signIn, step, unnamed, writeOrderPolicy } from './test-studio.js'
import type { User } from './test-studio.js'
import { OWNER_SNAPSHOT, startPlane, withoutColumn } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * The whole journey of plan section 3, as one administrator walks it, against
 * the real server: what holds across the steps rather than inside one.
 */
let plane: TestPlane

beforeEach(async () => {
  plane = await startPlane()
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

/** The routes of the administrator plane, and whoami. Nothing else is the studio's to call (0020, 0024). */
const ADMIN_PLANE = [
  /^GET \/v1\/whoami$/,
  /^GET \/v1\/connections$/,
  /^POST \/v1\/connections\/[^/]+\/test$/,
  /^GET \/v1\/connections\/[^/]+\/metadata$/,
  /^POST \/v1\/form-proposals$/,
  /^POST \/v1\/forms\/[^/]+\/versions$/,
  /^GET \/v1\/forms\/[^/]+\/versions\/latest$/,
  /^POST \/v1\/forms\/[^/]+\/drift$/,
  /^GET \/v1\/forms\/[^/]+\/versions$/,
  /^GET \/v1\/forms\/[^/]+\/versions\/\d+$/,
  /^POST \/v1\/forms\/[^/]+\/regenerations$/,
  /^POST \/v1\/forms\/[^/]+\/restorations$/,
]

/**
 * From a published version 1 to the Drift step's answers (0030): version 2
 * published, the drift checked, a restore of version 1 refused by a dropped
 * column and the database put back, version 1 restored, and the form
 * regenerated and taken up as the draft. `record` is called at each state.
 */
async function evolve(user: User, plane: TestPlane, record: (name: string) => Promise<void>): Promise<void> {
  const publish = await goTo(user, 'Publish')
  // Found, not got: the step reads which version is published before its button names one.
  await user.click(await within(publish).findByRole('button', { name: 'Publish version 2' }))
  await within(publish).findByText('Published version 2 of sales-order.')
  const drift = await goTo(user, 'Drift')
  plane.databases.set('fixture', withoutColumn(OWNER_SNAPSHOT, 'order', 'notes'))
  await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
  const versions = await within(drift).findByRole('region', { name: 'Versions of sales-order' })
  await user.click(await within(versions).findByRole('button', { name: 'Restore version 1' }))
  await within(versions).findByRole('alert')
  await record('Drift, a restore refused')
  plane.databases.set('fixture', OWNER_SNAPSHOT)
  await user.click(within(versions).getByRole('button', { name: 'Restore version 1' }))
  await within(versions).findByText(/^Restored version 1 as version 3/)
  await record('Drift, restored')
  await user.click(within(drift).getByRole('button', { name: 'Regenerate, keeping your presentation' }))
  const regenerated = await within(drift).findByRole('region', { name: 'Regenerated from version 3' })
  await record('Drift, regenerated')
  await user.click(within(regenerated).getByRole('button', { name: 'Continue to presentation' }))
  await screen.findByRole('region', { name: 'Carried from version 3' })
  await record('Presentation, carried')
}

describe('the journey', () => {
  // Every step, from connecting to drift, audited where it stands: one step
  // that broke the floor -- an unnamed control, two landmarks with one name,
  // a heading skipped -- fails here with the step it is on.
  test('every step passes axe and names every control', async () => {
    const user = await signIn(plane)
    const findings: Record<string, string[]> = {}
    const record = async (name: string) => {
      findings[name] = [...(await audit()), ...unnamed()]
    }
    await record('Connect')
    await discover(user)
    await record('Connect, discovered')
    await generateOrder(user)
    await record('Generate')
    await goTo(user, 'Choose')
    await record('Choose')
    await writeOrderPolicy(user)
    await record('Policy')
    await goTo(user, 'Presentation')
    await record('Presentation')
    await goTo(user, 'Preview')
    await record('Preview')
    const publish = await goTo(user, 'Publish')
    await user.click(await within(publish).findByRole('button', { name: 'Publish version 1' }))
    await within(publish).findByText('Published version 1 of sales-order.')
    await record('Publish')
    const drift = await goTo(user, 'Drift')
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    await within(drift).findByRole('region', { name: 'Version 1 of sales-order, against the database now' })
    await record('Drift')
    await evolve(user, plane, record)
    expect(findings).toEqual(Object.fromEntries(Object.keys(findings).map((name) => [name, []])))
  })

  // The studio talks to the administrator plane and to nothing else: no
  // record route, no lookup route, nothing outside /v1 -- through the
  // versions, regeneration and restore of 0030 too. A preview that
  // fetched customers through the runtime plane would be the studio writing
  // with a clerk's permissions.
  test('speaks only the administrator plane', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    await writeOrderPolicy(user)
    await goTo(user, 'Preview')
    const publish = await goTo(user, 'Publish')
    await user.click(await within(publish).findByRole('button', { name: 'Publish version 1' }))
    await within(publish).findByText('Published version 1 of sales-order.')
    await evolve(user, plane, async () => {})
    const calls = plane.requests.map((request) => `${request.method} ${request.path}`)
    expect(calls.filter((call) => !ADMIN_PLANE.some((route) => route.test(call)))).toEqual([])
    // Not vacuous: every route the journey has a reason to call, it called.
    // (Testing a connection is the one it skips.)
    const used = new Set(calls.map((call) => ADMIN_PLANE.findIndex((route) => route.test(call))))
    expect([...used].sort((a, b) => a - b)).toEqual([0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  // A step that cannot work yet is listed, disabled, and says what it waits
  // for: nothing is shown that does not work.
  test('lists the steps that wait, and what each waits for', async () => {
    await signIn(plane)
    const steps = screen.getByRole('navigation', { name: 'Steps' })
    const buttons = within(steps).getAllByRole('button')
    expect(buttons.map((button) => [button.textContent, (button as HTMLButtonElement).disabled])).toEqual([
      ['1. Connect', false],
      ['2. Choose', true],
      ['3. Generate', true],
      ['4. Policy', true],
      ['5. Presentation', true],
      ['6. Preview', true],
      ['7. Publish', true],
      ['8. Drift', false],
    ])
    expect(within(steps).getByRole('button', { name: '2. Choose' }).getAttribute('aria-describedby')).not.toBeNull()
    expect(step('Connect')).toBeTruthy()
    // The step's heading takes focus, so a keyboard starts where the step does.
    expect(document.activeElement?.textContent).toBe('Connect')
  })
})
