// The gates workflow as the report and the guards read it (0035).
//
// `.github/workflows/gates.yml` is the one list of what a run does: ci.yml
// and release.yml both call it. So the jobs whose results the report expects,
// the jobs its `needs` must name and the packages the `test` job runs are
// read from it, parsed with `yaml`, and never typed a second time anywhere.
//
// A job's results key is derived the way collect.mjs derives it at run time,
// from the job's own collect step: `--job <id>`, and, for a job a matrix runs
// more than once, `--package "$X"`, `--variant "$X"` or both, with X taken
// from `${{ matrix.<name> }}` in the step's env -- both from an include-only
// matrix, read as its pairs, as the `test-images` job's legs are (0067) --
// or `--package` and `--shard`, from a list of packages run whole and an
// `include` entry per shard of a suite run in shards, as the `test` job's
// are (0164). A matrix value added to the workflow is an artefact the report
// then expects, without an edit here.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { keyFor } from './collect.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export const GATES_WORKFLOW = '.github/workflows/gates.yml'

/** A workflow under .github/workflows, parsed. */
export function readWorkflow(root = repo, file = GATES_WORKFLOW) {
  return YAML.parse(readFileSync(join(root, file), 'utf8'))
}

/** The jobs of the gates workflow that leave results: every job but the report that reads them. */
export function gateJobs(workflow) {
  return Object.keys(workflow?.jobs ?? {}).filter((id) => id !== 'report')
}

/**
 * The `test` job's legs, `{ package, shard }` each, by npm name: each package
 * its matrix lists, whole (`shard` null), then each `include` entry, a shard
 * of a suite the job runs in shards, `<index>/<count>` (0164).
 */
export function testMatrix(workflow) {
  const matrix = workflow?.jobs?.test?.strategy?.matrix
  if (!Array.isArray(matrix?.package)) throw new Error(`${GATES_WORKFLOW} has no test job whose matrix lists packages`)
  return [
    ...matrix.package.map((name) => ({ package: String(name), shard: null })),
    ...(matrix.include ?? []).map((entry) => ({ package: String(entry?.package), shard: entry?.shard === undefined ? null : String(entry.shard) })),
  ]
}

/**
 * The `test-images` job's legs, `{ package, image }` each, as its
 * include-only matrix lists them: data-fixtures and an adapter suite on an
 * image of the matrix other than the default (0067).
 */
export function imageMatrix(workflow) {
  const include = workflow?.jobs?.['test-images']?.strategy?.matrix?.include
  if (!Array.isArray(include)) throw new Error(`${GATES_WORKFLOW} has no test-images job whose matrix includes its legs`)
  return include.map((entry) => ({ package: String(entry?.package), image: String(entry?.image) }))
}

/** A job's step with `id: collect`, which writes what the job found for the report. */
export function collectStep(job) {
  return (job?.steps ?? []).find((step) => step?.id === 'collect')
}

/** `--flag "$NAME"` in a step's run, and the expression the step's env gives NAME. */
function argument(step, flag) {
  const name = new RegExp(`${flag}\\s+"\\$([A-Z_][A-Z0-9_]*)"`).exec(String(step.run ?? ''))?.[1]
  return name === undefined ? undefined : { name, expression: step.env?.[name] }
}

/** The matrix field `${{ matrix.<name> }}` names, from the expression the step's env gives an argument. */
function matrixField({ name, expression }, where) {
  const field = /^\$\{\{\s*matrix\.([\w-]+)\s*\}\}$/.exec(String(expression ?? '').trim())?.[1]
  if (field === undefined) throw new Error(`${where}: ${name} is not \${{ matrix.<name> }} in the step's env`)
  return field
}

/** Every value `${{ matrix.<name> }}` takes in `job`: its list, then each `include` entry's. */
function matrixValues(job, argument, where) {
  const field = matrixField(argument, where)
  const matrix = job.strategy?.matrix ?? {}
  const listed = Array.isArray(matrix[field]) ? matrix[field] : []
  const included = (matrix.include ?? []).map((entry) => entry?.[field]).filter((value) => value !== undefined)
  const values = [...listed, ...included].map(String)
  if (values.length === 0) throw new Error(`${where}: the job's matrix gives ${field} no value`)
  return values
}

/**
 * The pairs two arguments take in `job`, one per `include` entry: a job keyed
 * by two values runs exactly the pairs it lists, and a list beside them would
 * cross every value with every pair, which no key here can say.
 */
function matrixPairs(job, first, second, where) {
  const [a, b] = [matrixField(first, where), matrixField(second, where)]
  const matrix = job.strategy?.matrix ?? {}
  const crossed = Object.keys(matrix).filter((key) => key !== 'include')
  if (crossed.length > 0)
    throw new Error(
      `${where} collects with --package and --variant, and its matrix lists ${crossed.join(', ')} beside include, whose pairs alone a key can name`,
    )
  const pairs = (matrix.include ?? []).map((entry) => [entry?.[a], entry?.[b]])
  if (pairs.length === 0) throw new Error(`${where}: the job's matrix includes no ${a} and ${b}`)
  const partial = pairs.findIndex((pair) => pair.includes(undefined))
  if (partial !== -1) throw new Error(`${where}: the job's include entry ${String(partial + 1)} gives no ${pairs[partial][0] === undefined ? a : b}`)
  return pairs.map(([one, other]) => [String(one), String(other)])
}

/**
 * The legs of a job that collects with `--package` and `--shard`, as
 * `[package, shard]`: each package its list gives, whole (shard undefined),
 * then each `include` entry's package and shard (0164). An entry for a
 * listed package is refused: GitHub adds an entry to the listed leg it
 * matches rather than making one of its own, and a second entry's shard
 * replaces the first's there, so one shard alone would run. A key beside
 * the list would cross every package with its values, which no key names.
 */
function shardLegs(job, first, second, where) {
  const [a, b] = [matrixField(first, where), matrixField(second, where)]
  const matrix = job.strategy?.matrix ?? {}
  const crossed = Object.keys(matrix).filter((key) => key !== 'include' && key !== a)
  if (crossed.length > 0)
    throw new Error(`${where} collects with --package and --shard, and its matrix lists ${crossed.join(', ')} beside ${a}, which no key can name`)
  const listed = (Array.isArray(matrix[a]) ? matrix[a] : []).map(String)
  const included = (matrix.include ?? []).map((entry, at) => {
    const which = `${where}: the job's include entry ${String(at + 1)}`
    if (entry?.[a] === undefined || entry?.[b] === undefined) throw new Error(`${which} gives no ${entry?.[a] === undefined ? a : b}`)
    if (listed.includes(String(entry[a])))
      throw new Error(
        `${which} gives ${String(entry[a])} a ${b}, and its ${a} list names it too: GitHub adds the entry to that leg, where the next entry's ${b} replaces it`,
      )
    return [String(entry[a]), String(entry[b])]
  })
  return [...listed.map((name) => [name, undefined]), ...included]
}

/**
 * Every results key a run of `workflow` leaves, each with the job that
 * leaves it: `[{ key, job }]`. `named` is collect.mjs's namedPackages().
 * Throws, naming the job, when a job has no collect step or collects under
 * another job's name: a job the report cannot expect is a job it cannot
 * miss.
 */
export function expectedKeys(workflow, named) {
  const keys = []
  for (const id of gateJobs(workflow)) {
    const job = workflow.jobs[id]
    const step = collectStep(job)
    const where = `${GATES_WORKFLOW}: the ${id} job`
    if (step === undefined) throw new Error(`${where} has no step with id collect, so it leaves nothing for the report`)
    const collects = /--job\s+([\w-]+)/.exec(String(step.run ?? ''))?.[1]
    if (collects !== id) throw new Error(`${where} collects as --job ${String(collects)}, not as itself`)
    const pkg = argument(step, '--package')
    const variant = argument(step, '--variant')
    const shard = argument(step, '--shard')
    if (shard !== undefined) {
      if (pkg === undefined || variant !== undefined)
        throw new Error(`${where} collects with --shard, which divides one package's suite: it needs --package and no --variant`)
      for (const [one, other] of shardLegs(job, pkg, shard, where)) keys.push({ key: keyFor({ job: id, pkg: one, shard: other }, named), job: id })
      continue
    }
    if (pkg === undefined && variant === undefined) {
      keys.push({ key: keyFor({ job: id }, named), job: id })
      continue
    }
    if (pkg !== undefined && variant !== undefined) {
      for (const [one, other] of matrixPairs(job, pkg, variant, where)) keys.push({ key: keyFor({ job: id, pkg: one, variant: other }, named), job: id })
      continue
    }
    for (const value of matrixValues(job, pkg ?? variant, where)) {
      keys.push({ key: keyFor(pkg === undefined ? { job: id, variant: value } : { job: id, pkg: value }, named), job: id })
    }
  }
  return keys
}
