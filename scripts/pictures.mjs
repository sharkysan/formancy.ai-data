// `pnpm pictures`: the README's pictures, taken app by app, and README.md's
// regions written from what was taken (0038).
//
//   pnpm pictures                       retake every picture whose text changed, or that has no record or no file
//   pnpm pictures --all                 retake every picture, on an empty record: the one way to a new look
//   pnpm pictures --app studio --all    retake every studio picture, on this machine's look
//   pnpm pictures --scene studio-drift  retake those scenes (repeatable)
//   pnpm pictures --check               walk every scene and compare its text with the record; write nothing
//   pnpm pictures --review <dir>        also write each new picture, decoded to PNG, into <dir> outside the repository
//
// Checks its arguments against scripts/pictures/scenes.json, runs each app's
// own apps/<app>/scripts/pictures.mjs in scenes.json's order, one after the
// other, then `node scripts/pictures/readme.mjs --write`, and prints one
// table: scene, CSS size, bytes, and whether the picture is new, changed or
// unchanged by its bytes.
//
// One look (0038): an app script refuses to write a picture taken on another
// look than the record's. `--all` without `--app` starts from an empty
// record, so every picture is taken on this machine's look; if any app fails,
// the record it started from is put back.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dated, IMAGES, ordered, outsideRepository, readScenes, RECORD, REPO, serialize } from './pictures/record.mjs'

const USAGE = 'pnpm pictures [--app <app>]... [--scene <id>]... [--all] [--check] [--review <dir outside the repository>]'

/** The apps that have scenes, in scenes.json's order: the order they run in. */
const appsOf = (scenes) => [...new Set(scenes.map((scene) => scene.app))]

/**
 * `argv` read against `scenes`, or a sentence saying what is wrong with it:
 * an unknown option, app or scene, an option without its value, and the
 * combinations that mean nothing -- `--all` with `--scene`, `--check` with
 * anything but `--app`, a scene of another app than `--app` names.
 */
export function parse(argv, scenes, { cwd = process.cwd() } = {}) {
  const apps = appsOf(scenes)
  const options = { apps: [], scenes: [], all: false, check: false, review: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]
    const value = () => {
      const given = argv[index + 1]
      if (given === undefined || given.startsWith('--')) throw new Error(`${option} needs a value: ${USAGE}`)
      index += 1
      return given
    }
    if (option === '--app') {
      const app = value()
      if (!apps.includes(app)) throw new Error(`--app ${app} is no app with a scene in scripts/pictures/scenes.json; those are ${apps.join(', ')}`)
      options.apps.push(app)
    } else if (option === '--scene') {
      const id = value()
      if (!scenes.some((scene) => scene.id === id)) throw new Error(`--scene ${id} is no scene of scripts/pictures/scenes.json`)
      options.scenes.push(id)
    } else if (option === '--all') options.all = true
    else if (option === '--check') options.check = true
    else if (option === '--review') {
      if (options.review !== undefined) throw new Error('--review is given twice')
      options.review = outsideRepository(value(), cwd)
    } else throw new Error(`${option} is not an option: ${USAGE}`)
  }
  if (options.all && options.scenes.length > 0) throw new Error('--all retakes every scene of an app, so it is not given with --scene')
  if (options.check && (options.all || options.scenes.length > 0 || options.review !== undefined)) throw new Error('--check walks every scene of an app and writes nothing, so it takes --app and nothing else')
  for (const id of options.scenes) {
    const { app } = scenes.find((scene) => scene.id === id)
    if (options.apps.length > 0 && !options.apps.includes(app)) throw new Error(`--scene ${id} is a ${app} scene, and --app names ${options.apps.join(', ')}`)
  }
  return options
}

/**
 * What runs, in scenes.json's order of apps: each app with its own flags,
 * a scene only to the app that has it; `fresh` when the whole set is retaken
 * on an empty record, and `write` unless only checking.
 */
export function plan(options, scenes) {
  const appOf = (id) => scenes.find((scene) => scene.id === id).app
  const chosen = new Set(options.scenes.length > 0 ? options.scenes.map(appOf) : options.apps.length > 0 ? options.apps : appsOf(scenes))
  const runs = appsOf(scenes)
    .filter((app) => chosen.has(app))
    .map((app) => ({
      app,
      args: [
        ...(options.check ? ['--check'] : []),
        ...(options.all ? ['--all'] : []),
        ...options.scenes.filter((id) => appOf(id) === app).flatMap((id) => ['--scene', id]),
        ...(options.review === undefined ? [] : ['--review', options.review]),
      ],
    }))
  return { runs, fresh: options.all && options.apps.length === 0, write: !options.check }
}

/**
 * `after` with each entry dated as `before` dates it where the picture is
 * the same (record.mjs's `dated`): `--all` runs the apps on an empty record,
 * so this is where an unchanged picture gets its first date back.
 */
export const redated = (before, after, scenes) => ordered(Object.fromEntries(Object.entries(after).map(([id, next]) => [id, dated(before[id], next)])), scenes)

/** One row per scene: its CSS size and bytes as recorded now, and whether its picture is new, changed or unchanged since `before`. */
export function table(before, after, scenes) {
  const rows = scenes.map((scene) => {
    const now = after[scene.id]
    if (now === undefined) return [scene.id, '-', '-', 'not taken']
    const was = before[scene.id]
    const state = was === undefined ? 'new' : was.sha256 === now.sha256 ? 'unchanged' : 'changed'
    return [scene.id, `${String(now.css.width)}x${String(now.css.height)}`, String(now.bytes), state]
  })
  const head = ['scene', 'CSS size', 'bytes', 'picture']
  const widths = head.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)))
  return [head, ...rows].map((row) => row.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd()).join('\n')
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: REPO, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.error !== undefined) throw result.error
  return result.status === 0
}

function main() {
  const scenes = readScenes()
  const options = parse(process.argv.slice(2), scenes)
  const { runs, fresh, write } = plan(options, scenes)
  for (const { app } of runs) {
    if (!existsSync(join(REPO, 'apps', app, 'scripts', 'pictures.mjs'))) throw new Error(`apps/${app}/scripts/pictures.mjs does not exist, so the ${app} scenes cannot be taken or checked`)
  }
  const kept = existsSync(RECORD) ? readFileSync(RECORD, 'utf8') : undefined
  const before = kept === undefined ? {} : JSON.parse(kept)
  if (fresh) {
    mkdirSync(IMAGES, { recursive: true })
    writeFileSync(RECORD, serialize({}, scenes), 'utf8')
    console.log('pictures: --all without --app, so every picture is retaken on an empty record and on this machine\'s look')
  }
  for (const { app, args } of runs) {
    console.log(`\npictures: ${app} ${args.join(' ')}`.trimEnd())
    if (run('pnpm', ['--filter', `@formancy/data-${app}`, 'exec', 'node', 'scripts/pictures.mjs', ...args])) continue
    if (fresh) {
      if (kept === undefined) rmSync(RECORD, { force: true })
      else writeFileSync(RECORD, kept, 'utf8')
      console.error('pictures: captured.json is as it was before this run; pictures already retaken are not, and `git checkout docs/images/readme` puts them back')
    }
    throw new Error(`the ${app} pictures ${options.check ? 'check' : 'run'} failed`)
  }
  if (!write) return
  if (fresh) writeFileSync(RECORD, serialize(redated(before, JSON.parse(readFileSync(RECORD, 'utf8')), scenes), scenes), 'utf8')
  if (!run('node', ['scripts/pictures/readme.mjs', '--write'])) throw new Error('README.md could not be written from the record')
  const after = JSON.parse(readFileSync(RECORD, 'utf8'))
  console.log(`\n${table(before, after, scenes)}`)
}

// Run as a command, not when a test imports it: by the file itself, since every app's script has this one's name too.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(`pictures: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
