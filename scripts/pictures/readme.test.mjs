import { describe, expect, test } from 'vitest'
import { readWorkflow } from '../release-report/workflows.mjs'
import { entry, pictureOf, serialize } from './record.mjs'
import {
  END,
  guardProblems,
  HERO_LINE,
  integrityProblems,
  linkProblems,
  lookProblems,
  orphanProblems,
  pageOf,
  quoteProblems,
  regionProblems,
  relink,
  render,
  repository,
  rewrite,
  shapeProblems,
  START,
  STEP_SCALE,
  stepProblems,
  stepRegion,
} from './readme.mjs'

/**
 * The README's pictures and the guide pages', held in `pnpm test:repo`
 * without a browser (0038, 0154).
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
  // region's markers lost in an edit of README.md or a guide page, would
  // leave the page showing what no capture made, or nothing at all, and
  // saying it is held.
  test('are the regions README.md and the guide pages show, each on its own page, as scenes.json and captured.json render them', () => {
    expect(regionProblems(here)).toEqual([])
  })

  // A picture edited, recompressed or deleted by hand would still have a
  // record saying it was taken from the page, and the README would show it.
  test("each have a record, and a file whose bytes are the record's", () => {
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
  test("are scenes of the right shape, each taken by its app's script", () => {
    expect(shapeProblems(here)).toEqual([])
  })

  // An app script with no scene would run a --check that compares nothing,
  // and a region with no picture would pass the region check empty.
  test('leave no app script without a scene and no region without a picture', () => {
    expect(guardProblems(here)).toEqual([])
  })

  // A step added to How it works, or renamed there, would stand without its
  // picture, and a picture moved would stand under another step than its own.
  test('picture every step of How it works, one each, under its item, as its list names them', () => {
    expect(stepProblems(here)).toEqual([])
  })
})

/*
 * A small repository: one hero, an inline scene with a step and two `more`
 * scenes after it, a host `more` scene, an examples scene, and two `step`
 * scenes, a studio one and a host one, for README.md's How it works of two
 * steps, each followed by its region. Its snapshot lines are written by
 * hand in the shapes Playwright prints.
 */
const LOOK = {
  platform: 'linux-x64',
  playwright: '1.63.0',
  chromium: '153.0.8010.12',
  fonts: { Archivo: 'v25', 'IBM Plex Mono': 'v20', 'IBM Plex Sans': 'v23' },
}
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
      quotes: {
        '9007199254740993': ['React', 'Angular'],
        '99999999999999.9999': ['React', 'Angular'],
        'Loaded record k1:9007199254740993 into both forms.': ['Record'],
      },
    },
    {
      id: 'examples-order',
      app: 'examples',
      placement: 'inline',
      title: 'Both renderers',
      caption: 'Refused with “pattern”.',
      alt: 'Two forms.',
      quotes: { pattern: ['React'] },
    },
    {
      id: 'studio-drift',
      app: 'studio',
      placement: 'inline',
      title: 'Drift',
      step: '8. Drift',
      caption: 'The rename is a “possible-rename”.',
      alt: 'The Drift step: “3 changes, 1 blocking.”',
      quotes: { 'possible-rename': ['Drift'], '3 changes, 1 blocking.': ['Drift'] },
    },
    {
      id: 'studio-regenerated',
      app: 'studio',
      placement: 'more',
      title: 'Regenerated',
      caption: '“Nothing is published until you publish it.”',
      alt: 'A panel.',
      quotes: { 'Nothing is published until you publish it.': ['Regenerated'] },
    },
    {
      id: 'studio-restored',
      app: 'studio',
      placement: 'more',
      title: 'Restored',
      caption: '“The database was not changed.”',
      alt: 'The versions panel.',
      quotes: { 'The database was not changed.': ['Versions'] },
    },
    {
      id: 'host-other-tenant',
      app: 'host',
      placement: 'more',
      title: "Another tenant's record",
      caption: 'otto: “No such record.”',
      alt: 'An alert “No such record.”',
      quotes: { 'No such record.': ['Record'] },
    },
    {
      id: 'studio-connect-pg',
      app: 'studio',
      placement: 'step',
      title: 'Connect',
      step: '1. Connect',
      caption: 'It saw everything: “No gap was reported.”',
      alt: 'The Connect step.',
      quotes: { 'No gap was reported.': ['Seen'] },
    },
    {
      id: 'host-record-tabs',
      app: 'host',
      placement: 'step',
      title: 'Run',
      step: '2. Run',
      caption: `A page draws it, beside its “Delivery” ([0008](${LINK})).`,
      alt: 'The open order.',
      quotes: { Delivery: ['Record'] },
    },
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
  'studio-connect-pg': { Seen: '- region "What pg can see":\n  - paragraph: No gap was reported.' },
  'host-record-tabs': { Record: '- region "Order k1:10422":\n  - tab "Delivery"' },
}

/** README.md as the small repository has it: the hero's region, then How it works, its two steps listed, each followed by its region. */
const README = [
  '# Formancy Data',
  '',
  START('hero'),
  END,
  '',
  '## How it works',
  '',
  '1. **Connect.** The studio discovers it.',
  '',
  START('how-it-works-1'),
  END,
  '',
  '2. **Run.** A page draws it.',
  '',
  START('how-it-works-2'),
  END,
  '',
  '## Licence',
  '',
].join('\n')

/** The small repository, every check passing: what the pages' regions, the record and the files are after a capture. */
function fixture() {
  const list = scenes()
  const files = new Map()
  const record = {}
  for (const scene of list) {
    const picture = Buffer.from(`the picture of ${scene.id}`)
    files.set(pictureOf(scene.id), picture)
    record[scene.id] = entry(scene.id, {
      captured: '2026-10-09',
      settings: SETTINGS,
      clip: { x: 0, y: 0, width: 842, height: 400 },
      picture,
      look: structuredClone(LOOK),
      database: 'captured snapshots',
      stylesheet: 'sha256 0',
      // A copy: a case that edits a recorded line would otherwise edit every later fixture's.
      text: structuredClone(TEXT[scene.id]),
    })
  }
  const skeleton = (title, name) => [`# ${title}`, '', 'Intro.', '', START(name), END, ''].join('\n')
  const titles = { examples: 'Examples', studio: 'Studio', host: 'Host' }
  const guides = Object.entries(titles).map(([name, title]) => [pageOf(name), rewrite(skeleton(title, name), list, record, pageOf(name))])
  return {
    scenes: list,
    record,
    recordText: serialize(record, list),
    documents: Object.fromEntries([['README.md', rewrite(README, list, record)], ...guides]),
    listing: ['captured.json', ...list.map((scene) => `${scene.id}.webp`)],
    file: (path) => files.get(path),
    exists: (path) => [LINK.slice(2), RECIPE].includes(path) || files.has(path),
    appScripts: ['examples', 'host', 'studio'],
    files,
  }
}

const ALL = { regionProblems, integrityProblems, orphanProblems, quoteProblems, lookProblems, linkProblems, shapeProblems, stepProblems, guardProblems }

describe('each check, on a small repository', () => {
  // The guard on the guards below: the unchanged small repository passes
  // every check, so each failure below is the change it names and nothing else.
  test('passes every check as a capture leaves it', () => {
    const state = fixture()
    for (const [name, check] of Object.entries(ALL)) expect(check(state), name).toEqual([])
  })

  // The format the pages show, pinned: the picture at its recorded CSS width
  // with its alt, the italic caption led by the step, and a run of `more`
  // scenes folded into one <details> whose summary is their titles -- an
  // app's on its page of the guide, one directory below the root, so its
  // pictures are `../images/`.
  test('renders a region in the order scenes.json gives, with runs of more scenes folded', () => {
    const { scenes: list, record } = fixture()
    expect(render(list, record).studio).toBe(
      [
        '<img src="../images/readme/studio-drift.webp" width="842" alt="The Drift step: “3 changes, 1 blocking.”">',
        '',
        '**Step 8, Drift.** *The rename is a “possible-rename”.*',
        '',
        '<details>',
        '<summary>More: Regenerated, Restored</summary>',
        '',
        '<img src="../images/readme/studio-regenerated.webp" width="842" alt="A panel.">',
        '',
        '*“Nothing is published until you publish it.”*',
        '',
        '<img src="../images/readme/studio-restored.webp" width="842" alt="The versions panel.">',
        '',
        '*“The database was not changed.”*',
        '',
        '</details>',
      ].join('\n'),
    )
    expect(render(list, record).hero).toMatch(
      /^<img src="\.\/docs\/images\/readme\/host-loaded\.webp"[\s\S]*\n\nThe screenshots in this README are taken by `pnpm pictures`/,
    )
  })

  // scenes.json writes a caption's links from the repository's root. Drawn
  // as written on a page of the guide, one directory down, every one would
  // name a file under docs/guide/ that is not there. Each is aimed from the
  // page, its fragment kept, and a link to another site or to a heading of
  // the page itself is left alone.
  // Watched failing with relink returning its text unchanged: the
  // repository's guide regions then linked ./docs/decisions/… from
  // docs/guide/, and the link check above failed on every one.
  test('aims a region’s links and pictures from the page it is drawn on', () => {
    const text = '[0008](./docs/decisions/0008-x.md#why) <img src="./docs/images/readme/a.webp"> [site](https://formancy.ai/) [here](#top) [up](./README.md)'
    expect(relink(text, 'README.md')).toBe(text)
    expect(relink(text, 'docs/guide/studio.md')).toBe(
      '[0008](../decisions/0008-x.md#why) <img src="../images/readme/a.webp"> [site](https://formancy.ai/) [here](#top) [up](../../README.md)',
    )
    expect(pageOf('hero')).toBe('README.md')
    expect(pageOf('studio')).toBe('docs/guide/studio.md')
  })

  // The hero line tells a reader which job goes red on a picture whose text
  // the page no longer shows: since 0058 that is the pictures job, in
  // Chromium, not the browser job, whose legs run in every browser. Read
  // from the workflow, so a job renamed or a check moved again fails here.
  test('the hero line names the job that runs the pictures’ check', () => {
    const named = /the (\S+) job fails/.exec(HERO_LINE)?.[1]
    const job = readWorkflow().jobs[named]
    expect(
      job?.steps.map((step) => step.run),
      `the ${String(named)} job`,
    ).toContain('pnpm test:pictures')
  })

  // Watched failing with: one caption edited in scenes.json without `readme.mjs --write`.
  test('regions: a caption edited without writing the page', () => {
    const state = fixture()
    state.scenes[2].caption = 'The rename is a “possible-rename”, said differently.'
    expect(regionProblems(state)).toEqual([
      'docs/guide/studio.md\'s pictures region "studio" is not what scenes.json and captured.json render: run `node scripts/pictures/readme.mjs --write`',
    ])
  })

  // Watched failing with: the studio region's markers deleted from docs/guide/studio.md.
  test("regions: the studio region's markers deleted", () => {
    const state = fixture()
    state.documents['docs/guide/studio.md'] = state.documents['docs/guide/studio.md'].replace(START('studio'), '')
    expect(regionProblems(state)).toEqual([`docs/guide/studio.md does not hold the pictures region "studio", opened by ${START('studio')}`])
  })

  // A second copy of a region, on its own page or on another, or one no
  // scene is drawn in, is a region nothing renders.
  test('regions: one twice, one on a page it is not drawn on, and one no scene is drawn in', () => {
    const twice = fixture()
    twice.documents['docs/guide/host.md'] += `\n${START('host')}\n${END}\n`
    expect(regionProblems(twice)).toEqual(['docs/guide/host.md holds the pictures region "host" twice'])
    const elsewhere = fixture()
    elsewhere.documents['README.md'] += `\n${START('host')}\n${END}\n`
    expect(regionProblems(elsewhere)).toEqual(['README.md holds the pictures region "host", which is drawn on docs/guide/host.md'])
    const stray = fixture()
    stray.documents['README.md'] += `\n${START('site')}\n${END}\n`
    expect(regionProblems(stray)).toEqual(['README.md holds a pictures region "site" no scene is drawn in'])
  })

  // A page of the guide renamed or deleted takes its region with it, and
  // nothing else would say the app's pictures are shown nowhere.
  // Watched failing with: docs/guide/host.md left out of the documents.
  test('regions: the page a region is drawn on missing', () => {
    const state = fixture()
    state.documents['docs/guide/host.md'] = undefined
    expect(regionProblems(state)).toEqual(['docs/guide/host.md does not exist, and the pictures region "host" is drawn on it'])
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
    expect(integrityProblems(crlf)).toEqual([
      'docs/images/readme/captured.json is not as the camera writes it: pretty-printed, keyed in scenes.json order, LF only',
    ])
  })

  // Watched failing with: a stray docs/images/readme/stray.webp; separately, a record with no scene.
  test('orphans: a stray picture, and a record with no scene', () => {
    const stray = fixture()
    stray.listing.push('stray.webp')
    expect(orphanProblems(stray)).toEqual(["docs/images/readme/stray.webp is no scene's picture"])
    const record = fixture()
    record.record['studio-gone'] = record.record['studio-drift']
    expect(orphanProblems(record)).toEqual(['captured.json records studio-gone, which is no scene of scenes.json'])
  })

  // Watched failing with: “No such record.” changed to “No such order.” in a caption.
  test('quotes: a caption quoting what its part does not say', () => {
    const state = fixture()
    state.scenes[5].caption = 'otto: “No such order.”'
    expect(quoteProblems(state)).toEqual([
      'host-other-tenant: “No such order.” is quoted in its caption or alt and is not a key of its quotes, so nothing holds it to the picture',
    ])
    state.scenes[5].quotes['No such order.'] = ['Record']
    expect(quoteProblems(state)).toEqual([
      'host-other-tenant: “No such order.” is not inside one name or value of what the part Record says, so the caption quotes what its picture does not show',
    ])
  })

  // Watched failing with: the hero's “99999999999999.9999” scoped to the Record part, which does not show it.
  test('quotes: a quote scoped to a part that does not say it', () => {
    const state = fixture()
    state.scenes[0].quotes['99999999999999.9999'] = ['Record']
    expect(quoteProblems(state)).toEqual([
      'host-loaded: “99999999999999.9999” is not inside one name or value of what the part Record says, so the caption quotes what its picture does not show',
    ])
  })

  // Watched failing with: a curly quote added to an alt without a quotes key.
  test('quotes: a quotation in an alt with no key, and a key nothing quotes', () => {
    const state = fixture()
    state.scenes[1].alt = 'Two forms, one saying “required”.'
    expect(quoteProblems(state)).toEqual([
      'examples-order: “required” is quoted in its caption or alt and is not a key of its quotes, so nothing holds it to the picture',
    ])
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
    expect(quoteProblems(line)).toEqual(
      expect.arrayContaining(['studio-drift, part Drift: line 4 is not an accessibility snapshot line: it does not start with "- " at an even indentation']),
    )
  })

  // Watched failing with: one record's chromium edited.
  test('one look: one record taken on another Chromium', () => {
    const state = fixture()
    state.record['studio-restored'].look.chromium = '154.0.0.0'
    expect(lookProblems(state)).toEqual([
      expect.stringMatching(
        /^the pictures were taken on 2 looks, and every one must be taken on one: .*Chromium 153\.0\.8010\.12.*; .*Chromium 154\.0\.0\.0.*`pnpm pictures --all` retakes every picture$/,
      ),
    ])
  })

  // Watched failing with: a caption linking 0099-….
  test('links: a caption linking a decision record that does not exist', () => {
    const state = fixture()
    state.scenes[2].caption = 'The rename is a “possible-rename” ([0099](./docs/decisions/0099-no-such-record.md)).'
    expect(linkProblems(state)).toEqual(["studio-drift's caption links ./docs/decisions/0099-no-such-record.md, which is no file of the repository"])
  })

  // The hero line and every <img> are written into the pages by the render,
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
    expect(linkProblems(picture)).toEqual([
      'docs/guide/studio.md\'s pictures region "studio" links ../images/readme/studio-restored.webp, which is no file of the repository',
    ])
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
    expect(shapeProblems(state)).toEqual([
      "studio-regenerated's title has a comma in it, and a <details> summary joins titles with commas, so it would read as two scenes",
    ])
  })

  // Watched failing with: the examples scene removed from scenes.json.
  test('guard on the guard: an app script with no scene', () => {
    const state = fixture()
    state.scenes.splice(1, 1)
    expect(guardProblems(state)).toEqual(['apps/examples/scripts/pictures.mjs takes no scene of scenes.json, so its check would compare nothing'])
  })

  // A render that drew no picture would be written into its page and then
  // match it, so the region check alone would pass an empty page.
  test('guard on the guard: a region that draws no picture, and a render that cannot draw', () => {
    const state = fixture()
    const rendered = render(state.scenes, state.record)
    expect(guardProblems(state, { ...rendered, examples: '*Refused with “pattern”.*' })).toEqual(['the pictures region "examples" renders no picture'])
    expect(guardProblems({ ...state, record: {} })).toEqual([
      expect.stringMatching(/^the regions could not be rendered, so none drew a picture: host-loaded has no record/),
    ])
  })
})

/*
 * README.md's How it works, a picture under each step (0168): the `step`
 * placement held as the hero is, each case on the small repository above.
 */
describe('the steps of How it works, on a small repository', () => {
  // The format the README shows, pinned: a region per step, named for its
  // number and drawn on README.md, its picture at STEP_SCALE of its
  // recorded width and linked to itself so a reader can open it whole, then
  // its caption led by nothing, since the step's item stands above it --
  // and the step scenes in those regions alone, none in their app's.
  // Watched failing with every step drawn at its recorded width (the
  // studio step's 842 drawn at 842, not 589), and with regionOf left
  // without `step`: README.md's regions were then none it draws, "README.md
  // must hold the pictures regions hero, ...; how-it-works-1,
  // how-it-works-2 not drawn on this page".
  test('renders each step in a region of its own on README.md, at 0.7 of its size, linked to itself, and in no other region', () => {
    const { scenes: list, record } = fixture()
    record['host-record-tabs'].css.width = 320
    const rendered = render(list, record)
    expect(STEP_SCALE).toBe(0.7)
    expect(stepRegion('2. Run')).toBe('how-it-works-2')
    expect(pageOf('how-it-works-1')).toBe('README.md')
    expect(rendered['how-it-works-1']).toBe(
      [
        '[<img src="./docs/images/readme/studio-connect-pg.webp" width="589" alt="The Connect step.">](./docs/images/readme/studio-connect-pg.webp)',
        '',
        '*It saw everything: “No gap was reported.”*',
      ].join('\n'),
    )
    expect(rendered['how-it-works-2']).toBe(
      [
        '[<img src="./docs/images/readme/host-record-tabs.webp" width="224" alt="The open order.">](./docs/images/readme/host-record-tabs.webp)',
        '',
        `*A page draws it, beside its “Delivery” ([0008](${LINK})).*`,
      ].join('\n'),
    )
    expect(rendered.studio).not.toContain('studio-connect-pg')
    expect(rendered.host).not.toContain('host-record-tabs')
  })

  // A step's region is the render, on README.md and on no other page: its
  // markers lost in an edit of the README, or a copy of them left on a page
  // of the guide, would show what no capture made, or nothing.
  // Watched failing with pageOf left without the steps' regions: README.md's
  // were then regions not drawn on it, "how-it-works-1, how-it-works-2 not
  // drawn on this page".
  test('regions: a step missing from README.md, and planted on a page of the guide', () => {
    const missing = fixture()
    missing.documents['README.md'] = missing.documents['README.md'].replace(START('how-it-works-1'), '')
    expect(regionProblems(missing)).toEqual([`README.md does not hold the pictures region "how-it-works-1", opened by ${START('how-it-works-1')}`])
    const elsewhere = fixture()
    elsewhere.documents['docs/guide/studio.md'] += `\n${START('how-it-works-2')}\n${END}\n`
    expect(regionProblems(elsewhere)).toEqual(['docs/guide/studio.md holds the pictures region "how-it-works-2", which is drawn on README.md'])
  })

  // Its pictures and its captions' links are read from README.md, where
  // the region is: a picture gone would leave a step linking nowhere.
  // Watched failing with pageOf left without the steps' regions, as the
  // case above.
  test('links: a step whose picture does not exist, aimed from README.md', () => {
    const state = fixture()
    state.files.delete(pictureOf('host-record-tabs'))
    expect(linkProblems(state)).toEqual([
      'README.md\'s pictures region "how-it-works-2" links ./docs/images/readme/host-record-tabs.webp, which is no file of the repository',
    ])
  })

  // A step's caption is held to its parts as every other caption is.
  // Watched failing with quoteProblems left to the scenes that are not
  // `step`: the misquote passed.
  test("quotes: a step's caption quoting what its part does not say", () => {
    const state = fixture()
    state.scenes[6].caption = 'It saw everything: “No gap was found.”'
    state.scenes[6].quotes = { 'No gap was found.': ['Seen'] }
    expect(quoteProblems(state)).toEqual([
      'studio-connect-pg: “No gap was found.” is not inside one name or value of what the part Seen says, so the caption quotes what its picture does not show',
    ])
  })

  // A step scene must say which step it pictures, and the steps come in
  // their order in scenes.json as in the README; a placement the render
  // does not know would draw the scene nowhere.
  // Watched failing with each check taken out of shapeProblems in turn.
  test('shape: a step scene naming no step, two in the wrong order, and an unknown placement', () => {
    const unnamed = fixture()
    delete unnamed.scenes[6].step
    expect(shapeProblems(unnamed)).toEqual(['studio-connect-pg is drawn in How it works and names no step of it'])
    const swapped = fixture()
    swapped.scenes.splice(6, 2, swapped.scenes[7], swapped.scenes[6])
    expect(shapeProblems(swapped)).toEqual([
      'host-record-tabs is the step scene number 1 in scenes.json and pictures step 2. Run: one scene per step, in step order',
      'studio-connect-pg is the step scene number 2 in scenes.json and pictures step 1. Connect: one scene per step, in step order',
    ])
    const unknown = fixture()
    unknown.scenes[7].placement = 'steps'
    expect(shapeProblems(unknown)).toEqual(['host-record-tabs: placement "steps" is none of hero, inline, more, step'])
  })

  // How it works and its pictures say the same steps: a step added to the
  // list, a scene's step renamed, or the section gone, each fails here.
  // Watched failing with stepProblems answering nothing, and with its
  // second half -- a scene's step the list does not have -- taken out.
  test("steps: How it works' list and the step scenes disagree", () => {
    const added = fixture()
    added.documents['README.md'] = added.documents['README.md'].replace('\n## Licence', '\n3. **Review drift.** It is checked.\n\n## Licence')
    expect(stepProblems(added)).toEqual(['the step "3. Review drift" of README.md\'s How it works is pictured by 0 step scenes, not one'])
    const renamed = fixture()
    renamed.scenes[7].step = '2. Running'
    expect(stepProblems(renamed)).toEqual([
      'the step "2. Run" of README.md\'s How it works is pictured by 0 step scenes, not one',
      'host-record-tabs pictures the step "2. Running", which README.md\'s How it works does not have',
    ])
    const gone = fixture()
    gone.documents['README.md'] = gone.documents['README.md'].replace('## How it works', '## How to')
    expect(stepProblems(gone)).toEqual(['README.md has no numbered steps under ## How it works, which the step scenes picture'])
  })

  // Every step scene taken out, with the regions they were drawn in, would
  // leave How it works listing steps no picture shows while every other
  // check passed: there is no region left to be wrong, and no scene left to
  // name a step. The list alone asks for them.
  // Watched failing with stepProblems answering nothing when scenes.json has
  // no step scene, as it first did: "expected [] to deeply equal [ …(2) ]".
  test('steps: How it works listing steps and no scene picturing any', () => {
    const state = fixture()
    state.scenes = state.scenes.filter((scene) => scene.placement !== 'step')
    for (const name of ['how-it-works-1', 'how-it-works-2'])
      state.documents['README.md'] = state.documents['README.md'].replace(new RegExp(`${START(name)}[\\s\\S]*?${END}\\n`), '')
    expect(regionProblems(state)).toEqual([])
    expect(stepProblems(state)).toEqual([
      'the step "1. Connect" of README.md\'s How it works is pictured by 0 step scenes, not one',
      'the step "2. Run" of README.md\'s How it works is pictured by 0 step scenes, not one',
    ])
  })

  // A step's picture stands under its item: a region moved under another
  // step, or below the list, would show the Connect step under Run, with
  // every region still the render and on its page.
  // Watched failing with the placement check taken out of stepProblems.
  test('steps: a region under another step than its own', () => {
    const state = fixture()
    const text = state.documents['README.md']
    const region = (name) => new RegExp(`${START(name)}[\\s\\S]*?${END}`).exec(text)[0]
    const [first, second] = [region('how-it-works-1'), region('how-it-works-2')]
    state.documents['README.md'] = text.replace(first, '<first>').replace(second, first).replace('<first>', second)
    expect(regionProblems(state)).toEqual([])
    expect(stepProblems(state)).toEqual([
      'the pictures region "how-it-works-1" is not right after the step "1. Connect" of README.md\'s How it works, so its picture would stand under another step',
      'the pictures region "how-it-works-2" is not right after the step "2. Run" of README.md\'s How it works, so its picture would stand under another step',
    ])
  })
})
