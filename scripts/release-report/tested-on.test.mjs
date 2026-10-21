import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, test } from 'vitest'
import YAML from 'yaml'
import { BROWSERS } from '../browsers.mjs'
import { adapterLine, readmeTable, stale } from './readme.mjs'
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

describe('the browsers’ pins', () => {
  // A headless chromium.launch() starts the headless shell, a build of its
  // own in Playwright's browsers.json; the `chromium` entry beside it is the
  // full browser, another download, which Playwright 1.63.0 pins at the
  // same version and revision. What this holds is the entry read: from
  // `chromium`, the README's table and the report would name a build the
  // gates never launch. That a run launched the shell is the report's to
  // hold, from the options it launched with (problems.mjs, launchedBuild).
  test('hold Chromium to the headless shell Playwright pins', () => {
    expect(facts.browser.pins.find((pin) => pin.browser === 'chromium')).toMatchObject({ name: 'chromium-headless-shell' })
  })

  // Every browser the gates run in is held to a build Playwright pins: a
  // browser without one would be reported at whatever version a machine
  // had, and the README's table would leave it out (0058).
  test('pin a build of Playwright’s for every browser the gates run in, in their order', () => {
    expect(facts.browser.pins.map((pin) => [pin.browser, pin.name])).toEqual([
      ['chromium', 'chromium-headless-shell'],
      ['firefox', 'firefox'],
      ['webkit', 'webkit'],
    ])
  })
})

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

  // The release is tested on the matrix (0067), not on the default alone: a
  // README naming 17 and 2022 only would undersell what runs, and one naming
  // an image no leg runs would claim a version nothing tests. Each image of
  // each engine's matrix is named, with the suites that run on it.
  test('name every image of each engine’s matrix, and the suites that run on the others', async () => {
    const { MATRIX_IMAGES, DEFAULT_IMAGES } = await import(pathToFileURL(join(repo, 'packages', 'data-fixtures', 'dist', 'index.mjs')).href)
    expect(facts.matrix).toEqual(MATRIX_IMAGES)
    expect(facts.images).toEqual(DEFAULT_IMAGES)
    const table = readmeTable(facts)
    for (const engine of facts.engines) {
      const line = adapterLine(facts, engine)
      for (const image of facts.matrix[engine]) {
        expect(table, image).toContain(`\`${image}\``)
        expect(line, image).toContain(`\`${image}\``)
      }
      expect(table).toContain(`\`@formancy/data-fixtures\` and \`@formancy/data-${engine}\` also on`)
      // 0067 narrows 0003: an image one file names is what that file
      // showed, not what the release is tested with. 0003's old rule,
      // "unless a test names another image", in the Tested with column
      // would make postgres:14-alpine, which admin-untested names, read as
      // tested.
      expect(table, engine).toContain(`| \`${facts.images[engine]}\`; \`@formancy/data-fixtures\``)
      expect(line, engine).not.toContain('unless a test names another image')
    }
    expect(table).toContain('an image outside the matrix that one file names shows only what that file shows')
    // An image of the matrix no leg runs has no suites to name, and is refused rather than said.
    const unled = { ...facts, legs: facts.legs.filter((leg) => leg.image !== facts.matrix.postgres[1]) }
    expect(() => readmeTable(unled)).toThrow(`${facts.matrix.postgres[1]} is an image of the matrix that no leg of the test-images job runs`)
  })

  // No test runs on Azure SQL Database or Managed Instance (0073). Before
  // it the README named the images it was tested on and said nothing of
  // them, which a buyer on Azure reads as a question answered; and a row
  // typed by hand would go on saying "not tested" after a later record
  // tested one. The row is data-core's UNTESTED_PRODUCTS, so it fails here
  // the day either Azure product is called tested, and it never names a
  // product an engine of TESTED_SERVERS was tested on. The row sits under
  // the "Tested with" column, so its cell opens with "None": one that
  // opened with the products' names would read, down that column, as
  // products the release was tested with.
  test('name Azure SQL Database and Azure SQL Managed Instance as recognised and not tested, from data-core, under "Tested with" as none', async () => {
    const { TESTED_SERVERS, UNTESTED_PRODUCTS } = await import(pathToFileURL(join(repo, 'packages', 'data-core', 'dist', 'index.mjs')).href)
    expect(facts.untested).toEqual(UNTESTED_PRODUCTS)
    const table = readmeTable(facts).split('\n')
    expect(table[0]).toBe('| | Tested with | Declared as |')
    const row = table.find((line) => line.startsWith('| **Recognised, not tested** |'))
    expect(row, 'the README table has no "Recognised, not tested" row').toBeDefined()
    const [, testedWith, declaredAs] = row.slice(1, -1).split('|').map((text) => text.trim())
    expect(testedWith).toMatch(/^None: /)
    expect(declaredAs).toBe('')
    expect(testedWith).toContain('Azure SQL Database')
    expect(testedWith).toContain('Azure SQL Managed Instance')
    const tested = new Set(Object.values(TESTED_SERVERS).map((entry) => entry.product))
    expect(facts.untested.filter(({ product }) => tested.has(product))).toEqual([])
    for (const { name } of facts.untested) expect(testedWith).toContain(name)
    // A release tested on every product it recognises has nothing to say here, and says nothing rather than an empty row.
    expect(readmeTable({ ...facts, untested: [] })).not.toContain('Recognised, not tested')
  })

  // A SQL Server connection may log in as an Entra managed identity or
  // service principal, and no test logs in as either (0074): a buyer on
  // Azure SQL reads this table for what was tested, and a README naming
  // the images alone would let "SQL Server, tested" stand for a login no
  // test made. The row is data-sqlserver's SQLSERVER_LOGINS, the list the
  // allowlist's login types are held to, so a login added there without
  // the README, or one later tested, changes the row. Under "Tested with"
  // the tested logins come first and the others follow, said as accepted
  // and not tested. Watched failing with the row left out, and with every
  // login rendered as tested.
  test('name every SQL Server login the adapter opens, and the ones no test logs in with as accepted and not tested, from data-sqlserver', async () => {
    const { SQLSERVER_LOGINS } = await import(pathToFileURL(join(repo, 'packages', 'data-sqlserver', 'dist', 'index.mjs')).href)
    expect(facts.logins).toEqual(SQLSERVER_LOGINS.map(({ login, name, tested }) => ({ login, name, tested })))
    const row = readmeTable(facts)
      .split('\n')
      .find((line) => line.startsWith('| **SQL Server logins** |'))
    expect(row, 'the README table has no "SQL Server logins" row').toBeDefined()
    const [, testedWith, declaredAs] = row.slice(1, -1).split('|').map((text) => text.trim())
    expect(testedWith).toBe('SQL login; Entra managed identity and Entra service principal are accepted and not tested')
    expect(declaredAs).toBe('')
    const [tested, untested = ''] = testedWith.split('; ')
    for (const { name, tested: wasTested } of facts.logins) expect(wasTested ? tested : untested, name).toContain(name)
    // Were every login tested, the row would name them all and say nothing more.
    const all = readmeTable({ ...facts, logins: facts.logins.map((login) => ({ ...login, tested: true })) })
    expect(all).toContain('| **SQL Server logins** | SQL login, Entra managed identity and Entra service principal |  |')
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

  // An upstream package is shipped when a consumer's install of the
  // published packages brings it: a published package's `dependencies`
  // name it, or a shipped package's own do. One only an app or a test
  // declares -- the renderers, the themes, core where the suites use it --
  // is not, and the release's SBOM is held to the shipped ones alone, so a
  // correct SBOM is not refused for leaving out what nothing installs
  // (0092; watched failing: no package was marked).
  test('marks shipped the upstream packages a published package brings', () => {
    const shipped = (name) => facts.upstream.filter((entry) => entry.name === name).some((entry) => entry.shipped === true)
    expect(shipped('@formancy/spec')).toBe(true)
    for (const name of ['@formancy/react', '@formancy/angular', '@formancy/themes', '@formancy/core']) expect(shipped(name), name).toBe(false)
    for (const entry of facts.upstream) expect(typeof entry.shipped, entry.name).toBe('boolean')
  })

  // A lookup that found nothing would render an empty row that equals
  // itself, and the README test above would pass on a table of blanks.
  test('finds a version for every browser, every tool and every package it names', () => {
    const version = /^\d+\.\d+/
    expect(facts.browser.playwright).toMatch(version)
    expect(facts.browser.pins.map((pin) => pin.browser)).toEqual([...BROWSERS])
    for (const pin of facts.browser.pins) expect(pin, pin.browser).toMatchObject({ browserVersion: expect.stringMatching(version), revision: expect.stringMatching(/^\d+$/) })
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
