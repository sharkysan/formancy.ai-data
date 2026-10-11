// The licence and notice texts of every package a built app bundles (0046).
//
// A Vite plugin, in the configs of the two apps the web image serves,
// apps/studio and apps/host, that writes THIRD-PARTY-NOTICES.txt beside each
// app's index.html. The bundles keep no licence comment, so without it the
// code of React, Angular and upstream formancy reaches every browser with
// none of the texts their licences ask to travel with it: MIT's notice, and
// for an Apache-2.0 package its NOTICE (section 4(d)). Vite's own
// `build.license` (read in 8.3.3, what both apps resolve) reads one licence
// file per package and never a NOTICE.
//
// Every module of every chunk, and every file the build writes beside them,
// is placed, or the build stops:
//
// - under node_modules, it belongs to the package directly below the last
//   node_modules of its path. Each such package is listed once, by name and
//   version, with the full text of every licence and notice file in its
//   directory -- a name that begins LICENSE, LICENCE, COPYING or NOTICE in
//   any case, so rxjs's LICENSE.txt is found and so is formancy's NOTICE,
//   and is not a script or data by its extension -- and of every such file
//   in a directory between there and a bundled file of it, where a package
//   keeps code it vendors under that code's own licence. A package with no
//   licence text at its root stops the build, naming it;
// - in this repository and not under node_modules, it is this repository's
//   own -- a workspace package resolves to its real path here -- and is not
//   listed: LICENSE.md and NOTICE cover it;
// - written by the bundler itself, it is one of BUNDLER_MODULES and is not
//   listed; any other module a plugin writes stops the build;
// - a worker, which Vite bundles in a build of its own that runs none of
//   these plugins, stops the build: the module that imports it with
//   `?worker`, and the file its code comes back as, which names no source;
// - a file the build writes is placed by the source files Vite names for
//   it, and a stylesheet or source map Vite makes from a chunk is that
//   chunk's; any other file with no source stops the build;
// - anywhere else, nothing here can say whose it is, and the build stops.
//
// The modules are read as each chunk is rendered, not from the bundle at the
// end: the CSS step removes a chunk that held only stylesheets, and moves its
// rules into a stylesheet of their own, by the time the bundle is written.
//
// Node built-ins only: the getting-started gate, which runs from a checkout
// with nothing installed, imports NOTICES_FILE from here.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The file each build writes beside its index.html, and the gate asks the web front for. */
export const NOTICES_FILE = 'THIRD-PARTY-NOTICES.txt'

/** A licence's text, by how its file's name begins: LICENSE, LICENSE.txt, LICENCE.md, COPYING. */
const LICENCE = /^(licen[cs]e|copying)/i

/** A notice a licence asks to be reproduced, Apache-2.0's above all. */
const NOTICE = /^notice/i

/**
 * A script, a stylesheet, JSON, a source map or WebAssembly, by its
 * extension: code or data, never a licence's text, whatever its name begins
 * with -- a package's license.js is not its licence.
 */
const CODE = /\.(?:[cm]?[jt]sx?|json|map|wasm|css)$/i

/**
 * The modules the bundler writes into a chunk itself rather than reading
 * them from a package: Rolldown's runtime helpers and Vite's preload
 * helpers, the only ones either app's build had with Vite 8.3.3 on
 * 2026-10-11. They are not listed, and Vite's own licence output lists none
 * of them either. Any other module whose id begins with `\0` --
 * the bundler's mark for one no file holds -- stops the build, so a plugin
 * that writes a library into a chunk is read before it ships.
 */
export const BUNDLER_MODULES = new Set(['\0rolldown/runtime.js', '\0vite/modulepreload-polyfill.js', '\0vite/preload-helper.js'])

/** A module Vite turns into a worker, as its own worker plugin tells them (`?worker`, `?sharedworker`). */
const WORKER = /[?&](?:worker|sharedworker)(?:&|$)/

const NODE_MODULES = '/node_modules/'

/** A path `/`-separated, as the bundler names modules on every platform. */
const slashed = (path) => path.replaceAll('\\', '/')

/** A module id as a path: without the query a plugin may add. */
const pathOf = (id) => slashed(id.split('?')[0])

/** The package directory a path under node_modules belongs to: the one directly below its last node_modules. */
function packageDirectory(path) {
  const at = path.lastIndexOf(NODE_MODULES)
  if (at === -1) return undefined
  const below = path.slice(at + NODE_MODULES.length).split('/')
  const name = below[0].startsWith('@') ? `${below[0]}/${below[1]}` : below[0]
  return `${path.slice(0, at + NODE_MODULES.length)}${name}`
}

/** A file's text, which must be UTF-8: a byte-order mark is dropped, anything else that is not UTF-8 throws. */
const utf8 = (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes)

/**
 * The licence and notice files in one directory of a package, in name
 * order, each named by `prefix` and its own name; `problems` names any that
 * is not UTF-8, as package `id`'s.
 */
function licenceFiles(directory, prefix, id) {
  const files = []
  const problems = []
  for (const name of readdirSync(directory).sort()) {
    if ((!LICENCE.test(name) && !NOTICE.test(name)) || CODE.test(name)) continue
    if (!statSync(join(directory, name)).isFile()) continue
    try {
      files.push({ name: `${prefix}${name}`, licence: LICENCE.test(name), text: utf8(readFileSync(join(directory, name))).trimEnd() })
    } catch {
      problems.push(`${id}'s ${prefix}${name} is not UTF-8, so it cannot be reproduced as it ships`)
    }
  }
  return { files, problems }
}

/**
 * A package as the notices list it, read from its directory: its manifest's
 * name, version and licence, the licence and notice files at its root, then
 * those in each directory of `within` -- the directories between its root
 * and a bundled file of it -- in path order. `problems` says why it cannot be
 * listed as it ships.
 */
function readPackage(directory, within) {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  } catch {
    return { problems: [`${directory} holds a bundled module and no package.json this plugin can read, so its name and terms are unknown`] }
  }
  const id = `${String(manifest.name)}@${String(manifest.version)}`
  const own = licenceFiles(directory, '', id)
  const problems = [...own.problems]
  const files = [...own.files]
  for (const inner of [...within].sort()) {
    const found = licenceFiles(inner, `${inner.slice(directory.length + 1)}/`, id)
    problems.push(...found.problems)
    files.push(...found.files)
  }
  if (problems.length === 0 && !own.files.some((file) => file.licence && file.text.trim() !== '')) {
    problems.push(`${id} is bundled and ships no licence text: no file at its root whose name begins LICENSE, LICENCE or COPYING, and is not a script or data, holds any`)
  }
  return { id, name: String(manifest.name), version: String(manifest.version), declared: manifest.license, files, problems }
}

/**
 * Every package `ids` came from -- the modules of the chunks and the source
 * files of what is written beside them -- each once, in name and version
 * order, and what stops them being listed. `workspace` is the directory
 * whose files outside node_modules are this repository's own.
 */
function bundledPackages(ids, workspace) {
  const own = `${slashed(resolve(workspace)).replace(/\/$/, '')}/`
  // Each package directory, with the directories below its root that hold a bundled file of it.
  const directories = new Map()
  const problems = []
  for (const id of ids) {
    if (id.startsWith('\0')) {
      if (!BUNDLER_MODULES.has(id)) problems.push(`${JSON.stringify(id.slice(1))} is a module a plugin or the bundler wrote, and not one of the reviewed BUNDLER_MODULES in scripts/third-party-notices.mjs`)
      continue
    }
    if (WORKER.test(id)) {
      problems.push(`${slashed(id)} is a worker, which Vite bundles in a build of its own that this plugin does not see, so what it carries is unknown`)
      continue
    }
    const path = pathOf(id)
    const directory = packageDirectory(path)
    if (directory === undefined) {
      if (!path.startsWith(own)) problems.push(`${path} is bundled and is neither in a package under node_modules nor this repository's own, so whose it is and under what terms is unknown`)
      continue
    }
    const within = directories.get(directory) ?? new Set()
    directories.set(directory, within)
    for (let inner = dirname(path); inner.length > directory.length && inner.startsWith(`${directory}/`); inner = dirname(inner)) within.add(inner)
  }
  const packages = new Map()
  for (const [directory, within] of directories) {
    const found = readPackage(directory, within)
    problems.push(...found.problems)
    if (found.problems.length > 0) continue
    // One name and version installed twice -- pnpm does, once per set of
    // peers -- is one package; what the second copy vendors is added.
    const listed = packages.get(found.id)
    if (listed === undefined) packages.set(found.id, found)
    else for (const file of found.files) if (!listed.files.some((each) => each.name === file.name)) listed.files.push(file)
  }
  const order = (a, b) => (a.name === b.name ? (a.version < b.version ? -1 : 1) : a.name < b.name ? -1 : 1)
  return { packages: [...packages.values()].sort(order), problems }
}

const RULE = '-'.repeat(80)

/** The notices file's text: what it is, then each package with its files' texts. */
function noticesText(packages) {
  const lines = [
    'Third-party notices',
    '',
    'The packages below are bundled into the files beside this one. Each is',
    'listed once, by name and version, with the licence its package.json',
    'declares, and is followed by its licence and notice files as it ships',
    'them: those at its root, and those in any directory between there and a',
    'file of it that is bundled, named by their path in the package.',
    '',
    "The rest of this build is not listed: the Formancy Data repository's own",
    "code, under the terms of that repository's LICENSE.md and NOTICE, which are",
    'at the root of its source and in its web image, not beside this file; and',
    'the helpers the bundler writes into its output itself.',
  ]
  for (const found of packages) {
    lines.push('', RULE, `${found.name} ${found.version}`)
    if (typeof found.declared === 'string') lines.push(`Declared licence: ${found.declared}`)
    lines.push(`Files: ${found.files.map((file) => file.name).join(', ')}`, RULE)
    for (const file of found.files) lines.push('', `== ${file.name} ==`, '', file.text)
  }
  return `${lines.join('\n')}\n`
}

/**
 * The plugin. Build only: the dev server and the apps' suites bundle
 * nothing. `workspace` defaults to this repository's root, found from this
 * file when the bundle is written, not when the config loads. Among the
 * plugins Vite runs last, after its CSS step and its page, so it sees the
 * stylesheets, the page and what the plugins before it write.
 */
export function thirdPartyNotices({ workspace } = {}) {
  let root
  let modules = new Set()
  let stylesheets = new Set()
  return {
    name: 'formancy-data:third-party-notices',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      root = config.root
    },
    renderStart() {
      modules = new Set()
      stylesheets = new Set()
    },
    renderChunk(_code, chunk) {
      for (const id of chunk.moduleIds) modules.add(id)
      for (const fileName of chunk.viteMetadata?.importedCss ?? []) stylesheets.add(fileName)
      return null
    },
    generateBundle(_options, bundle) {
      const items = Object.values(bundle)
      const maps = new Set(items.flatMap((item) => (item.type === 'chunk' && item.sourcemapFileName ? [item.sourcemapFileName] : [])))
      const ids = [...modules]
      const problems = []
      for (const item of items) {
        if (item.type === 'chunk' || stylesheets.has(item.fileName) || maps.has(item.fileName)) continue
        if (item.originalFileNames.length === 0) problems.push(`${item.fileName} is written from no source file Vite names -- a worker's code, which Vite bundles in a build of its own, or a file a plugin emits -- so whose it is is unknown`)
        for (const name of item.originalFileNames) ids.push(resolve(root, name))
      }
      const found = bundledPackages(ids, workspace ?? fileURLToPath(new URL('..', import.meta.url)))
      problems.push(...found.problems)
      if (problems.length > 0) this.error(`${NOTICES_FILE} cannot be written:\n- ${problems.join('\n- ')}`)
      this.emitFile({ type: 'asset', fileName: NOTICES_FILE, source: new TextEncoder().encode(noticesText(found.packages)) })
    },
  }
}
