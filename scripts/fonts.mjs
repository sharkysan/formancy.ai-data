// The faces a built page carries (0072): the stylesheets its index.html
// links, the `@font-face` rules in them, and the Fontsource packages an app
// imports them from. One reader for the browser gates' fonts check, the
// camera's font wait and look, the demo's policy and the static guard that
// no page names another host, so that none of them reads a stylesheet its
// own way.
//
// Node built-ins only, beside the modules that import it: the camera and
// the getting-started gate import from scripts/ without installing anything.

import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, normalize, sep } from 'node:path'
import { styleReferences, stylesheetLinks } from './addresses.mjs'

/**
 * An address a built page's own references are resolved against: a path of
 * it is a path of `dist`, whether Vite wrote it relative (the examples'
 * `./assets/…`) or absolute (the studio's and the host page's `/assets/…`).
 */
const PAGE = 'http://page.invalid/'

/**
 * A rule's declarations, by lowercased name: split at each `;` outside
 * parentheses and quotes, since a `data:` URL holds one (`data:font/woff2;base64,…`).
 */
function declarations(body) {
  const found = {}
  let start = 0
  let depth = 0
  let quote = null
  const end = (at) => {
    const text = body.slice(start, at)
    const colon = text.indexOf(':')
    if (colon > -1) found[text.slice(0, colon).trim().toLowerCase()] = text.slice(colon + 1).trim()
    start = at + 1
  }
  for (let at = 0; at < body.length; at += 1) {
    const character = body[at]
    if (quote !== null) {
      if (character === quote) quote = null
    } else if (character === '"' || character === "'") quote = character
    else if (character === '(') depth += 1
    else if (character === ')') depth -= 1
    else if (character === ';' && depth === 0) end(at)
  }
  end(body.length)
  return found
}

/** `css` without its comments: what a stylesheet says, not what it says about itself. */
export const uncommented = (css) => css.replaceAll(/\/\*[\s\S]*?\*\//g, '')

/** Every `@font-face` rule of `css`, as its text. */
const FONT_FACE = /@font-face\s*\{([^}]*)\}/gi

/**
 * Each `@font-face` of `css`: its family, unquoted -- lightningcss writes
 * `font-family:Archivo Variable` bare where Fontsource quotes it -- and the
 * addresses of its `src`, as written.
 */
export function fontFaces(css) {
  return [...uncommented(css).matchAll(FONT_FACE)].map(([, body]) => {
    const said = declarations(body)
    const family = (said['font-family'] ?? '').replace(/^(["'])(.*)\1$/, '$2').trim()
    return { family, sources: styleReferences(said.src ?? '') }
  })
}

/** `css` with every `@font-face` rule taken out: the rules that draw with the faces, not the faces. */
export const withoutFontFaces = (css) => uncommented(css).replaceAll(FONT_FACE, '')

/**
 * The stylesheets `dist/index.html` links from its own origin, each as
 * `{ href, url, path, text }`: `url` as the page resolves it, `path` the
 * file in `dist`. A stylesheet on another host is not read here; that the
 * page names none is the static guard's (scripts/no-other-host.test.mjs).
 * Read from the page, not from `dist/assets/*.css`, because turbo replays a
 * cached build over a `dist` it never cleans (0069), so an earlier build's
 * stylesheet can lie beside the one the page loads. Refuses one whose path
 * leaves `dist`.
 */
export function builtStylesheets(dist) {
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  const own = new URL(PAGE).origin
  return stylesheetLinks(html).flatMap((href) => {
    const url = new URL(href, PAGE)
    if (url.origin !== own) return []
    const path = normalize(join(dist, decodeURIComponent(url.pathname)))
    if (!path.startsWith(`${normalize(dist)}${sep}`)) throw new Error(`dist/index.html links ${href}, which is outside dist`)
    return [{ href, url, path, text: readFileSync(path, 'utf8') }]
  })
}

/**
 * The families the built page's stylesheets declare a face of, once each,
 * sorted: what a pass must have loaded, and the refusing pass must not.
 * Read from the build the gate measures, so a face added to or dropped from
 * an app is checked without an edit here; empty when it declares none.
 */
export function declaredFamilies(dist) {
  return [...new Set(builtStylesheets(dist).flatMap(({ text }) => fontFaces(text).map((face) => face.family)))].sort()
}

/** A side-effect import of a Fontsource stylesheet in an app's `src/main.tsx`: the package, and the stylesheet's path in it. */
const FACE_IMPORT = /^import\s+['"](@fontsource(?:-variable)?\/[^/'"]+)\/([^'"]+\.css)['"]/gm

/**
 * Every Fontsource package `<app>/src/main.tsx` imports a stylesheet of, in
 * the order of its first import: its name, the version installed for the
 * app, Google's version of the face (the package's metadata.json), the
 * stylesheets imported (`<package>/<file>`), the one family they declare,
 * and the names of the font files the package ships. Refuses a package
 * whose imported stylesheets declare no family, or more than one.
 */
export function fontPackages(app) {
  const main = readFileSync(join(app, 'src', 'main.tsx'), 'utf8')
  const resolve = createRequire(join(app, 'package.json')).resolve
  const found = new Map()
  for (const [, name, stylesheet] of main.matchAll(FACE_IMPORT)) {
    if (!found.has(name)) {
      const manifest = resolve(`${name}/package.json`)
      const directory = manifest.slice(0, -'package.json'.length)
      const { version } = JSON.parse(readFileSync(manifest, 'utf8'))
      const google = JSON.parse(readFileSync(resolve(`${name}/metadata.json`), 'utf8')).version
      found.set(name, { name, version, google, stylesheets: [], families: new Set(), files: readdirSync(join(directory, 'files')) })
    }
    const entry = found.get(name)
    entry.stylesheets.push(`${name}/${stylesheet}`)
    for (const face of fontFaces(readFileSync(resolve(`${name}/${stylesheet}`), 'utf8'))) entry.families.add(face.family)
  }
  return [...found.values()].map(({ families, ...entry }) => {
    if (families.size !== 1)
      throw new Error(
        `${entry.stylesheets.join(', ')} declare ${families.size === 0 ? 'no family' : `${String(families.size)} families, ${[...families].join(', ')}`}, where one package is one face`,
      )
    return { ...entry, family: [...families][0] }
  })
}
