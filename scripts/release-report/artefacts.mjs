// A gates run's artefacts as the report job downloads them (0035).
//
// Every job but the report uploads `release-results-<key>`, holding the one
// `<key>.json` its collect step wrote; collect also gave the key to the
// upload as the artefact's name, so the two have one source. The report job
// downloads them with `actions/download-artifact` and no `merge-multiple`,
// which puts each in a directory of its own name: two jobs that wrote the
// same key cannot overwrite one another there, and the report sees both.
//
// What is wrong with them is a problem of the run: an expected key with no
// artefact, an artefact no job of gates.yml leaves, a directory that does
// not hold exactly its own key's results, a key twice, and results from
// another commit or another run.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const ARTEFACT_PREFIX = 'release-results-'

/** Every artefact directory under `dir`, with each JSON file in it, parsed: `[{ name, files: [{ file, result } | { file, error }] }]`. */
export function readArtefacts(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({
      name,
      files: readdirSync(join(dir, name))
        .filter((file) => file.endsWith('.json'))
        .sort()
        .map((file) => {
          try {
            return { file, result: JSON.parse(readFileSync(join(dir, name, file), 'utf8')) }
          } catch (error) {
            return { file, error: error.message }
          }
        }),
    }))
}

/** The results files the artefacts hold: every parsed file of the results schema. */
export function resultsOf(artefacts) {
  return artefacts.flatMap((artefact) => artefact.files.map((entry) => entry.result).filter((result) => result?.schema === 1 && typeof result.key === 'string'))
}

/**
 * What is wrong with this run's artefacts, as sentences. Pure: `expected` is
 * workflows.mjs's expectedKeys() for gates.yml, `commit` and `runId` this
 * run's.
 */
export function artefactProblems(artefacts, { expected, commit, runId }) {
  const problems = []
  const wanted = new Map(expected.map((entry) => [entry.key, entry.job]))
  const names = artefacts.map((artefact) => artefact.name)
  for (const { key } of expected) {
    const name = `${ARTEFACT_PREFIX}${key}`
    const count = names.filter((candidate) => candidate === name).length
    if (count === 0) problems.push(`${key}: its job left no artefact ${name}`)
    if (count > 1) problems.push(`${name} appears ${String(count)} times, where one job leaves it once`)
  }
  const keys = new Map()
  for (const artefact of artefacts) {
    const key = artefact.name.startsWith(ARTEFACT_PREFIX) ? artefact.name.slice(ARTEFACT_PREFIX.length) : null
    if (key === null || !wanted.has(key)) {
      problems.push(`${artefact.name} is no artefact a job of .github/workflows/gates.yml leaves`)
      continue
    }
    if (artefact.files.length !== 1) {
      problems.push(`${artefact.name} holds ${String(artefact.files.length)} results files, where it holds exactly ${key}.json`)
      continue
    }
    const [{ file, result, error }] = artefact.files
    if (error !== undefined) {
      problems.push(`${artefact.name}/${file} is not JSON: ${error}`)
      continue
    }
    if (file !== `${key}.json` || result?.key !== key || result?.job !== wanted.get(key)) {
      problems.push(`${artefact.name} holds ${file}, the results of key ${String(result?.key)} from job ${String(result?.job)}, where it holds ${key}.json from job ${wanted.get(key)}`)
    }
    keys.set(result?.key, (keys.get(result?.key) ?? 0) + 1)
    if (result?.commit !== commit) problems.push(`${artefact.name} is from commit ${String(result?.commit)}, not this run's ${commit}`)
    if (String(result?.run?.id) !== String(runId)) problems.push(`${artefact.name} is from run ${String(result?.run?.id)}, not this run's ${String(runId)}`)
  }
  for (const [key, count] of keys) if (count > 1 && names.filter((name) => name === `${ARTEFACT_PREFIX}${key}`).length < 2) problems.push(`the results of ${String(key)} appear in ${String(count)} artefacts`)
  return problems
}
