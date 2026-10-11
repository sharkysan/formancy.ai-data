// A stand-in for the cloudflared binary, for configure.test.mjs and
// setup.test.mjs: a shell script that answers each command exactly as the
// test's plan says, records every command it was asked, and answers a
// command the plan does not hold with exit 2. It models nothing of what
// cloudflared does -- the plan says which rule each URL gets -- so a test
// that uses it holds configure's and setup's own steps, and what cloudflared
// makes of a configuration stays the CI job `cloudflare`'s to show against
// the real binary. A shell script, not Node, because configure asks one
// question per probe, and fifty Node starts are ten seconds.

import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

/** The key of one command line, as the script computes it: its arguments, a newline after each, hashed. */
const keyOf = (args) => createHash('sha256').update(args.map((arg) => `${arg}\n`).join('')).digest('hex')

const SCRIPT = (answers, log) => `#!/bin/sh
for arg in "$@"; do printf '%s\\t' "$arg"; done >> '${log}'
printf '\\n' >> '${log}'
key=$(for arg in "$@"; do printf '%s\\n' "$arg"; done | sha256sum | cut -c1-64)
dir='${answers}'
if [ ! -f "$dir/$key.status" ]; then echo "the stand-in has no answer for: $*" >&2; exit 2; fi
if [ -f "$dir/$key.to" ]; then cp "$dir/$key.content" "$(cat "$dir/$key.to")"; fi
cat "$dir/$key.out"
cat "$dir/$key.err" >&2
exit "$(cat "$dir/$key.status")"
`

/** The stand-in, written into `dir`: its path, `plan(entries)` to say what it answers, and `asked()`, every command since. */
export function standIn(dir) {
  const binary = join(dir, 'cloudflared')
  const answers = join(dir, 'stand-in-answers')
  const log = join(dir, 'stand-in-asked')
  writeFileSync(binary, SCRIPT(answers, log), 'utf8')
  chmodSync(binary, 0o755)
  return {
    binary,
    /** `entries`: `[{ args, status, out, err, writes: { path, content } }]`, each the answer to exactly those arguments. */
    plan(entries) {
      rmSync(answers, { recursive: true, force: true })
      mkdirSync(answers)
      writeFileSync(log, '', 'utf8')
      for (const { args, status = 0, out = '', err = '', writes } of entries) {
        const key = keyOf(args)
        writeFileSync(join(answers, `${key}.status`), String(status))
        writeFileSync(join(answers, `${key}.out`), out)
        writeFileSync(join(answers, `${key}.err`), err)
        if (writes !== undefined) {
          writeFileSync(join(answers, `${key}.to`), writes.path)
          writeFileSync(join(answers, `${key}.content`), writes.content)
        }
      }
    },
    asked: () =>
      readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => line.split('\t').slice(0, -1)),
  }
}
