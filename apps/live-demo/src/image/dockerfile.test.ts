import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { POSTGRES_IMAGE } from '@formancy/data-fixtures'
import { describe, expect, test } from 'vitest'
import { AUDIENCE, ISSUER, TENANT_CLAIM } from '../token.js'
import { IDENTITY_SECRET_VARIABLE, SERVER_PORT } from './contract.js'
import { CONNECTION } from './forms.js'

/**
 * deploy/demo/Dockerfile, read as instructions, held to what the code that
 * meets the image says: the PostgreSQL the suites run on, the Node the
 * other images run, the issuer, audience and tenant claim token.ts signs,
 * the port and key variable the Durable Object uses, and every file the
 * image's scripts name. An image that disagreed would build and start, and
 * refuse every visitor's token, or listen where nobody asks -- found on the
 * first deploy, not here. Whether the image builds and starts is the image
 * gate's (pnpm test:live-demo).
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const read = (...path: string[]): string => readFileSync(join(repo, ...path), 'utf8')

interface Instruction {
  keyword: string
  args: string
}

interface Stage {
  from: string
  name: string | undefined
  instructions: Instruction[]
}

/** A Dockerfile's instructions by stage: comments dropped, continuation lines joined. */
function stagesOf(text: string): Stage[] {
  const logical = text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')
    .replace(/\\\n/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  const stages: Stage[] = []
  for (const line of logical) {
    const [keyword = '', ...rest] = line.split(/\s+/)
    const args = rest.join(' ')
    if (keyword.toUpperCase() === 'FROM') {
      const [from = '', as, name] = args.split(' ')
      stages.push({ from, name: as?.toUpperCase() === 'AS' ? name : undefined, instructions: [] })
    } else stages.at(-1)?.instructions.push({ keyword: keyword.toUpperCase(), args })
  }
  return stages
}

/** `ENV a=b c=d` as pairs; the image's values are plain words, never quoted. */
function environment(stage: Stage, until?: (instruction: Instruction) => boolean): Map<string, string> {
  const values = new Map<string, string>()
  for (const instruction of stage.instructions) {
    if (until?.(instruction) === true) break
    if (instruction.keyword !== 'ENV') continue
    for (const pair of instruction.args.split(/\s+/)) {
      const [name = '', ...value] = pair.split('=')
      values.set(name, value.join('='))
    }
  }
  return values
}

const stages = stagesOf(read('deploy', 'demo', 'Dockerfile'))
const runtime = stages.at(-1) as Stage
const runsBuild = (instruction: Instruction) => instruction.keyword === 'RUN' && instruction.args === 'sh /demo/build.sh'
const env = environment(runtime)

/** Each file a COPY puts under /demo/, by its name there, with the path it came from. */
function copiedToDemo(): Map<string, string> {
  const copied = new Map<string, string>()
  for (const instruction of runtime.instructions.filter((each) => each.keyword === 'COPY')) {
    const words = instruction.args.split(' ').filter((word) => !word.startsWith('--'))
    const target = words.at(-1)
    if (target !== '/demo/') continue
    for (const source of words.slice(0, -1)) copied.set(source.split('/').at(-1) as string, source)
  }
  return copied
}

describe('the demo image', () => {
  // The suites prove the adapter on this PostgreSQL (0003), and the demo's
  // data and forms are tested on it (load and publish integration tests);
  // a demo on another would be one nothing here ran.
  test("runs data-fixtures' PostgreSQL image", () => {
    expect(runtime.from).toBe(POSTGRES_IMAGE)
  })

  // Node is copied from the build stage into PostgreSQL's image: the one
  // the server's own image runs, so the demo's server is that server.
  test("builds with, and copies, the Node the server's own image runs", () => {
    const server = stagesOf(read('packages', 'data-server', 'Dockerfile')).at(-1) as Stage
    for (const stage of stages.slice(0, -1)) expect(stage.from).toBe(server.from)
    expect(runtime.instructions).toContainEqual({ keyword: 'COPY', args: `--from=${String(stages.at(-2)?.name)} /usr/local/bin/node /usr/local/bin/node` })
  })

  // Settings that disagreed with token.ts would make a server that refuses
  // every token the Worker signs.
  test('verifies the tokens token.ts signs, with the key the starter sets', () => {
    expect(env.get('FORMANCY_DATA_ISSUER')).toBe(ISSUER)
    expect(env.get('FORMANCY_DATA_AUDIENCE')).toBe(AUDIENCE)
    expect(env.get('FORMANCY_DATA_ATTRIBUTES')).toBe(`tenant=${TENANT_CLAIM}`)
    expect(env.get('FORMANCY_DATA_IDENTITY_SECRET')).toBe(`env:${IDENTITY_SECRET_VARIABLE}`)
    // After the build: its server verifies with the build's own key, and
    // nothing a visitor's key could sign reaches the administrator's plane.
    expect(environment(runtime, runsBuild).has('FORMANCY_DATA_IDENTITY_SECRET')).toBe(false)
    expect(env.has('FORMANCY_DATA_ADMIN_ROLES')).toBe(false)
  })

  test('listens where the Durable Object asks', () => {
    expect(env.get('PORT')).toBe(String(SERVER_PORT))
    expect(runtime.instructions.filter((instruction) => instruction.keyword === 'EXPOSE').map((instruction) => instruction.args)).toEqual([String(SERVER_PORT)])
  })

  // The base image says SIGINT; Cloudflare stops a container with SIGTERM,
  // and a local run should be stopped the same way, which the server
  // closes its pools on.
  test('is stopped with SIGTERM', () => {
    expect(runtime.instructions.filter((instruction) => instruction.keyword === 'STOPSIGNAL').map((instruction) => instruction.args)).toEqual(['SIGTERM'])
  })

  // A file a script names and no COPY puts there fails the image's build,
  // or worse its start, on Cloudflare.
  test('holds every file its scripts name, the fixture byte for byte as the suites load it', () => {
    const copied = copiedToDemo()
    const named = new Set(
      [read('deploy', 'demo', 'build.sh'), read('deploy', 'demo', 'start.sh'), runtime.instructions.map((instruction) => instruction.args).join('\n')].flatMap(
        (text) => [...text.matchAll(/\/demo\/([a-z][a-z0-9.-]*)/g)].map((match) => match[1] as string),
      ),
    )
    expect([...named].filter((name) => !copied.has(name))).toEqual([])
    expect(copied.get('postgres.sql')).toBe('packages/data-fixtures/fixtures/postgres.sql')
    expect(env.get('FORMANCY_DATA_CONNECTIONS')).toBe('/demo/connections.json')
    expect(copied.get('connections.json')).toBe('deploy/demo/connections.json')
  })

  // The forms are generated on CONNECTION; an allowlist that named another
  // would refuse every proposal at build.
  test('lets the server reach the connection the forms are published on, and no other', () => {
    const connections = JSON.parse(read('deploy', 'demo', 'connections.json')) as Array<{ id: string; host: string }>
    expect(connections.map((connection) => connection.id)).toEqual([CONNECTION])
    expect(connections.map((connection) => connection.host)).toEqual(['127.0.0.1'])
  })
})
