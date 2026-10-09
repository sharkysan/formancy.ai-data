import type { DatabaseKind } from '@formancy/data-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * What a database server said about itself when a suite or a gate started
 * it, and who started it: the release report's "tested on" is these records,
 * read from every job of a run (0035). Under 0003 an image a test starts is
 * part of what is tested, for that test, so the record names the test.
 */
export interface ServerAnswer {
  /** The server's own version string: `server_version`, or `ProductVersion` ("16.0.4295.3"). */
  version: string
  /** SQL Server's `ProductUpdateLevel` ("CU20"); null for PostgreSQL, which has none. */
  updateLevel: string | null
  /** SQL Server's `Edition`; null for PostgreSQL, which has none. */
  edition: string | null
  /** `version()` or `@@version`: the server's whole sentence about itself, for a reader. */
  description: string | null
}

export interface ServerRecord extends ServerAnswer {
  engine: DatabaseKind
  /** The image the container was started from, as the starter named it. */
  image: string
  /** The absolute path of the file that asked for the server, or null when no frame named one. */
  caller: string | null
  /** The package script that was running (`test-coverage`, `test-browser`), or `direct`. */
  script: string
  /** When the server answered, as an ISO instant. */
  at: string
}

/**
 * The running package script, safe in a file name: `npm_lifecycle_event`
 * with every character but a letter or a digit made `-`, because a Windows
 * checkout cannot hold the `:` of `test:coverage` in a file name. `direct`
 * when nothing set it -- a script run with `node` -- which collect's time
 * window still tells apart from a run.
 */
export function scriptName(event: string | undefined = process.env['npm_lifecycle_event']): string {
  return event === undefined || event === '' ? 'direct' : event.replaceAll(/[^A-Za-z0-9]/g, '-')
}

/** This package's own directory: the parent of `src/` under test and of `dist/` once built. */
const PACKAGE = fileURLToPath(new URL('..', import.meta.url))

/** A test file, which is a caller even inside this package: its own suite starts containers too. */
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/

/** The file a stack frame names, or undefined for a frame without one (`<anonymous>`, `native`). */
function frameFile(line: string): string | undefined {
  // `at fn (location)` or `at location`, where location ends `:line:column`.
  const location = /\((.*):\d+:\d+\)\s*$/.exec(line)?.[1] ?? /^\s*at (?:async )?(.*):\d+:\d+\s*$/.exec(line)?.[1]
  if (location === undefined) return undefined
  if (location.startsWith('file://')) return fileURLToPath(location)
  return location
}

/**
 * The first file on `stack` that is neither this package's own code nor
 * Node's nor an installed module: the test or the gate that asked for a
 * server. Null when there is none.
 *
 * It reads the stack as it is NOW, so a starter calls it before its first
 * `await`. After one, V8's async stack traces still name a caller that
 * awaited the starter -- measured: the fixture-load test passes with the
 * capture moved after the container's start -- but not one that did not
 * await it, nor anything across a timer or an event, where the test fails.
 */
export function callerOf(stack: string | undefined, own: string = PACKAGE): string | null {
  for (const line of (stack ?? '').split('\n').slice(1)) {
    const file = frameFile(line)
    if (file === undefined || file.startsWith('node:') || file.includes(`${sep}node_modules${sep}`) || file.includes('/node_modules/')) continue
    if (file.startsWith(own) && !TEST_FILE.test(file)) continue
    return file
  }
  return null
}

/** Who is calling the function that calls this, read from the stack now (see `callerOf`). */
export function captureCaller(): string | null {
  const limit = Error.stackTraceLimit
  // A test's frames sit under a few of vitest's and this package's own; ten,
  // Node's default, can run out before the test is reached.
  Error.stackTraceLimit = 50
  try {
    return callerOf(new Error('caller').stack)
  } finally {
    Error.stackTraceLimit = limit
  }
}

/** Numbers this process's records, so two servers of one engine started by one process get two files. */
let written = 0

/**
 * Writes `record` to `<dir>/test-results/servers/<script>-<engine>-<pid>-<n>.json`
 * and returns it whole, with the script and the moment filled in.
 *
 * The file is created exclusively and `n` moves on past one that exists:
 * vitest can run two test files in one process, each with this module fresh,
 * and a record overwritten would be a server the report never hears of.
 */
export function recordServer(record: Omit<ServerRecord, 'script' | 'at'>, dir: string = process.cwd()): ServerRecord {
  const whole: ServerRecord = { ...record, script: scriptName(), at: new Date().toISOString() }
  const folder = join(dir, 'test-results', 'servers')
  mkdirSync(folder, { recursive: true })
  for (;;) {
    written += 1
    const file = join(folder, `${whole.script}-${whole.engine}-${String(process.pid)}-${String(written)}.json`)
    try {
      writeFileSync(file, `${JSON.stringify(whole, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
      return whole
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'EEXIST') throw error
    }
  }
}
