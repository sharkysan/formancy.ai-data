import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/**
 * The admin's palette, copied by hand into every app here, held to one value
 * per variable.
 *
 * CLAUDE.md asks each UI to wear formancy.ai's admin.css variables, and an
 * application's stylesheet is not a package this repository can depend on, so
 * each app copies them. Three copies now -- the examples page, the studio and
 * the host page -- and nothing failed when one moved without the others. This
 * narrows "copied by hand" to one gap, upstream's: when admin.css changes
 * there, these still agree with each other, and with it only by review.
 *
 * Which files are copies is derived, never listed: every stylesheet under
 * apps/ whose `:root` block carries the comment naming admin.css. A fourth
 * app that copies the palette is compared without anybody editing this.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The comment each copy opens its variables with, which is what makes it a copy. */
const MARK = '/* formancy.ai apps/admin/src/admin.css */'

/** Installed, built or measured, never written. */
const SKIP = new Set(['node_modules', 'dist', 'coverage'])

/** Every `.css` file under apps/, as a path from the repository root and its text. */
function stylesheets() {
  const found = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue
      const full = join(directory, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.endsWith('.css')) found.push({ path: relative(repo, full).replaceAll('\\', '/'), text: readFileSync(full, 'utf8') })
    }
  }
  walk(join(repo, 'apps'))
  return found
}

/**
 * The custom properties of the `:root` block that carries the mark, by name,
 * each value with its whitespace collapsed and comments removed: what the
 * browser would compute, not how the file happens to be laid out.
 */
function palette(text) {
  const block = /:root\s*\{([^}]*)\}/g
  for (const match of text.matchAll(block)) {
    const body = match[1] ?? ''
    if (!body.includes(MARK)) continue
    const declarations = body.replaceAll(/\/\*[\s\S]*?\*\//g, '')
    return Object.fromEntries(
      [...declarations.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, String(value).replaceAll(/\s+/g, ' ').trim()]),
    )
  }
  return undefined
}

const copies = stylesheets()
  .map(({ path, text }) => ({ path, values: palette(text) }))
  .filter((copy) => copy.values !== undefined)

describe("the admin's palette, in every app that copies it", () => {
  // A guard on the guard: the comparison below is vacuous over one copy, and
  // over copies that declare nothing. The three apps that copy it today, and
  // the variables every one of them is drawn with.
  test('is found where it is copied', () => {
    expect(copies.map(({ path }) => path)).toEqual(expect.arrayContaining(['apps/examples/src/app.css', 'apps/studio/src/styles/room.css', 'apps/host/src/styles/room.css']))
    for (const { path, values } of copies) expect({ path, has: Object.keys(values ?? {}) }).toEqual({ path, has: expect.arrayContaining(['--ground', '--text', '--muted', '--client', '--server']) })
  })

  // The failure this prevents is one app's colour moved -- a muted grey
  // darkened to fix a contrast finding in one place -- and the same room
  // quietly becoming two. Said as every variable on which the copies differ,
  // with each copy's value, so a failure names what to reconcile.
  test('says the same thing in every copy', () => {
    const [first, ...rest] = copies
    const names = [...new Set(copies.flatMap(({ values }) => Object.keys(values ?? {})))].sort()
    const differing = names
      .filter((name) => rest.some(({ values }) => values?.[name] !== first?.values?.[name]))
      .map((name) => `${name}: ${copies.map(({ path, values }) => `${path} ${values?.[name] ?? '(missing)'}`).join(' | ')}`)
    expect(differing, 'the copies of the palette disagree').toEqual([])
  })
})
