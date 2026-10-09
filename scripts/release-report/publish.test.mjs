import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { LICENSE_FIELD } from '../verify-licenses.mjs'
import { decide, integrityOf, publishOrder, toPublish } from './publish.mjs'
import { packageTarball } from './test-archive.mjs'
import { pinned } from './verify-publish.mjs'

/**
 * What the publish job decides before it calls npm (0035): the order the
 * tarballs go in, from their own manifests, and what a version already on
 * the registry means. Pure; the call to npm is the publish job's, which has
 * never run, and 0035 says so.
 */
const manifest = (name, dependencies = {}) => ({ name, manifest: { name, version: '0.1.0', dependencies } })
const PACKAGES = [
  manifest('@formancy/data-server', { '@formancy/data-core': '0.1.0', '@formancy/data-postgres': '0.1.0', '@formancy/data-sqlserver': '0.1.0', fastify: '^5.12.5' }),
  manifest('@formancy/data-sqlserver', { '@formancy/data-core': '0.1.0', mssql: '^12.0.0' }),
  manifest('@formancy/data-client', { '@formancy/data-core': '0.1.0' }),
  manifest('@formancy/data-postgres', { '@formancy/data-core': '0.1.0', postgres: '^3.4.9' }),
  manifest('@formancy/data-core', { '@formancy/spec': '0.3.0' }),
]

describe('publishOrder', () => {
  // A package published before what it depends on is, for as long as the
  // gap lasts, a version npm serves that nobody can install.
  test('puts each package after the ones it depends on: data-core first, data-server last', () => {
    const order = publishOrder(PACKAGES)
    expect(order[0]).toBe('@formancy/data-core')
    expect(order.at(-1)).toBe('@formancy/data-server')
    for (const { name, manifest: declared } of PACKAGES) {
      for (const dependency of Object.keys(declared.dependencies).filter((entry) => order.includes(entry))) {
        expect(order.indexOf(dependency), `${dependency} before ${name}`).toBeLessThan(order.indexOf(name))
      }
    }
  })

  // A cycle has no order to publish in.
  test('refuses a cycle', () => {
    expect(() => publishOrder([manifest('a', { b: '1' }), manifest('b', { a: '1' })])).toThrow(/cycle: a, b/)
  })
})

describe('decide', () => {
  const bytes = Buffer.from('a tarball')
  const tarball = { name: '@formancy/data-core', version: '0.1.0', integrity: integrityOf(bytes) }

  // A re-run of the publish job finds what the first run published; the
  // same bytes are skipped, so the run can go on to the GitHub release.
  test('publishes a version npm does not have, and skips one it holds with these bytes', () => {
    expect(decide(tarball, undefined)).toBe('publish')
    expect(decide(tarball, tarball.integrity)).toBe('skip')
  })

  // A version is published once. Skipping on the version alone would call a
  // release done whose npm bytes are not the ones the gates ran.
  test('refuses a version npm holds with other bytes', () => {
    expect(() => decide(tarball, integrityOf(Buffer.from('other bytes')))).toThrow(/@formancy\/data-core@0\.1\.0 is on npm as sha512-.+, not as this tarball's sha512-/)
  })

  // The integrity the registry records is `sha512-` and the base64 digest of
  // the tarball's bytes; a hex digest, or another hash, would never equal
  // npm's, and a re-run would refuse every version the first run published.
  test('computes the integrity in the form npm records', () => {
    expect(integrityOf(Buffer.alloc(0))).toBe('sha512-z4PhNX7vuL3xVChQ1m2AB9Yg5AULVxXcg/SpIdNs6c5H0NE8XYXysP+DGNKHfuwvY7kxvUdBeoGlODJ6+SfaPg==')
  })
})

describe('toPublish', () => {
  const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
  /** Two tarballs, the report of the run that installed them, and what `check` pinned of both. */
  function release() {
    const tarballs = [
      { file: 'formancy-data-server-0.1.0.tgz', bytes: packageTarball({ name: '@formancy/data-server', version: '0.1.0', license: LICENSE_FIELD, dependencies: { '@formancy/data-core': '0.1.0' } }) },
      { file: 'formancy-data-core-0.1.0.tgz', bytes: packageTarball({ name: '@formancy/data-core', version: '0.1.0', license: LICENSE_FIELD }) },
    ]
    const report = {
      problems: [],
      subject: { version: '0.1.0', release: 'v0.1.0', commit: 'c0ffee', run: { id: '42' } },
      results: { install: { tarballs: tarballs.map(({ file, bytes }) => ({ file, sha256: sha256(bytes) })) } },
    }
    const files = [{ path: 'release-report/release-report.json', bytes: Buffer.from(JSON.stringify(report)) }, ...tarballs.map(({ file, bytes }) => ({ path: `release-tarballs/${file}`, bytes }))]
    return { files, report, checked: pinned(files), release: 'v0.1.0', version: '0.1.0', commit: 'c0ffee', runId: '42' }
  }

  // What reaches npm is in dependency order, and is what was checked.
  test('gives the checked tarballs in the order they publish in', () => {
    expect(toPublish(release()).map((entry) => `${entry.name}@${entry.version}`)).toEqual(['@formancy/data-core@0.1.0', '@formancy/data-server@0.1.0'])
  })

  // The npm step reads NPM_TOKEN; it refuses on its own account, before the
  // first `npm publish`, a tarball check did not pin and a report that is not
  // this run's, so a step added before it cannot hand it something else.
  test('refuses a tarball the check job did not check, and a report of another run', () => {
    const swapped = release()
    swapped.files[2] = { ...swapped.files[2], bytes: packageTarball({ name: '@formancy/data-core', version: '0.1.0', license: LICENSE_FIELD, description: 'other' }) }
    expect(() => toPublish(swapped)).toThrow(/release-tarballs\/formancy-data-core-0\.1\.0\.tgz is not the file the check job checked/)
    expect(() => toPublish({ ...release(), commit: 'decaf' })).toThrow(/the report is of commit c0ffee, not decaf/)
    expect(() => toPublish({ ...release(), checked: undefined })).toThrow(/the check job pinned no file/)
  })
})
