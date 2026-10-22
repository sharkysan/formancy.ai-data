import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/**
 * The admin's palette, worn from formancy rather than copied (0096).
 *
 * CLAUDE.md asks each UI to wear formancy.ai's admin.css variables. Until
 * formancy 0.6.0 an application's stylesheet was not a package, so each app
 * here copied them, and this guard held the copies to each other while
 * nothing held them to upstream. 0.6.0 publishes the palette as
 * `@formancy/themes/room.css` (formancy.ai 0178), the file upstream's admin
 * imports itself; so every app imports it, and the palette is the release
 * this repository pins (0002). What this holds is that nobody copies it again:
 * a stylesheet here that declares one of its variables would draw a room of
 * its own over upstream's, quietly.
 *
 * Which apps wear it is derived, never listed: every app under apps/ whose
 * own stylesheets read one of room.css's variables. A fourth app that draws
 * with the palette is held without anybody editing this.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

/** room.css as the apps resolve it: from an app's own dependencies, at the version pnpm installed. */
const ROOM = createRequire(join(repo, 'apps', 'host', 'package.json')).resolve('@formancy/themes/room.css')

/** Installed, built or measured, never written. */
const SKIP = new Set(['node_modules', 'dist', 'coverage'])

/** Every `.css` file under `directory`, as a path from the repository root and its text. */
function stylesheets(directory) {
  const found = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.endsWith('.css')) found.push({ path: relative(repo, full).replaceAll('\\', '/'), text: readFileSync(full, 'utf8') })
    }
  }
  walk(directory)
  return found
}

/** A stylesheet's text with its comments removed, so a variable named in prose is neither declared nor read. */
function code(text) {
  return text.replaceAll(/\/\*[\s\S]*?\*\//g, '')
}

/** The custom properties a stylesheet declares, anywhere in it. */
function declared(text) {
  return [...code(text).matchAll(/(--[\w-]+)\s*:/g)].map(([, name]) => String(name))
}

const variables = [...new Set(declared(readFileSync(ROOM, 'utf8')))]

/** Every app's directory, with the room's variables its own stylesheets read. */
const apps = readdirSync(join(repo, 'apps'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const sheets = stylesheets(join(repo, 'apps', entry.name, 'src'))
    const reads = variables.filter((name) => sheets.some(({ text }) => code(text).includes(`var(${name})`)))
    return { app: `apps/${entry.name}`, sheets, reads }
  })
const wearing = apps.filter(({ reads }) => reads.length > 0)

describe("the admin's palette", () => {
  // A guard on the guard: every check below is vacuous over a room.css that
  // declares nothing, or over no app. The variables every app draws with, and
  // the three apps that draw with them today.
  test('is read from the formancy release this repository pins, and worn by the apps', () => {
    expect(variables).toEqual(expect.arrayContaining(['--ground', '--text', '--muted', '--client', '--server']))
    expect(wearing.map(({ app }) => app)).toEqual(expect.arrayContaining(['apps/examples', 'apps/studio', 'apps/host']))
  })

  // An app that reads the variables without importing room.css draws with
  // nothing: every colour falls back to the browser's, which no check of
  // its own stylesheet sees. Imported from the entry before the app's own
  // stylesheet, as the theme is, so the app's rules come after the palette.
  test('is imported by every app that draws with it, before its own stylesheet', () => {
    const missing = wearing.flatMap(({ app }) => {
      const entry = readFileSync(join(repo, app, 'src', 'main.tsx'), 'utf8')
      const room = entry.indexOf("import '@formancy/themes/room.css'")
      const own = entry.search(/import '\.\/[^']+\.css'/)
      if (room === -1) return [`${app}/src/main.tsx does not import @formancy/themes/room.css`]
      return own !== -1 && own < room ? [`${app}/src/main.tsx imports its own stylesheet before room.css`] : []
    })
    expect(missing).toEqual([])
  })

  // The failure this prevents is the copy coming back: a muted grey darkened
  // in one app to fix a contrast finding, and the same room quietly becoming
  // two, one of them nobody upstream knows about. Said as each stylesheet and
  // the variable it declares, so a failure names what to remove.
  test('is declared by no stylesheet of any app', () => {
    const copied = apps.flatMap(({ sheets }) => sheets.flatMap(({ path, text }) => declared(text).filter((name) => variables.includes(name)).map((name) => `${path} ${name}`)))
    expect(copied).toEqual([])
  })
})
