import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { rel, tags } from './addresses.mjs'
import { demoBase, demoUrl, readDemoConfig, stageDemo } from './demo.mjs'
import { headerRules, headersFile } from './demo-headers.mjs'
import { canonicalsOf, descriptionOf, indexedPage, robotsOf } from './indexed-page.mjs'
import { LIVE_DESCRIPTION, liveDemoBase, liveDemoUrl, stageLiveDemo } from './live-demo.mjs'
import { liveHeadersFile } from './live-demo-headers.mjs'
import { NOTICES_FILE } from './third-party-notices.mjs'
import { WEB_PAGES } from './web-policies.mjs'

/**
 * What a page tells a search engine (0177). Every app's index.html, and so
 * every build -- the composed stack's studio and host page, a gate's, a
 * preview's -- asks to be left out of the index; the examples page's and
 * the live demo's deploys, which put a build at the one address it is
 * served at on formancy.ai, stage its page through indexedPage, which
 * drops that request, names the address as the page's canonical one and
 * changes nothing else. The live demo's Worker is reached by
 * scripts/live-demo.mjs through apps/live-demo/dist, so `pnpm build`
 * first, as for scripts/live-demo.test.mjs.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...path) => readFileSync(join(repo, ...path), 'utf8').replaceAll('\r\n', '\n')

/** Every app: a directory under apps/ with an index.html, as scripts/no-other-host.test.mjs finds them. */
const APPS = readdirSync(join(repo, 'apps'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(repo, 'apps', entry.name, 'index.html')))
  .map((entry) => entry.name)
  .sort()

/** Whether an element is one indexedPage writes: the robots meta, the description meta or a canonical link. */
const written = ({ name, attributes }) =>
  (name === 'meta' && ['robots', 'description'].includes(String(attributes.name ?? '').toLowerCase())) ||
  (name === 'link' && rel(attributes).includes('canonical'))

/** Every element of `html` but those indexedPage writes, as its text, in order. */
const others = (html) =>
  tags(html, '[a-z][\\w-]*')
    .map((element) => ({ ...element, name: /^<([a-z][\w-]*)/i.exec(element.text)[1].toLowerCase() }))
    .filter((element) => !written(element))
    .map(({ text }) => text)

/** A page as a build writes it, in a directory of its own, with a hashed chunk and the notices beside it. */
function built(html) {
  const directory = mkdtempSync(join(tmpdir(), 'indexed-page-built-'))
  mkdirSync(join(directory, 'assets'))
  writeFileSync(join(directory, 'index.html'), html)
  writeFileSync(join(directory, 'assets', 'index-BxKwE78K.js'), 'export {}')
  writeFileSync(join(directory, NOTICES_FILE), 'notices')
  return directory
}

describe('every page asks to be left out of the index, wherever it is built (0177)', () => {
  // A guard on the guard: the case below is vacuous over no app.
  test('the apps are found where they are', () => {
    expect(APPS).toEqual(expect.arrayContaining(['examples', 'host', 'studio']))
  })

  // An index.html without it is indexed wherever its build is served: an
  // operator's composed stack, a preview, a gate on a loopback address --
  // not only at the address one of the deploys chose. The examples page's
  // included, so that one rule holds for every source and the deploy
  // alone says otherwise.
  test.each(APPS)("%s's index.html asks search engines to leave it out, once, and names no canonical address", (app) => {
    const html = read('apps', app, 'index.html')
    expect(robotsOf(html)).toEqual(['noindex'])
    expect(canonicalsOf(html)).toEqual([])
  })

  // What the web image copies is the build, not the source. The live demo
  // asks to be indexed now, and it is the host page's build: a noindex
  // dropped from the host page to get there would put every operator's
  // host page in a search engine's index, and the studio beside it.
  test.each(Object.values(WEB_PAGES))('the composed stack serves $location, as built, asking search engines to leave it out', ({ app }) => {
    const index = join(repo, app, 'dist', 'index.html')
    if (!existsSync(index)) throw new Error(`no built page at ${app}/dist: run \`pnpm build\` first`)
    expect(robotsOf(readFileSync(index, 'utf8'))).toEqual(['noindex'])
  })
})

describe('indexedPage (0177)', () => {
  const page = [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <title>A page</title>',
    '    <meta',
    '      name="description"',
    '      content="What the page shows."',
    '    />',
    '    <meta name="robots" content="noindex" />',
    '    <link rel="icon" href="data:," />',
    '  </head>',
    '  <body><div id="root"></div></body>',
    '</html>',
    '',
  ]
  const html = page.join('\n')
  const address = 'https://formancy.ai/data/x/'

  // The page asks to be indexed and names the address it is served at as
  // its own, and every other byte is the build's: the page the gates
  // measured is the page a visitor is sent, since a browser fetches
  // neither a description nor a canonical link.
  test("drops the robots meta's line, keeps the description, and names the address as canonical after it", () => {
    expect(indexedPage(html, { address })).toBe(
      [...page.slice(0, 8), '    <link rel="canonical" href="https://formancy.ai/data/x/" />', ...page.slice(9)].join('\n'),
    )
  })

  // A description given takes the place of the page's own, escaped as an
  // attribute's value, so a quote in it ends nothing.
  test("writes a description given in place of the page's own, escaped", () => {
    expect(indexedPage(html, { address, description: 'Its "words" & <more>.' })).toBe(
      [
        ...page.slice(0, 4),
        '    <meta name="description" content="Its &quot;words&quot; &amp; &lt;more&gt;." />',
        '    <link rel="canonical" href="https://formancy.ai/data/x/" />',
        ...page.slice(9),
      ].join('\n'),
    )
    expect(descriptionOf(indexedPage(html, { address, description: 'Its "words" & <more>.' }))).toBe('Its "words" & <more>.')
  })

  // A head the deploy cannot read as every page's source writes it would
  // be staged as built, noindex and all, or with two descriptions or two
  // canonical addresses for a search engine to choose between, while the
  // deploy said it went out: each stops the deploy with a sentence.
  test.each([
    ['no robots meta', html.replace('    <meta name="robots" content="noindex" />\n', ''), 'one <meta name="robots" content="noindex">'],
    ['a robots meta that says more', html.replace('content="noindex"', 'content="noindex, nofollow"'), 'one <meta name="robots" content="noindex">'],
    ['two robots metas', html.replace('<link rel="icon"', '<meta name="robots" content="noindex" /><link rel="icon"'), 'one <meta name="robots"'],
    ['no description', html.replace(/ {4}<meta\n {6}name="description"[^>]*>\n/, ''), 'one <meta name="description">'],
    ['two descriptions', html.replace('<link rel="icon"', '<meta name="description" content="Another." /><link rel="icon"'), 'one <meta name="description">'],
    ['a canonical address already', html.replace('<link rel="icon"', '<link rel="canonical" href="https://example.com/" /><link rel="icon"'), 'canonical'],
  ])('refuses a page with %s', (_name, changed, says) => {
    expect(changed).not.toBe(html)
    expect(() => indexedPage(changed, { address })).toThrow(says)
  })

  // The canonical address is the one a browser would write: a search
  // engine takes it as given, and http, a host spelled otherwise or a
  // path that is not one would name another page.
  test.each(['http://formancy.ai/data/x/', 'https://Formancy.ai/data/x/', 'formancy.ai/data/x/', 'https://formancy.ai/data/x/#top'])(
    'refuses the address %s',
    (other) => {
      expect(() => indexedPage(html, { address: other })).toThrow('is not an https address as a browser writes it')
    },
  )
})

describe('each deploy stages its page asking to be indexed at its own address (0177)', () => {
  // The examples page as its Worker's assets serve it: every file under the
  // demo's path, the _headers file at the root, and the page asking to be
  // indexed at the demo's address with its own description. Staged as
  // built, it would ask search engines to leave out the module's one page
  // of generated forms; with another address as canonical, they would
  // index that one in its place.
  test("the examples page's, under the demo's path with its headers, at the address its Worker is routed at", () => {
    const wrangler = readDemoConfig()
    const source = read('apps', 'examples', 'index.html')
    const dist = built(source)
    const stage = mkdtempSync(join(tmpdir(), 'indexed-page-stage-'))
    try {
      stageDemo(dist, stage, wrangler)
      const page = join(stage, ...demoBase(wrangler).split('/'))
      const staged = readFileSync(join(page, 'index.html'), 'utf8')
      expect(robotsOf(staged)).toEqual([])
      expect(canonicalsOf(staged)).toEqual([demoUrl(wrangler)])
      expect(descriptionOf(staged)).toBe(descriptionOf(source))
      expect(others(staged)).toEqual(others(source))
      expect(readFileSync(join(page, 'assets', 'index-BxKwE78K.js'), 'utf8')).toBe('export {}')
      expect(readFileSync(join(page, NOTICES_FILE), 'utf8')).toBe('notices')
      expect(readFileSync(join(stage, '_headers'), 'utf8')).toBe(headersFile(headerRules(demoBase(wrangler))))
      expect(readdirSync(stage).sort()).toEqual(['_headers', 'data'])
    } finally {
      rmSync(dist, { recursive: true, force: true })
      rmSync(stage, { recursive: true, force: true })
    }
  })

  // The host page's demo build as the live demo's Worker serves it: the
  // same, at the demo's address, with a description of the demo in place
  // of the host page's, which says what an operator's host page is. The
  // build it stages from still asks to be left out, as the composed
  // stack's does: the copy staged here is the only page that does not.
  test("the live demo's, under its path with its headers, at the address its Worker is routed at, with the demo's description", () => {
    const source = read('apps', 'host', 'index.html')
    const dist = built(source)
    const stage = mkdtempSync(join(tmpdir(), 'indexed-page-stage-'))
    try {
      stageLiveDemo(dist, stage)
      const page = join(stage, ...liveDemoBase().split('/'))
      const staged = readFileSync(join(page, 'index.html'), 'utf8')
      expect(robotsOf(staged)).toEqual([])
      expect(canonicalsOf(staged)).toEqual([liveDemoUrl()])
      expect(descriptionOf(staged)).toBe(LIVE_DESCRIPTION)
      expect(LIVE_DESCRIPTION).not.toBe(descriptionOf(source))
      expect(others(staged)).toEqual(others(source))
      expect(readFileSync(join(page, 'assets', 'index-BxKwE78K.js'), 'utf8')).toBe('export {}')
      expect(readFileSync(join(stage, '_headers'), 'utf8')).toBe(liveHeadersFile(liveDemoBase()))
      expect(readdirSync(stage).sort()).toEqual(['_headers', 'data'])
      expect(robotsOf(readFileSync(join(dist, 'index.html'), 'utf8'))).toEqual(['noindex'])
    } finally {
      rmSync(dist, { recursive: true, force: true })
      rmSync(stage, { recursive: true, force: true })
    }
  })
})
