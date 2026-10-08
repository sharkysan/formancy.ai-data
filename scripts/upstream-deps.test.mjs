import { describe, expect, test } from 'vitest'
import { upstreamDependencyProblems, workspaceManifests } from './upstream-deps.mjs'

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
      upstreamDependencyProblems([
        core,
        { name: '@formancy/data-postgres', dependencies: { '@formancy/data-core': 'workspace:*', postgres: '^3.4.9' } },
      ]),
    ).toEqual([])
  })

  // A pre-release is still a release somebody chose.
  test('accepts an exact pre-release', () => {
    expect(upstreamDependencyProblems([{ name: 'x', dependencies: { '@formancy/core': '0.4.0-rc.1' } }])).toEqual([])
  })
})

describe('this workspace', () => {
  // The real tree, so the guard is a gate and not an example.
  test('depends on upstream only at exact released versions', () => {
    const manifests = workspaceManifests()
    expect(manifests.length).toBeGreaterThanOrEqual(3)
    expect(upstreamDependencyProblems(manifests)).toEqual([])
  })
})
