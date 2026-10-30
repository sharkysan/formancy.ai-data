import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as prettier from 'prettier'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { prettierConfig } from './code-style/code-style.mjs'

/**
 * The merge a branch begun before the format takes main through
 * (`scripts/prettier-merge.mjs`, 0113), run as CONTRIBUTING.md runs it, in a
 * repository of its own written under the system's temporary directory:
 * `base` in the style before the format, `main` the format of it with what
 * main changed, and `feature` the branch's change in the style it was
 * written in. Git reads neither the machine's configuration nor the
 * person's -- a signing key or a hook there would change what a commit does
 * -- and the script is handed the three versions as git hands them.
 *
 * What it cannot see: whether Prettier itself formats a file well, which is
 * the format check's to hold, or the time a large merge takes.
 */
const script = join(dirname(fileURLToPath(import.meta.url)), 'prettier-merge.mjs')
const FILE = 'order.ts'

/** The file as it stood before the format: double quotes and semicolons. */
const BASE = ['export const status = "placed";', 'export function total(lines: number[]) { return lines.reduce((sum, line) => sum + line, 0); }', ''].join('\n')

/** What Prettier writes of `text`, in this repository's style. */
const formatted = (text) => prettier.format(text, { ...prettierConfig, filepath: FILE })

let scratch
let dir
let env

/** Runs git in the repository, and says how it ended. */
const git = (...args) => spawnSync('git', args, { cwd: dir, env, encoding: 'utf8' })

/** Commits `text` as the file on `branch`, made from `from`. */
function commit(branch, from, text) {
  expect(git('checkout', '-q', '-B', branch, from).status).toBe(0)
  writeFileSync(join(dir, FILE), text)
  expect(git('commit', '-q', '-am', branch).status).toBe(0)
}

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'prettier-merge-')))
  dir = join(scratch, 'repository')
  mkdirSync(dir)
  const config = join(scratch, 'gitconfig')
  writeFileSync(config, '')
  env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: config,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Merge Test',
    GIT_AUTHOR_EMAIL: 'merge-test@example.invalid',
    GIT_COMMITTER_NAME: 'Merge Test',
    GIT_COMMITTER_EMAIL: 'merge-test@example.invalid',
  }
  expect(git('init', '-q', '-b', 'base').status).toBe(0)
  writeFileSync(join(dir, FILE), BASE)
  expect(git('add', FILE).status).toBe(0)
  expect(git('commit', '-q', '-m', 'base').status).toBe(0)
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

/** Merges main into the feature branch through the script, without committing, and returns how it ended and the file. */
function mergeThroughScript() {
  const run = spawnSync(process.execPath, [script, '--no-commit', 'main'], { cwd: dir, env, encoding: 'utf8' })
  return { status: run.status, output: run.stdout + run.stderr, text: readFileSync(join(dir, FILE), 'utf8') }
}

describe('a merge of main into a branch begun before the format', () => {
  // The format rewrote every line of every file, so git's own merge
  // conflicts wherever the branch changed a line at all, though main
  // changed nothing it says: every branch open under the format would be
  // resolved by hand, line by line. Through the script, the branch's change
  // comes in formatted, and only the format is taken from main.
  test('takes a change on one side, against main’s format of the same lines, without a conflict', async () => {
    const change = BASE.replace('"placed"', '"received"')
    commit('main', 'base', await formatted(BASE))
    commit('feature', 'base', change)

    const plain = git('merge', '--no-commit', 'main')
    expect(plain.status, 'git’s own merge of the same three versions').toBe(1)
    expect(readFileSync(join(dir, FILE), 'utf8')).toContain('<<<<<<<')
    expect(git('merge', '--abort').status).toBe(0)

    const merged = mergeThroughScript()
    expect(merged.status, merged.output).toBe(0)
    expect(merged.text).toBe(await formatted(change))
    expect(git('diff', '--name-only', '--diff-filter=U').stdout).toBe('')
  })

  // A driver that resolved a conflict by taking one side, or by keeping
  // both, would lose a change silently, which a conflict never does.
  test('still conflicts where both sides changed what a line says', async () => {
    commit('main', 'base', await formatted(BASE.replace('"placed"', '"shipped"')))
    commit('feature', 'base', BASE.replace('"placed"', '"received"'))

    const merged = mergeThroughScript()
    expect(merged.status, merged.output).toBe(1)
    expect(merged.text).toContain('<<<<<<<')
    expect(merged.text).toContain("export const status = 'received'")
    expect(merged.text).toContain("export const status = 'shipped'")
    expect(git('diff', '--name-only', '--diff-filter=U').stdout).toBe(`${FILE}\n`)
  })
})
