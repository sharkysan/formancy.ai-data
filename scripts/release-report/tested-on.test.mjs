import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, test } from 'vitest'
import YAML from 'yaml'
import { stale } from './readme.mjs'
import { dockerfileImages, installed, NESTED, published, testedOn, workspace } from './tested-on.mjs'

/**
 * What the checkout says it is tested on (0035), held to the tree: the
 * README's generated blocks to what is installed and built, compose to the
 * images the suites start, and testedOn() to every dependency a published
 * package declares. Runs in `pnpm test:repo`, after `pnpm build`: the images
 * come from data-fixtures' built output.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

let facts
beforeAll(async () => {
  facts = await testedOn(repo)
})

/** An image without its tag or digest: `postgres:17-alpine` is `postgres`, a registry's port kept. */
function repository(image) {
  const base = image.split('@')[0]
  const slash = base.lastIndexOf('/')
  const colon = base.indexOf(':', slash + 1)
  return colon === -1 ? base : base.slice(0, colon)
}

describe('the README blocks', () => {
  // A dependency or an image bumped without the README following would leave
  // the README naming a version nobody runs any more, which is the drift a
  // generated block exists to stop.
  test('say what testedOn() says', () => {
    expect(
      stale(facts, repo).map(({ file }) => file),
      'run node scripts/release-report/readme.mjs --write',
    ).toEqual([])
  })
})

describe('the images', () => {
  // compose.yaml is how a developer and the getting-started guide run the
  // databases (0032). A service on another tag than the suites' would be a
  // stack nobody tested, under the same image name.
  test('compose names exactly the image the suites start, wherever it names that repository', () => {
    const compose = YAML.parse(readFileSync(join(repo, 'compose.yaml'), 'utf8'))
    const defaults = Object.values(facts.images)
    const services = Object.entries(compose.services).filter(([, service]) => typeof service.image === 'string')
    const sharing = services.filter(([, service]) => defaults.some((image) => repository(image) === repository(service.image)))
    expect(sharing.length).toBeGreaterThanOrEqual(defaults.length)
    for (const [name, service] of sharing) {
      expect(defaults, `compose.yaml's ${name}`).toContain(service.image)
    }
  })

  // The databases the composed stack's server connects to are the engines
  // the getting-started job runs the guide on, and the report names what
  // they answered beside the suites'. One on another image repository --
  // another product line, a different edition's image -- would pass the
  // check above, which looks only at the repositories the suites use.
  test('compose runs each database the server connects to on that engine’s default image', () => {
    const compose = YAML.parse(readFileSync(join(repo, 'compose.yaml'), 'utf8'))
    const connections = JSON.parse(readFileSync(join(repo, 'deploy', 'connections.json'), 'utf8'))
    expect(new Set(connections.map((entry) => entry.kind))).toEqual(new Set(facts.engines))
    for (const { id, kind, host } of connections) {
      expect(compose.services[host]?.image, `compose.yaml's ${host}, which connection ${id} reaches`).toBe(facts.images[kind])
    }
  })

  // Under pnpm's isolated node_modules a package can import testcontainers
  // only if it declares it, so a suite or gate that starts a container
  // through it goes through data-fixtures -- which records what answered.
  // This holds declarations only: compose and `docker run` start databases
  // outside it, and nothing here sees those (0035 says so).
  test('only data-fixtures may start a container through testcontainers', () => {
    const declaring = workspace(repo)
      .filter(({ manifest }) =>
        ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].some((field) =>
          Object.keys(manifest[field] ?? {}).some((name) => name === 'testcontainers' || name.startsWith('@testcontainers/')),
        ),
      )
      .map(({ dir }) => dir)
    expect(declaring).toEqual(['packages/data-fixtures'])
  })
})

describe('testedOn()', () => {
  // A runtime dependency added to a published package and missing here would
  // be published as a range the report never names beside a version.
  test('names every runtime dependency of every published package, with the package that declares it', () => {
    const local = new Set(workspace(repo).map(({ manifest }) => manifest.name))
    const declared = published(repo).flatMap(({ manifest }) =>
      Object.entries(manifest.dependencies ?? {})
        .filter(([name, range]) => !local.has(name) && !String(range).startsWith('workspace:') && !name.startsWith('@formancy/'))
        .map(([name, range]) => ({ package: manifest.name, name, range })),
    )
    expect(declared.length).toBeGreaterThan(3)
    const named = facts.runtime.filter((entry) => entry.under === undefined).map(({ package: owner, name, range }) => ({ package: owner, name, range }))
    expect(named).toEqual(expect.arrayContaining(declared))
    expect(named).toHaveLength(declared.length)
  })

  // NESTED is the one typed list. An entry that is not what its parent
  // depends on -- a typo, a driver that changed what it speaks through --
  // would name a package nothing loads.
  test('names, under each facade, a package that facade depends on as installed', () => {
    for (const [parent, children] of Object.entries(NESTED)) {
      const owners = published(repo).filter(({ manifest }) => manifest.dependencies?.[parent] !== undefined)
      expect(owners.length, `no published package depends on ${parent}`).toBeGreaterThan(0)
      for (const { dir } of owners) {
        const found = installed(join(repo, dir), parent)
        const manifest = JSON.parse(readFileSync(join(found.dir, 'package.json'), 'utf8'))
        for (const child of children) expect(Object.keys(manifest.dependencies ?? {}), `${parent} as ${dir} loads it`).toContain(child)
      }
    }
  })

  // The server image is built in stages, and the one that runs is the last.
  // Reading only the first FROM would name the build's Node as the one the
  // product runs on.
  test("reads every stage's image of the server's Dockerfile, and skips a stage's flags", () => {
    const text = readFileSync(join(repo, 'packages', 'data-server', 'Dockerfile'), 'utf8')
    const stages = text.split('\n').filter((line) => /^FROM\s/i.test(line)).length
    expect(stages).toBeGreaterThanOrEqual(2)
    expect(facts.node.dockerfile).toHaveLength(stages)
    expect(dockerfileImages('FROM --platform=$BUILDPLATFORM node:22-alpine AS build\nRUN true\nFROM node:22-slim AS runtime\n')).toEqual(['node:22-alpine', 'node:22-slim'])
  })

  // A lookup that found nothing would render an empty row that equals
  // itself, and the README test above would pass on a table of blanks.
  test('finds a version for the browser, every tool and every package it names', () => {
    const version = /^\d+\.\d+/
    expect(facts.browser.playwright).toMatch(version)
    expect(facts.browser.chromium).toMatchObject({ name: 'chromium-headless-shell', browserVersion: expect.stringMatching(version), revision: expect.stringMatching(/^\d+$/) })
    for (const tool of facts.tooling) {
      expect(tool.versions.length, tool.name).toBeGreaterThan(0)
      for (const entry of tool.versions) expect(entry.version, tool.name).toMatch(version)
    }
    for (const entry of [...facts.runtime, ...facts.upstream]) expect(entry.version ?? entry.loaded, entry.name).toMatch(version)
    expect(facts.node.ci.length).toBeGreaterThan(0)
    // The README's Development line sends a reader to the table for pnpm's
    // version: corepack runs the one the root's packageManager pins.
    expect(facts.packageManager).toEqual({ name: 'pnpm', version: expect.stringMatching(version), declared: expect.stringMatching(/^pnpm@/) })
    expect(facts.engines).toEqual(Object.keys(facts.images))
  })
})
