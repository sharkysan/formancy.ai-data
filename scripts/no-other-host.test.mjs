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
 * Google only for a theme parameter given as `{ googleFont }`, and only for
 * a grid given `loadThemeGoogleFonts` -- the page does neither -- so a scan
 * of the bundle would fail on a request nobody makes. The gates see the one
 * that is made.
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
  return values
    .map((value) => resolved(value, base))
    .filter((url) => url !== null && /^https?:$/.test(url.protocol) && url.origin !== own)
    .map((url) => url.href)
}

/** apps/<app>/dist, or a failure that says to build first. */
function built(app) {
  const dist = join(repo, 'apps', app, 'dist')
  if (!existsSync(join(dist, 'index.html'))) throw new Error(`no built page at apps/${app}/dist: run \`pnpm build\` first, which \`pnpm test:repo\` needs`)
  return dist
}

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

/** The families of a font stack, in order, unquoted. */
const familiesOf = (stack) => stack.split(',').map((family) => family.trim().replace(/^(["'])(.*)\1$/, '$2'))

/**
 * Why the stack `name` draws its text in no face of `families`, the ones the
 * build declares, or undefined. Its first family has a face, or the family
 * right after it is Fontsource's `<first> Variable` -- the name a variable
 * package gives the face, which `--display` names after `'Archivo'` -- and
 * that has one. A `Variable` face the stack does not name next is no face
 * its text is drawn in: a family named between the two, a generic one or
 * one the machine has, is drawn before it.
 */
function stackProblem(name, stack, families) {
  const [first, next] = familiesOf(stack)
  if (families.includes(first) || (next === `${first} Variable` && families.includes(next))) return undefined
  const variable = families.includes(`${first} Variable`) ? `, and ${first} Variable, which has, is not the family the stack names next` : ''
  return `${name}'s first family, ${first}, has no face in the build${variable}`
}

/** A width keyword of the `font` shorthand (CSS Fonts 4's `<font-width-css3>` but `normal`). */
const WIDTH = /^(?:ultra-|extra-|semi-)?(?:condensed|expanded)$/i

/** A percentage. */
const PERCENTAGE = /^(?:\d+\.?\d*|\.\d+)%$/

/** What can be a size in the `font` shorthand, with its `/<line-height>` if it has one: a length, a percentage or a size keyword, not an angle. */
const SIZE =
  /^(?:(?:\d+\.?\d*|\.\d+)(?:%|(?!(?:deg|grad|rad|turn)(?:\/|$))[a-z]+)|xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|larger|smaller)(?:\/|$)/i

/** A declaration's value as its space-separated words, a quoted string or a function call kept whole. */
function words(value) {
  return value.trim().match(/(?:"[^"]*"|'[^']*'|[^\s"'(]+(?:\([^)]*\))?|\([^)]*\))+/g) ?? []
}

/**
 * Why `rules`, a stylesheet with its `@font-face` rules taken out, asks a
 * face for a width: none, or each way it does -- `font-stretch` or
 * `font-width`, a `wdth` variation, or a width in the `font` shorthand: a
 * width keyword before the size, or a percentage right before it, which is
 * how lightningcss writes `font-stretch` folded into the shorthand. The size
 * is the first word that can be one and is not a percentage another size
 * follows; what comes after it is the line height and the families, whose
 * names may hold a keyword (`Roboto Condensed`).
 */
function widthProblems(rules) {
  const problems = []
  if (/(?:^|[{;\s])font-(?:stretch|width)\s*:/i.test(rules)) problems.push('sets font-stretch')
  if (/font-variation-settings\s*:[^;}]*["']wdth["']/i.test(rules)) problems.push('sets a wdth variation')
  for (const [, value] of rules.matchAll(/(?:^|[{;\s])font\s*:([^;}]*)/gi)) {
    const said = words(value)
    const size = said.findIndex((word, at) => SIZE.test(word) && !(PERCENTAGE.test(word) && SIZE.test(said[at + 1] ?? '')))
    if (size > 0 && said.slice(0, size).some((word) => WIDTH.test(word) || PERCENTAGE.test(word)))
      problems.push(`asks a width in the font shorthand, ${value.trim()}`)
  }
  return problems
}

/**
 * The stacks the room and the theme draw text with, for `app`: `--display` of
 * the admin's palette, `@formancy/themes/room.css` (0096), `--sans` and
 * `--mono` of the app's own stylesheet, which room.css does not carry, and
 * Blueprint's `--fm-sans` and `--fm-mono`, each from the themes the app
 * installs.
 */
function stacks(app) {
  const directory = join(repo, 'apps', app)
  const themes = createRequire(join(directory, 'package.json'))
  const room = readFileSync(themes.resolve('@formancy/themes/room.css'), 'utf8')
  const blueprint = readFileSync(themes.resolve('@formancy/themes/blueprint.css'), 'utf8')
  const own = ownStylesheets(directory).find((css) => /--sans\s*:/.test(css))
  const found = { '--display': property(room, '--display') }
  for (const name of ['--sans', '--mono']) found[name] = own === undefined ? undefined : property(own, name)
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
    expect(
      elsewhere(
        references(html).map(({ value }) => value),
        PAGE,
      ),
    ).toEqual([])
  })

  // What the build wrote is what is served: a stylesheet that imports
  // another host's, or names a face or an image there, is a request the
  // source index.html never shows.
  test.each(APPS)('%s, as built: the page and every stylesheet it links name no address on another host', (app) => {
    const dist = built(app)
    const found = elsewhere(
      references(readFileSync(join(dist, 'index.html'), 'utf8')).map(({ value }) => value),
      PAGE,
    )
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
          if (target.origin !== url.origin || !target.pathname.startsWith('/assets/'))
            problems.push(`a face of ${family} is ${target.href}, not a file under assets/`)
          else if (!existsSync(join(dist, decodeURIComponent(target.pathname))))
            problems.push(`a face of ${family} is ${target.pathname}, which the build does not hold`)
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
  // Variable` of it, where the stack names that right after it -- among the
  // faces the build carries.
  test.each(APPS)('%s, as built: the first family of every stack the room and Blueprint draw with has a face', (app) => {
    const families = declaredFamilies(built(app))
    const problems = []
    for (const [name, stack] of Object.entries(stacks(app))) {
      if (stack === undefined) {
        problems.push(`${name} is not defined where it was looked for`)
        continue
      }
      const problem = stackProblem(name, stack, families)
      if (problem !== undefined) problems.push(problem)
    }
    expect(problems).toEqual([])
  })

  // A guard on the rule above, with no build: Fontsource's variable packages
  // call their face `<family> Variable`, and a stack that names only
  // `<family>` never draws in it. The studio's build, all 18 of its IBM Plex
  // Sans faces renamed `IBM Plex Sans Variable` -- what importing
  // @fontsource-variable/ibm-plex-sans in place of the static package gives
  // -- passed the rule that took `<family> Variable` for any stack, while
  // every --sans and --fm-sans text was drawn in the fallback (2026-10-16).
  // And a family named between the two draws before the variable face does.
  test('the stack rule takes `<family> Variable` only where the stack names it right after `<family>`', () => {
    const families = ['Archivo Variable', 'IBM Plex Mono', 'IBM Plex Sans', 'IBM Plex Sans Variable']
    expect(stackProblem('--display', "'Archivo', 'Archivo Variable', 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif", families)).toBeUndefined()
    expect(stackProblem('--mono', "'IBM Plex Mono', ui-monospace, monospace", families)).toBeUndefined()
    expect(stackProblem('--sans', "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif", ['Archivo Variable', 'IBM Plex Sans Variable'])).toBe(
      "--sans's first family, IBM Plex Sans, has no face in the build, and IBM Plex Sans Variable, which has, is not the family the stack names next",
    )
    expect(stackProblem('--display', "'Archivo', 'IBM Plex Sans', 'Archivo Variable', sans-serif", families)).toBe(
      "--display's first family, Archivo, has no face in the build, and Archivo Variable, which has, is not the family the stack names next",
    )
    expect(stackProblem('--display', "'Archivo', 'Archivo Variable', sans-serif", ['IBM Plex Sans'])).toBe(
      "--display's first family, Archivo, has no face in the build",
    )
  })

  // The Archivo the apps import is its weight axis alone (wght.css): a rule
  // asking for a width would draw the normal width, and look like a
  // stylesheet that works.
  test.each(APPS)('%s, as built: no rule asks a face for a width', (app) => {
    const problems = []
    for (const { href, text } of builtStylesheets(built(app))) problems.push(...widthProblems(withoutFontFaces(text)).map((problem) => `${href} ${problem}`))
    expect(problems).toEqual([])
  })

  // A guard on the rule above, with no build. lightningcss, which minifies
  // every build here, folds `font-stretch` into the `font` shorthand when a
  // rule sets every font longhand -- `font-stretch: 90%` as `90%`, and even
  // `condensed` as `75%`, before the size -- and keeps a keyword written in
  // the shorthand where the family is a var() (lightningcss 1.33.0, as Vite
  // 8.3.3 resolves it, 2026-10-16). A rule reading the longhand alone missed
  // all three. A family whose name holds a keyword, after the size, asks no
  // width, and neither does a percentage that is the size.
  test('the width rule reads the longhand, the variation and the font shorthand', () => {
    expect(widthProblems('.a{font-weight:700;font-stretch:90%}')).toEqual(['sets font-stretch'])
    expect(widthProblems(`.a{font-variation-settings:"wdth" 90}`)).toEqual(['sets a wdth variation'])
    expect(widthProblems('.a{font:700 90% 1rem/1.2 Archivo}')).toEqual(['asks a width in the font shorthand, 700 90% 1rem/1.2 Archivo'])
    expect(widthProblems('.a{font:italic 700 112.5% 2rem/1.1 Archivo,sans-serif}')).toEqual([
      'asks a width in the font shorthand, italic 700 112.5% 2rem/1.1 Archivo,sans-serif',
    ])
    expect(widthProblems('.b{font:700 condensed 2rem var(--display)}')).toEqual(['asks a width in the font shorthand, 700 condensed 2rem var(--display)'])
    expect(widthProblems('.c{font:oblique 10deg Semi-Expanded 1rem x}')).toEqual(['asks a width in the font shorthand, oblique 10deg Semi-Expanded 1rem x'])
    expect(
      widthProblems(
        '.d{font:700 1rem Roboto Condensed}.e{font:90%/1.2 Archivo}.f{font:500 90% Archivo}.g{font:inherit}.h{font-family:var(--display);--font:condensed}',
      ),
    ).toEqual([])
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
      if (JSON.stringify(said) !== JSON.stringify(firstSaid))
        problems.push(`apps/${app} imports ${said.join(', ') || 'no face'}, where apps/${first} imports ${firstSaid.join(', ')}`)
      for (const { name, version } of imports[app]) {
        if (!/^\d+\.\d+\.\d+$/.test(String(catalog?.[name]))) problems.push(`the catalog pins ${name} as ${String(catalog?.[name])}, not one exact version`)
        else if (version !== catalog[name]) problems.push(`apps/${app} has ${name} ${version} installed, and the catalog pins ${String(catalog[name])}`)
        if (manifest.dependencies?.[name] !== 'catalog:')
          problems.push(`apps/${app} depends on ${name} as ${String(manifest.dependencies?.[name])}, not catalog:`)
      }
    }
    expect(problems).toEqual([])
  })
})
