import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { DEFAULT_LOOKUP_DEADLINE_MS } from '../../packages/data-core/dist/index.mjs'
import { INSTANCE_TYPES, leaks, lookupDeadlineFor, memoryUsed, publishedPort, quotaOf, runArguments } from './docker.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const config = JSON.parse(readFileSync(join(repo, 'apps', 'live-demo', 'wrangler.json'), 'utf8'))

describe('the quota a visitor’s container runs under', () => {
  // The gate measures start, journey and memory at the share of a machine
  // the deploy asks Cloudflare for: read from wrangler.json, so a config
  // moved to another instance type is measured at that type's share, never
  // at a number this file typed.
  test("is wrangler.json's instance type's share, with no swap, as Cloudflare gives none", () => {
    const [container] = config.containers
    const type = INSTANCE_TYPES[container.instance_type]
    expect(type, container.instance_type).toBeDefined()
    expect(quotaOf(container.instance_type)).toEqual({ cpus: String(type.vcpu), memory: `${String(type.memoryMiB)}m`, swap: `${String(type.memoryMiB)}m` })
    // basic, as 0070 decides it, is a quarter of a CPU and a GiB.
    expect(quotaOf('basic')).toEqual({ cpus: '0.25', memory: '1024m', swap: '1024m' })
  })

  // A type the table does not know would run unbounded, and the gate would
  // report a cold start no instance has.
  test('is refused for an instance type the table does not know', () => {
    expect(() => quotaOf('standard-9')).toThrow(/standard-9 is no instance type .* lite, basic/)
  })
})

describe("the image's lookup deadline", () => {
  // The server's default deadline is the slowest lookup measured on a whole
  // machine (0061). At basic's quarter of a CPU the same lookups take up to
  // four times as long: on 2026-10-17 three cold visitors at once, beside a
  // type-check, had the new order's customer, created-by and approved-by
  // lookups answer 503 lookup-timeout after the default's 892 ms. So the
  // image's deadline is the default over the instance type's CPU share,
  // derived from both, never typed.
  test("is the measured default over wrangler.json's instance type's CPU share, as the Dockerfile sets it", () => {
    const [container] = config.containers
    const expected = lookupDeadlineFor(container.instance_type, DEFAULT_LOOKUP_DEADLINE_MS)
    expect(expected).toBe(Math.ceil(DEFAULT_LOOKUP_DEADLINE_MS / INSTANCE_TYPES[container.instance_type].vcpu))
    const dockerfile = readFileSync(join(repo, 'deploy', 'demo', 'Dockerfile'), 'utf8')
    const set = [...dockerfile.matchAll(/\bFORMANCY_DATA_LOOKUP_DEADLINE_MS=(\S+)/g)].map((match) => match[1])
    expect(set).toEqual([String(expected)])
  })

  // A whole CPU or more needs no more than what was measured on one.
  test('is never below the measured default', () => {
    expect(lookupDeadlineFor('standard-4', 892)).toBe(892)
    expect(lookupDeadlineFor('lite', 892)).toBe(892 * 16)
  })
})

describe('the docker run of a visitor’s container', () => {
  const arguments_ = runArguments({ image: 'formancy/data-demo:gate', name: 'formancy-data-demo-gate-1', port: 4390, quota: quotaOf('basic'), variables: ['FORMANCY_DATA_DEMO_IDENTITY_SECRET'] })

  // The key is the instance's whole credential: on a command line it is in
  // every process listing and in `docker inspect`'s Args. Named alone, the
  // CLI copies it from its own environment, where the stand-in put it.
  test('names the key’s variable and never holds a value for it', () => {
    const at = arguments_.indexOf('--env')
    expect(arguments_[at + 1]).toBe('FORMANCY_DATA_DEMO_IDENTITY_SECRET')
    expect(arguments_.filter((argument) => argument.includes('='))).toEqual([])
    expect(() => runArguments({ image: 'i', name: 'n', port: 1, quota: quotaOf('basic'), variables: ['FORMANCY_DATA_DEMO_IDENTITY_SECRET=k'] })).toThrow(/a variable's name, never its value/)
  })

  // Cloudflare's VM starts the container with an empty /run, where
  // Docker keeps the image's: PostgreSQL's socket directory, made by the
  // image's build under /run, was gone on Cloudflare, and every start
  // exited 1 within a quarter of a second (0088). Run so here, the gate
  // meets what Cloudflare does.
  test('runs with an empty /run, as Cloudflare starts it', () => {
    expect(arguments_[arguments_.indexOf('--tmpfs') + 1]).toBe('/run')
  })

  // Cloudflare runs linux/amd64 images only; a port published beyond
  // loopback would put a visitor's server on this machine's network.
  test('runs linux/amd64 under the quota, its port on loopback only, the image last', () => {
    expect(arguments_.slice(0, 3)).toEqual(['run', '--name', 'formancy-data-demo-gate-1'])
    for (const [flag, value] of [['--platform', 'linux/amd64'], ['--cpus', '0.25'], ['--memory', '1024m'], ['--memory-swap', '1024m'], ['--publish', '127.0.0.1::4390']]) {
      expect(arguments_[arguments_.indexOf(flag) + 1], flag).toBe(value)
    }
    expect(arguments_.at(-1)).toBe('formancy/data-demo:gate')
  })
})

describe('what docker says', () => {
  // `docker port` lists IPv4 and, on some engines, IPv6 bindings; the
  // loopback one is the one runArguments asked for.
  test("reads the published port from docker port's answer", () => {
    expect(publishedPort('127.0.0.1:49153\n')).toBe(49153)
    expect(publishedPort('[::1]:49160\n127.0.0.1:49161\n')).toBe(49161)
    expect(publishedPort('')).toBeUndefined()
  })

  // cgroup v2 says memory.peak, cgroup v1 memory.max_usage_in_bytes (this
  // workstation's Docker Desktop, 2026-10-16): the peak whichever it is,
  // and a refusal when neither answered, rather than a peak of zero.
  test('reads the peak memory from either cgroup version', () => {
    expect(memoryUsed({ v2: '110710784\n', v1: undefined })).toEqual({ bytes: 110710784, from: 'memory.peak' })
    expect(memoryUsed({ v2: undefined, v1: '108863488\n' })).toEqual({ bytes: 108863488, from: 'memory.max_usage_in_bytes' })
    expect(() => memoryUsed({ v2: undefined, v1: undefined })).toThrow(/neither memory.peak nor memory.max_usage_in_bytes/)
  })
})

describe('the leak check', () => {
  // A log line holding the key or the database password is a credential
  // in Cloudflare's logs if observability is ever turned on; the check
  // names which secret, never its value.
  test('names each secret a text holds, and says nothing of one it does not', () => {
    const key = 'k'.repeat(43)
    const password = 'p'.repeat(43)
    expect(leaks([{ where: 'the container’s log', text: `listening; key ${key}` }], { 'the identity key': key, 'the database password': password })).toEqual(['the identity key is in the container’s log'])
    expect(leaks([{ where: 'the container’s log', text: 'listening' }], { 'the identity key': key })).toEqual([])
  })

  // A secret of a few characters is found in any text, and an empty one in
  // every text: either would make the check say nothing true.
  test('refuses a secret too short to be looked for', () => {
    expect(() => leaks([], { 'the identity key': 'short' })).toThrow(/the identity key is 5 characters/)
    expect(() => leaks([], { 'the database password': undefined })).toThrow(/the database password is not known/)
  })
})
