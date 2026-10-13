import { readFile } from 'node:fs/promises'
import { runKeysTool } from './identity-keys-tool.js'

// `node dist/identity-keys-cli.mjs check <file> <algorithm> | convert <kid>`:
// the image's key set file tool (0059), an entry beside main.mjs. What it
// does is runKeysTool's, which its tests drive; this only hands it the process.
process.exitCode = await runKeysTool(process.argv.slice(2), process.env, {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readFile: (path) => readFile(path, 'utf8'),
})
