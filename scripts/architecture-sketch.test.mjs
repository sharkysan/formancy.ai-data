import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import YAML from 'yaml'

/**
 * The README's architecture sketch, docs/images/architecture.svg, drawn by
 * hand as SVG text (0172), held to the workspace it draws. A package renamed,
 * added or published leaves the drawing showing another repository, and
 * nothing about a picture breaks, so these fail instead:
 *
 * - a name the sketch writes -- `@formancy/<x>`, `apps/<x>`, `packages/<x>`
 *   or a bare `data-<x>` -- that is no workspace package or app, and no
 *   `@formancy/*` package a workspace manifest depends on, upstream's
 *   renderers among them;
 * - a published package, one whose manifest is not private, that no box
 *   of the sketch draws;
 * - a <desc> that does not name what the boxes draw, and README.md not
 *   showing the sketch by an <img> whose alt names it all too, so that a
 *   reader who cannot see the drawing reads the same names;
 * - a sketch that would load anything -- a script, an image, a font, a
 *   stylesheet, any address -- none of which GitHub runs or fetches for an
 *   SVG drawn in an <img>, so that what it draws there is what it draws
 *   here;
 * - a colour that `@formancy/themes`' room.css does not declare, written as
 *   it writes it, so that the sketch wears the room the apps wear.
 *
 * Everything is read from the files: pnpm-workspace.yaml and the manifests,
 * the SVG's text and style, README.md, and room.css as the apps resolve it.
 * What none of it sees is review's: whether an arrow goes where the code
 * calls, whether a box says what its package does, and whether it reads.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...path) => readFileSync(join(repo, ...path), 'utf8').replaceAll('\r\n', '\n')

const SKETCH = 'docs/images/architecture.svg'

/** room.css as the apps resolve it, at the version pnpm installed, as scripts/palette.test.mjs reads it. */
const ROOM = createRequire(join(repo, 'apps', 'host', 'package.json')).resolve('@formancy/themes/room.css')

const FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

/**
 * Every workspace package and app, as `{ directory, name, published,
 * depends }`: the directories pnpm-workspace.yaml names, each `<dir>/*` or a
 * directory, each with a manifest; published unless the manifest is private.
 */
function workspace(root = repo) {
  const config = YAML.parse(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')) ?? {}
  const directories = (config.packages ?? []).flatMap((pattern) => {
    const each = /^([\w.-]+(?:\/[\w.-]+)*)\/\*$/.exec(pattern)
    if (each === null && !/^[\w.-]+(?:\/[\w.-]+)*$/.test(pattern)) {
      throw new Error(`pnpm-workspace.yaml: ${pattern} is not <directory>/* or a directory, which is all this guard reads; teach it`)
    }
    if (each === null) return [pattern]
    return readdirSync(join(root, each[1]), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${each[1]}/${entry.name}`)
  })
  return directories.flatMap((directory) => {
    let manifest
    try {
      manifest = JSON.parse(readFileSync(join(root, directory, 'package.json'), 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
    const depends = FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {}))
    return [{ directory, name: String(manifest.name), published: manifest.private !== true, depends }]
  })
}

/** `markup`'s text, its tags taken out and its entities decoded, every run of space one space. */
const plain = (markup) =>
  markup
    .replace(/<[^>]*>/g, ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
    .replace(/\s+/g, ' ')
    .trim()

/** `svg` without its comments, which say things about the drawing and are none of it. */
const uncommented = (svg) => svg.replace(/<!--[\s\S]*?-->/g, '')

/** What the boxes say: the text of every <text>, its <tspan>s included. */
const drawnText = (svg) => [...uncommented(svg).matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((found) => plain(found[1])).join(' ')

/** What the sketch says of itself to a reader who cannot see it: its <title> and <desc>, or '' for one it does not have. */
const described = (svg, element) => plain(new RegExp(`<${element}\\b[^>]*>([\\s\\S]*?)</${element}>`).exec(uncommented(svg))?.[1] ?? '')

/** A package's or an app's name, a workspace directory, or a bare `data-<x>`, not inside a longer one. */
const NAME = /(?<![\w@./-])(@formancy\/[a-z0-9-]+|(?:apps|packages)\/[a-z0-9-]+|data-[a-z0-9-]+)(?![\w/-])/g

/** Every name `text` writes, once each, in the order it writes them; a bare `data-core` is `@formancy/data-core`. */
const namesIn = (text) => [...new Set([...text.matchAll(NAME)].map((found) => (found[1].startsWith('data-') ? `@formancy/${found[1]}` : found[1])))]

/** Whether `text` writes `name` whole. */
const writes = (text, name) => namesIn(text).includes(name)

/** The colour properties: what a shape is filled or stroked with, and what a gradient or a filter draws. */
const COLOURED = '(?:fill|stroke|stop-color|flood-color|lighting-color|color)'

/** Every colour the sketch names, in an attribute or in a declaration of its <style>; `none`, `currentColor` and a reference into itself are none. */
function colours(svg) {
  const code = uncommented(svg)
  const values = [
    ...[...code.matchAll(new RegExp(`\\s${COLOURED}\\s*=\\s*"([^"]*)"`, 'g'))].map((found) => found[1]),
    ...[...code.matchAll(new RegExp(`(?:^|[\\s;{])${COLOURED}\\s*:\\s*([^;}]*)`, 'g'))].map((found) => found[1]),
  ]
  return values.map((value) => value.trim()).filter((value) => value !== 'none' && value !== 'currentColor' && !/^url\(\s*#/.test(value))
}

/** A colour as it compares: lower case, every run of space one space. */
const normal = (colour) => colour.toLowerCase().replace(/\s+/g, ' ')

/** The colours a stylesheet's custom properties declare, as it writes them. */
const declaredColours = (css) =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/--[\w-]+\s*:\s*([^;]+);/g)]
    .map((found) => found[1].trim())
    .filter((value) => /^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\()/i.test(value))

/** What would make the sketch fetch, run or embed something, each with what it is. */
const LOADS = [
  [/<script\b/i, 'a script'],
  [/<(?:image|foreignObject|iframe|object|embed|video|audio)\b/i, 'an element that embeds another document or file'],
  [/@import\b/i, 'an @import'],
  [/@font-face\b/i, 'a font of its own'],
  [/url\(\s*(?!['"]?#)/i, 'a url() of something outside itself'],
  [/\s(?:xlink:)?href\s*=\s*["'](?!#)/i, 'a link to something outside itself'],
  [/\son[a-z]+\s*=/i, 'an event handler'],
]

/** README.md's <img> tags whose `src`, from the repository's root, is `path`. */
const imagesOf = (readme, path) =>
  [...readme.matchAll(/<img\b[^>]*>/g)]
    .map((found) => found[0])
    .filter((tag) => {
      const src = /\ssrc="([^"]*)"/.exec(tag)?.[1]
      return src !== undefined && posix.normalize(src) === path
    })

/**
 * What is wrong with the sketch, one sentence each, empty when nothing is.
 * Pure: `svg` and `readme` are the two files' text, `packages` what
 * `workspace()` reads and `room` the colours room.css declares, so that a
 * case can hand it a repository this one is not.
 */
function sketchProblems({ svg, readme, packages, room }) {
  const problems = []
  const names = new Set(packages.map((entry) => entry.name))
  const directories = new Set(packages.map((entry) => entry.directory))
  const upstream = new Set(packages.flatMap((entry) => entry.depends).filter((name) => name.startsWith('@formancy/') && !names.has(name)))
  const drawn = drawnText(svg)
  const title = described(svg, 'title')
  const desc = described(svg, 'desc')
  for (const name of namesIn(`${drawn} ${title} ${desc}`)) {
    if (name.startsWith('@formancy/')) {
      if (!names.has(name) && !upstream.has(name))
        problems.push(`${SKETCH} names ${name}, which is no workspace package or app and no @formancy package a workspace manifest depends on`)
    } else if (!directories.has(name)) problems.push(`${SKETCH} names ${name}, which is no workspace package's or app's directory`)
  }
  for (const entry of packages.filter((each) => each.published))
    if (!writes(drawn, entry.name)) problems.push(`${entry.name} is published, and no box of ${SKETCH} draws it`)
  if (title === '') problems.push(`${SKETCH} has no <title>, which names it to a reader who cannot see it`)
  if (desc === '') problems.push(`${SKETCH} has no <desc>, which says it to a reader who cannot see it`)
  else for (const name of namesIn(drawn)) if (!writes(desc, name)) problems.push(`${SKETCH}'s <desc> does not name ${name}, which a box of it draws`)
  for (const [pattern, what] of LOADS)
    if (pattern.test(uncommented(svg))) problems.push(`${SKETCH} holds ${what}, which GitHub neither runs nor fetches for an SVG in an <img>`)
  const palette = new Set(room.map(normal))
  for (const colour of [...new Set(colours(svg))])
    if (!palette.has(normal(colour)))
      problems.push(`${SKETCH} draws with ${colour}, which room.css does not declare: draw with its values, written as it writes them`)
  const shown = imagesOf(readme, SKETCH)
  if (shown.length === 0) problems.push(`README.md shows no <img> whose src is ./${SKETCH}`)
  for (const tag of shown) {
    const alt = plain(/\salt="([^"]*)"/.exec(tag)?.[1] ?? '')
    if (alt === '') problems.push(`README.md shows ${SKETCH} with no alt`)
    else
      for (const name of namesIn(drawn)) if (!writes(alt, name)) problems.push(`README.md's alt for ${SKETCH} does not name ${name}, which a box of it draws`)
  }
  return problems
}

describe('the README’s architecture sketch', () => {
  const svg = read(SKETCH)
  const readme = read('README.md')
  const packages = workspace()
  const room = declaredColours(readFileSync(ROOM, 'utf8'))

  // A package renamed, added, published or taken out of the workspace leaves
  // the drawing at the top of the README showing a repository that is not
  // this one, and an SVG has nothing in it that breaks. Watched failing on
  // 2026-11-20 with the data-identity box renamed @formancy/data-gateway
  // (the name refused, data-identity drawn by no box, and neither the <desc>
  // nor the alt naming the new one), with the teal written #40e0d0, and
  // before README.md showed the sketch; each put back and compared by sha256.
  test('names only what the workspace has, draws every published package, says it all to a reader who cannot see it, loads nothing and wears the room', () => {
    expect(sketchProblems({ svg, readme, packages, room })).toEqual([])
  })

  // A guard on the guard: every check above is about absence, so a reader
  // that found no package, no name, no colour or no picture would pass for
  // ever. What the files hold today.
  test('reads the workspace, the names, the colours and the README at all', () => {
    expect(packages.filter((entry) => entry.published).map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['@formancy/data-core', '@formancy/data-client', '@formancy/data-server']),
    )
    expect(packages.find((entry) => entry.name === '@formancy/data-studio')).toMatchObject({ directory: 'apps/studio', published: false })
    expect(namesIn(drawnText(svg))).toEqual(expect.arrayContaining(['@formancy/data-server', '@formancy/react', 'apps/host', 'apps/studio']))
    expect(colours(svg).length).toBeGreaterThan(0)
    expect(room).toEqual(expect.arrayContaining(['#8b7bff', '#3fe0d5']))
    expect(imagesOf(readme, SKETCH)).toHaveLength(1)
  })
})

describe('the sketch’s check', () => {
  const packages = [
    { directory: 'packages/data-core', name: '@formancy/data-core', published: true, depends: ['@formancy/spec'] },
    { directory: 'packages/data-server', name: '@formancy/data-server', published: true, depends: ['@formancy/data-core'] },
    { directory: 'apps/host', name: '@formancy/data-host', published: false, depends: ['@formancy/react'] },
  ]
  const room = ['#080a12', 'rgb(255 255 255 / 9%)', '#3fe0d5']
  const sketch = (boxes, desc = boxes, style = '.ground { fill: #080a12; stroke: rgb(255 255 255 / 9%); }') =>
    `<svg><title>T</title><desc>${desc}</desc><style>${style}</style><text>${boxes}</text><path stroke="#3fe0d5" marker-end="url(#a)"/></svg>`
  const shown = (alt) => `# X\n\n<img src="./${SKETCH}" width="600" alt="${alt}">\n`
  const clean = '@formancy/data-core <tspan>@formancy/data-server</tspan> @formancy/react apps/host'
  const said = '@formancy/data-core, @formancy/data-server, @formancy/react and apps/host'

  // Without this, every case below could pass by refusing everything. A
  // comment about the drawing is none of it, and a bare data-core names the
  // package the alt names in full.
  test('passes a sketch that names the workspace, wears the room and is shown with its names', () => {
    const svg = sketch(`${clean} data-core`).replace('</svg>', '<!-- no <script>, no url(x), fill: #ffffff, apps/nothing --></svg>')
    expect(sketchProblems({ svg, readme: shown(said), packages, room })).toEqual([])
  })

  // A box renamed to a package nobody has, an app's directory misspelled, a
  // bare name with no package behind it, and a published package that no
  // box draws: the drawing of another repository.
  test('refuses a name the workspace does not have, and a published package it does not draw', () => {
    const boxes = '@formancy/data-gateway @formancy/data-server apps/hosts data-nothing'
    expect(sketchProblems({ svg: sketch(boxes), readme: shown(boxes), packages, room })).toEqual([
      `${SKETCH} names @formancy/data-gateway, which is no workspace package or app and no @formancy package a workspace manifest depends on`,
      `${SKETCH} names apps/hosts, which is no workspace package's or app's directory`,
      `${SKETCH} names @formancy/data-nothing, which is no workspace package or app and no @formancy package a workspace manifest depends on`,
      `@formancy/data-core is published, and no box of ${SKETCH} draws it`,
    ])
  })

  // A name only the <desc> or the alt still holds is a box that was taken
  // out, or one added that neither says: a reader who cannot see the
  // drawing reads another one.
  test('refuses a <desc> or an alt that leaves out a name the boxes draw, and a README that does not show it', () => {
    expect(sketchProblems({ svg: sketch(clean, '@formancy/data-core'), readme: shown('data-core'), packages, room })).toEqual([
      `${SKETCH}'s <desc> does not name @formancy/data-server, which a box of it draws`,
      `${SKETCH}'s <desc> does not name @formancy/react, which a box of it draws`,
      `${SKETCH}'s <desc> does not name apps/host, which a box of it draws`,
      `README.md's alt for ${SKETCH} does not name @formancy/data-server, which a box of it draws`,
      `README.md's alt for ${SKETCH} does not name @formancy/react, which a box of it draws`,
      `README.md's alt for ${SKETCH} does not name apps/host, which a box of it draws`,
    ])
    expect(sketchProblems({ svg: sketch(clean), readme: '# X\n\n<img src="./docs/images/other.svg" alt="x">\n', packages, room })).toEqual([
      `README.md shows no <img> whose src is ./${SKETCH}`,
    ])
    expect(sketchProblems({ svg: sketch(clean), readme: shown(''), packages, room })).toEqual([`README.md shows ${SKETCH} with no alt`])
  })

  // GitHub draws an SVG in an <img> with no script, no font and nothing
  // fetched; one that leans on any of them draws something else there than
  // in the review that approved it. A comment saying so is not one.
  test('refuses a sketch that would load something, and a colour the room does not have', () => {
    const style = '@import "x.css"; @font-face { font-family: X; } .a { fill: #ffffff; stroke: rgb(255 255 255 / 9%); }'
    const svg = sketch(clean, clean, style).replace('</svg>', '<script>1</script><image href="x.png"/></svg>')
    expect(sketchProblems({ svg, readme: shown(said), packages, room })).toEqual([
      `${SKETCH} holds a script, which GitHub neither runs nor fetches for an SVG in an <img>`,
      `${SKETCH} holds an element that embeds another document or file, which GitHub neither runs nor fetches for an SVG in an <img>`,
      `${SKETCH} holds an @import, which GitHub neither runs nor fetches for an SVG in an <img>`,
      `${SKETCH} holds a font of its own, which GitHub neither runs nor fetches for an SVG in an <img>`,
      `${SKETCH} holds a link to something outside itself, which GitHub neither runs nor fetches for an SVG in an <img>`,
      `${SKETCH} draws with #ffffff, which room.css does not declare: draw with its values, written as it writes them`,
    ])
  })
})
