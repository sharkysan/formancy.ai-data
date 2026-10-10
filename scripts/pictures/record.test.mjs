import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { announce, checkProblems, dated, entry, lineDiff, misquotes, outsideRepository, pairingProblems, quotations, readScenes, REPO, serialize, stylesheetNotices, withEntry } from './record.mjs'

/**
 * What a capture may write into docs/images/readme/captured.json and what
 * `--check` fails with (0038), decided once for the three apps' scripts.
 * Pure, so held here without a browser; the browser half is the camera's.
 */

const LOOK = { platform: 'linux-x64', playwright: '1.63.0', chromium: '153.0.8010.12', fonts: { Archivo: 'v25', 'IBM Plex Mono': 'v20', 'IBM Plex Sans': 'v23' } }
const SETTINGS = { width: 1200, height: 900, deviceScaleFactor: 2, locale: 'en-US', timezoneId: 'UTC' }
const SCENES = [
  { id: 'studio-drift', app: 'studio', placement: 'inline', title: 'Drift', step: '8. Drift', caption: 'A “possible-rename”.', alt: 'The Drift step.', quotes: { 'possible-rename': ['Drift'] } },
  { id: 'studio-restored', app: 'studio', placement: 'more', title: 'Restored', caption: '“The database was not changed.”', alt: 'The versions panel.', quotes: { 'The database was not changed.': ['Versions'] } },
]
const DRIFT = { Drift: '- main "Drift":\n  - code: possible-rename' }
const RESTORED = { Versions: '- region "Versions of pg-order":\n  - status: Restored version 1 as version 4. The database was not changed.' }
const taken = (id, text, look = LOOK) => entry(id, { captured: '2026-10-09', settings: SETTINGS, clip: { x: 296, y: 12, width: 892, height: 1357 }, picture: Buffer.from(id), look, database: 'captured snapshots', stylesheet: 'sha256 0', text })

describe('quotations', () => {
  // A mark opened and never closed, or closed twice, would quote a run nobody
  // meant, or none, and the check would hold the caption to the wrong text.
  test('reads every “…” and refuses one left open or closed twice', () => {
    expect(quotations('It says “Saved.”, then “Not saved”.')).toEqual(['Saved.', 'Not saved'])
    expect(() => quotations('It says “Saved.')).toThrow(/never closed/)
    expect(() => quotations('It says Saved.” twice.”')).toThrow(/never opened/)
    expect(() => quotations('“a “b” c”')).toThrow(/opened inside another/)
  })
})

describe('the record an app script writes', () => {
  // The shape captured.json keeps every entry in: a key out of place, or a
  // size taken from the viewport instead of the clip, would be a record
  // the README renders at the wrong width.
  test('is one entry per scene, with the clip as its CSS size and the picture\'s own bytes and digest', () => {
    const written = taken('studio-drift', DRIFT)
    expect(Object.keys(written)).toEqual(['file', 'captured', 'viewport', 'deviceScaleFactor', 'locale', 'timezone', 'css', 'bytes', 'sha256', 'look', 'database', 'stylesheet', 'text'])
    expect(written).toMatchObject({ file: 'docs/images/readme/studio-drift.webp', viewport: { width: 1200, height: 900 }, css: { width: 892, height: 1357 }, bytes: 12, timezone: 'UTC' })
    expect(written.sha256).toBe(createHash('sha256').update('studio-drift').digest('hex'))
  })

  // A capture that wrote first and checked after would commit a picture its
  // caption misquotes; so would one that wrote a line nobody can decode.
  test('is refused when the caption would quote what the new text does not say', () => {
    expect(() => withEntry({}, SCENES, 'studio-drift', taken('studio-drift', { Drift: '- main "Drift":\n  - code: column-dropped' }))).toThrow(
      /studio-drift was not written, because its caption or alt would not be true of it:\n {2}studio-drift: “possible-rename” is not inside one name or value of what the part Drift says/,
    )
    expect(() => withEntry({}, SCENES, 'studio-drift', taken('studio-drift', { Drift: 'main "Drift"' }))).toThrow(/line 1 is not an accessibility snapshot line/)
    expect(() => withEntry({}, SCENES, 'studio-gone', taken('studio-gone', DRIFT))).toThrow(/studio-gone is not a scene of scripts\/pictures\/scenes\.json/)
  })

  // The BRIEF's "--scene studio-drift with the recorded chromium edited": one
  // picture retaken on another machine would sit beside the others in
  // another look; the refusal says how to retake them all.
  test('is refused when it was taken on another look than the record, naming --all', () => {
    const record = { 'studio-restored': taken('studio-restored', RESTORED) }
    const elsewhere = taken('studio-drift', DRIFT, { ...LOOK, chromium: '154.0.0.0' })
    expect(() => withEntry(record, SCENES, 'studio-drift', elsewhere)).toThrow(
      'the pictures were taken on linux-x64, Playwright 1.63.0, Chromium 153.0.8010.12, Archivo v25, IBM Plex Mono v20, IBM Plex Sans v23; this machine has linux-x64, Playwright 1.63.0, Chromium 154.0.0.0, Archivo v25, IBM Plex Mono v20, IBM Plex Sans v23; `pnpm pictures --all` retakes every picture',
    )
    // On an empty record -- the root runner's --all -- any look is the first.
    expect(Object.keys(withEntry({}, SCENES, 'studio-drift', elsewhere))).toEqual(['studio-drift'])
  })

  // A retake that gives the same bytes and the same text on the same look
  // changed nothing; a new date on it would put captured.json in `git status`
  // after every retake, and the review's "git status lists exactly the
  // pictures whose pixels changed" would be false.
  test('keeps the date of a picture retaken as the same bytes and text, and only then', () => {
    const before = { ...taken('studio-drift', DRIFT), captured: '2026-10-01' }
    const same = { ...taken('studio-drift', DRIFT), captured: '2026-10-09' }
    expect(dated(before, same).captured).toBe('2026-10-01')
    expect(withEntry({ 'studio-drift': before }, SCENES, 'studio-drift', same)['studio-drift'].captured).toBe('2026-10-01')
    const otherBytes = { ...same, sha256: 'f'.repeat(64) }
    expect(dated(before, otherBytes).captured).toBe('2026-10-09')
    const otherText = { ...same, text: { Drift: '- main "Drift":\n  - code: possible-rename\n  - button "Check drift"' } }
    expect(dated(before, otherText).captured).toBe('2026-10-09')
    const otherLook = { ...same, look: { ...LOOK, chromium: '154.0.0.0' } }
    expect(dated(before, otherLook).captured).toBe('2026-10-09')
    expect(dated(undefined, same)).toBe(same)
  })

  // The record is diffed in every pull request that retakes a picture: in
  // scenes.json's order, so a retake changes its own lines and no others.
  test('keeps scenes.json order and LF only, whichever scene is written first', () => {
    const record = withEntry(withEntry({}, SCENES, 'studio-restored', taken('studio-restored', RESTORED)), SCENES, 'studio-drift', taken('studio-drift', DRIFT))
    expect(Object.keys(record)).toEqual(['studio-drift', 'studio-restored'])
    const text = serialize(record, SCENES)
    expect(text.endsWith('}\n')).toBe(true)
    expect(text.includes('\r')).toBe(false)
    expect(JSON.parse(text)).toEqual(record)
  })

  // The repository's own scenes, checked as a capture would check them
  // before writing: each caption and alt lists exactly the quotes it has.
  test("holds the repository's scenes to their quotes", () => {
    for (const scene of readScenes()) expect(misquotes(scene, undefined), scene.id).toEqual([])
  })
})

describe('what --check fails with', () => {
  const record = { 'studio-drift': taken('studio-drift', DRIFT), 'studio-restored': taken('studio-restored', RESTORED) }
  const all = { 'studio-drift': DRIFT, 'studio-restored': RESTORED }

  // The BRIEF's "act table emptied", as the app script hands it over: a
  // check that walked nothing would pass, so "compared no scene" comes
  // first and alone.
  test('is "compared no scene" first, before anything else is looked at', () => {
    expect(checkProblems({ app: 'studio', scenes: SCENES, record, actIds: [], running: {}, playwright: '1.63.0' })).toEqual(['studio: compared no scene, so nothing held its pictures'])
  })

  // The same sentence from the walk's side: with every scene paired with its
  // act, a walk that read no scene's text -- a mode that skips the reading,
  // say -- would otherwise find nothing to differ and pass, since the test
  // above reaches the sentence through the pairing alone.
  test('is "compared no scene" when the walk read nothing, though every scene has its act', () => {
    expect(checkProblems({ app: 'studio', scenes: SCENES, record, actIds: Object.keys(all), running: {}, playwright: '1.63.0' })).toEqual(['studio: compared no scene, so nothing held its pictures'])
  })

  // The BRIEF's "a scene with no act; separately, an act's key renamed": a
  // picture nothing walks is held by nothing, and an act nothing records
  // compares nothing.
  test('is a scene with no act, and an act with no scene', () => {
    expect(checkProblems({ app: 'studio', scenes: SCENES, record, actIds: ['studio-drift', 'studio-restord'], running: { 'studio-drift': DRIFT }, playwright: '1.63.0' })).toEqual([
      'studio: the scene studio-restored has no act, so its picture is held by nothing',
      'studio: the act studio-restord is no scene of scripts/pictures/scenes.json',
    ])
  })

  // The same pairing, asked before the walk: an act renamed from its scene
  // would otherwise be walked with no scene to read its step from, and fail
  // on that instead of saying what is wrong.
  test('pairs scenes and acts before any walk, after an empty act table', () => {
    expect(pairingProblems({ app: 'studio', scenes: SCENES, actIds: [] })).toEqual(['studio: compared no scene, so nothing held its pictures'])
    expect(pairingProblems({ app: 'studio', scenes: SCENES, actIds: ['studio-drift', 'studio-restord'] })).toEqual([
      'studio: the scene studio-restored has no act, so its picture is held by nothing',
      'studio: the act studio-restord is no scene of scripts/pictures/scenes.json',
    ])
    expect(pairingProblems({ app: 'studio', scenes: SCENES, actIds: ['studio-drift', 'studio-restored'] })).toEqual([])
  })

  // What a changed sentence in the studio -- the BRIEF's drift.tsx edit --
  // reaches the check as: the diff and both Playwright versions say whether
  // the page changed or the snapshot format did.
  test('is each part whose text changed, with a line diff and both Playwright versions', () => {
    const running = { ...all, 'studio-drift': { Drift: '- main "Drift":\n  - code: possibly-renamed' } }
    expect(checkProblems({ app: 'studio', scenes: SCENES, record, actIds: Object.keys(all), running, playwright: '1.64.0' })).toEqual([
      'studio-drift, part Drift: the page now says something else than its picture (recorded with Playwright 1.63.0, running 1.64.0); `pnpm pictures --scene studio-drift` retakes it\n    -   - code: possible-rename\n    +   - code: possibly-renamed',
    ])
    expect(checkProblems({ app: 'studio', scenes: SCENES, record, actIds: Object.keys(all), running: all, playwright: '1.63.0' })).toEqual([])
  })

  // A part added to or dropped from an act changes what the picture is of.
  test('is a part the record or the walk does not have', () => {
    const running = { ...all, 'studio-restored': { ...RESTORED, Extra: '- button "Restore version 1"' } }
    expect(checkProblems({ app: 'studio', scenes: SCENES, record, actIds: Object.keys(all), running, playwright: '1.63.0' })).toEqual(['studio-restored: the part Extra is not in the record'])
  })
})

describe('lineDiff', () => {
  // The diff a failing check prints: lines kept are left out, so the change is what is read.
  test('lists the recorded lines removed and the running lines added, in order', () => {
    expect(lineDiff('a\nb\nc', 'a\nx\nc\nd')).toEqual(['- b', '+ x', '+ d'])
    expect(lineDiff('a', 'a')).toEqual([])
  })
})

describe('the stylesheet notice', () => {
  // A change of style alone leaves every text equal; without the notice
  // nothing would say the pictures may no longer look like the page.
  test('names the scenes whose recorded stylesheet differs, and only those', () => {
    const record = { 'studio-drift': taken('studio-drift', DRIFT), 'studio-restored': { ...taken('studio-restored', RESTORED), stylesheet: 'sha256 1' } }
    expect(stylesheetNotices({ app: 'studio', scenes: SCENES, record, stylesheet: 'sha256 1' })).toEqual([
      "studio's stylesheet changed since studio-drift was taken; the text check cannot see what that did to the pictures, so look at them, and `pnpm pictures --scene <id>` retakes one",
    ])
    expect(stylesheetNotices({ app: 'host', scenes: SCENES, record, stylesheet: 'sha256 1' })).toEqual([])
  })

  // Under Actions the notice must reach the run's page: as an annotation,
  // and in the step summary, which turbo's prefix on the line cannot hide.
  test('is printed, and under GitHub Actions also annotated and written to the step summary', () => {
    const printed = []
    const appended = []
    announce(['a notice, 100% true'], { env: {}, print: (line) => printed.push(line), append: (...args) => appended.push(args) })
    expect(printed).toEqual(['notice: a notice, 100% true'])
    expect(appended).toEqual([])
    printed.length = 0
    announce(['a notice, 100% true'], { env: { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: '/summary' }, print: (line) => printed.push(line), append: (...args) => appended.push(args) })
    expect(printed).toEqual(['notice: a notice, 100% true', '::warning title=README pictures::a notice, 100%25 true'])
    expect(appended).toEqual([['/summary', '> **README pictures:** a notice, 100% true\n\n']])
  })
})

describe('outsideRepository', () => {
  // The BRIEF's "--review <WT>/x": decoded PNGs inside the working tree are
  // one `git add -A` from being committed beside the WebPs.
  test('refuses a review directory inside the repository, and gives back one outside it absolute', () => {
    expect(() => outsideRepository(join(REPO, 'x'))).toThrow(/is inside the repository \(x\)/)
    expect(() => outsideRepository('.', REPO)).toThrow(/is inside the repository \(\.\)/)
    expect(() => outsideRepository('docs/review', REPO)).toThrow(/is inside the repository \(docs\/review\)/)
    expect(outsideRepository('../review', REPO)).toBe(join(REPO, '..', 'review'))
    // A directory whose name starts with two dots is still inside.
    expect(() => outsideRepository(join(REPO, '..x'), REPO)).toThrow(/is inside the repository \(\.\.x\)/)
  })
})
