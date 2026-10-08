import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/**
 * The image has to contain every workspace package the server imports.
 *
 * The Dockerfile copies an explicit list, because copying the whole repository
 * would invalidate the dependency layer on every source change. The cost is
 * that **adding a workspace dependency silently breaks the container**: the
 * image builds, every test passes, and it exits on startup with
 * ERR_MODULE_NOT_FOUND. formancy.ai shipped exactly that once, and this is its
 * guard, adopted before the server has a workspace dependency to forget.
 */
const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..', '..')

interface Manifest {
  name: string
  dependencies?: Record<string, string>
}

/** The package directory for a workspace package name, read from the manifests rather than assumed. */
function directoryOf(name: string): string {
  for (const directory of ['data-core', 'data-postgres', 'data-sqlserver', 'data-server', 'data-fixtures']) {
    try {
      if (read(directory).name === name) return directory
    } catch {
      // Not a package directory in this checkout.
    }
  }
  throw new Error(`no workspace package is called ${name}`)
}

function read(directory: string): Manifest {
  return JSON.parse(readFileSync(join(repo, 'packages', directory, 'package.json'), 'utf8')) as Manifest
}

/** Every workspace package directory the server needs at runtime, itself included, transitively. */
function workspaceClosure(from: string): Set<string> {
  const found = new Set<string>()
  const pending = [from]
  while (pending.length > 0) {
    const directory = pending.pop()
    if (directory === undefined || found.has(directory)) continue
    found.add(directory)
    for (const [name, range] of Object.entries(read(directory).dependencies ?? {})) {
      // `workspace:` is what makes it ours; a published dependency needs no COPY.
      if (range.startsWith('workspace:')) pending.push(directoryOf(name))
    }
  }
  return found
}

describe('the container build', () => {
  const dockerfile = readFileSync(join(repo, 'packages', 'data-server', 'Dockerfile'), 'utf8')

  // The failure this prevents is not a build error. The image builds, the suite
  // is green, and the container exits on startup with a module it cannot find.
  test('copies every workspace package the server depends on, manifest early and source late', () => {
    const needed = [...workspaceClosure('data-server')].sort()
    expect(needed.filter((directory) => !dockerfile.includes(`COPY packages/${directory}/ `))).toEqual([])
    expect(needed.filter((directory) => !dockerfile.includes(`COPY packages/${directory}/package.json`))).toEqual([])
  })

  // A guard on the guard: a closure that silently came back empty would make
  // the test above pass forever.
  test('the closure is computed from the manifests', () => {
    expect(workspaceClosure('data-server').has('data-server')).toBe(true)
    expect(workspaceClosure('data-postgres')).toEqual(new Set(['data-postgres', 'data-core']))
  })

  // The licence travels with the image too: the runtime tree comes from
  // `pnpm deploy`, which packs what the manifest's `files` lists.
  test('the image is built with the licence in place', () => {
    expect(dockerfile).toContain('COPY LICENSE.md NOTICE')
    expect(dockerfile).toContain('node scripts/sync-licenses.mjs')
  })
})
