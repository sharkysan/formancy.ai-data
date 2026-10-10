import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { parse, plan, redated, table } from './pictures.mjs'
import { readScenes, REPO } from './pictures/record.mjs'

/**
 * `pnpm pictures`, the root runner (0038): what it accepts, what it runs and
 * what it prints. Running the apps is their scripts' business and needs a
 * browser; deciding what to run is this file's and needs neither.
 */

const SCENES = [
  { id: 'host-loaded', app: 'host' },
  { id: 'examples-order', app: 'examples' },
  { id: 'studio-connect', app: 'studio' },
  { id: 'studio-drift', app: 'studio' },
  { id: 'host-stale', app: 'host' },
]
const OUTSIDE = join(REPO, '..', 'pictures-review')

describe('the arguments', () => {
  // A misspelt scene or app would otherwise run nothing and say it succeeded.
  test('are checked against scenes.json', () => {
    expect(parse(['--app', 'studio', '--scene', 'studio-drift'], SCENES)).toEqual({ apps: ['studio'], scenes: ['studio-drift'], all: false, check: false, review: undefined })
    expect(() => parse(['--app', 'site'], SCENES)).toThrow('--app site is no app with a scene in scripts/pictures/scenes.json; those are host, examples, studio')
    expect(() => parse(['--scene', 'studio-drfit'], SCENES)).toThrow('--scene studio-drfit is no scene of scripts/pictures/scenes.json')
    expect(() => parse(['--scene'], SCENES)).toThrow(/^--scene needs a value/)
    expect(() => parse(['--scene', '--all'], SCENES)).toThrow(/^--scene needs a value/)
    expect(() => parse(['--force'], SCENES)).toThrow(/^--force is not an option/)
  })

  // Each pair would mean nothing, and running one half of it would surprise.
  test('refuse the combinations that mean nothing', () => {
    expect(() => parse(['--all', '--scene', 'studio-drift'], SCENES)).toThrow('--all retakes every scene of an app, so it is not given with --scene')
    expect(() => parse(['--check', '--all'], SCENES)).toThrow(/^--check walks every scene of an app and writes nothing/)
    expect(() => parse(['--check', '--scene', 'host-stale'], SCENES)).toThrow(/^--check walks every scene/)
    expect(() => parse(['--app', 'studio', '--scene', 'host-stale'], SCENES)).toThrow('--scene host-stale is a host scene, and --app names studio')
  })

  // The BRIEF's "--review <WT>/x": refused before any app runs, and a
  // relative directory resolved here, since the apps run elsewhere.
  test('take a review directory outside the repository only, made absolute', () => {
    expect(() => parse(['--review', 'x'], SCENES, { cwd: REPO })).toThrow(/^--review x is inside the repository \(x\)/)
    expect(parse(['--review', '../pictures-review'], SCENES, { cwd: REPO }).review).toBe(OUTSIDE)
  })

  // The repository's own scenes: every app in them is one --app accepts.
  test("accept every app of the repository's scenes", () => {
    const apps = [...new Set(readScenes().map((scene) => scene.app))]
    expect(apps.sort()).toEqual(['examples', 'host', 'studio'])
    for (const app of apps) expect(parse(['--app', app], readScenes()).apps).toEqual([app])
  })
})

describe('the plan', () => {
  // Every app, in scenes.json's order, when nothing narrows it; a scene only
  // to the app that has it, so no app is asked for a scene it cannot take.
  test("runs the apps in scenes.json's order, each with only its own scenes", () => {
    expect(plan(parse([], SCENES), SCENES)).toEqual({ runs: [{ app: 'host', args: [] }, { app: 'examples', args: [] }, { app: 'studio', args: [] }], fresh: false, write: true })
    expect(plan(parse(['--scene', 'studio-drift', '--scene', 'host-stale', '--review', OUTSIDE], SCENES), SCENES).runs).toEqual([
      { app: 'host', args: ['--scene', 'host-stale', '--review', OUTSIDE] },
      { app: 'studio', args: ['--scene', 'studio-drift', '--review', OUTSIDE] },
    ])
  })

  // 0038's one look: only --all without --app may start a new look, so only
  // it starts from an empty record; --check writes neither pictures nor README.
  test('starts from an empty record only for --all without --app, and writes nothing for --check', () => {
    expect(plan(parse(['--all'], SCENES), SCENES)).toMatchObject({ fresh: true, write: true })
    expect(plan(parse(['--all', '--app', 'studio'], SCENES), SCENES)).toEqual({ runs: [{ app: 'studio', args: ['--all'] }], fresh: false, write: true })
    expect(plan(parse(['--check'], SCENES), SCENES)).toEqual({ runs: ['host', 'examples', 'studio'].map((app) => ({ app, args: ['--check'] })), fresh: false, write: false })
  })
})

describe('the record after --all', () => {
  // --all starts the apps from an empty record, so no app sees the date a
  // picture was first taken; without this, every --all would rewrite every
  // date and captured.json would change on a retake that changed no picture.
  test('keeps the date of every picture retaken as the same bytes and text', () => {
    const look = { platform: 'linux-x64', playwright: '1.63.0', chromium: '153.0.8010.12', fonts: {} }
    const before = { 'studio-connect': { captured: '2026-10-01', sha256: 'a', look, text: { Seen: '- region "x"' } }, 'studio-drift': { captured: '2026-10-01', sha256: 'b', look, text: { Drift: '- main "Drift"' } } }
    const after = { 'studio-connect': { ...before['studio-connect'], captured: '2026-10-09' }, 'studio-drift': { ...before['studio-drift'], captured: '2026-10-09', sha256: 'c' } }
    expect(redated(before, after, SCENES)).toEqual({ 'studio-connect': before['studio-connect'], 'studio-drift': after['studio-drift'] })
  })
})

describe('the table', () => {
  // What a reviewer lists in the pull request: which pictures are new, which
  // changed by their bytes, and which a retake left as they were.
  test('says of each scene its CSS size, its bytes, and whether its picture is new, changed or unchanged', () => {
    const before = { 'studio-connect': { css: { width: 842, height: 614 }, bytes: 149262, sha256: 'a' }, 'studio-drift': { css: { width: 892, height: 1357 }, bytes: 212320, sha256: 'b' } }
    const after = { ...before, 'studio-drift': { ...before['studio-drift'], sha256: 'c' }, 'host-stale': { css: { width: 1168, height: 1004 }, bytes: 94846, sha256: 'd' } }
    expect(table(before, after, SCENES).split('\n')).toEqual([
      'scene           CSS size   bytes   picture',
      'host-loaded     -          -       not taken',
      'examples-order  -          -       not taken',
      'studio-connect  842x614    149262  unchanged',
      'studio-drift    892x1357   212320  changed',
      'host-stale      1168x1004  94846   new',
    ])
  })
})
