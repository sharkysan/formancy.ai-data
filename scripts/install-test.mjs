#!/usr/bin/env node
/**
 * Install the packed packages into a project that knows nothing about this
 * repository, and run it.
 *
 * **Why no other gate can see this.** `pnpm build`, `typecheck`, `test:coverage`
 * and `check:pkg` all run inside the workspace, against the tree they were
 * built from. A workspace sibling resolves a package through a symlink to its
 * source directory, so an `exports` map that is wrong for a real consumer can
 * be right for every test in the repository. formancy.ai shipped a package with
 * no `exports` at all for four releases that way, while ninety-five tests and
 * `publint` said nothing.
 *
 * **What this proves, and only this.** The tarballs `pnpm pack` produces install
 * into a plain npm project; every entry point resolves; the types resolve with
 * `skipLibCheck` off, so a declaration file that imports a type its consumer
 * does not have is found here rather than by a customer; and the code runs
 * under Node.
 *
 * It does **not** talk to npm, so it says nothing about the registry copy, and
 * it does not connect to a database, which is the integration suites' job.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')

/** Every publishable package, as a name and the directory to pack from. */
function publishable() {
  const root = join(repo, 'packages')
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const file = join(root, entry.name, 'package.json')
      let manifest
      try {
        manifest = JSON.parse(readFileSync(file, 'utf8'))
      } catch {
        return []
      }
      if (manifest.private === true || manifest.name === undefined) return []
      return [{ name: manifest.name, dir: join(root, entry.name) }]
    })
}

/**
 * Run a Node tool, on either platform.
 *
 * `pnpm`, `npm` and `npx` are `.cmd` shims on Windows, so the bare name is
 * `spawnSync ENOENT` there -- and Node 20 and later refuse to spawn a `.cmd` at
 * all without a shell, which is `EINVAL`. So Windows gets a shell with every
 * argument quoted, and everywhere else gets the executable directly, which is
 * the safer of the two and is what CI runs.
 */
const WINDOWS = process.platform === 'win32'

const run = (command, args, cwd) => {
  const options = { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  if (!WINDOWS) return execFileSync(command, args, options)
  const quoted = args.map((arg) => (/[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg))
  return execFileSync(`${command}.cmd`, quoted, { ...options, shell: true })
}

const work = mkdtempSync(join(tmpdir(), 'formancy-data-install-'))
let failed = false

try {
  const packages = publishable()
  // Three today. A walk that finds fewer has gone wrong, and a test over zero
  // packages passes by having nothing to check.
  if (packages.length < 3) {
    throw new Error(`only found ${String(packages.length)} publishable packages; the walk is wrong`)
  }

  const tarballs = new Map()
  for (const { name, dir } of packages) {
    const out = run('pnpm', ['pack', '--pack-destination', work], dir)
    const file = out.trim().split('\n').at(-1)
    if (file === undefined || !file.endsWith('.tgz')) {
      throw new Error(`pnpm pack said something unexpected for ${name}: ${out}`)
    }
    tarballs.set(name, file.startsWith(work) ? file : join(work, file))
  }
  console.log(`packed ${String(tarballs.size)} packages`)

  // The fixture is copied rather than generated: TypeScript inside a template
  // literal inside a script is the shape that cost upstream two broken attempts.
  const project = join(work, 'consumer')
  mkdirSync(project, { recursive: true })
  cpSync(join(here, 'install-fixture'), project, { recursive: true })

  writeFileSync(
    join(project, 'package.json'),
    `${JSON.stringify(
      {
        name: 'formancy-data-install-test',
        private: true,
        type: 'module',
        dependencies: Object.fromEntries(packages.map(({ name }) => [name, `file:${tarballs.get(name)}`])),
        devDependencies: {
          // What a Node consumer has. The drivers' declaration files reference
          // Node's types, and with skipLibCheck off that reference is checked.
          '@types/node': '^22.10.0',
          // The TypeScript the workspace pins; a consumer on another major is
          // its own question.
          typescript: '~6.0.3',
          tsx: '^4.20.3',
        },
      },
      null,
      2,
    )}\n`,
  )

  writeFileSync(
    join(project, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: 'ES2023',
          module: 'NodeNext',
          moduleResolution: 'nodenext',
          lib: ['ES2023'],
          types: ['node'],
          noEmit: true,
          // OFF, deliberately. Skipping library checks is what lets a broken
          // declaration file reach a consumer unnoticed, and the published
          // `.d.mts` files are precisely what is on trial here.
          skipLibCheck: false,
        },
        include: ['consume.ts'],
      },
      null,
      2,
    )}\n`,
  )

  console.log('installing the tarballs into a plain npm project…')
  // npm rather than pnpm, deliberately: pnpm in a directory under a workspace
  // can still find the workspace, and resolving through it is the thing this
  // test exists to avoid.
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel', 'error'], project)

  console.log('type-checking the consumer against the installed types…')
  run('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'], project)

  console.log('running it under Node…')
  const output = run('npx', ['tsx', 'consume.ts'], project)
  process.stdout.write(output)

  console.log('\ninstall test passed: the packed tarballs work in a project that is not this one')
} catch (error) {
  failed = true
  console.error('\ninstall test FAILED')
  console.error(error.message)
  const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`
  if (detail.trim() !== '') console.error(detail.slice(0, 6000))
} finally {
  rmSync(work, { recursive: true, force: true })
}

process.exit(failed ? 1 : 0)
