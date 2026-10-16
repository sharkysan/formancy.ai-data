import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import { references, resolved, styleReferences } from './addresses.mjs'
import { builtStylesheets, declaredFamilies, fontFaces, fontPackages, withoutFontFaces } from './fonts.mjs'

/**
 * No page asks another host for anything, and the room's faces are the
 * build's own (0072): what each app declares, before and after `vite build`.
 *
 * The browser gates see what a page asks for when it runs, in every pass;
 * this reads what it says it will, with no browser: each app's index.html,
 * the built page and every stylesheet it links, and the Fontsource packages
 * each app imports its faces from. It does not read JavaScript: the host
 * page's bundle holds AG Grid's own loader of Google's fonts, which asks
 * nothing unless a grid is given `loadThemeGoogleFonts`, and a scan of the
 * bundle would fail on a request nobody makes. The gates see the one that
 * is made.
 *
 * Named after formancy.ai's apps/admin/src/no-other-host.test.tsx. The apps
 * are derived, never listed: every apps/<name>/index.html. The built pages
 * are `pnpm build`'s, which `pnpm test:repo` needs already.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Every app: a directory under apps/ with an index.html. */
const APPS = readdirSync(join(repo, 'apps'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(repo, 'apps', entry.name, 'index.html')))
  .map((entry) => entry.name)
  .sort()

/** An address a page's own references resolve against; fonts.mjs resolves the built page's the same way. */
const PAGE = 'http://page.invalid/'

/** The http(s) addresses among `values`, resolved against `base` as a browser would, on an origin other than base's. */
function elsewhere(values, base) {
  const own = new URL(base).origin
  return values.map((value) => resolved(value, base)).filter((url) => url !== null && /^https?:$/.test(url.protocol) && url.origin !== own).map((url) => url.href)
}

/** apps/<app>/dist, or a failure that says to build first. */
function built(app) {
  const dist = join(repo, 'apps', app, 'dist')
  if (!existsSync(join(dist, 'index.html'))) throw new Error(`no built page at apps/${app}/dist: run \`pnpm build\` first, which \`pnpm test:repo\` needs`)
  return dist
}

/** The comment each copy of the admin's palette opens its variables with (scripts/palette.test.mjs). */
const MARK = '/* formancy.ai apps/admin/src/admin.css */'

/** Every .css file of an app's own source, as text: not installed, built or measured. */
function ownStylesheets(directory) {
  const found = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'coverage'].includes(entry.name) || entry.name.startsWith('.')) continue
    const full = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...ownStylesheets(full))
    else if (entry.name.endsWith('.css')) found.push(readFileSync(full, 'utf8'))
  }
  return found
}

/** A custom property's value in `css`, or undefined. */
const property = (css, name) => new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(css)?.[1]

/** The first family of a font stack, unquoted. */
const firstFamily = (stack) => stack.split(',')[0].trim().replace(/^(["'])(.*)\1$/, '$2')

/**
 * The stacks the room and the theme draw text with, for `app`: `--display`,
 * `--sans` and `--mono` of its copy of the admin's palette, and Blueprint's
 * `--fm-sans` and `--fm-mono`, from the theme the app installs.
 */
function stacks(app) {
  const directory = join(repo, 'apps', app)
  const palette = ownStylesheets(directory).find((css) => css.includes(MARK))
  const blueprint = readFileSync(createRequire(join(directory, 'package.json')).resolve('@formancy/themes/blueprint.css'), 'utf8')
  const found = {}
  for (const name of ['--display', '--sans', '--mono']) found[name] = palette === undefined ? undefined : property(palette, name)
  for (const name of ['--fm-sans', '--fm-mono']) found[name] = property(blueprint, name)
  return found
}

/** A file name as Vite writes a bundled asset, `<name>-<8-character hash>.<ext>`, back to the name it had: undefined for one without the hash. */
function unhashed(file) {
  const match = /^(.+)-[\w-]{8}(\.[a-z0-9]+)$/i.exec(file)
  return match === null ? undefined : `${match[1]}${match[2]}`
}

/** The workspace catalog, where each face's version is pinned once. */
const catalog = parse(readFileSync(join(repo, 'pnpm-workspace.yaml'), 'utf8')).catalog

describe('no page asks another host for anything (0072)', () => {
  // A guard on the guard: the cases below are vacuous over no app.
  test('the apps are found where they are', () => {
    expect(APPS).toEqual(expect.arrayContaining(['examples', 'host', 'studio']))
  })

  // A link, a preconnect or a script on another host is a request every
  // visitor's browser makes, telling that host their address -- Google's
  // fonts were three such addresses in each app -- and a page whose look
  // depends on a network the gates cannot hold. However the attribute is
  // quoted, and protocol-relative too.
  test.each(APPS)("%s's index.html names no address on another host", (app) => {
    const html = readFileSync(join(repo, 'apps', app, 'index.html'), 'utf8')
    expect(elsewhere(references(html).map(({ value }) => value), PAGE)).toEqual([])
  })

  // What the build wrote is what is served: a stylesheet that imports
  // another host's, or names a face or an image there, is a request the
  // source index.html never shows.
  test.each(APPS)('%s, as built: the page and every stylesheet it links name no address on another host', (app) => {
    const dist = built(app)
    const found = elsewhere(references(readFileSync(join(dist, 'index.html'), 'utf8')).map(({ value }) => value), PAGE)
    for (const { url, text } of builtStylesheets(dist)) found.push(...elsewhere(styleReferences(text), url.href))
    expect(found).toEqual([])
  })

  // Each face is a file of the build, hashed so the year's cache is right
  // for it, and a file one of the packages ships, so the notices list it
  // with its licence (0046). A face inlined as data: is refused by the
  // demo's font-src and is a file the notices plugin never sees; one
  // committed to the repository would be listed as this repository's own,
  // under LICENSE.md, with no OFL text, and nothing else would fail.
  test.each(APPS)('%s, as built: every face is a hashed file under assets/ that one of its font packages ships', (app) => {
    const dist = built(app)
    const shipped = new Set(fontPackages(join(repo, 'apps', app)).flatMap((entry) => entry.files))
    const problems = []
    for (const { url, text } of builtStylesheets(dist)) {
      for (const { family, sources } of fontFaces(text)) {
        for (const source of sources) {
          if (source.startsWith('data:')) {
            problems.push(`a face of ${family} is inlined as a data: URL`)
            continue
          }
          const target = new URL(source, url)
          const file = target.pathname.split('/').at(-1) ?? ''
          if (target.origin !== url.origin || !target.pathname.startsWith('/assets/')) problems.push(`a face of ${family} is ${target.href}, not a file under assets/`)
          else if (!existsSync(join(dist, decodeURIComponent(target.pathname)))) problems.push(`a face of ${family} is ${target.pathname}, which the build does not hold`)
          else if (unhashed(file) === undefined) problems.push(`a face of ${family}, ${file}, is named without a hash`)
          else if (!shipped.has(unhashed(file))) problems.push(`a face of ${family}, ${file}, is no file of the font packages apps/${app} imports`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  // Dropping an import shrinks the families the build declares, and the
  // browser gates' fonts check, which reads them from the build, passes
  // with that text drawn in a fallback face. So every stack the room and
  // the theme define has its first family -- or Fontsource's `<family>
  // Variable` of it -- among the faces the build carries.
  test.each(APPS)('%s, as built: the first family of every stack the room and Blueprint draw with has a face', (app) => {
    const families = declaredFamilies(built(app))
    const problems = []
    for (const [name, stack] of Object.entries(stacks(app))) {
      if (stack === undefined) {
        problems.push(`${name} is not defined where it was looked for`)
        continue
      }
      const first = firstFamily(stack)
      if (!families.includes(first) && !families.includes(`${first} Variable`)) problems.push(`${name}'s first family, ${first}, has no face in the build`)
    }
    expect(problems).toEqual([])
  })

  // The Archivo the apps import is its weight axis alone (wght.css): a rule
  // asking for a width would draw the normal width, and look like a
  // stylesheet that works.
  test.each(APPS)('%s, as built: no rule asks a face for a width', (app) => {
    const problems = []
    for (const { href, text } of builtStylesheets(built(app))) {
      const rules = withoutFontFaces(text)
      if (/(?:^|[{;\s])font-(?:stretch|width)\s*:/i.test(rules)) problems.push(`${href} sets font-stretch`)
      if (/font-variation-settings\s*:[^;}]*["']wdth["']/i.test(rules)) problems.push(`${href} sets a wdth variation`)
    }
    expect(problems).toEqual([])
  })

  // One room, said once, as scripts/palette.test.mjs says it for the
  // colours: every app imports the same faces, from the version the
  // workspace catalog pins exactly -- the release formancy.ai's site and
  // admin install -- and depends on each as `catalog:`, so a bump is one
  // line and no app is left on the last one.
  test('the apps import the same faces, at the versions the catalog pins', () => {
    const imports = Object.fromEntries(APPS.map((app) => [app, fontPackages(join(repo, 'apps', app))]))
    const [first] = APPS
    expect(imports[first].length, `apps/${first} imports no face from a package`).toBeGreaterThan(0)
    const problems = []
    for (const app of APPS) {
      const manifest = JSON.parse(readFileSync(join(repo, 'apps', app, 'package.json'), 'utf8'))
      const said = imports[app].flatMap(({ stylesheets }) => stylesheets)
      const firstSaid = imports[first].flatMap(({ stylesheets }) => stylesheets)
      if (JSON.stringify(said) !== JSON.stringify(firstSaid)) problems.push(`apps/${app} imports ${said.join(', ') || 'no face'}, where apps/${first} imports ${firstSaid.join(', ')}`)
      for (const { name, version } of imports[app]) {
        if (!/^\d+\.\d+\.\d+$/.test(String(catalog?.[name]))) problems.push(`the catalog pins ${name} as ${String(catalog?.[name])}, not one exact version`)
        else if (version !== catalog[name]) problems.push(`apps/${app} has ${name} ${version} installed, and the catalog pins ${String(catalog[name])}`)
        if (manifest.dependencies?.[name] !== 'catalog:') problems.push(`apps/${app} depends on ${name} as ${String(manifest.dependencies?.[name])}, not catalog:`)
      }
    }
    expect(problems).toEqual([])
  })
})
