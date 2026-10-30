import { runDriftCheck } from './drift-check.js'

// `node dist/drift-check-cli.mjs [--fail-on blocking|review] <server URL> <form id>...`:
// the drift check a deploy pipeline runs (0111), an entry beside main.mjs. What
// it does is runDriftCheck's, which its tests drive; this only hands it the process.
process.exitCode = await runDriftCheck(process.argv.slice(2), process.env, {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  fetch: globalThis.fetch,
})
