import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PUBLISH_PROTOCOL } from './protocol.js'
import { Refusal } from './quiet.js'
import { runMeasurement } from './run.js'
import { validateResults } from './validate.js'

/*
 * `pnpm performance` (after the build): measures with the publish protocol
 * and writes docs/performance/results.json, which `render` turns into the
 * page. Publish mode only: there is no flag that turns a protocol value, the
 * quiet check or a precondition off. It refuses, before starting anything,
 * on a machine running any other container, so it runs alone.
 *
 * Run from `dist/`, three directories below the repository's root. Raw
 * samples, the server's log and its store stay in `runs/<stamp>/`, which git
 * ignores.
 */
if (process.argv[2] !== '--publish') {
  console.error('measure takes --publish: the published figures come from the publish protocol and nothing else')
  process.exit(2)
}

const root = fileURLToPath(new URL('../../../', import.meta.url))
const stamp = new Date().toISOString().replaceAll(':', '-')
const runDir = join(root, 'packages', 'data-performance', 'runs', stamp)

try {
  const results = await runMeasurement(PUBLISH_PROTOCOL, { root, runDir, progress: (line) => console.log(`${new Date().toISOString()} ${line}`) })
  const validation = validateResults(results, { published: true })
  writeFileSync(join(runDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`)
  if (!validation.ok) {
    console.error(`The result does not validate as published; kept in ${runDir}:\n  ${validation.problems.join('\n  ')}`)
    process.exit(1)
  }
  mkdirSync(join(root, 'docs', 'performance'), { recursive: true })
  writeFileSync(join(root, 'docs', 'performance', 'results.json'), `${JSON.stringify(results, null, 2)}\n`)
  console.log(`wrote docs/performance/results.json; raw samples in ${runDir}`)
} catch (error) {
  if (error instanceof Refusal) {
    console.error(error.message)
    process.exit(1)
  }
  throw error
}
