// The README pictures' scenes and their record (0038): scripts/pictures/scenes.json,
// written by hand, and docs/images/readme/captured.json, written only by a
// capture. What a capture may write, what `--check` compares, and what
// readme.test.mjs holds the two files to are decided here once, so the three
// apps' scripts and the repository guard cannot disagree about any of it.
//
// Node built-ins only, and pure but for the two readers and the writer at the
// end: an app script imports it from the apps, the root test from the root.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decode, occursIn } from './aria-text.mjs'

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const SCENES = join(REPO, 'scripts', 'pictures', 'scenes.json')
export const IMAGES = join(REPO, 'docs', 'images', 'readme')
export const RECORD = join(IMAGES, 'captured.json')

/** Where a scene's picture is, relative to the repository: what the record's `file` says and the README's `src` points at. */
export const pictureOf = (id) => `docs/images/readme/${id}.webp`

/** The text of every “…” in `text`, in order. Throws on a mark left open or closed twice, which would quote nothing anybody checks. */
export function quotations(text) {
  const found = []
  let open = -1
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '“') {
      if (open !== -1) throw new Error(`a quotation is opened inside another: ${text.slice(open, index + 1)}`)
      open = index
    } else if (text[index] === '”') {
      if (open === -1) throw new Error(`a quotation is closed that was never opened: …${text.slice(Math.max(0, index - 40), index + 1)}`)
      found.push(text.slice(open + 1, index))
      open = -1
    }
  }
  if (open !== -1) throw new Error(`a quotation is never closed: ${text.slice(open, open + 60)}`)
  return found
}

/**
 * What is wrong between `scene`'s quotes and `text`, the parts' snapshots by
 * part name: a “…” in its caption or alt that its `quotes` does not list, a
 * listed quote its caption and alt do not have, a part it names that the
 * picture does not have, and a quote not inside one decoded name or value of
 * a part it names. Empty when the caption quotes only what its picture shows.
 * With no `text` -- a scene not taken yet -- only the caption and alt are
 * held to the keys.
 */
export function misquotes(scene, text) {
  const problems = []
  let written
  try {
    written = [...quotations(scene.caption ?? ''), ...quotations(scene.alt ?? '')]
  } catch (error) {
    return [`${scene.id}: ${error.message}`]
  }
  const quotes = scene.quotes ?? {}
  for (const quote of new Set(written)) {
    if (!Object.hasOwn(quotes, quote)) problems.push(`${scene.id}: “${quote}” is quoted in its caption or alt and is not a key of its quotes, so nothing holds it to the picture`)
  }
  for (const [quote, parts] of Object.entries(quotes)) {
    if (!written.includes(quote)) problems.push(`${scene.id}: “${quote}” is a key of its quotes and is quoted in neither its caption nor its alt`)
    if (!Array.isArray(parts) || parts.length === 0) {
      problems.push(`${scene.id}: “${quote}” names no part it must occur in`)
      continue
    }
    if (text === undefined) continue
    for (const part of parts) {
      if (text[part] === undefined) {
        problems.push(`${scene.id}: “${quote}” must occur in the part ${part}, which the picture does not have`)
        continue
      }
      let found
      try {
        found = occursIn(quote, text[part])
      } catch (error) {
        problems.push(`${scene.id}, part ${part}: ${error.message}`)
        continue
      }
      if (!found) problems.push(`${scene.id}: “${quote}” is not inside one name or value of what the part ${part} says, so the caption quotes what its picture does not show`)
    }
  }
  return problems
}

/** Every line of every part of `text` that the decoder cannot read, said. */
export function undecodable(id, text) {
  const problems = []
  for (const [part, snapshot] of Object.entries(text ?? {})) {
    try {
      decode(snapshot)
    } catch (error) {
      problems.push(`${id}, part ${part}: ${error.message}`)
    }
  }
  return problems
}

/** A look as a person reads it in a refusal. */
export function describeLook(look) {
  const fonts = Object.entries(look?.fonts ?? {}).map(([family, version]) => `${family} ${version}`)
  return `${look?.platform}, Playwright ${look?.playwright}, Chromium ${look?.chromium}, ${fonts.join(', ')}`
}

const sameLook = (left, right) => describeLook(left) === describeLook(right)

/**
 * The record entry for one scene's picture, in the order captured.json keeps
 * every entry: where the file is and when it was taken, what it was taken
 * with, its size and bytes, what it shows and on what, and each part's text.
 */
export function entry(id, { captured, settings, clip, picture, look, database, stylesheet, text }) {
  return {
    file: pictureOf(id),
    captured,
    viewport: { width: settings.width, height: settings.height },
    deviceScaleFactor: settings.deviceScaleFactor,
    locale: settings.locale,
    timezone: settings.timezoneId,
    css: { width: clip.width, height: clip.height },
    bytes: picture.length,
    sha256: createHash('sha256').update(picture).digest('hex'),
    look,
    database,
    stylesheet,
    text,
  }
}

/**
 * `next` with `previous`'s date when it is the same picture -- the same
 * bytes, the same text, on the same look -- taken again: `captured` is when
 * these pixels were first taken, so a retake that changed nothing changes
 * no line of captured.json.
 */
export function dated(previous, next) {
  if (previous === undefined) return next
  const same = previous.sha256 === next.sha256 && JSON.stringify(previous.text) === JSON.stringify(next.text) && sameLook(previous.look, next.look)
  return same ? { ...next, captured: previous.captured } : next
}

/** `record`'s entries in scenes.json's order, with any entry no scene has kept after them, for the guard to name. */
export function ordered(record, scenes) {
  const ids = scenes.map((scene) => scene.id)
  const known = ids.filter((id) => Object.hasOwn(record, id)).map((id) => [id, record[id]])
  const unknown = Object.keys(record).filter((id) => !ids.includes(id)).map((id) => [id, record[id]])
  return Object.fromEntries([...known, ...unknown])
}

/** captured.json's text: pretty-printed, keyed in scenes.json's order, LF only, one newline at the end. */
export const serialize = (record, scenes) => `${JSON.stringify(ordered(record, scenes), null, 2)}\n`

/**
 * `record` with `next` written as scene `id`'s entry, or a refusal: for a
 * scene scenes.json does not have, for a caption that would misquote the new
 * text, and for a look other than the one every existing entry was taken on
 * (0038's one look). Pure; the caller writes what it returns.
 */
export function withEntry(record, scenes, id, next) {
  const scene = scenes.find((candidate) => candidate.id === id)
  if (scene === undefined) throw new Error(`${id} is not a scene of scripts/pictures/scenes.json, so it has no caption to be held to`)
  const problems = [...undecodable(id, next.text), ...misquotes(scene, next.text)]
  if (problems.length > 0) throw new Error(`${id} was not written, because its caption or alt would not be true of it:\n  ${problems.join('\n  ')}`)
  const other = Object.values(record).find((existing) => !sameLook(existing.look, next.look))
  if (other !== undefined) {
    throw new Error(`the pictures were taken on ${describeLook(other.look)}; this machine has ${describeLook(next.look)}; \`pnpm pictures --all\` retakes every picture`)
  }
  return ordered({ ...record, [id]: dated(record[id], next) }, scenes)
}

/** scenes.json as written. */
export const readScenes = () => JSON.parse(readFileSync(SCENES, 'utf8'))

/** captured.json, or an empty record where there is none yet. */
export const readRecord = () => (existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, 'utf8')) : {})

export const writeRecord = (record, scenes) => writeFileSync(RECORD, serialize(record, scenes), 'utf8')

/**
 * `dir` as an absolute path, refused when it is inside the repository: what
 * `--review` writes is for a reviewer to open, never to be committed by a
 * `git add` that sweeps it up.
 */
export function outsideRepository(dir, cwd = process.cwd()) {
  const absolute = resolve(cwd, dir)
  const inside = relative(REPO, absolute)
  if (inside === '' || (inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))) {
    throw new Error(`--review ${dir} is inside the repository (${inside === '' ? '.' : inside.split(sep).join('/')}); give a directory outside it, so the decoded pictures are never committed`)
  }
  return absolute
}

/** The lines of `before` and `after` as a line diff, `-` for a recorded line and `+` for a running one, unchanged lines left out. */
export function lineDiff(before, after) {
  const [a, b] = [before.split('\n'), after.split('\n')]
  // Longest common subsequence, by table: a snapshot is at most a few hundred lines.
  const lengths = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1])
  const out = []
  let [i, j] = [0, 0]
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) [i, j] = [i + 1, j + 1]
    // A recorded line first, as a diff reads: what was, then what is.
    else if (i < a.length && (j === b.length || lengths[i + 1][j] >= lengths[i][j + 1])) out.push(`- ${a[i++]}`)
    else out.push(`+ ${b[j++]}`)
  }
  return out
}

/**
 * The app's scenes against its act table, in `checkProblems`' order: an
 * empty table first and alone, then a scene with no act and an act with no
 * scene. Asked before any walk too, so an act is never walked without the
 * scene it reads its step and quotes from.
 */
export function pairingProblems({ app, scenes, actIds }) {
  if (actIds.length === 0) return [`${app}: compared no scene, so nothing held its pictures`]
  const problems = []
  const sceneIds = scenes.filter((scene) => scene.app === app).map((scene) => scene.id)
  for (const id of sceneIds) if (!actIds.includes(id)) problems.push(`${app}: the scene ${id} has no act, so its picture is held by nothing`)
  for (const id of actIds) if (!sceneIds.includes(id)) problems.push(`${app}: the act ${id} is no scene of scripts/pictures/scenes.json`)
  return problems
}

/**
 * What `--check` fails with for `app`, in order: no scene compared at all;
 * then a scene of the app with no act, or an act with no scene; then each
 * part whose running text is not the recorded text, with a line diff and the
 * recorded and running Playwright versions. `running` is each walked scene's
 * text by part; `actIds` the keys of the app's act table.
 */
export function checkProblems({ app, scenes, record, actIds, running, playwright }) {
  const compared = Object.keys(running)
  if (compared.length === 0) return [`${app}: compared no scene, so nothing held its pictures`]
  const problems = pairingProblems({ app, scenes, actIds })
  for (const id of compared) {
    const recorded = record[id]?.text
    if (recorded === undefined) {
      problems.push(`${id}: has no record to compare with; \`pnpm pictures --scene ${id}\` takes it`)
      continue
    }
    for (const part of new Set([...Object.keys(recorded), ...Object.keys(running[id])])) {
      const [was, is] = [recorded[part], running[id][part]]
      if (was === is) continue
      if (was === undefined || is === undefined) {
        problems.push(`${id}: the part ${part} is ${was === undefined ? 'not in the record' : 'no longer in the picture'}`)
        continue
      }
      problems.push(
        `${id}, part ${part}: the page now says something else than its picture (recorded with Playwright ${record[id].look?.playwright}, running ${playwright}); \`pnpm pictures --scene ${id}\` retakes it\n    ${lineDiff(was, is).join('\n    ')}`,
      )
    }
  }
  return problems
}

/**
 * The stylesheet notice: each scene of the app whose record names another
 * stylesheet digest than the app's now. A notice, not a failure -- a change
 * of style alone leaves every text equal, and only a look at the pictures
 * can say whether they still look like the page.
 */
export function stylesheetNotices({ app, scenes, record, stylesheet }) {
  const stale = scenes.filter((scene) => scene.app === app && record[scene.id] !== undefined && record[scene.id].stylesheet !== stylesheet).map((scene) => scene.id)
  if (stale.length === 0) return []
  return [`${app}'s stylesheet changed since ${stale.join(', ')} ${stale.length === 1 ? 'was' : 'were'} taken; the text check cannot see what that did to the pictures, so look at them, and \`pnpm pictures --scene <id>\` retakes one`]
}

/**
 * Says `notices` where a person and GitHub both see them: printed, and under
 * GitHub Actions also as a warning annotation and in the step summary, which
 * GitHub reads even when turbo prefixes the annotation's line.
 */
export function announce(notices, { env = process.env, print = console.log, append = (file, text) => writeFileSync(file, text, { flag: 'a' }) } = {}) {
  for (const notice of notices) {
    print(`notice: ${notice}`)
    if (env.GITHUB_ACTIONS !== 'true') continue
    print(`::warning title=README pictures::${notice.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`)
    if (env.GITHUB_STEP_SUMMARY) append(env.GITHUB_STEP_SUMMARY, `> **README pictures:** ${notice}\n\n`)
  }
}
