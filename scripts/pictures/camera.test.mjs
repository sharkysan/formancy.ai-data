import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { fontPackages } from '../fonts.mjs'
import { fonts, foreignFaces, lookFonts, MARGIN, padded, SETTINGS, stylesheet, widestBreakpoint } from './camera.mjs'
import { REPO } from './record.mjs'

/**
 * The camera's decisions that need no browser (0038): the settings every
 * picture is taken in, the width it is taken past, and what the look says
 * of the faces the pictures were drawn in, and where they came from (0072).
 * Its browser half -- the font wait, the intrusion check, the settle loop,
 * the encoder -- runs at every capture and was watched refusing in Chromium
 * (0038 lists how).
 */

describe('the settings', () => {
  // §3 of the design: a picture taken at another scale, locale or time zone
  // would show other dates and other pixels for the same state.
  test('are the ones every picture is taken in', () => {
    expect(SETTINGS).toEqual({ deviceScaleFactor: 2, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce', colorScheme: 'light', height: 900 })
  })
})

describe('the clip', () => {
  // A part with no frame or padding of its own ran into the picture's edge --
  // the examples' papers at 0 px, the studio's Connect heading at 0.5 px
  // (measured on the pictures, 2026-10-10) -- and looked cut out of the page.
  // Watched failing with the clip as the parts' union alone.
  test('keeps MARGIN of the bench on every side of the parts', () => {
    expect(MARGIN).toBe(16)
    expect(padded({ x: 100, y: 200, width: 300, height: 400 }, MARGIN, { width: 1200, height: 2000 })).toEqual({ x: 84, y: 184, width: 332, height: 432 })
  })

  // The bench stops short of what is drawn beside the parts, side by side: a
  // clip grown by one number on every side showed a sliver of the Steps panel
  // beside each studio step (2026-10-10).
  test('keeps what the bench leaves on each side, and no more', () => {
    expect(padded({ x: 296, y: 100, width: 892, height: 400 }, { top: 0, right: 12, bottom: 0, left: 12 }, { width: 1200, height: 2000 })).toEqual({ x: 284, y: 100, width: 916, height: 400 })
  })

  // A margin past the page's edge would be a box the full-page shot cannot
  // take, and a picture of nothing at its side.
  test('stops at the edges of the page', () => {
    expect(padded({ x: 4, y: 0, width: 1190, height: 600 }, MARGIN, { width: 1200, height: 610 })).toEqual({ x: 0, y: 0, width: 1200, height: 610 })
  })
})

describe('the widest breakpoint', () => {
  // The apps' pictures are of the wide layout; a width at or below the
  // widest max-width would picture the narrow one under a wide caption.
  test("is read from each app's stylesheet as its gate inlines it", () => {
    expect(widestBreakpoint(stylesheet(join(REPO, 'apps', 'studio', 'src'), 'studio.css'), 'studio.css')).toBe(1024)
    // The workspace's widest tier, 80rem, where Forms turns from a sidebar into tabs (0047).
    expect(widestBreakpoint(stylesheet(join(REPO, 'apps', 'host', 'src'), 'host.css'), 'host.css')).toBe(1280)
    expect(widestBreakpoint(stylesheet(join(REPO, 'apps', 'examples', 'src'), 'app.css'), 'app.css')).toBe(1280)
  })

  // A stylesheet with no breakpoint left would let any width through.
  test('is refused when the stylesheet has none', () => {
    expect(() => widestBreakpoint('.page { max-width: 100rem; }', 'page.css')).toThrow('found no max-width breakpoint in page.css')
  })
})

describe('the stylesheet', () => {
  // The digest the record holds is of what the page loads; an import the
  // camera skipped would leave a changed file out of the stylesheet notice.
  test('inlines its ./ imports and refuses one it does not understand', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pictures-camera-test-'))
    try {
      writeFileSync(join(directory, 'room.css'), '.room { color: red; }')
      writeFileSync(join(directory, 'app.css'), "/* @import is said here */\n@import './room.css';\n.app {}")
      expect(stylesheet(directory, 'app.css')).toBe('/* @import is said here */\n.room { color: red; }\n.app {}')
      writeFileSync(join(directory, 'app.css'), "@import url('https://example.invalid/x.css');")
      expect(() => stylesheet(directory, 'app.css')).toThrow('app.css has an @import the camera does not inline')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe("the look's faces (0072)", () => {
  // The record's look names the face each picture was drawn in, so a font
  // package that moved is a new look and not an unexplained change of
  // pixels: each family by the package an app imports it from, its version
  // as installed, and Google's version of the face that release carries --
  // read from the packages, never typed, and the same for every app.
  test("are each family's package, its version and Google's version of the face, the same in every app", () => {
    const looks = ['examples', 'studio', 'host'].map((app) => {
      const packages = fontPackages(join(REPO, 'apps', app))
      return lookFonts(
        packages.map((entry) => entry.family),
        packages,
      )
    })
    expect(Object.keys(looks[0]).sort()).toEqual(['Archivo Variable', 'IBM Plex Mono', 'IBM Plex Sans'])
    for (const value of Object.values(looks[0])) expect(value).toMatch(/^@fontsource(?:-variable)?\/[a-z-]+ \d+\.\d+\.\d+ \(v\d+\)$/)
    expect(looks[1]).toEqual(looks[0])
    expect(looks[2]).toEqual(looks[0])
  })

  // A face the build declares and no imported package does -- one written
  // by hand over a committed file -- is a face the record cannot name.
  test('refuse a family no imported package declares', () => {
    const packages = [{ name: '@fontsource/ibm-plex-sans', version: '5.3.0', google: 'v23', family: 'IBM Plex Sans' }]
    expect(lookFonts(['IBM Plex Sans'], packages)).toEqual({ 'IBM Plex Sans': '@fontsource/ibm-plex-sans 5.3.0 (v23)' })
    expect(() => lookFonts(['IBM Plex Sans', 'Roboto'], packages)).toThrow('the build declares Roboto, which no font package the app imports declares')
  })

  // The pictures are drawn in the build's own files; a face another origin
  // answered is one the look does not name, from a host the page must not ask.
  test('refuse a font file from any origin but the app’s', () => {
    const origin = 'http://examples.invalid'
    expect(foreignFaces(new Set([`${origin}/assets/archivo-latin-wght-normal-D9H2jx1E.woff2`]), origin)).toEqual([])
    expect(foreignFaces(new Set([`${origin}/assets/a.woff2`, 'https://fonts.gstatic.com/s/archivo/v25/k3k6o8.woff2']), origin)).toEqual(['https://fonts.gstatic.com/s/archivo/v25/k3k6o8.woff2'])
  })
})

describe('the font wait', () => {
  // Only a capture calls it, so nothing here ran it: a doc comment left open
  // above it once made the function part of the comment, the module still
  // loaded, every app's --check passed, and the first capture stopped at
  // "fonts is not defined" (2026-10-16). Watched failing with the comment's
  // close taken out again.
  test('is a function the capture can call', () => {
    expect(fonts).toBeTypeOf('function')
  })
})
