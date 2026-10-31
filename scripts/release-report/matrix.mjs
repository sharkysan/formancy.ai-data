// The report's two matrices (0035).
//
// Shared cases on every image of every engine's matrix (0067): one row per id
// `sharedCases()` gives, one cell per image of MATRIX_IMAGES -- the default
// first, per engine of DATABASE_KINDS -- `passed`, `failed` or `missing`,
// from the tests that declared the case with `covers()` on that engine. A
// test's image is never its leg's name: it is each image the servers of its
// own leg (results file) answered on whose record names the test's file, so
// a file that started two images counts for both, and a leg that ran the
// default under another image's name counts for the default. A case that
// passes through one adapter only, or on one image only, is `missing` on the
// others, which fails the run: release gate 1, "both adapters pass the same
// mandatory behaviour suite", as a check on every pull request, on every
// version the release names. What it cannot show is that a test which
// declares a case asserts it; review holds that.
//
// The browser matrix as it is: each environment a suite or gate ran in --
// jsdom, and each browser a gate launched -- per app, with the renderers the
// app draws and the engines its run started. Nothing in it is typed: a
// browser added to a gate later shows up here without a change to this file.

const distinct = (values) => [...new Set(values)]

/** Whether a record is the getting-started journey's composed database, which no test file started. */
const composed = (server) => server.script === 'getting-started'

/**
 * Every test of the run that declares shared cases: its file, name, status,
 * engine and cases, its leg's key, and the images its leg's servers answered
 * on for its file and engine.
 */
export function declarations(results) {
  return results.flatMap((result) =>
    (result.suites ?? []).flatMap((suite) =>
      suite.files.flatMap((file) =>
        file.tests
          .filter((test) => Array.isArray(test.meta?.covers) && test.meta.covers.length > 0)
          .map((test) => {
            const engine = test.meta.engine ?? null
            const images = distinct(
              (result.servers ?? [])
                .filter((server) => !composed(server) && server.engine === engine && server.caller === file.file)
                .map((server) => server.image),
            )
            return { file: file.file, name: test.name, status: test.status, engine, covers: test.meta.covers, leg: result.key, images }
          }),
      ),
    ),
  )
}

/** The columns of the shared-case matrix: each image of each engine's matrix, its default first. */
export function caseColumns(engines, matrix) {
  return engines.flatMap((engine) => (matrix[engine] ?? []).map((image, at) => ({ engine, image, default: at === 0 })))
}

/**
 * The cells of `row` a run is held to, as `[image, cell]`: all of them, or,
 * for a local run that allowed the image legs missing, all but a missing one
 * off the default.
 */
export function heldCells(row, columns, allowMissing = []) {
  const defaults = columns.filter((column) => column.default).map((column) => column.image)
  const lenient = allowMissing.includes('test-images')
  return Object.entries(row.cells).filter(([image, cell]) => !lenient || defaults.includes(image) || cell.state !== 'missing')
}

/**
 * The matrix -- `columns`, and `rows` whose cells are keyed by image -- and
 * the declarations that name no shared case, no engine, or a file no server
 * of its leg names.
 */
export function sharedCaseMatrix({ results, cases, engines, matrix }) {
  const declared = declarations(results)
  const known = new Set(cases)
  const columns = caseColumns(engines, matrix)
  return {
    columns,
    rows: cases.map((id) => ({
      id,
      cells: Object.fromEntries(
        columns.map(({ engine, image }) => {
          const tests = declared.filter((test) => test.engine === engine && test.images.includes(image) && test.covers.includes(id))
          return [image, { state: tests.length === 0 ? 'missing' : tests.every((test) => test.status === 'passed') ? 'passed' : 'failed', tests: tests.length }]
        }),
      ),
    })),
    unknown: declared.flatMap((test) => test.covers.filter((id) => !known.has(id)).map((id) => ({ file: test.file, name: test.name, id }))),
    withoutEngine: declared.filter((test) => !engines.includes(test.engine)).map(({ file, name, engine }) => ({ file, name, engine })),
    withoutImage: declared
      .filter((test) => engines.includes(test.engine) && test.images.length === 0)
      .map(({ file, name, engine, leg }) => ({ file, name, engine, leg })),
  }
}

/**
 * Environment x app x renderers x engines. `apps` is each workspace app with
 * the renderers it draws (`[{ name: 'React', version }]`) and the jsdom its
 * suite loads; the engines are the ones its suite's or its gate's servers
 * ran, so an app that renders from a captured snapshot shows none.
 */
export function browserMatrix({ results, apps }) {
  const servers = results.flatMap((result) => result.servers ?? [])
  const engines = (owner) => distinct(servers.filter((server) => server.package === owner).map((server) => server.engine)).sort()
  const suites = new Set(results.flatMap((result) => (result.suites ?? []).map((suite) => suite.package)))
  const rows = []
  for (const app of apps) {
    if (suites.has(app.name))
      rows.push({ environment: `jsdom ${app.jsdom ?? '?'}`, app: app.path, renderers: app.renderers, engines: engines(app.name), source: 'suite' })
  }
  for (const result of results) {
    for (const gate of result.browserGates ?? []) {
      const app = apps.find((candidate) => candidate.path === gate.gate)
      const browser = gate.browser === null || gate.browser === undefined ? 'no browser launched' : `${gate.browser.name} ${gate.browser.version}`
      rows.push({ environment: browser, app: gate.gate, renderers: app?.renderers ?? [], engines: engines(gate.gate), source: 'gate' })
    }
  }
  return rows
}
