import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { LICENSE_FIELD } from '../verify-licenses.mjs'
import { packageTarball, tgz } from './test-archive.mjs'
import { describeTarball, downloadedProblems, lockedPackages, npmPurl, pinned, publishProblems, sbomInstallProblems } from './verify-publish.mjs'

/**
 * What a release refuses before anything permanent happens (0035): the
 * report, the tarballs, the SBOM and the body, each held to the run that
 * gated them. Over a release made by hand -- two packages, tarballs this
 * file packs itself -- with one defect introduced at a time.
 */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const MANIFESTS = {
  '@formancy/data-core': { name: '@formancy/data-core', version: '0.1.0', license: LICENSE_FIELD },
  '@formancy/data-server': { name: '@formancy/data-server', version: '0.1.0', license: LICENSE_FIELD, dependencies: { '@formancy/data-core': '0.1.0' } },
}
const fileOf = (name) => `${name.slice(1).replace('/', '-')}-0.1.0.tgz`

/** A release in which everything holds: the report, the tarballs as `{ file, bytes }`, the SBOM, the body and the run. */
function green() {
  const tarballs = Object.values(MANIFESTS).map((manifest) => ({ file: fileOf(manifest.name), bytes: packageTarball(manifest) }))
  return {
    report: {
      problems: [],
      subject: { version: '0.1.0', release: 'v0.1.0', commit: 'c0ffee', run: { id: '42' } },
      results: {
        buildIdentity: Object.keys(MANIFESTS).map((name) => ({ package: name })),
        install: { tarballs: tarballs.map(({ file, bytes }, index) => ({ name: Object.keys(MANIFESTS)[index], file, sha256: sha256(bytes) })) },
      },
      testedOn: {
        runtime: [
          { package: '@formancy/data-server', name: 'postgres', loaded: '3.4.9' },
          { package: '@formancy/data-server', name: 'mssql', loaded: '12.7.4' },
          { package: '@formancy/data-server', name: 'tedious', under: 'mssql', loaded: '20.3.3' },
          // A clean install, the install gate's, resolved a newer fastify than the suites ran; the report says so.
          { package: '@formancy/data-server', name: 'fastify', loaded: '5.12.5', fresh: '5.12.7' },
        ],
        upstream: [
          { name: '@formancy/spec', version: '0.3.0', shipped: true },
          { name: '@formancy/react', version: '0.3.0', shipped: false },
        ],
      },
    },
    tarballs,
    // As cdxgen writes an install of the tarballs: each package by its URL, and the graph of who depends on whom.
    sbom: {
      components: [
        'pkg:npm/%40formancy/data-core@0.1.0',
        'pkg:npm/%40formancy/data-server@0.1.0',
        'pkg:npm/postgres@3.4.9',
        'pkg:npm/mssql@12.7.4',
        'pkg:npm/tedious@20.3.3',
        'pkg:npm/fastify@5.12.7',
        'pkg:npm/%40formancy/spec@0.3.0',
      ].map((purl) => ({ purl })),
      dependencies: [
        { ref: 'pkg:npm/%40formancy/data-core@0.1.0', dependsOn: ['pkg:npm/%40formancy/spec@0.3.0'] },
        { ref: 'pkg:npm/%40formancy/data-server@0.1.0', dependsOn: ['pkg:npm/%40formancy/data-core@0.1.0', 'pkg:npm/postgres@3.4.9', 'pkg:npm/mssql@12.7.4', 'pkg:npm/fastify@5.12.7'] },
        { ref: 'pkg:npm/mssql@12.7.4', dependsOn: ['pkg:npm/tedious@20.3.3'] },
      ],
    },
    notes: '## 0.1.0\n\nThe first.\n',
    release: 'v0.1.0',
    version: '0.1.0',
    commit: 'c0ffee',
    runId: '42',
  }
}

/** The problems of `green()` with `change` applied. */
function refusals(change = () => {}) {
  const inputs = green()
  change(inputs)
  return publishProblems({ ...inputs, tarballs: inputs.tarballs.map(({ file, bytes }) => describeTarball(file, bytes)) })
}

/** Replaces a tarball's bytes, and what the install gate recorded with them, so only what the bytes hold differs. */
function repack(inputs, name, bytes) {
  const tarball = inputs.tarballs.find((entry) => entry.file === fileOf(name))
  tarball.bytes = bytes
  inputs.report.results.install.tarballs.find((entry) => entry.name === name).sha256 = sha256(bytes)
}

describe('a release in which everything holds', () => {
  // A refusal on good input is a release nobody can cut.
  test('is refused nothing', () => {
    expect(refusals()).toEqual([])
  })
})

describe('the report', () => {
  // A report of another commit, run, release or version is evidence about
  // something else, however green.
  test('is refused when it is of another commit, run, release or version', () => {
    expect(refusals((inputs) => (inputs.commit = 'decaf'))).toEqual(['the report is of commit c0ffee, not decaf'])
    expect(refusals((inputs) => (inputs.runId = '43'))).toEqual(['the report is of run 42, not this run, 43'])
    expect(refusals((inputs) => (inputs.release = 'dry-run'))).toEqual(['the report is of the release v0.1.0, not dry-run'])
    // ... and every tarball, packed at the report's version, is not this release's either.
    expect(refusals((inputs) => (inputs.version = '0.2.0'))).toEqual([
      'the report is of version 0.1.0, not 0.2.0',
      'formancy-data-core-0.1.0.tgz is @formancy/data-core 0.1.0, where this release is 0.2.0',
      'formancy-data-server-0.1.0.tgz is @formancy/data-server 0.1.0, where this release is 0.2.0',
    ])
  })

  // A report that failed, or one made on a machine with parts allowed
  // missing, did not gate this release.
  test('is refused when it has problems, or is partial or local', () => {
    expect(refusals((inputs) => (inputs.report.problems = ['@formancy/data-core: 1 test(s) failed']))).toEqual(['the report has 1 problem(s), the first: @formancy/data-core: 1 test(s) failed'])
    expect(refusals((inputs) => (inputs.report.partial = ['install']))).toEqual(['the report is partial: install allowed missing'])
    expect(refusals((inputs) => (inputs.report.local = true))).toEqual(['the report is a local one, and a release reads only the report its own gates built'])
  })
})

describe('the tarballs', () => {
  // One byte different is a tarball no gate installed or ran.
  test('are refused when one is not, byte for byte, the install gate’s', () => {
    const tampered = (inputs) => {
      const tarball = inputs.tarballs.find((entry) => entry.file === fileOf('@formancy/data-server'))
      tarball.bytes = tgz([
        ['package/package.json', Buffer.from(JSON.stringify(MANIFESTS['@formancy/data-server']))],
        ['package/LICENSE.md', Buffer.from('# Licence\n')],
        ['package/NOTICE', Buffer.from('Notices.\n')],
        ['package/dist/index.mjs', Buffer.from('export const name = "@formancy/data-servex"\n')],
      ])
    }
    expect(refusals(tampered)).toEqual([expect.stringMatching(/^formancy-data-server-0\.1\.0\.tgz has sha256 [0-9a-f]{64}, not that of the formancy-data-server-0\.1\.0\.tgz the install gate installed and ran, [0-9a-f]{64}$/)])
  })

  // A package without a tarball is a release that leaves it behind; a
  // tarball of something else is one that publishes what no gate meant to.
  test('are refused when one is missing, or one is no published package’s', () => {
    expect(refusals((inputs) => inputs.tarballs.pop())).toEqual(['@formancy/data-server: 0 tarballs, where a release publishes exactly one'])
    expect(refusals((inputs) => inputs.tarballs.push({ file: 'formancy-data-fixtures-0.1.0.tgz', bytes: packageTarball({ name: '@formancy/data-fixtures', version: '0.1.0', license: LICENSE_FIELD }) }))).toEqual([
      'formancy-data-fixtures-0.1.0.tgz is @formancy/data-fixtures, which is no published package',
    ])
  })

  // One number for every package is what bump.mjs makes and what the tag
  // names; a tarball at another would put that version on npm under this
  // release, and a version number is never taken back. The tag job reads
  // data-core's manifest only, so a stray one is found here or nowhere.
  test('are refused when one carries another version than the release’s', () => {
    expect(refusals((inputs) => repack(inputs, '@formancy/data-server', packageTarball({ ...MANIFESTS['@formancy/data-server'], version: '0.2.0' })))).toEqual([
      'formancy-data-server-0.1.0.tgz is @formancy/data-server 0.2.0, where this release is 0.1.0',
    ])
  })

  // 0001: a commercial package under the scope's Apache-2.0 declaration, or
  // without its terms and notices, cannot be unpublished into not having happened.
  test('are refused without NOTICE or with another licence field', () => {
    expect(refusals((inputs) => repack(inputs, '@formancy/data-core', packageTarball(MANIFESTS['@formancy/data-core'], { without: ['NOTICE'] })))).toEqual(['formancy-data-core-0.1.0.tgz carries no package/NOTICE'])
    expect(refusals((inputs) => repack(inputs, '@formancy/data-core', packageTarball({ ...MANIFESTS['@formancy/data-core'], license: 'Apache-2.0' })))).toEqual([
      `formancy-data-core-0.1.0.tgz declares the licence Apache-2.0, not "${LICENSE_FIELD}"`,
    ])
  })
})

describe('the SBOM', () => {
  const at = (name) => (inputs) => inputs.sbom.components.findIndex((component) => component.purl.startsWith(`pkg:npm/${name}@`))
  const replace = (name, purl) => (inputs) => (inputs.sbom.components[at(name)(inputs)].purl = purl)
  const edge = (from, to, purl) => (inputs) => {
    const node = inputs.sbom.dependencies.find((entry) => entry.ref === from)
    node.dependsOn = node.dependsOn.map((each) => (each.startsWith(`pkg:npm/${to}@`) ? purl : each))
  }

  // Both drivers are named, and every package this release publishes, at
  // its version: an SBOM read off the workspace named none of them, where
  // they are links (0092; watched failing on the check by name, which
  // asked neither).
  test('is refused without a driver, or without a package this release publishes at its version', () => {
    expect(refusals((inputs) => inputs.sbom.components.splice(at('postgres')(inputs), 1))).toContain("the SBOM names no postgres, a driver that talks to a customer's database")
    expect(refusals(replace('%40formancy/data-core', 'pkg:npm/%40formancy/data-core@0.0.9'))).toEqual(['the SBOM names no @formancy/data-core 0.1.0, which this release publishes'])
  })

  // An upstream package a published package's install brings is named, at
  // a version the suites loaded; one only an app declares -- the React
  // renderer here -- is not asked for (0092; watched failing on the check by
  // name, which asked neither and never read `shipped`).
  test('is refused without a shipped upstream package, or with another version of one, and not for one nothing installs', () => {
    expect(refusals((inputs) => inputs.sbom.components.splice(at('%40formancy/spec')(inputs), 1))).toEqual(['the SBOM names no @formancy/spec, which a published package depends on'])
    expect(refusals(replace('%40formancy/spec', 'pkg:npm/%40formancy/spec@0.2.0'))).toEqual(['the SBOM names @formancy/spec 0.2.0, where the suites loaded 0.3.0'])
    expect(refusals()).toEqual([])
  })

  // A runtime dependency is held where a published package is given it, in
  // the SBOM's graph, at the version its suites loaded -- a nested one where
  // the dependency that declares it is given it, tedious under mssql. A
  // consumer's tree can hold one name at two versions, the other brought by
  // a dependency of a dependency that no suite's record names: a check by
  // name refused that correct SBOM (0092; watched failing on the check by
  // name, which refused the second tedious and asked nothing of the graph).
  test('holds each runtime dependency where the package that declares it is given it', () => {
    expect(refusals(edge('pkg:npm/%40formancy/data-server@0.1.0', 'fastify', 'pkg:npm/fastify@5.0.0'))).toEqual([
      'the SBOM gives @formancy/data-server fastify 5.0.0, where its suites loaded 5.12.5 and a clean install resolved 5.12.7',
    ])
    expect(refusals(edge('pkg:npm/mssql@12.7.4', 'tedious', 'pkg:npm/tedious@19.0.0'))).toEqual(['the SBOM gives mssql tedious 19.0.0, where its suites loaded 20.3.3'])
    expect(refusals((inputs) => (inputs.sbom.dependencies[1].dependsOn = inputs.sbom.dependencies[1].dependsOn.filter((purl) => !purl.includes('postgres'))))).toEqual([
      'the SBOM records no dependency of @formancy/data-server on postgres',
    ])
    // A second tedious, under something else, is no refusal: mssql is given the one the suites loaded.
    expect(
      refusals((inputs) => {
        inputs.sbom.components.push({ purl: 'pkg:npm/tedious@19.0.0' }, { purl: 'pkg:npm/legacy-tool@1.0.0' })
        inputs.sbom.dependencies.push({ ref: 'pkg:npm/legacy-tool@1.0.0', dependsOn: ['pkg:npm/tedious@19.0.0'] })
      }),
    ).toEqual([])
  })

  // The SBOM is of an install made on the day, as the install gate's clean
  // install is: a version that install resolved and no suite ran is the
  // release body's to say ("which no suite ran"), not a refusal; one
  // neither ran nor resolved is refused (0092; watched failing on the
  // check by name, which refused the fresh fastify).
  test('takes a version the install gate resolved, and no other the suites did not run', () => {
    expect(refusals()).toEqual([])
    expect(refusals((inputs) => (inputs.report.testedOn.runtime[3].fresh = null))).toEqual(['the SBOM gives @formancy/data-server fastify 5.12.7, where its suites loaded 5.12.5'])
  })

  // A nested dependency is held under the version of its parent the
  // published package is actually given -- a clean install's newer mssql
  // here -- not the one the suites loaded (watched failing on the 0.2.0
  // tarballs, installed on 2026-10-21: "records no dependency of mssql on
  // tedious", the SBOM's mssql being 12.7.10).
  test('holds a nested dependency under the parent the published package is given', () => {
    const newer = (inputs) => {
      inputs.report.testedOn.runtime[1].fresh = '12.7.5'
      inputs.sbom.components[inputs.sbom.components.findIndex((component) => component.purl === 'pkg:npm/mssql@12.7.4')].purl = 'pkg:npm/mssql@12.7.5'
      edge('pkg:npm/%40formancy/data-server@0.1.0', 'mssql', 'pkg:npm/mssql@12.7.5')(inputs)
      inputs.sbom.dependencies.find((entry) => entry.ref === 'pkg:npm/mssql@12.7.4').ref = 'pkg:npm/mssql@12.7.5'
    }
    expect(refusals(newer)).toEqual([])
  })

  // A package of types alone carries no code that runs, and cdxgen's
  // --required-only leaves it out of the inventory: the check asks nothing
  // of one, so an SBOM is not refused for what it leaves out by design
  // (watched failing on the 0.2.0 tarballs: "records no dependency of
  // @formancy/data-sqlserver on @types/mssql").
  test('asks nothing of a package of types alone', () => {
    expect(refusals((inputs) => inputs.report.testedOn.runtime.push({ package: '@formancy/data-server', name: '@types/mssql', loaded: '12.3.0' }))).toEqual([])
  })

  // cdxgen that stops writing the graph stops every release, with a
  // sentence, rather than passing: nothing would be held where it is given.
  test('is refused without a dependency graph', () => {
    const refused = refusals((inputs) => delete inputs.sbom.dependencies)
    expect(refused).toContain('the SBOM records no dependency of @formancy/data-server on fastify')
    expect(refused).toContain('the SBOM records no dependency of mssql on tedious')
  })

  test('reads a scoped package URL, encoded or not', () => {
    expect(npmPurl('pkg:npm/%40formancy/spec@0.3.0?type=module')).toEqual({ name: '@formancy/spec', version: '0.3.0' })
    expect(npmPurl('pkg:npm/@formancy/spec@0.3.0')).toEqual({ name: '@formancy/spec', version: '0.3.0' })
    expect(npmPurl('pkg:pypi/x@1')).toBeUndefined()
  })
})

describe('the SBOM against the install it describes', () => {
  /** npm's lockfile of the project the tarballs were installed into, lockfileVersion 3. */
  const lockfile = () => ({
    lockfileVersion: 3,
    packages: {
      '': { name: 'formancy-data', version: '0.1.0', dependencies: { '@formancy/data-server': 'file:x.tgz' } },
      'node_modules/@formancy/data-server': { version: '0.1.0' },
      'node_modules/mssql': { version: '12.7.4' },
      'node_modules/mssql/node_modules/tedious': { version: '20.3.3' },
      'node_modules/linked': { link: true },
      'node_modules/a-dev-tool': { version: '1.0.0', dev: true },
    },
  })
  const sbom = (purls) => ({ components: purls.map((purl) => ({ purl })) })
  const named = ['pkg:npm/%40formancy/data-server@0.1.0', 'pkg:npm/mssql@12.7.4', 'pkg:npm/tedious@20.3.3']

  // What npm installed, nested copies included, and nothing else: the
  // project itself, a link and a dev dependency are not part of what a
  // consumer installs.
  test('reads what npm installed from its lockfile', () => {
    expect(lockedPackages(lockfile())).toEqual([
      { name: '@formancy/data-server', version: '0.1.0' },
      { name: 'mssql', version: '12.7.4' },
      { name: 'tedious', version: '20.3.3' },
    ])
  })

  // The SBOM names exactly what that install holds: a tool cdxgen found
  // somewhere else, or a package the install holds and the SBOM leaves
  // out, is refused -- the 0.2.0 SBOM, read off the workspace, named vitest
  // and Playwright and left out tedious (0092; watched failing: no such
  // check).
  test('names exactly what the install holds', () => {
    expect(sbomInstallProblems(sbom(named), lockfile())).toEqual([])
    expect(sbomInstallProblems(sbom([...named, 'pkg:npm/vitest@5.0.3']), lockfile())).toEqual(['the SBOM names vitest 5.0.3, which the install it describes does not hold'])
    expect(sbomInstallProblems(sbom(named.slice(0, 2)), lockfile())).toEqual(['the SBOM leaves out tedious 20.3.3, which the install it describes holds'])
    expect(sbomInstallProblems({ components: [...sbom(named).components, { name: 'a-binary' }] }, lockfile())).toEqual([
      'the SBOM names a-binary, a component with no npm package URL, in an inventory of an npm install',
    ])
  })

  // A package of types alone is left out on both sides: cdxgen does not
  // list it, and an SBOM is not refused for leaving it out (watched failing
  // on the 0.2.0 tarballs: "leaves out @types/mssql 12.3.0").
  test('leaves out packages of types alone', () => {
    const typed = lockfile()
    typed.packages['node_modules/@types/mssql'] = { version: '12.3.0' }
    expect(lockedPackages(typed).map((entry) => entry.name)).not.toContain('@types/mssql')
    expect(sbomInstallProblems(sbom(named), typed)).toEqual([])
  })

  // An empty or missing lockfile holds nothing, so nothing the SBOM names
  // could be held to it: refused, never passed.
  test('is refused against an install that holds nothing', () => {
    expect(sbomInstallProblems(sbom(named), { packages: {} })).toEqual(['the install the SBOM describes holds no package, so nothing it names can be held to it'])
  })
})

describe('the release body', () => {
  // The GitHub release is the last step, after npm; a body it would refuse
  // must be found before.
  test('is refused when missing or longer than GitHub accepts', () => {
    expect(refusals((inputs) => (inputs.notes = null))).toEqual(['the report job wrote no release body'])
    expect(refusals((inputs) => (inputs.notes = 'x'.repeat(125_001)))).toEqual(['the release body is 125001 characters, over the 125000 GitHub accepts'])
  })
})

describe('what the publish job downloads', () => {
  /** The files `check` read, as the publish job downloads them again: the report's directory and the tarballs. */
  const downloads = (inputs) => [
    { path: 'release-report/release-report.json', bytes: Buffer.from(JSON.stringify(inputs.report)) },
    { path: 'release-report/RELEASE_NOTES.md', bytes: Buffer.from(inputs.notes) },
    ...inputs.tarballs.map(({ file, bytes }) => ({ path: `release-tarballs/${file}`, bytes })),
  ]
  /** The problems of downloading `green()` again after `change`, against what `check` pinned before it. */
  const again = (change = () => {}) => {
    const inputs = green()
    const checked = pinned(downloads(inputs))
    change(inputs)
    const files = inputs.files ?? downloads(inputs)
    return downloadedProblems({ checked: inputs.checked ?? checked, files, report: inputs.report, release: inputs.release, version: inputs.version, commit: inputs.commit, runId: inputs.runId })
  }

  // The artefact store is the run's, and every job of it can write there:
  // `check` itself uploads the SBOM, after running cdxgen, whose dependencies
  // nothing locks. What publish signs and sends to npm is what `check` hashed
  // before any of that ran, or nothing.
  test('are refused unless they are, byte for byte, what the check job checked', () => {
    expect(again()).toEqual([])
    const swapped = again((inputs) => (inputs.tarballs[1].bytes = packageTarball({ ...MANIFESTS['@formancy/data-server'], description: 'not what was checked' })))
    expect(swapped).toEqual([expect.stringMatching(/^release-tarballs\/formancy-data-server-0\.1\.0\.tgz is not the file the check job checked: sha256 [0-9a-f]{64}, checked [0-9a-f]{64}$/)])
    expect(again((inputs) => inputs.tarballs.push({ file: 'formancy-data-extra-0.1.0.tgz', bytes: Buffer.from('x') }))).toEqual(['release-tarballs/formancy-data-extra-0.1.0.tgz was downloaded, and the check job never checked it'])
    expect(again((inputs) => inputs.tarballs.pop())).toEqual(['release-tarballs/formancy-data-server-0.1.0.tgz was checked by the check job, and was not downloaded'])
  })

  // A missing pin is no pin: an output the check job did not write is '',
  // and '' must refuse, not wave everything through.
  test('are refused when the check job pinned nothing', () => {
    expect(again((inputs) => (inputs.checked = ''))).toEqual(['the check job pinned no file, so nothing downloaded here can be shown to be what it checked'])
  })

  // The publish job holds the report itself to this run, whatever check
  // found: a report swapped together with its tarballs would agree with them.
  test('are refused when the report is not this run’s, green and whole', () => {
    expect(again((inputs) => (inputs.runId = '43'))).toEqual(['the report is of run 42, not this run, 43'])
  })
})
