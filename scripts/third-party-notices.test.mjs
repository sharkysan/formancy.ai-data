import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { BUNDLER_MODULES, NOTICES_FILE, thirdPartyNotices } from './third-party-notices.mjs'

/**
 * The notices a built app carries (0046), held in real Vite builds: the Vite
 * apps/host resolves, which builds the pages the web image serves, over a
 * project made for each case in a temporary directory -- an index.html, a
 * script, and a node_modules tree whose packages ship what the case needs.
 * So the modules and files the plugin places are the ones Rolldown and Vite
 * report as written, and a refusal is the build's own failure.
 */

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const { build } = await import(pathToFileURL(createRequire(join(repo, 'apps', 'host', 'package.json')).resolve('vite')).href)

const made = []
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
})

/** A directory of the case's own, by its real path, which is how the bundler names the modules in it. */
const temporary = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'notices-')))
  made.push(dir)
  return dir
}

const PAGE = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8" /><title>t</title></head><body><script type="module" src="/src/main.js"></script></body></html>\n'

/**
 * A project: `files` maps a path in it to its contents, `links` a path in it
 * to the directory it links to -- inside the project when relative, as pnpm
 * links a workspace package, or anywhere when absolute. The project's own
 * package.json declares no licence and its directory holds no licence file,
 * so a plugin that listed the project's own modules would refuse it.
 */
function project(files, links = {}) {
  const root = temporary()
  for (const [path, contents] of Object.entries({ 'index.html': PAGE, 'package.json': '{ "name": "the-app", "private": true }\n', ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), contents)
  }
  for (const [path, target] of Object.entries(links)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    symlinkSync(isAbsolute(target) ? target : join(root, target), join(root, path), 'junction')
  }
  return root
}

/**
 * A package in node_modules: its manifest, an index.js whose function says
 * its name, and whatever else it ships. A function, because a module whose
 * only export is a boolean or a number is copied into its users by the
 * bundler and is then in no chunk (the last describe holds that).
 */
const pkg = (name, version, files = {}, manifest = {}) => ({
  [`node_modules/${name}/package.json`]: JSON.stringify({ name, version, type: 'module', main: 'index.js', ...manifest }),
  [`node_modules/${name}/index.js`]: `export function name() {\n  return ${JSON.stringify(name)}\n}\n`,
  ...Object.fromEntries(Object.entries(files).map(([file, contents]) => [`node_modules/${name}/${file}`, contents])),
})

/** A script that imports each package's function and calls it, so nothing is shaken out. */
const uses = (...names) => `${names.map((name, index) => `import { name as n${String(index)} } from '${name}'`).join('\n')}\nconsole.log(${names.map((_, index) => `n${String(index)}()`).join(', ')})\n`

/**
 * The project built with the plugin, in memory: every chunk's modules,
 * every file's name, and the notices file's bytes. `options` is added to the
 * build's own, `plugins` run before the notices.
 */
async function built(root, { plugins = [], options = {} } = {}) {
  const result = await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [...plugins, thirdPartyNotices({ workspace: root })],
    build: { write: false, minify: false, ...options },
  })
  const output = (Array.isArray(result) ? result : [result]).flatMap((each) => each.output)
  const notices = output.find((item) => item.fileName === NOTICES_FILE)
  if (notices === undefined) throw new Error(`the build wrote no ${NOTICES_FILE}`)
  return { modules: output.flatMap((item) => item.moduleIds ?? []), files: output.map((item) => item.fileName), bytes: Buffer.from(notices.source) }
}

/** What a build that must fail failed with. */
async function refusal(root, setup = {}) {
  const outcome = await built(root, setup).then(
    () => undefined,
    (error) => error,
  )
  if (outcome === undefined) throw new Error('the build passed')
  return String(outcome.message)
}

const times = (text, part) => text.split(part).length - 1

/** The packages a notices text lists, by their headings, in its order. */
const listed = (text) => [...text.matchAll(/^-{80}\n(.+)\n/gm)].map((match) => match[1])

const APACHE = 'Apache License\nVersion 2.0, January 2004\n\nthe whole text, as the package ships it\n'
const FORMAL_NOTICE = 'Formal\nCopyright 2026 The Formal Authors\n\nThis product includes software developed at Example (https://example.invalid).\n'
const MIT = 'MIT License\n\nCopyright (c) 2026 Plain\n\nPermission is hereby granted, free of charge, ...\n'

describe('the notices a build writes', () => {
  // Apache-2.0 section 4(d) asks that a NOTICE travel with the work, and MIT
  // that its notice does: formancy's packages ship LICENSE and NOTICE, and
  // rxjs and tslib, in the host page's Angular chunk, ship LICENSE.txt. A
  // match on exact names misses LICENSE.txt, and Vite's own output reads one
  // file per package, so the NOTICE goes. A package split across two chunks
  // -- formal here, in the page's chunk and in the lazily loaded one -- is
  // still one package, listed once.
  test('reproduce every licence and notice file a package ships, each package once', async () => {
    const root = project({
      // plain first, so the bundler meets the packages out of name order.
      'src/main.js': `import plain from 'plain'\nconsole.log(plain)\n${uses('formal')}import('./lazy.js').then((lazy) => console.log(lazy.more()))\n`,
      'src/lazy.js': "export { more } from 'formal/more.js'\n",
      ...pkg('formal', '2.1.0', { 'LICENSE.txt': APACHE, NOTICE: FORMAL_NOTICE, 'README.md': 'Formal, the readme.\n', 'more.js': 'export function more() {\n  return 1\n}\n' }, { license: 'Apache-2.0' }),
      // CommonJS, so the bundler writes its runtime helper into the chunk.
      'node_modules/plain/package.json': JSON.stringify({ name: 'plain', version: '1.0.0', main: 'index.js', license: 'MIT' }),
      'node_modules/plain/index.js': "module.exports = 'plain'\n",
      'node_modules/plain/LICENSE': MIT,
    })
    const { modules, bytes } = await built(root)
    const text = bytes.toString('utf8')

    expect(times(text, 'formal 2.1.0')).toBe(1)
    expect(times(text, APACHE.trimEnd())).toBe(1)
    expect(times(text, FORMAL_NOTICE.trimEnd())).toBe(1)
    expect(text).toContain('Declared licence: Apache-2.0')
    expect(text).not.toContain('Formal, the readme.')
    expect(times(text, MIT.trimEnd())).toBe(1)
    // In name order, though the bundler met plain first, so the file is the
    // same for the same bundle whatever order the chunks and their modules
    // come in.
    expect(modules.findIndex((id) => id.includes('/node_modules/plain/'))).toBeLessThan(modules.findIndex((id) => id.includes('/node_modules/formal/')))
    expect(listed(text)).toEqual(['formal 2.1.0', 'plain 1.0.0'])
    expect(modules.some((id) => id.includes('/node_modules/formal/more.js'))).toBe(true)
    // A guard on the guard: every bundler module the plugin lets through
    // unlisted is one this build had, so the list names what Vite and
    // Rolldown write and nothing they no longer do.
    expect([...BUNDLER_MODULES].filter((id) => !modules.includes(id))).toEqual([])
  })

  // A package can carry somebody else's code in a directory of its own,
  // under that code's licence -- @angular/core 22 ships third_party/ with a
  // LICENSE beside each set of type declarations it vendors, none of them
  // bundled today. Read at the package's root alone, the vendored code
  // would ship under the outer package's licence, without the text its own
  // asks to travel with it.
  test('reproduce the licence of code a package vendors, from the directory it sits in', async () => {
    const BSD = 'BSD 3-Clause License\n\nCopyright (c) 2026 Inner\n'
    const root = project({
      'src/main.js': uses('outer'),
      'node_modules/outer/package.json': JSON.stringify({ name: 'outer', version: '1.0.0', type: 'module', main: 'index.js', license: 'MIT' }),
      'node_modules/outer/index.js': "export { name } from './third_party/inner/index.js'\n",
      'node_modules/outer/LICENSE': MIT,
      'node_modules/outer/third_party/inner/package.json': JSON.stringify({ name: 'inner', version: '2.0.0', type: 'module', license: 'BSD-3-Clause' }),
      'node_modules/outer/third_party/inner/index.js': 'export function name() {\n  return "inner"\n}\n',
      'node_modules/outer/third_party/inner/LICENSE': BSD,
      // Not on the way to any bundled module, so not this build's.
      'node_modules/outer/elsewhere/NOTICE': 'Elsewhere\n',
    })
    const text = (await built(root)).bytes.toString('utf8')
    expect(listed(text)).toEqual(['outer 1.0.0'])
    expect(times(text, MIT.trimEnd())).toBe(1)
    expect(times(text, BSD.trimEnd())).toBe(1)
    expect(text).toContain('Files: LICENSE, third_party/inner/LICENSE\n')
    expect(text).not.toContain('Elsewhere')
  })

  // pnpm installs one name and version in a directory per set of peers, so
  // one package can reach a bundle from two directories, each copy for what
  // its own dependents use. It is one package, listed once; and what either
  // copy vendors is reproduced, though only that copy's bundled file leads
  // to it. Listed per directory, the file would say twin's terms twice;
  // listed from the first copy alone, one vendored licence would go.
  test('list a package installed twice once, with what either copy vendors', async () => {
    const VENDOR_A = 'Vendor A License\n\nCopyright (c) 2026 A\n'
    const VENDOR_B = 'Vendor B License\n\nCopyright (c) 2026 B\n'
    const twin = (under) => ({
      [`node_modules/${under}/node_modules/twin/package.json`]: JSON.stringify({ name: 'twin', version: '3.0.0', type: 'module', main: 'index.js', license: 'MIT' }),
      [`node_modules/${under}/node_modules/twin/index.js`]: 'export function name() {\n  return "twin"\n}\n',
      [`node_modules/${under}/node_modules/twin/LICENSE`]: MIT,
      [`node_modules/${under}/node_modules/twin/vendor-a/index.js`]: 'export function a() {\n  return "a"\n}\n',
      [`node_modules/${under}/node_modules/twin/vendor-a/LICENSE`]: VENDOR_A,
      [`node_modules/${under}/node_modules/twin/vendor-b/index.js`]: 'export function b() {\n  return "b"\n}\n',
      [`node_modules/${under}/node_modules/twin/vendor-b/LICENSE`]: VENDOR_B,
    })
    const root = project({
      'src/main.js': uses('left', 'right'),
      ...pkg('left', '1.0.0', { LICENSE: MIT, 'index.js': "import { a } from 'twin/vendor-a/index.js'\nexport function name() {\n  return `left ${a()}`\n}\n" }, { license: 'MIT' }),
      ...pkg('right', '1.0.0', { LICENSE: MIT, 'index.js': "import { b } from 'twin/vendor-b/index.js'\nexport function name() {\n  return `right ${b()}`\n}\n" }, { license: 'MIT' }),
      ...twin('left'),
      ...twin('right'),
    })
    const { modules, bytes } = await built(root)
    const text = bytes.toString('utf8')
    // A guard on the guard: the bundle holds both copies, each by one file.
    expect(modules.filter((id) => /\/node_modules\/(left|right)\/node_modules\/twin\//.test(id)).map((id) => id.slice(id.indexOf('/node_modules/') + 14))).toEqual(
      expect.arrayContaining(['left/node_modules/twin/vendor-a/index.js', 'right/node_modules/twin/vendor-b/index.js']),
    )
    expect(listed(text)).toEqual(['left 1.0.0', 'right 1.0.0', 'twin 3.0.0'])
    expect(times(text, VENDOR_A.trimEnd())).toBe(1)
    expect(times(text, VENDOR_B.trimEnd())).toBe(1)
  })

  // @formancy/themes ships stylesheets and nothing else, under Apache-2.0
  // with a NOTICE, and both apps import it from a script; it is listed only
  // because the stylesheet is a module of the chunk that imports it. A
  // lazily loaded module that imports nothing but a stylesheet makes a chunk
  // the CSS step then removes, its rules moved into a stylesheet of their
  // own, so a plugin reading only the chunks that survive misses it.
  test('list a package whose stylesheet a script imports, from a lazily loaded module too', async () => {
    const root = project({
      'src/main.js': "import 'themed/blueprint.css'\nimport('./lazy.js').then(() => console.log('lazy'))\n",
      'src/lazy.js': "import 'later/later.css'\n",
      'node_modules/themed/package.json': JSON.stringify({ name: 'themed', version: '0.4.0', license: 'Apache-2.0', exports: { './blueprint.css': './blueprint.css' } }),
      'node_modules/themed/blueprint.css': '[data-formancy-part="field"] { color: #123456; }\n',
      'node_modules/themed/LICENSE': APACHE,
      'node_modules/themed/NOTICE': FORMAL_NOTICE,
      'node_modules/later/package.json': JSON.stringify({ name: 'later', version: '1.0.0', license: 'MIT', exports: { './later.css': './later.css' } }),
      'node_modules/later/later.css': 'p { color: #654321; }\n',
      'node_modules/later/LICENSE': MIT,
    })
    const text = (await built(root)).bytes.toString('utf8')
    expect(listed(text)).toEqual(['later 1.0.0', 'themed 0.4.0'])
    expect(times(text, APACHE.trimEnd())).toBe(1)
    expect(times(text, FORMAL_NOTICE.trimEnd())).toBe(1)
  })

  // A file of a package that a script names by `new URL(..., import.meta.url)`,
  // or a stylesheet by `url()`, is copied beside the chunks without being a
  // module of any; it ships all the same. Vite writes it as a file of its own
  // only past its inline limit, which the case sets to nothing so every file
  // is one (what Vite inlines instead is the last describe's).
  test('list the package of a file the build writes beside its chunks', async () => {
    const root = project({
      'src/main.js': "import './page.css'\nconsole.log(new URL('../node_modules/picture/logo.png', import.meta.url).href)\n",
      'src/page.css': "body { background: url('../node_modules/backdrop/bg.png'); }\n",
      ...pkg('picture', '1.0.0', { 'logo.png': 'a picture', LICENSE: MIT }),
      ...pkg('backdrop', '1.0.0', { 'bg.png': 'a backdrop', LICENSE: MIT }),
    })
    const { files, bytes } = await built(root, { options: { assetsInlineLimit: 0 } })
    expect(files.some((file) => /^assets\/logo-[\w-]+\.png$/.test(file))).toBe(true)
    expect(files.some((file) => /^assets\/bg-[\w-]+\.png$/.test(file))).toBe(true)
    expect(listed(bytes.toString('utf8'))).toEqual(['backdrop 1.0.0', 'picture 1.0.0'])
  })

  // A bundled package whose terms nobody shipped would reach every browser
  // with no licence beside it; Vite's own output lists it with no text and
  // carries on. Its name is the sentence, so the person reading the failure
  // knows which dependency to look at. A NOTICE alone is not a licence, an
  // empty LICENSE is no text, and a script named license.js is code: printed
  // as a licence, it would be a package with none listed as having one.
  test('refuse a bundled package that ships no licence text, naming each', async () => {
    const root = project({
      'src/main.js': `${uses('bare', 'noticed', 'blank', 'formal')}import { check } from 'scripted'\nconsole.log(check())\n`,
      ...pkg('bare', '0.1.0', { 'README.md': 'No licence here.\n' }, { license: 'MIT' }),
      ...pkg('noticed', '0.2.0', { NOTICE: 'Noticed\nCopyright 2026\n' }, { license: 'Apache-2.0' }),
      ...pkg('blank', '0.3.0', { LICENSE: '\n  \n' }, { license: 'MIT' }),
      ...pkg('formal', '2.1.0', { LICENSE: APACHE }, { license: 'Apache-2.0' }),
      'node_modules/scripted/package.json': JSON.stringify({ name: 'scripted', version: '0.4.0', type: 'module', main: 'license.js', license: 'UNLICENSED' }),
      'node_modules/scripted/license.js': 'export function check() {\n  return "licensed"\n}\n',
      'node_modules/scripted/licence.json': '{ "holder": "nobody" }\n',
    })
    const message = await refusal(root)
    expect(message).toContain('bare@0.1.0')
    expect(message).toContain('noticed@0.2.0')
    expect(message).toContain('blank@0.3.0')
    expect(message).toContain('scripted@0.4.0')
    expect(message).not.toContain('formal@2.1.0')
  })
})

describe('what a build does not list', () => {
  // A workspace package is linked into node_modules and resolves to its real
  // path in the repository, as @formancy/data-core and data-client do in the
  // apps. It is this repository's code, under its LICENSE.md and NOTICE, and
  // has no licence file of its own: a plugin that looked up every module's
  // nearest package.json would list it, or refuse it, and the project itself.
  test("leaves out the repository's own modules, a linked workspace package included", async () => {
    const root = project(
      {
        'src/main.js': `${uses('formal')}import { own } from '@example/own'\nconsole.log(own())\n`,
        'packages/own/package.json': JSON.stringify({ name: '@example/own', version: '1.0.0', type: 'module', main: 'index.js' }),
        'packages/own/index.js': 'export function own() {\n  return 1\n}\n',
        ...pkg('formal', '2.1.0', { LICENSE: APACHE }, { license: 'Apache-2.0' }),
      },
      { 'node_modules/@example/own': 'packages/own' },
    )
    const { modules, bytes } = await built(root)
    const text = bytes.toString('utf8')
    expect(modules.some((id) => id.endsWith('/packages/own/index.js'))).toBe(true)
    expect(text).toContain('formal 2.1.0')
    expect(text).not.toContain('@example/own')
    expect(text).not.toContain('the-app')
  })

  // The files Vite makes from the chunks themselves -- the stylesheet of a
  // chunk two lazily loaded modules share, which no source file names, and a
  // chunk's source map -- carry the chunks' modules, which are placed. A
  // plugin that refused every file with no source of its own would stop a
  // build for turning source maps on.
  test("passes over the files Vite makes from the chunks: a shared chunk's stylesheet, a source map", async () => {
    const root = project({
      'src/main.js': `${uses('formal')}import('./a.js').then((a) => console.log(a.a()))\nimport('./b.js').then((b) => console.log(b.b()))\n`,
      'src/a.js': "import { shared } from './shared.js'\nexport function a() {\n  return shared() + 'a'\n}\n",
      'src/b.js': "import { shared } from './shared.js'\nexport function b() {\n  return shared() + 'b'\n}\n",
      'src/shared.js': "import './shared.css'\nexport function shared() {\n  return 's'\n}\n",
      'src/shared.css': 'p { color: #123456; }\n',
      ...pkg('formal', '2.1.0', { LICENSE: APACHE }, { license: 'Apache-2.0' }),
    })
    const { files, bytes } = await built(root, { options: { sourcemap: true } })
    expect(files.some((file) => /^assets\/shared-[\w-]+\.css$/.test(file))).toBe(true)
    expect(files.some((file) => file.endsWith('.js.map'))).toBe(true)
    expect(listed(bytes.toString('utf8'))).toEqual(['formal 2.1.0'])
  })

  // A module from outside the repository and outside node_modules -- a
  // dependency linked from somewhere else on the machine -- is nobody's this
  // build can name, so its terms are unknown: the build stops rather than
  // ship it under no licence, or under this repository's.
  test('refuses a module from neither node_modules nor the repository, naming it', async () => {
    const elsewhere = temporary()
    writeFileSync(join(elsewhere, 'package.json'), JSON.stringify({ name: 'far', version: '1.0.0', type: 'module', main: 'index.js' }))
    writeFileSync(join(elsewhere, 'index.js'), 'export function name() {\n  return "far"\n}\n')
    const root = project({ 'src/main.js': uses('far') }, { 'node_modules/far': elsewhere })
    const message = await refusal(root)
    expect(message).toContain(join(elsewhere, 'index.js').replaceAll('\\', '/'))
  })

  // A plugin can write any code into a chunk under an id of its own, a
  // library included. The bundler's own helpers are a reviewed list; any
  // other such module stops the build until somebody has read what it is.
  test('refuses a module a plugin writes that is not one of the reviewed bundler modules', async () => {
    const greeting = {
      name: 'greeting',
      resolveId: (id) => (id === 'virtual:greeting' ? '\0virtual:greeting' : undefined),
      load: (id) => (id === '\0virtual:greeting' ? 'export function greeting() {\n  return "hello"\n}\n' : undefined),
    }
    const root = project({ 'src/main.js': "import { greeting } from 'virtual:greeting'\nconsole.log(greeting())\n" })
    expect(await refusal(root, { plugins: [greeting] })).toContain('virtual:greeting')
  })

  // Vite bundles a worker in a build of its own, which runs none of the
  // page's plugins, and hands back its code as a file with no source named
  // -- or, inlined, as a string inside the module that imports it. Either
  // way the packages a worker bundles reach the browser in no chunk this
  // plugin reads, here formal in each of three workers. A file a plugin
  // emits from no source is unknown in the same way. Each stops the build,
  // named, until somebody teaches the plugin to read it.
  test('refuses a worker, and a file written from no source, naming each', async () => {
    const extra = {
      name: 'extra',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'extra.bin', source: 'bytes from somewhere' })
      },
    }
    const root = project({
      'src/main.js': [
        "import Wrapped from './wrapped.js?worker'",
        "import Inlined from './inlined.js?worker&inline'",
        "new Worker(new URL('./located.js', import.meta.url), { type: 'module' })",
        'new Wrapped()',
        'new Inlined()',
        '',
      ].join('\n'),
      'src/located.js': uses('formal'),
      'src/wrapped.js': uses('formal'),
      'src/inlined.js': uses('formal'),
      ...pkg('formal', '2.1.0', { LICENSE: APACHE }, { license: 'Apache-2.0' }),
    })
    const message = await refusal(root, { plugins: [extra] })
    expect(message).toMatch(/assets\/located-[\w-]+\.js /)
    expect(message).toMatch(/assets\/wrapped-[\w-]+\.js /)
    expect(message).toContain('/src/wrapped.js?worker ')
    expect(message).toContain('/src/inlined.js?worker&inline ')
    expect(message).toContain('extra.bin ')
  })
})

describe('what a build does not see', () => {
  // What 0046 and the register say the notices miss, measured: Vite folds
  // these into a chunk or a stylesheet as text, with no module and no file to
  // say whose they are -- a package stylesheet a stylesheet @imports, a
  // package's file under the inline limit, as a data: URL, from a CSS url()
  // or a new URL(), and a module whose only export is a boolean or a number,
  // copied into its user. Each package ships and none is listed. If this
  // fails, the bundler has started reporting one of them, and the record and
  // the register say a gap that is gone.
  test('misses what Vite folds into a chunk or a stylesheet as text', async () => {
    const root = project({
      'src/main.js': [
        "import './page.css'",
        "import { FLAG } from 'flagged'",
        "import { COUNT } from 'counted'",
        "console.log(FLAG, COUNT, new URL('../node_modules/picture/logo.png', import.meta.url).href)",
        '',
      ].join('\n'),
      'src/page.css': "@import 'imported/imported.css';\nbody { background: url('../node_modules/backdrop/bg.png'); }\n",
      'node_modules/imported/package.json': JSON.stringify({ name: 'imported', version: '1.0.0', exports: { './imported.css': './imported.css' } }),
      'node_modules/imported/imported.css': 'p { color: #123456; }\n',
      ...pkg('picture', '1.0.0', { 'logo.png': 'a picture' }),
      ...pkg('backdrop', '1.0.0', { 'bg.png': 'a backdrop' }),
      'node_modules/flagged/package.json': JSON.stringify({ name: 'flagged', version: '1.0.0', type: 'module', main: 'index.js' }),
      'node_modules/flagged/index.js': 'export const FLAG = true\n',
      'node_modules/counted/package.json': JSON.stringify({ name: 'counted', version: '1.0.0', type: 'module', main: 'index.js' }),
      'node_modules/counted/index.js': 'export const COUNT = 42\n',
    })
    // Vite's own inline limit, as both apps have it. None of these packages
    // ships a licence, so had the plugin seen one the build would have
    // stopped.
    const { modules, bytes } = await built(root)
    expect(modules.filter((id) => id.includes('/node_modules/'))).toEqual([])
    expect(listed(bytes.toString('utf8'))).toEqual([])
  })
})

describe('the encoding', () => {
  // nginx serves the file as `text/plain; charset=utf-8`, so it must be
  // UTF-8: a name with an accent or a copyright sign written in another
  // encoding is garbled in every browser. A byte-order mark at the start of
  // a licence file is the file's encoding, not its text.
  test('is UTF-8, every licence text included', async () => {
    const accented = 'Copyright © 2026 Zoë Ångström'
    const root = project({
      'src/main.js': uses('accented'),
      ...pkg('accented', '1.0.0', { LICENSE: `﻿${accented}\n\nPermission is granted.\n` }),
    })
    const text = new TextDecoder('utf-8', { fatal: true }).decode((await built(root)).bytes)
    expect(text).toContain(accented)
    expect(text).not.toContain('﻿')
  })

  // A licence file in Latin-1 read as UTF-8 comes out with replacement
  // characters where its © was: a text that is no longer the one shipped.
  // The build stops and names the file instead.
  test('refuses a licence file that is not UTF-8, naming the package and the file', async () => {
    const root = project({
      'src/main.js': uses('latin'),
      ...pkg('latin', '1.0.0', { 'LICENSE.txt': Buffer.from('Copyright © 2026 Zoë\n', 'latin1') }),
    })
    const message = await refusal(root)
    expect(message).toContain('latin@1.0.0')
    expect(message).toContain('LICENSE.txt')
  })
})

describe('the packages and apps this repository builds', () => {
  // The plugin takes a workspace package's dist as this repository's own.
  // tsdown inlines a devDependency a package imports at run time, with no
  // more than a hint: @formancy/core, a devDependency of data-core, would
  // land in data-core's dist, and from there in both apps' bundles and the
  // npm tarball, as this repository's code and under its licence. With
  // `deps.onlyBundle` empty, such a build fails instead, naming the package
  // (tsdown 0.23.0, watched on 2026-10-11).
  test('each refuses to inline anything from node_modules into its dist', async () => {
    const packages = readdirSync(join(repo, 'packages')).filter((name) => readdirSync(join(repo, 'packages', name)).includes('tsdown.config.ts'))
    expect(packages).toContain('data-core')
    expect(packages).toContain('data-client')
    for (const name of packages) {
      const { default: config } = await import(pathToFileURL(join(repo, 'packages', name, 'tsdown.config.ts')).href)
      expect({ name, onlyBundle: config.deps?.onlyBundle }).toEqual({ name, onlyBundle: [] })
    }
  })

  // Turbo replays an app's cached dist/ when none of the files it hashes for
  // the build changed, and by default it hashes the app's own files alone.
  // The plugin lives outside both apps, so an edit to it alone -- a licence
  // file name it now finds, a module it now refuses -- would be served with
  // the notices the old plugin wrote. Each app whose build runs the plugin
  // names it among its build's inputs (its turbo.json), read here as turbo
  // resolves them. The apps are found by the plugins their configs load, and
  // are the two the web image serves.
  test('each app that writes the notices builds again when the plugin changes', async () => {
    const apps = []
    for (const name of readdirSync(join(repo, 'apps')).sort()) {
      const file = join(repo, 'apps', name, 'vite.config.ts')
      if (!existsSync(file)) continue
      const { default: config } = await import(pathToFileURL(file).href)
      if ((config.plugins ?? []).flat(Infinity).some((plugin) => plugin?.name === thirdPartyNotices().name)) apps.push(name)
    }
    expect(apps).toEqual(['host', 'studio'])
    const dry = spawnSync('pnpm', ['exec', 'turbo', 'run', 'build', '--dry=json', ...apps.map((name) => `--filter=./apps/${name}`)], { cwd: repo, encoding: 'utf8', shell: process.platform === 'win32' })
    expect(dry.status).toBe(0)
    const tasks = JSON.parse(dry.stdout).tasks
    for (const name of apps) {
      const task = tasks.find((each) => each.directory === `apps/${name}` && each.task === 'build')
      expect({ name, plugin: Object.keys(task?.inputs ?? {}).includes('../../scripts/third-party-notices.mjs') }).toEqual({ name, plugin: true })
    }
  })
})
