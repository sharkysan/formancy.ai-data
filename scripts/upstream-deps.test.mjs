import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { lockedPackages, releaseAgeExemptionProblems, releaseAgeExemptions, upstreamDependencyProblems, workspaceManifests } from './upstream-deps.mjs'

describe('upstreamDependencyProblems', () => {
  const core = { name: '@formancy/data-core', dependencies: { '@formancy/spec': '0.3.0' } }

  // The case 0002 exists for: a range lets upstream move under this repository
  // without a commit saying so, and a protocol resolves it from a checkout.
  test('refuses a range, a workspace link and a path to an upstream package', () => {
    const problems = upstreamDependencyProblems([
      { name: '@formancy/data-postgres', dependencies: { '@formancy/core': '^0.3.0' } },
      { name: '@formancy/data-sqlserver', devDependencies: { '@formancy/spec': 'workspace:*' } },
      { name: '@formancy/data-server', peerDependencies: { '@formancy/server-core': 'link:../../../formancy.ai/packages/server-core' } },
    ])
    expect(problems).toHaveLength(3)
    expect(problems[0]).toMatch(/@formancy\/core@\^0\.3\.0/)
    expect(problems[1]).toMatch(/workspace:\*/)
    expect(problems[2]).toMatch(/link:/)
  })

  // A sibling in this workspace is not upstream; `workspace:*` is right for it.
  test('accepts an exact upstream version and a workspace sibling', () => {
    expect(
      upstreamDependencyProblems([core, { name: '@formancy/data-postgres', dependencies: { '@formancy/data-core': 'workspace:*', postgres: '^3.4.9' } }]),
    ).toEqual([])
  })

  // A pre-release is still a release somebody chose.
  test('accepts an exact pre-release', () => {
    expect(upstreamDependencyProblems([{ name: 'x', dependencies: { '@formancy/core': '0.4.0-rc.1' } }])).toEqual([])
  })
})

describe('workspaceManifests', () => {
  /** A repository of `package.json` files alone: the root's, and one package's. */
  function repository(root) {
    const dir = mkdtempSync(join(tmpdir(), 'upstream-deps-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify(root))
    mkdirSync(join(dir, 'packages', 'one'), { recursive: true })
    writeFileSync(join(dir, 'packages', 'one', 'package.json'), JSON.stringify({ name: '@formancy/data-one' }))
    return dir
  }

  // The lint and format rules are @formancy/code-style, a root devDependency
  // (0116). Read only from packages/* and apps/*, the root's `^0.12.0` would
  // let the rules move under this repository without a commit saying so, which
  // is the range 0002 refuses everywhere else.
  test('reads the root manifest, so a range or a link there is refused too', () => {
    const dir = repository({ name: 'formancy-data', devDependencies: { '@formancy/code-style': '^0.12.0' } })
    try {
      const problems = upstreamDependencyProblems(workspaceManifests(dir))
      expect(problems).toHaveLength(1)
      expect(problems[0]).toMatch(/formancy-data: devDependencies @formancy\/code-style@\^0\.12\.0/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('releaseAgeExemptionProblems', () => {
  const siblings = new Set(['@formancy/data-core'])
  const locked = new Set(['@formancy/core@0.5.0', '@formancy/expressions@0.5.0', 'ajv@8.20.0'])

  // What pnpm writes when a release younger than its minimum age is pinned,
  // and the only thing the exemption is for: upstream, by exact version,
  // installed now -- the transitive `@formancy/expressions` included.
  test('accepts an upstream package at a version the lockfile installs', () => {
    expect(releaseAgeExemptionProblems(['@formancy/core@0.5.0', '@formancy/expressions@0.5.0'], locked, siblings)).toEqual([])
  })

  // The policy exists for packages nobody here reviews: a third-party package
  // admitted on its first day would be the compromise it guards against.
  test('refuses a package outside the upstream scope, and a sibling', () => {
    const problems = releaseAgeExemptionProblems(['ajv@8.20.0', '@formancy/data-core@0.1.0'], locked, siblings)
    expect(problems).toHaveLength(2)
    expect(problems[0]).toMatch(/ajv@8\.20\.0/)
    expect(problems[1]).toMatch(/@formancy\/data-core@0\.1\.0/)
  })

  // A name alone, or a pattern, admits every later release on its first day,
  // which is a range by another route (0002).
  test('refuses a name without a version, a pattern and a range', () => {
    const problems = releaseAgeExemptionProblems(['@formancy/core', '@formancy/*', '@formancy/core@^0.5.0'], locked, siblings)
    expect(problems).toHaveLength(3)
  })

  // An exemption for a version nothing installs any more admits nothing, and
  // left behind it reads as if that version were still in use.
  test('refuses an upstream version the lockfile no longer installs', () => {
    const problems = releaseAgeExemptionProblems(['@formancy/core@0.4.0'], locked, siblings)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/@formancy\/core@0\.4\.0/)
  })
})

describe('this workspace', () => {
  // The real tree, so the guard is a gate and not an example.
  test('depends on upstream only at exact released versions', () => {
    const manifests = workspaceManifests()
    expect(manifests.length).toBeGreaterThanOrEqual(3)
    expect(upstreamDependencyProblems(manifests)).toEqual([])
  })

  // The real pnpm-workspace.yaml against the real lockfile.
  test('exempts from the minimum release age only upstream versions it installs', () => {
    const siblings = new Set(workspaceManifests().map((manifest) => manifest.name))
    expect(releaseAgeExemptionProblems(releaseAgeExemptions(), lockedPackages(), siblings)).toEqual([])
  })
})
