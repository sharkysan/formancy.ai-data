import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { REPO } from './record.mjs'
import { appOptions, field, notShot, reasonToShoot, said } from './session.mjs'

/**
 * What an app's pictures script decides before and between its scenes
 * (0038), decided once in session.mjs for the three apps: which arguments it
 * takes, and which scenes it shoots. The walk itself needs the app's page and
 * a browser, and runs as the apps' `pictures.mjs`.
 */

const SCENES = [
  { id: 'host-loaded', app: 'host' },
  { id: 'studio-connect', app: 'studio' },
  { id: 'studio-drift', app: 'studio' },
]
const OUTSIDE = join(REPO, '..', 'pictures-review')

describe("an app script's arguments", () => {
  // The root runner passes an app only its own scenes; a person running the
  // app script by hand must get the same refusals, or a scene of another app
  // would be walked by nobody and the run would say it succeeded.
  test('are the runner\'s, for this app only', () => {
    expect(appOptions(['--scene', 'studio-drift', '--review', OUTSIDE], SCENES, 'studio')).toEqual({ apps: [], scenes: ['studio-drift'], all: false, check: false, review: OUTSIDE })
    expect(appOptions(['--check'], SCENES, 'studio')).toMatchObject({ check: true })
    expect(() => appOptions(['--scene', 'host-loaded'], SCENES, 'studio')).toThrow('--scene host-loaded is a host scene, and this is apps/studio/scripts/pictures.mjs')
    expect(() => appOptions(['--app', 'studio'], SCENES, 'studio')).toThrow("--app is the root runner's option: apps/studio/scripts/pictures.mjs takes its own scenes only")
    expect(() => appOptions(['--all', '--scene', 'studio-drift'], SCENES, 'studio')).toThrow('--all retakes every scene of an app, so it is not given with --scene')
    expect(() => appOptions(['--review', join(REPO, 'x')], SCENES, 'studio')).toThrow(/is inside the repository/)
  })
})

describe('what an app script prints when it fails', () => {
  // A timeout's call log can quote the value an action was given -- a host
  // token typed into the sign-in -- and a driver's error the URL it used;
  // either would reach a CI log that anybody with access to the run reads.
  test('has every secret of the plane taken out', () => {
    const error = new Error('locator.fill("pictures-host-clara"): postgres://formancy_writer:writer-fixture-password@localhost:5432/x refused')
    expect(said(error, ['pictures-host-clara', 'writer-fixture-password', ''])).toBe('locator.fill("[a secret]"): postgres://formancy_writer:[a secret]@localhost:5432/x refused')
    expect(said('a string thrown', [])).toBe('a string thrown')
  })
})

describe("a field's name", () => {
  // The renderers name a required field "Amount*"; an act that asked for
  // "Amount" exactly would find nothing, and one that asked loosely would
  // also find "Amount due" -- a hold on the wrong field passes for the wrong reason.
  test('is its label, with the required marker or without it, and nothing else', () => {
    expect(field('Amount').test('Amount*')).toBe(true)
    expect(field('Amount').test('Amount')).toBe(true)
    expect(field('Amount').test('Amount due')).toBe(false)
    expect(field('Amount').test('Amount**')).toBe(false)
    expect(field('Order date').test('Order date*')).toBe(true)
  })
})

describe('which scene is shot', () => {
  const text = { Seen: '- region "What ms-reader can see"' }
  const picture = Buffer.from('a picture')
  const recorded = { text, bytes: picture.length, sha256: createHash('sha256').update(picture).digest('hex') }
  // `file` is read with `in`, because a default would stand in for the `undefined` that means "no picture".
  const shoot = (argv, changes = {}) => {
    const { record = { 'studio-connect': recorded }, now = text } = changes
    return reasonToShoot({ options: appOptions(argv, SCENES, 'studio'), id: 'studio-connect', record, text: now, picture: 'file' in changes ? changes.file : picture })
  }

  // The default is "retake what is stale": a picture whose text is the
  // record's is left as it is, and every other one is retaken, saying why.
  test('by default, only one whose text changed, or that has no record or no picture, or a picture that is not its record\'s', () => {
    expect(shoot([])).toBeUndefined()
    expect(shoot([], { now: { Seen: '- region "What ms-reader can see":\n  - list' } })).toBe('its text changed')
    expect(shoot([], { record: {} })).toBe('it has no record')
    expect(shoot([], { file: undefined })).toBe('it has no picture')
    expect(shoot([], { file: Buffer.from('another picture') })).toBe('its picture is not the one its record describes')
  })

  // --all and --scene shoot what they name, whatever the record says; --check
  // shoots nothing, so a check can never write a picture.
  test('with --all every one, with --scene those named, with --check none', () => {
    expect(shoot(['--all'])).toBe('--all')
    expect(shoot(['--scene', 'studio-connect'])).toBe('--scene')
    expect(shoot(['--scene', 'studio-drift'])).toBeUndefined()
    expect(shoot(['--check'], { record: {} })).toBeUndefined()
  })
})

describe('what a scene that is not shot is said to be', () => {
  const text = { Seen: '- region "What ms-reader can see"' }
  const line = (argv, now = text) => notShot({ options: appOptions(argv, SCENES, 'studio'), id: 'studio-connect', record: { 'studio-connect': { text } }, text: now })

  // Under --scene a scene not named is walked and its text read, but it was
  // said to be "the record's" without being compared: a scene whose text had
  // changed was reported unchanged. Watched failing with that line.
  test('under --scene, compared with its record and said either way, and never retaken', () => {
    expect(line(['--scene', 'studio-drift'])).toBe("not named by --scene; its text is the record's")
    expect(line(['--scene', 'studio-drift'], { Seen: '- region "What ms-reader can see":\n  - list' })).toBe("not named by --scene, and its text is not the record's: `pnpm pictures --scene studio-connect` retakes it")
  })

  // By default a scene is left only when its text is the record's; under
  // --check nothing is shot, and the check says afterwards what differs.
  test("by default the record's, and under --check walked", () => {
    expect(line([])).toBe("its text is the record's, so it is not retaken")
    expect(line(['--check'])).toBe('walked')
  })
})
