import { describe, expect, test } from 'vitest'
import { entry, pictureOf, serialize } from './record.mjs'
import {
  END,
  guardProblems,
  integrityProblems,
  linkProblems,
  lookProblems,
  orphanProblems,
  quoteProblems,
  regionProblems,
  render,
  repository,
  rewrite,
  shapeProblems,
  START,
} from './readme.mjs'

/**
 * The README's pictures, held in `pnpm test:repo` without a browser (0038).
 *
 * The first block is the gate: the repository as it is. Every check returns
 * the sentences that are wrong with it, and passes only when there are none.
 * The second block shows each check failing on the change it exists for --
 * the BRIEF's list, made to a small repository built here -- so a check that
 * had quietly stopped checking anything would fail there, not pass here.
 */

describe("the repository's README pictures", () => {
  const here = repository()

  // A caption or a recorded size edited without `readme.mjs --write`, or a
  // region's markers lost in an edit of README.md, would leave the README
  // showing what no capture made, or nothing at all, and saying it is held.
  test('are the regions README.md shows, as scenes.json and captured.json render them', () => {
    expect(regionProblems(here)).toEqual([])
  })

  // A picture edited, recompressed or deleted by hand would still have a
  // record saying it was taken from the page, and the README would show it.
  test('each have a record, and a file whose bytes are the record\'s', () => {
    expect(integrityProblems(here)).toEqual([])
  })

  // A picture left behind by a removed scene is committed weight nothing
  // shows; a record without a scene holds a picture to no caption.
  test('are all the pictures directory holds, and all the record holds', () => {
    expect(orphanProblems(here)).toEqual([])
  })

  // A caption that quotes a sentence its picture's parts do not say is the
  // stale picture this whole arrangement exists to prevent.
  test('have captions and alts that quote only what their parts say, in the parts they name', () => {
    expect(quoteProblems(here)).toEqual([])
  })

  // Two machines' pictures side by side differ in fonts and rendering, and
  // the README would show the product in two looks with no change to explain it.
  test('were taken on one look', () => {
    expect(lookProblems(here)).toEqual([])
  })

  // A decision record renamed or renumbered leaves a caption linking nowhere.
  test('link only files that exist', () => {
    expect(linkProblems(here)).toEqual([])
  })

  // A scene whose app has no pictures script is taken and checked by nothing;
  // a step that is not "<number>. <name>" cannot be found in the Steps list.
  test('are scenes of the right shape, each taken by its app\'s script', () => {
    expect(shapeProblems(here)).toEqual([])
  })

  // An app script with no scene would run a --check that compares nothing,
  // and a region with no picture would pass the region check empty.
  test('leave no app script without a scene and no region without a picture', () => {
    expect(guardProblems(here)).toEqual([])
  })
})

/*
 * A small repository: one hero, an inline scene with a step and two `more`
 * scenes after it, a host `more` scene, and an examples scene. Its snapshot
 * lines are written by hand in the shapes Playwright prints.
 */
const LOOK = { platform: 'linux-x64', playwright: '1.63.0', chromium: '153.0.8010.12', fonts: { Archivo: 'v25', 'IBM Plex Mono': 'v20', 'IBM Plex Sans': 'v23' } }
const SETTINGS = { width: 1200, height: 900, deviceScaleFactor: 2, locale: 'en-US', timezoneId: 'UTC' }
const LINK = './docs/decisions/0008-exact-values-travel-as-strings.md'
/** What the hero line links: the recipe, which says how the pictures are taken and what nothing checks. */
const RECIPE = 'docs/images/README.md'

function scenes() {
  return [
    {
      id: 'host-loaded',
      app: 'host',
      placement: 'hero',
      title: 'One record, both renderers',
      caption: `Its id, “9007199254740993”, and its amount, “99999999999999.9999”, digit for digit ([0008](${LINK})).`,
      alt: 'The record bar saying “Loaded record k1:9007199254740993 into both forms.” above two forms.',
      quotes: { '9007199254740993': ['React', 'Angular'], '99999999999999.9999': ['React', 'Angular'], 'Loaded record k1:9007199254740993 into both forms.': ['Record'] },
    },
    { id: 'examples-order', app: 'examples', placement: 'inline', title: 'Both renderers', caption: 'Refused with “pattern”.', alt: 'Two forms.', quotes: { pattern: ['React'] } },
    { id: 'studio-drift', app: 'studio', placement: 'inline', title: 'Drift', step: '8. Drift', caption: 'The rename is a “possible-rename”.', alt: 'The Drift step: “3 changes, 1 blocking.”', quotes: { 'possible-rename': ['Drift'], '3 changes, 1 blocking.': ['Drift'] } },
    { id: 'studio-regenerated', app: 'studio', placement: 'more', title: 'Regenerated', caption: '“Nothing is published until you publish it.”', alt: 'A panel.', quotes: { 'Nothing is published until you publish it.': ['Regenerated'] } },
    { id: 'studio-restored', app: 'studio', placement: 'more', title: 'Restored', caption: '“The database was not changed.”', alt: 'The versions panel.', quotes: { 'The database was not changed.': ['Versions'] } },
    { id: 'host-other-tenant', app: 'host', placement: 'more', title: "Another tenant's record", caption: 'otto: “No such record.”', alt: 'An alert “No such record.”', quotes: { 'No such record.': ['Record'] } },
  ]
}

const TEXT = {
  'host-loaded': {
    Record: '- region "Record":\n  - status: Loaded record k1:9007199254740993 into both forms.',
    React: '- region "React":\n  - textbox "Id" [disabled]: "9007199254740993"\n  - textbox "Amount*": "99999999999999.9999"',
    Angular: '- region "Angular":\n  - textbox "Id" [disabled]: "9007199254740993"\n  - textbox "Amount*": "99999999999999.9999"',
  },
  'examples-order': { React: '- region "sales.order React":\n  - textbox "Amount*" [invalid]: "12.34567"\n  - text: pattern' },
  'studio-drift': { Drift: '- main "Drift":\n  - status: 3 changes, 1 blocking.\n  - code: possible-rename' },
  'studio-regenerated': { Regenerated: '- region "Regenerated from version 3":\n  - paragraph: Nothing is published until you publish it.' },
  'studio-restored': { Versions: '- region "Versions of pg-order":\n  - status: Restored version 1 as version 4. The database was not changed.' },
  'host-other-tenant': { Record: '- region "Record":\n  - alert: No such record.' },
}

/** The small repository, every check passing: what the README regions, the record and the files are after a capture. */
function fixture() {
  const list = scenes()
  const files = new Map()
  const record = {}
  for (const scene of list) {
    const picture = Buffer.from(`the picture of ${scene.id}`)
    files.set(pictureOf(scene.id), picture)
    record[scene.id] = entry(scene.id, { captured: '2026-10-09', settings: SETTINGS, clip: { x: 0, y: 0, width: 842, height: 400 }, picture, look: structuredClone(LOOK), database: 'captured snapshots', stylesheet: 'sha256 0', text: TEXT[scene.id] })
  }
  const skeleton = ['# Formancy Data', '', 'Intro.', '', START('hero'), END, '', '## Examples', '', START('examples'), END, '', '## Studio', '', START('studio'), END, '', '## Host', '', START('host'), END, ''].join('\n')
  return {
    scenes: list,
    record,
    recordText: serialize(record, list),
    readme: rewrite(skeleton, list, record),
    listing: ['captured.json', ...list.map((scene) => `${scene.id}.webp`)],
    file: (path) => files.get(path),
    exists: (path) => [LINK.slice(2), RECIPE].includes(path) || files.has(path),
    appScripts: ['examples', 'host', 'studio'],
    files,
  }
}

const ALL = { regionProblems, integrityProblems, orphanProblems, quoteProblems, lookProblems, linkProblems, shapeProblems, guardProblems }

describe('each check, on a small repository', () => {
  // The guard on the guards below: the unchanged small repository passes
  // every check, so each failure below is the change it names and nothing else.
  test('passes every check as a capture leaves it', () => {
    const state = fixture()
    for (const [name, check] of Object.entries(ALL)) expect(check(state), name).toEqual([])
  })

  // The format README.md shows, pinned: the picture at its recorded CSS width
  // with its alt, the italic caption led by the step, and a run of `more`
  // scenes folded into one <details> whose summary is their titles.
  test('renders a region in the order scenes.json gives, with runs of more scenes folded', () => {
    const { scenes: list, record } = fixture()
    expect(render(list, record).studio).toBe(
      [
        '<img src="./docs/images/readme/studio-drift.webp" width="842" alt="The Drift step: “3 changes, 1 blocking.”">',
        '',
        '**Step 8, Drift.** *The rename is a “possible-rename”.*',
        '',
        '<details>',
        '<summary>More: Regenerated, Restored</summary>',
        '',
        '<img src="./docs/images/readme/studio-regenerated.webp" width="842" alt="A panel.">',
        '',
        '*“Nothing is published until you publish it.”*',
        '',
        '<img src="./docs/images/readme/studio-restored.webp" width="842" alt="The versions panel.">',
        '',
        '*“The database was not changed.”*',
        '',
        '</details>',
      ].join('\n'),
    )
    expect(render(list, record).hero).toMatch(/^<img src="\.\/docs\/images\/readme\/host-loaded\.webp"[\s\S]*\n\nEvery picture in this README is taken by `pnpm pictures`/)
  })

  // Watched failing with: one caption edited in scenes.json without `readme.mjs --write`.
  test('regions: a caption edited without writing the README', () => {
    const state = fixture()
    state.scenes[2].caption = 'The rename is a “possible-rename”, said differently.'
    expect(regionProblems(state)).toEqual(['README.md\'s pictures region "studio" is not what scenes.json and captured.json render: run `node scripts/pictures/readme.mjs --write`'])
  })

  // Watched failing with: the studio region's markers deleted from README.md.
  test("regions: the studio region's markers deleted", () => {
    const state = fixture()
    state.readme = state.readme.replace(START('studio'), '')
    expect(regionProblems(state)).toEqual([expect.stringContaining('does not hold the pictures region "studio"')])
  })

  // A second copy of a region, or one no scene is drawn in, is a region nothing renders.
  test('regions: one twice, and one no scene is drawn in', () => {
    const twice = fixture()
    twice.readme = `${twice.readme}\n${START('host')}\n${END}\n`
    expect(regionProblems(twice)).toEqual(['README.md holds the pictures region "host" twice'])
    const stray = fixture()
    stray.readme = `${stray.readme}\n${START('site')}\n${END}\n`
    expect(regionProblems(stray)).toEqual(['README.md holds a pictures region "site" no scene is drawn in'])
  })

  // Watched failing with: one byte appended to studio-restored.webp; separately, host-other-tenant.webp deleted.
  test('integrity: a picture changed by a byte, and one deleted', () => {
    const changed = fixture()
    changed.files.set(pictureOf('studio-restored'), Buffer.concat([changed.files.get(pictureOf('studio-restored')), Buffer.from([0])]))
    expect(integrityProblems(changed)).toEqual([expect.stringMatching(/^docs\/images\/readme\/studio-restored\.webp is not the picture its record describes/)])
    const deleted = fixture()
    deleted.files.delete(pictureOf('host-other-tenant'))
    expect(integrityProblems(deleted)).toEqual(['docs/images/readme/host-other-tenant.webp does not exist, and its record says it was taken'])
  })

  // A record written by hand, or merged with CRLF line endings, is not what
  // the camera writes, and the next capture would rewrite every line of it.
  test('integrity: a scene with no record, and a record not as the camera writes it', () => {
    const missing = fixture()
    delete missing.record['studio-drift']
    missing.recordText = serialize(missing.record, missing.scenes)
    expect(integrityProblems(missing)).toEqual(['studio-drift has no record: `pnpm pictures --scene studio-drift` takes it'])
    const crlf = fixture()
    crlf.recordText = crlf.recordText.replaceAll('\n', '\r\n')
    expect(integrityProblems(crlf)).toEqual(['docs/images/readme/captured.json is not as the camera writes it: pretty-printed, keyed in scenes.json order, LF only'])
  })

  // Watched failing with: a stray docs/images/readme/stray.webp; separately, a record with no scene.
  test('orphans: a stray picture, and a record with no scene', () => {
    const stray = fixture()
    stray.listing.push('stray.webp')
    expect(orphanProblems(stray)).toEqual(['docs/images/readme/stray.webp is no scene\'s picture'])
    const record = fixture()
    record.record['studio-gone'] = record.record['studio-drift']
    expect(orphanProblems(record)).toEqual(['captured.json records studio-gone, which is no scene of scenes.json'])
  })

  // Watched failing with: “No such record.” changed to “No such order.” in a caption.
  test('quotes: a caption quoting what its part does not say', () => {
    const state = fixture()
    state.scenes[5].caption = 'otto: “No such order.”'
    expect(quoteProblems(state)).toEqual(['host-other-tenant: “No such order.” is quoted in its caption or alt and is not a key of its quotes, so nothing holds it to the picture'])
    state.scenes[5].quotes['No such order.'] = ['Record']
    expect(quoteProblems(state)).toEqual(['host-other-tenant: “No such order.” is not inside one name or value of what the part Record says, so the caption quotes what its picture does not show'])
  })

  // Watched failing with: the hero's “99999999999999.9999” scoped to the Record part, which does not show it.
  test('quotes: a quote scoped to a part that does not say it', () => {
    const state = fixture()
    state.scenes[0].quotes['99999999999999.9999'] = ['Record']
    expect(quoteProblems(state)).toEqual(['host-loaded: “99999999999999.9999” is not inside one name or value of what the part Record says, so the caption quotes what its picture does not show'])
  })

  // Watched failing with: a curly quote added to an alt without a quotes key.
  test('quotes: a quotation in an alt with no key, and a key nothing quotes', () => {
    const state = fixture()
    state.scenes[1].alt = 'Two forms, one saying “required”.'
    expect(quoteProblems(state)).toEqual(['examples-order: “required” is quoted in its caption or alt and is not a key of its quotes, so nothing holds it to the picture'])
    const unused = fixture()
    unused.scenes[1].quotes.required = ['React']
    expect(quoteProblems(unused)).toEqual([
      'examples-order: “required” is a key of its quotes and is quoted in neither its caption nor its alt',
      'examples-order: “required” is not inside one name or value of what the part React says, so the caption quotes what its picture does not show',
    ])
  })

  // A part named in quotes that the picture does not have, and a recorded
  // line the decoder cannot read, would otherwise both read as a quote missing.
  test('quotes: a part the picture does not have, and a recorded line that does not decode', () => {
    const part = fixture()
    part.scenes[0].quotes['9007199254740993'] = ['React', 'Vue']
    expect(quoteProblems(part)).toEqual(['host-loaded: “9007199254740993” must occur in the part Vue, which the picture does not have'])
    const line = fixture()
    line.record['studio-drift'].text.Drift += '\nstatus: unread'
    expect(quoteProblems(line)).toEqual(expect.arrayContaining(['studio-drift, part Drift: line 4 is not an accessibility snapshot line: it does not start with "- " at an even indentation']))
  })

  // Watched failing with: one record's chromium edited.
  test('one look: one record taken on another Chromium', () => {
    const state = fixture()
    state.record['studio-restored'].look.chromium = '154.0.0.0'
    expect(lookProblems(state)).toEqual([expect.stringMatching(/^the pictures were taken on 2 looks, and every one must be taken on one: .*Chromium 153\.0\.8010\.12.*; .*Chromium 154\.0\.0\.0.*`pnpm pictures --all` retakes every picture$/)])
  })

  // Watched failing with: a caption linking 0099-….
  test('links: a caption linking a decision record that does not exist', () => {
    const state = fixture()
    state.scenes[2].caption = 'The rename is a “possible-rename” ([0099](./docs/decisions/0099-no-such-record.md)).'
    expect(linkProblems(state)).toEqual(["studio-drift's caption links ./docs/decisions/0099-no-such-record.md, which is no file of the repository"])
  })

  // The hero line and every <img> are written into README.md by the render,
  // not by a caption: a recipe never written, or a picture gone, would leave
  // the README linking nowhere while a caption-only check stayed green.
  // Watched failing with: docs/images/README.md, which the hero line links,
  // missing; separately, the picture a region shows missing.
  test('links: a region linking or showing a file that does not exist', () => {
    const recipe = fixture()
    const exists = recipe.exists
    recipe.exists = (path) => path !== RECIPE && exists(path)
    expect(linkProblems(recipe)).toEqual(['README.md\'s pictures region "hero" links ./docs/images/README.md, which is no file of the repository'])
    const picture = fixture()
    picture.files.delete(pictureOf('studio-restored'))
    expect(linkProblems(picture)).toEqual(['README.md\'s pictures region "studio" links ./docs/images/readme/studio-restored.webp, which is no file of the repository'])
  })

  // Watched failing with: a scene's app set to `hosts`.
  test('shape: a scene whose app has no pictures script', () => {
    const state = fixture()
    state.scenes[5].app = 'hosts'
    expect(shapeProblems(state)).toEqual(['host-other-tenant: apps/hosts/scripts/pictures.mjs does not exist, so nothing takes or checks this picture'])
  })

  // Each would break the render or the check: an id the file name cannot
  // carry, two scenes of one id, Markdown an alt would show as written, a
  // step the Steps list cannot be searched for, and no hero or two.
  test('shape: ids, alts, steps and the hero', () => {
    const state = fixture()
    state.scenes[1].id = 'Examples Order'
    state.scenes[4].id = 'studio-regenerated'
    state.scenes[3].alt = 'A panel with `notes` in it.'
    state.scenes[2].step = 'Drift'
    state.scenes[5].placement = 'hero'
    state.scenes[2].title = ''
    expect(shapeProblems(state)).toEqual([
      'the scene id "Examples Order" is not [a-z0-9-]+',
      'studio-drift has no title',
      'studio-drift: step "Drift" is not "<number>. <name>"',
      "studio-regenerated's alt has Markdown in it, which an alt shows as written",
      'the scene id studio-regenerated is used twice',
      'scenes.json must have exactly one hero scene',
    ])
  })

  // A <details> summary lists its `more` scenes' titles with commas, so a
  // title with one in it reads as two scenes (a hero's or an inline scene's
  // title is in no summary, and may have one): "Publish, after somebody else did" made
  // "More: Policy, Presentation, Preview, Publish, after somebody else did".
  // Watched failing with: that title.
  test('shape: a title with a comma in it', () => {
    const state = fixture()
    state.scenes[3].title = 'Regenerated, keeping the presentation'
    expect(shapeProblems(state)).toEqual(["studio-regenerated's title has a comma in it, and a <details> summary joins titles with commas, so it would read as two scenes"])
  })

  // Watched failing with: the examples scene removed from scenes.json.
  test('guard on the guard: an app script with no scene', () => {
    const state = fixture()
    state.scenes.splice(1, 1)
    expect(guardProblems(state)).toEqual(['apps/examples/scripts/pictures.mjs takes no scene of scenes.json, so its check would compare nothing'])
  })

  // A render that drew no picture would be written into README.md and then
  // match it, so the region check alone would pass an empty README.
  test('guard on the guard: a region that draws no picture, and a render that cannot draw', () => {
    const state = fixture()
    const rendered = render(state.scenes, state.record)
    expect(guardProblems(state, { ...rendered, examples: '*Refused with “pattern”.*' })).toEqual(['the pictures region "examples" renders no picture'])
    expect(guardProblems({ ...state, record: {} })).toEqual([expect.stringMatching(/^the regions could not be rendered, so none drew a picture: host-loaded has no record/)])
  })
})
