import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { LICENSE_FIELD } from '../verify-licenses.mjs'
import { packageTarball, tgz } from './test-archive.mjs'
import { describeTarball, downloadedProblems, npmPurl, pinned, publishProblems } from './verify-publish.mjs'

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
          { name: 'postgres', loaded: '3.4.9' },
          { name: 'mssql', loaded: '12.7.4' },
          { name: 'tedious', under: 'mssql', loaded: '20.3.3' },
          { name: 'fastify', loaded: '5.12.5' },
        ],
        upstream: [{ name: '@formancy/spec', version: '0.3.0' }],
      },
    },
    tarballs,
    sbom: { components: ['pkg:npm/postgres@3.4.9', 'pkg:npm/mssql@12.7.4', 'pkg:npm/tedious@20.3.3', 'pkg:npm/%40formancy/spec@0.3.0', 'pkg:npm/%40formancy/data-core@0.1.0', 'pkg:npm/fastify@5.12.5'].map((purl) => ({ purl })) },
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
  // An inventory that names another driver than the suites ran describes a
  // release nobody tested; one without a driver omits what talks to the
  // customer's database.
  test('is refused with another mssql than the suites loaded, or without postgres', () => {
    expect(refusals((inputs) => (inputs.sbom.components[1].purl = 'pkg:npm/mssql@12.0.0'))).toEqual(['the SBOM names mssql 12.0.0, where the suites loaded 12.7.4'])
    expect(refusals((inputs) => inputs.sbom.components.shift())).toEqual(["the SBOM names no postgres, a driver that talks to a customer's database"])
    expect(refusals((inputs) => (inputs.sbom.components[3].purl = 'pkg:npm/%40formancy/spec@0.2.0'))).toEqual(['the SBOM names @formancy/spec 0.2.0, where the suites loaded 0.3.0'])
  })

  // Every runtime dependency the report names is held to the SBOM, the one
  // under a facade included: tedious is what speaks TDS to the server, and a
  // server's fastify is what answers every request. A typed list of drivers
  // would let either differ from what the suites loaded, unnoticed.
  test('is refused with another version of any runtime dependency the suites loaded, nested ones included', () => {
    const at = (name) => (inputs) => inputs.sbom.components.findIndex((component) => component.purl.startsWith(`pkg:npm/${name}@`))
    const replace = (name, purl) => (inputs) => (inputs.sbom.components[at(name)(inputs)].purl = purl)
    expect(refusals(replace('tedious', 'pkg:npm/tedious@19.0.0'))).toEqual(['the SBOM names tedious 19.0.0, where the suites loaded 20.3.3'])
    expect(refusals(replace('fastify', 'pkg:npm/fastify@5.0.0'))).toEqual(['the SBOM names fastify 5.0.0, where the suites loaded 5.12.5'])
  })

  // Both spellings a package URL gives a scoped name.
  test('reads a scoped package URL, encoded or not', () => {
    expect(npmPurl('pkg:npm/%40formancy/spec@0.3.0?type=module')).toEqual({ name: '@formancy/spec', version: '0.3.0' })
    expect(npmPurl('pkg:npm/@formancy/spec@0.3.0')).toEqual({ name: '@formancy/spec', version: '0.3.0' })
    expect(npmPurl('pkg:pypi/x@1')).toBeUndefined()
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
