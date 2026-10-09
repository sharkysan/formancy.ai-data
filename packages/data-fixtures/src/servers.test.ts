import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import { callerOf, captureCaller, recordServer, scriptName } from './servers.js'

/**
 * The record every container start leaves for the release report (0035):
 * where it is written, what it is called, and who it says asked. Pure file
 * work in a temporary directory; the records of real servers are written by
 * the suites that start them, and the fixture-load test holds one to what
 * its server answers.
 */
const HERE = fileURLToPath(import.meta.url)
const ANSWER = { version: '17.11', updateLevel: null, edition: null, description: 'PostgreSQL 17.11 on x86_64' }

let dirs: string[] = []
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'formancy-data-servers-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

/** As a starter calls it: from a function of the file that wants a server. */
function startedHere(): string | null {
  return captureCaller()
}

describe('recordServer', () => {
  // `test:coverage` is the script every suite runs under, and a `:` in a
  // file name is a checkout Windows refuses: git cannot create the file, and
  // the developer's clone fails on a directory nobody meant to commit.
  test('writes a parseable record named by the script, with nothing a Windows file name cannot hold', () => {
    const dir = scratch()
    const before = process.env['npm_lifecycle_event']
    process.env['npm_lifecycle_event'] = 'test:coverage'
    try {
      const record = recordServer({ engine: 'postgres', image: 'postgres:17-alpine', caller: HERE, ...ANSWER }, dir)
      const [name, ...others] = readdirSync(join(dir, 'test-results', 'servers'))
      expect(others).toEqual([])
      expect(name).toMatch(new RegExp(`^test-coverage-postgres-${String(process.pid)}-\\d+\\.json$`))
      expect(name).not.toMatch(/[:<>"|?*]/)
      expect(JSON.parse(readFileSync(join(dir, 'test-results', 'servers', name ?? ''), 'utf8'))).toEqual(record)
      expect(record).toMatchObject({ script: 'test-coverage', engine: 'postgres', version: '17.11', caller: HERE })
      expect(Date.parse(record.at)).not.toBeNaN()
    } finally {
      if (before === undefined) delete process.env['npm_lifecycle_event']
      else process.env['npm_lifecycle_event'] = before
    }
  })

  // Two servers of one engine from one process -- the host's suite starts
  // one of each, a file can start two -- are two records. One overwriting the
  // other is a server the report never hears of.
  test('writes two records for two servers, never one over the other', () => {
    const dir = scratch()
    recordServer({ engine: 'sqlserver', image: 'mcr.microsoft.com/mssql/server:2022-latest', caller: HERE, ...ANSWER }, dir)
    recordServer({ engine: 'sqlserver', image: 'mcr.microsoft.com/mssql/server:2022-latest', caller: HERE, ...ANSWER }, dir)
    expect(readdirSync(join(dir, 'test-results', 'servers'))).toHaveLength(2)
  })

  // A gate run with `node` has no package script; its records still need a
  // name, and collect's time window tells them apart.
  test('names a record of no package script direct', () => {
    const before = process.env['npm_lifecycle_event']
    delete process.env['npm_lifecycle_event']
    try {
      expect(scriptName()).toBe('direct')
    } finally {
      if (before !== undefined) process.env['npm_lifecycle_event'] = before
    }
    expect(scriptName('')).toBe('direct')
    expect(scriptName('test:browser')).toBe('test-browser')
  })
})

describe('the caller a record names', () => {
  // A record whose starter is unknown cannot say which tests ran on an image
  // that is not the default, and that sentence is the report's (0035). The
  // capture must look past this package's own frames, or every record names
  // servers.ts.
  test('is the file that asked, read past this package’s own frames', () => {
    expect(startedHere()).toBe(HERE)
  })

  // The stack as vitest and Node print it: a file URL for an ES module, a
  // path otherwise, frames of installed modules and of Node in between. The
  // first file that is none of those is the caller.
  test('skips Node, installed modules and this package, and reads a file URL as a path', () => {
    const own = join(tmpdir(), 'data-fixtures') + '/'
    const test = join(tmpdir(), 'data-postgres', 'src', 'adapter.integration.test.ts')
    const stack = [
      'Error: caller',
      `    at captureCaller (${own}src/servers.ts:70:12)`,
      `    at startPostgresContainer (${pathToFileURL(`${own}dist/index.mjs`).href}:10:3)`,
      '    at async Promise.all (index 0)',
      `    at ${pathToFileURL(join(tmpdir(), 'node_modules', '.pnpm', 'vitest', 'dist', 'run.js')).href}:1:1`,
      '    at node:internal/process/task_queues:105:5',
      `    at ${pathToFileURL(test).href}:20:5`,
    ].join('\n')
    expect(callerOf(stack, own)).toBe(test)
    // A test file inside this package is a caller: its own suite starts containers.
    const ownTest = `${own}src/fixtures.integration.test.ts`
    expect(callerOf(`Error\n    at x (${own}src/servers.ts:1:1)\n    at ${ownTest}:5:5`, own)).toBe(ownTest)
    expect(callerOf('Error\n    at node:internal/x:1:1', own)).toBeNull()
  })
})
