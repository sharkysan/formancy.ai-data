import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { ROOM_GRID } from './grid-theme.js'

/*
 * The grid in the room (0047): AG Grid is recoloured only through its theme
 * parameters, each a variable of the room's or an opaque mix of parameters
 * that are: the admin's palette, @formancy/themes/room.css, which the page
 * imports and no stylesheet here declares again (0096), so the grid moves
 * with the room. No stylesheet of the host's reaches into the grid: a rule on
 * an `.ag-*` class or an `--ag-*` property breaks in AG Grid's minor
 * releases and would be a second palette.
 *
 * Read from the code and the stylesheets, never from wording.
 */

const source = dirname(fileURLToPath(import.meta.url))
const styles = join(source, 'styles')

/** The variables a stylesheet declares at the start of a line. */
const declared = (file: string): string[] => [...readFileSync(file, 'utf8').matchAll(/^\s*(--[\w-]+):/gm)].map((match) => String(match[1]))

/** The room's variables: the admin's palette as formancy publishes it, and the two font stacks the page's own room.css adds. */
const ROOM = new Set([...declared(createRequire(import.meta.url).resolve('@formancy/themes/room.css')), ...declared(join(styles, 'room.css'))])

/** Every value in the parameters that is a string, with the path it is at. */
function strings(value: unknown, at: string): Array<[string, string]> {
  if (typeof value === 'string') return [[at, value]]
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([key, inner]) => strings(inner, `${at}.${key}`))
}

describe("the grid's theme parameters", () => {
  // A literal colour is one the palette guard cannot see: the grid would
  // drift from the room the first time the room moves. `browserColorScheme`
  // and a border's `style` are keywords, not colours; a mix's `ref` and
  // `onto` name parameters.
  test('are room variables, or mixes of parameters that are', () => {
    const named = new Set(Object.keys(ROOM_GRID))
    const loose = strings(ROOM_GRID, 'params').filter(([at, value]) => {
      if (at === 'params.browserColorScheme') return value !== 'dark'
      if (at.endsWith('Border.style')) return value !== 'solid'
      if (/\.(ref|onto)$/.test(at)) return !named.has(value) || !/^var\(--/.test(String(ROOM_GRID[value as keyof typeof ROOM_GRID]))
      const variable = /^var\((--[\w-]+)\)$/.exec(value)?.[1]
      return variable === undefined || !ROOM.has(variable)
    })
    expect(ROOM.size).toBeGreaterThan(5)
    expect(loose).toEqual([])
  })

  // The focused cell is drawn by the range-selection border, which defaults
  // to the accent: violet, the room's colour for what a person acts on. The
  // room's focus is teal, and the gate measures it against both rows.
  test("draw the focus in the room's teal", () => {
    expect(ROOM_GRID.rangeSelectionBorderColor).toBe('var(--server)')
    expect(ROOM_GRID.focusShadow).toEqual({ spread: 2, color: 'var(--server)' })
  })
})

/** Every stylesheet under src/, host.css and the files it imports included, by its path from src/. */
function stylesheets(): string[] {
  return readdirSync(source, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.css'))
}

// The theme is the only way in: a rule of the host's that selected an AG Grid
// class or set one of its properties would recolour it behind the guard
// above, and break silently when AG Grid renames its classes. Every
// stylesheet under src/, so host.css, which imports the others, is read too
// (watched failing with a `.grid-bench .ag-cell` rule in styles/records.css,
// and in host.css).
test("no stylesheet of the host's reaches into the grid", () => {
  const files = stylesheets()
  expect(files).toContain('host.css')
  const reaching = files.flatMap((file) =>
    readFileSync(join(source, file), 'utf8')
      .replaceAll(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => /\.ag-|--ag-/.test(line))
      .map((line) => `${file}: ${line.trim()}`),
  )
  expect(reaching).toEqual([])
})
