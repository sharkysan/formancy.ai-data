import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as prettier from 'prettier'
import { EXTENSIONS } from './code-style/code-style.mjs'

/**
 * A merge across the format (0114): git's merge, with every TypeScript and
 * JavaScript file both sides changed merged by a driver that formats each
 * of its three versions -- the common ancestor, ours and theirs -- in this
 * repository's style before `git merge-file` merges them. The format
 * rewrote nearly every line of every file, so a branch begun before it
 * conflicts with main wherever it changed a line at all; formatted alike,
 * the versions conflict only where both sides changed what a line says.
 *
 *   node "$MAIN/scripts/prettier-merge.mjs" origin/main       in the branch's worktree: git merge origin/main, through the driver
 *   node scripts/prettier-merge.mjs --driver %O %A %B %P %L   the driver, as git calls it
 *
 * `$MAIN` is a checkout of main at least as new as the `origin/main` it
 * merges, with `pnpm install` run there, as CONTRIBUTING.md says.
 *
 * The first writes nothing to git's configuration: it hands git the driver
 * and an attributes file naming every extension the shared style formats,
 * for that one command, and deletes the file after. Prettier and the style
 * are this script's own checkout's, so a branch that has neither is merged
 * by main's. A file only one side changed is not the driver's -- one only
 * the branch changed comes in as it was written -- so `pnpm format` follows
 * the merge; and the driver merges a file with itself, so code main moved
 * to another file is carried across by hand. `prettier-merge.test.mjs`
 * holds both merges, and the fallback.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** A word the shell reads as itself, as git runs a driver through the shell. */
const quoted = (word) => `'${word.replaceAll("'", "'\\''")}'`

/**
 * At most this many passes, each over the last one's output, twice what
 * was needed: Prettier is not idempotent on a member chain whose last
 * argument is an object literal or a `satisfies`. When this repository was
 * formatted, on 30 October 2026 with Prettier 3.9.10, a second pass
 * changed two files the first had written, and a third changed nothing.
 */
const PASSES = 4

/** `text` as Prettier writes the file at `path` here, run until it stops changing. */
async function format(text, path) {
  const file = join(root, path)
  const options = await prettier.resolveConfig(file, { editorconfig: true })
  let now = text
  for (let pass = 0; pass < PASSES; pass += 1) {
    const next = await prettier.format(now, { ...options, filepath: file })
    if (next === now) break
    now = next
  }
  return now
}

/**
 * Git's merge driver: `base`, `ours` and `theirs` are the three versions'
 * files, `path` the file they are of, `markerSize` the conflict markers'.
 * Each version is formatted, then merged into `ours`, as git expects; a
 * version Prettier cannot parse -- a side left mid-edit -- leaves all three
 * as they were, merged as git would have. Its status is `git merge-file`'s:
 * 0 when clean, the number of conflicts otherwise.
 */
async function drive(base, ours, theirs, path, markerSize) {
  const files = [base, ours, theirs]
  const texts = files.map((file) => readFileSync(file, 'utf8'))
  try {
    const formatted = []
    for (const text of texts) formatted.push(await format(text, path))
    files.forEach((file, index) => writeFileSync(file, formatted[index]))
  } catch (error) {
    console.error(`prettier-merge: ${path} merged unformatted: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
  }
  const merge = spawnSync('git', ['merge-file', `--marker-size=${markerSize}`, '-L', 'ours', '-L', 'base', '-L', 'theirs', ours, base, theirs], {
    stdio: 'inherit',
  })
  return merge.status ?? 2
}

/** Git's merge, with `args` as `git merge` takes them, through the driver for this command alone. */
function merge(args) {
  const scratch = mkdtempSync(join(tmpdir(), 'prettier-merge-'))
  try {
    const attributes = join(scratch, 'attributes')
    writeFileSync(attributes, EXTENSIONS.map((extension) => `*.${extension} merge=prettier\n`).join(''))
    const driver = `${quoted(process.execPath)} ${quoted(fileURLToPath(import.meta.url))} --driver %O %A %B %P %L`
    const run = spawnSync(
      'git',
      [
        '-c',
        `core.attributesFile=${attributes}`,
        '-c',
        'merge.prettier.name=format the three versions, then merge them',
        '-c',
        `merge.prettier.driver=${driver}`,
        'merge',
        ...args,
      ],
      { stdio: 'inherit' },
    )
    return run.status ?? 2
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

const argv = process.argv.slice(2)
if (argv[0] === '--driver') {
  if (argv.length !== 6) throw new Error('prettier-merge: --driver takes %O %A %B %P %L')
  process.exitCode = await drive(argv[1], argv[2], argv[3], argv[4], argv[5])
} else if (argv.length === 0) {
  console.error('usage: node scripts/prettier-merge.mjs <what git merge takes>, e.g. main')
  process.exitCode = 2
} else {
  process.exitCode = merge(argv)
}
