// The studio's README pictures (0038): the studio scenes of
// scripts/pictures/scenes.json, taken -- or, with --check, walked and their
// text compared -- by scripts/pictures/session.mjs. Its header says the
// arguments; the camera's says what it reads from the DOM and why.
//
// The plane is the studio gate's kind: the real createDataServer with its
// administrator plane, the audit sink the plane requires and discards, and a
// fake connection registry over the committed captured snapshots, each read
// back against its fingerprint. `pg` answers as postgres-writer.json -- the
// order form's own account, the getting-started guide's `pg` -- and
// `ms-reader` as sqlserver-reader.json, an account without VIEW DEFINITION.
// ada and grace are both administrators with no attributes, so the conflict
// in the Publish scene comes from another actor in the trail (0033). Values
// come from journey.json's PostgreSQL form. No Docker.
//
// The induced states, as the captions say: grace's publish is a real request
// to the same server, required to answer 201; the drift is the writer
// snapshot with `notes` renamed in place by @formancy/data-fixtures'
// `renamedColumn`, which both adapters' discovery suites hold equal to what
// discovery reports after a real rename.
//
// One session: ada signs in, then the acts run in scenes.json's order, each
// starting where the last one left the studio. Elements are found by role and
// accessible name. One exception: the host token is a password field, which
// has no role, so it is found by its label.
//
// `pnpm --filter @formancy/data-studio pictures`, after `pnpm build`; the
// root's `pnpm pictures` runs it with the others.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSnapshot } from '@formancy/data-core'
import { renamedColumn } from '@formancy/data-fixtures'
import { createDataServer, createFileConfigurationStore } from '@formancy/data-server'
import journey from '../../../scripts/getting-started/journey.json' with { type: 'json' }
import { STUDIO, stepTitle } from '../../../scripts/getting-started/walk.mjs'
import { pictures, said, untilSnapshot } from '../../../scripts/pictures/session.mjs'

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const ORIGIN = 'http://studio.invalid'
const TOKENS = { ada: 'pictures-studio-ada', grace: 'pictures-studio-grace' }

/** How long a step may take to answer: Playwright's default, which the studio gate's waits run under. */
const WITHIN = 30_000

const [FORM] = journey.forms
const ROOT = `${FORM.root.schema}.${FORM.root.name}`
const [LOOKUP] = FORM.lookups

/** A captured snapshot as the suite reads it: refused when it is not what its fingerprint says. */
function readSnapshot(name) {
  const { fingerprint, ...contents } = JSON.parse(readFileSync(join(app, 'src', 'fixtures', name), 'utf8'))
  const recomputed = createSnapshot(contents)
  if (recomputed.fingerprint !== fingerprint) throw new Error(`src/fixtures/${name} is not the snapshot its fingerprint names: it was edited by hand`)
  return recomputed
}

const WRITER = readSnapshot('postgres-writer.json')
const READER = readSnapshot('sqlserver-reader.json')

/** The plane: `databases` is what each connection discovers now, mutable so an act can drift `pg`. */
async function startPlane() {
  const databases = new Map([
    [FORM.connection, WRITER],
    ['ms-reader', READER],
  ])
  const registry = {
    ids: () => [...databases.keys()].sort(),
    scope: (id) => (databases.has(id) ? { schemas: ['sales'] } : undefined),
    open: async (id) => {
      const now = databases.get(id)
      if (now === undefined) return undefined
      return { adapter: { kind: now.kind, ping: async () => ({ kind: now.kind, version: now.serverVersion }), discover: async () => databases.get(id), close: async () => {} }, lookups: {}, records: {} }
    },
    close: async () => {},
  }
  const verifyIdentity = async (token) => {
    const actor = Object.keys(TOKENS).find((name) => TOKENS[name] === token)
    return actor === undefined ? { ok: false, reason: 'ERR_JWS_INVALID' } : { ok: true, identity: { actor: { id: actor, roles: ['data-admin'] }, attributes: {} } }
  }
  const root = mkdtempSync(join(tmpdir(), 'formancy-data-studio-pictures-'))
  const server = await createDataServer({ verifyIdentity, admin: { registry, store: createFileConfigurationStore(root), adminRoles: ['data-admin'], audit: { sink: () => {} } } })
  const as = async (who, method, url, payload) => server.inject({ method, url, headers: { authorization: `Bearer ${TOKENS[who]}` }, ...(payload === undefined ? {} : { payload }) })
  return { server, databases, as, close: async () => { await server.close(); rmSync(root, { recursive: true, force: true }) } }
}

/**
 * The step `step` names, as the Steps list numbers it, after pressing its
 * entry unless the studio is already on it. Refuses when the list has no
 * entry of exactly that name, so a reorder or a rename fails the check
 * instead of leaving a caption with a stale step number.
 */
async function at(page, step, { go = true } = {}) {
  const entry = page.getByRole('navigation', { name: STUDIO.steps }).getByRole('button', { name: step, exact: true })
  if ((await entry.count()) !== 1) throw new Error(`the Steps list has no entry "${step}", which the scene's caption leads with`)
  if (go) await entry.click()
  const main = page.getByRole('main', { name: stepTitle(step), exact: true })
  await main.waitFor()
  return main
}

const discover = async (here, connection) => {
  await here.getByRole('group', { name: connection, exact: true }).getByRole('button', { name: `Discover ${connection}`, exact: true }).click()
  const seen = here.getByRole('region', { name: `What ${connection} can see`, exact: true })
  await seen.waitFor()
  return seen
}

/** Version 1 chosen under "Version to restore" -- which defaults to the newest older version -- and its restore pressed. */
async function restoreVersion1(here) {
  const versions = here.getByRole('region', { name: `Versions of ${FORM.formId}`, exact: true })
  await versions.getByRole('combobox', { name: 'Version to restore', exact: true }).selectOption({ label: 'Version 1' })
  await versions.getByRole('button', { name: 'Restore version 1', exact: true }).click()
  return versions
}

function actsOver(plane, scenes) {
  const stepOf = (id) => scenes.find((scene) => scene.id === id).step
  return {
    'studio-connect': async (page, scene) => {
      const here = await at(page, scene.step, { go: false })
      const seen = await discover(here, 'ms-reader')
      // The caption says what the catalog hid comes first; with no gap there is nothing to say it of.
      const gaps = await seen.getByRole('list', { name: 'What this connection could not see', exact: true }).getByRole('listitem').count()
      if (gaps === 0) throw new Error('ms-reader could see everything, so the picture shows no gap')
      return { parts: { Seen: seen } }
    },

    'studio-choose': async (page, scene) => {
      await discover(await at(page, stepOf('studio-connect'), { go: false }), FORM.connection)
      await page.getByRole('button', { name: 'Choose a root', exact: true }).click()
      const here = await at(page, scene.step, { go: false })
      await here.getByRole('combobox', { name: 'Root table or view', exact: true }).selectOption(ROOT)
      await here.getByRole('textbox', { name: 'Form id', exact: true }).fill(FORM.formId)
      await here.getByRole('textbox', { name: 'Title', exact: true }).fill(FORM.title)
      await here.getByRole('checkbox', { name: `Offer ${LOOKUP.foreignKey} as a lookup`, exact: true }).check()
      const columns = here.getByRole('group', { name: `Columns to show for ${LOOKUP.foreignKey}`, exact: true })
      for (const column of LOOKUP.display) {
        if (!(await columns.getByRole('checkbox', { name: column, exact: true }).isChecked())) throw new Error(`${column} is not ticked to show for ${LOOKUP.foreignKey}, as the alt says it is`)
      }
      return { parts: { Lookups: here.getByRole('group', { name: 'Foreign keys to offer as lookups', exact: true }) } }
    },

    'studio-generate': async (page, scene) => {
      const choose = page.getByRole('main', { name: stepTitle(stepOf('studio-choose')), exact: true })
      for (const column of FORM.pinned) {
        await choose.getByRole('checkbox', { name: `Pin ${column}`, exact: true }).check()
        const attribute = await choose.getByRole('textbox', { name: `Attribute ${column} is pinned to`, exact: true }).inputValue()
        const wanted = journey.policy.rowFilters.find((rule) => rule.column === column).attribute
        if (attribute !== wanted) throw new Error(`${column} is pinned to ${attribute}, not to journey.json's ${wanted}`)
      }
      await choose.getByRole('combobox', { name: 'Version column', exact: true }).selectOption(FORM.versionColumn)
      await choose.getByRole('button', { name: 'Generate the form', exact: true }).click()
      const here = await at(page, scene.step, { go: false })
      return { parts: { Chose: here.getByRole('region', { name: STUDIO.chose, exact: true }) } }
    },

    'studio-policy': async (page, scene) => {
      const here = await at(page, scene.step)
      for (const operation of ['read', 'create', 'update']) await here.getByRole('textbox', { name: `Roles that may ${operation}`, exact: true }).fill(journey.policy.operations[operation].join(', '))
      await here.getByRole('button', { name: 'Fill every field from the operations', exact: true }).click()
      await here.getByText(STUDIO.fits, { exact: true }).waitFor()
      return { parts: { Rows: here.getByRole('group', { name: `Row filters on ${ROOT}`, exact: true }), Lookup: here.getByRole('group', { name: 'Rows the Customer list may offer', exact: true }) } }
    },

    'studio-presentation': async (page, scene) => {
      const here = await at(page, scene.step)
      await here.getByRole('textbox', { name: 'Label of notes', exact: true }).fill('Remarks')
      await here.getByRole('checkbox', { name: 'Full width for Remarks', exact: true }).check()
      await here.getByRole('textbox', { name: 'Label of status', exact: true }).fill('')
      // The move last, so the toolbar's status says it when the picture is taken.
      await here.getByRole('button', { name: 'Move down Customer', exact: true }).click()
      const said = here.getByRole('status')
      await said.filter({ hasText: 'Moved Customer down.' }).waitFor()
      const order = here.getByRole('region', { name: 'Order', exact: true })
      // The whole section, its rows framed by its own border, and the toolbar
      // above it: a run of rows alone had the rows around them in its margin,
      // and showed no move -- the order of two rows looks like any order.
      const parts = { Undo: here.getByRole('button', { name: 'Undo', exact: true }), Redo: here.getByRole('button', { name: 'Redo', exact: true }), Said: said, Order: order }
      await untilSnapshot(order, /textbox "Label of order_date"[\s\S]*textbox "Label of customer"/, { within: WITHIN, what: 'Customer below Order date' })
      await untilSnapshot(order, /textbox "Label of status" \[invalid\]/, { within: WITHIN, what: 'the refusal of the emptied label' })
      const notes = await here.getByRole('textbox', { name: 'Label of notes', exact: true }).inputValue()
      if (notes !== 'Remarks') throw new Error(`the label of notes is ${notes}, not Remarks`)
      return { parts }
    },

    'studio-preview': async (page, scene) => {
      await page.getByRole('main', { name: stepTitle(stepOf('studio-presentation')), exact: true }).getByRole('textbox', { name: 'Label of status', exact: true }).fill('Status')
      const here = await at(page, scene.step)
      await here.getByRole('button', { name: 'Validate', exact: true }).click()
      await untilSnapshot(here, /\[invalid\]/, { within: WITHIN, what: "the preview's refusal" })
      return { parts: { Preview: here } }
    },

    'studio-publish-conflict': async (page, scene) => {
      const here = await at(page, scene.step)
      await here.getByRole('button', { name: 'Publish version 1', exact: true }).click()
      await here.getByText(`Published version 1 of ${FORM.formId}.`, { exact: true }).waitFor()
      // grace, from the same server: version 1 read and published again over it.
      const latest = await plane.as('grace', 'GET', `/v1/forms/${FORM.formId}/versions/latest`)
      const theirs = await plane.as('grace', 'POST', `/v1/forms/${FORM.formId}/versions`, { expectedBase: 1, bundle: latest.json().bundle })
      if (latest.statusCode !== 200 || theirs.statusCode !== 201) throw new Error(`grace's publish answered ${String(latest.statusCode)} and ${String(theirs.statusCode)}, not 200 and 201`)
      await here.getByRole('button', { name: 'Publish version 2', exact: true }).click()
      await here.getByRole('button', { name: 'Rebase on version 2', exact: true }).waitFor()
      return { parts: { Publish: here } }
    },

    'studio-drift': async (page, scene) => {
      const publish = page.getByRole('main', { name: stepTitle(stepOf('studio-publish-conflict')), exact: true })
      await publish.getByRole('button', { name: 'Rebase on version 2', exact: true }).click()
      await publish.getByRole('button', { name: 'Publish over version 2', exact: true }).click()
      await publish.getByText(`Published version 3 of ${FORM.formId}.`, { exact: true }).waitFor()
      // The caption's "restoring version 1, which still binds notes": version 3 is ada's, with Remarks.
      const three = (await plane.as('ada', 'GET', `/v1/forms/${FORM.formId}/versions/latest`)).json()
      const label = three.bundle.presentation.fields.find((entry) => entry.field === 'notes')?.label
      if (three.version !== 3 || !JSON.stringify(label ?? '').includes('Remarks')) throw new Error(`the latest version is ${String(three.version)} with notes labelled ${JSON.stringify(label)}, not version 3 with Remarks`)
      plane.databases.set(FORM.connection, renamedColumn(WRITER, FORM.root, 'notes', 'memo'))
      const here = await at(page, scene.step)
      await here.getByRole('button', { name: 'Check drift', exact: true }).click()
      await here.getByRole('region', { name: `Version 3 of ${FORM.formId}, against the database now`, exact: true }).waitFor()
      await (await restoreVersion1(here)).getByRole('alert').waitFor()
      return { parts: { Drift: here } }
    },

    'studio-regenerated': async (page) => {
      const here = page.getByRole('main', { name: stepTitle(stepOf('studio-drift')), exact: true })
      await here.getByRole('button', { name: 'Regenerate, keeping your presentation', exact: true }).click()
      const regenerated = here.getByRole('region', { name: /^Regenerated from version 3$/ })
      await regenerated.waitFor()
      return { parts: { Regenerated: regenerated } }
    },

    'studio-carried': async (page) => {
      await page.getByRole('button', { name: 'Continue to presentation', exact: true }).click()
      const here = page.getByRole('main', { name: stepTitle(stepOf('studio-presentation')), exact: true })
      const carried = here.getByRole('region', { name: /^Carried from version 3$/ })
      await carried.waitFor()
      return { parts: { Carried: carried } }
    },

    'studio-restored': async (page) => {
      plane.databases.set(FORM.connection, WRITER)
      const here = await at(page, stepOf('studio-drift'))
      await here.getByRole('button', { name: 'Check drift', exact: true }).click()
      const versions = await restoreVersion1(here)
      await versions.getByRole('status').filter({ hasText: /^Restored version 1 as version \d+/ }).waitFor()
      return { parts: { Versions: versions } }
    },
  }
}

const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))
let plane
try {
  const { chromium } = await import('playwright')
  plane = await startPlane()
  const scenes = JSON.parse(readFileSync(join(app, '..', '..', 'scripts', 'pictures', 'scenes.json'), 'utf8'))
  await pictures({
    app: 'studio',
    chromium,
    playwright: require('playwright/package.json').version,
    width: 1200,
    css: { directory: join(app, 'src'), entry: 'studio.css' },
    themes: manifest.dependencies['@formancy/themes'],
    origin: ORIGIN,
    dist: join(app, 'dist'),
    inject: (request) => plane.server.inject(request),
    within: WITHIN,
    secrets: Object.values(TOKENS),
    database: `the captured snapshots apps/studio/src/fixtures/postgres-writer.json (PostgreSQL ${WRITER.serverVersion}) and sqlserver-reader.json (SQL Server ${READER.serverVersion})`,
    open: async (page) => {
      await page.goto(`${ORIGIN}/`)
      await page.getByLabel(STUDIO.token, { exact: true }).fill(TOKENS.ada)
      await page.getByRole('button', { name: STUDIO.signIn, exact: true }).click()
      await page.getByRole('navigation', { name: STUDIO.steps }).waitFor()
    },
    acts: actsOver(plane, scenes),
  })
} catch (error) {
  console.error(`studio pictures: ${said(error, Object.values(TOKENS))}`)
  process.exitCode = 1
} finally {
  await plane?.close()
}
