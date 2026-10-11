import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderPerformance, replaceGenerated } from './render.js'
import type { Results } from './results.js'
import { validateResults } from './validate.js'

/*
 * `pnpm --filter @formancy/data-performance render`: rewrites
 * docs/performance.md's generated region from docs/performance/results.json.
 * `--check` changes nothing and exits 1 when the page is not what the
 * results render, which is what scripts/performance-doc.test.mjs asserts in
 * `pnpm test:repo`. Only a result that validates as published is rendered.
 *
 * Run from `dist/`, three directories below the repository's root.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url))
const resultsFile = `${root}docs/performance/results.json`
const pageFile = `${root}docs/performance.md`

const mode = process.argv[2]
if (mode !== '--write' && mode !== '--check') {
  console.error('render-cli takes --write or --check')
  process.exit(2)
}

const results = JSON.parse(readFileSync(resultsFile, 'utf8')) as unknown
const validation = validateResults(results, { published: true })
if (!validation.ok) {
  console.error(`${resultsFile} does not validate as published:\n  ${validation.problems.join('\n  ')}`)
  process.exit(1)
}
const page = readFileSync(pageFile, 'utf8')
const rendered = replaceGenerated(page, renderPerformance(results as Results))
if (mode === '--check') {
  if (rendered !== page) {
    console.error(`${pageFile} is not what ${resultsFile} renders: run "pnpm --filter @formancy/data-performance render"`)
    process.exit(1)
  }
} else if (rendered !== page) {
  writeFileSync(pageFile, rendered)
  console.log(`wrote ${pageFile}`)
}
