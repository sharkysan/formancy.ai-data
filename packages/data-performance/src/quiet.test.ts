import { describe, expect, test } from 'vitest'
import { PUBLISH_PROTOCOL } from './protocol.js'
import { calibrationVerdict, containerSetChange, judged, measuredPaths, preconditions, quietVerdict, Refusal } from './quiet.js'
import type { PreconditionInputs } from './quiet.js'
import type { BlockResult } from './sampler.js'

const CLEAR: PreconditionInputs = {
  platform: 'linux',
  containers: [],
  dirtyFiles: [],
  env: {},
  missingImages: [],
  tolerance: 1.1,
}

describe('the preconditions of a publish run', () => {
  // The baseline every refusal below is a single change of.
  test('pass when all is clear', () => {
    expect(preconditions(CLEAR)).toEqual([])
  })

  // The run reads /proc for busy time, steal and the server's CPU.
  test('refuse a platform that is not Linux', () => {
    expect(preconditions({ ...CLEAR, platform: 'win32' })).toEqual(['The measurement reads /proc, so it runs on Linux; this is win32.'])
  })

  // Another container's work lands inside the timed windows and on the
  // same CPUs, and nothing in the result could tell it apart. Named, so the
  // operator knows what to stop -- the live demo, on this machine.
  test('refuse a running container, naming it', () => {
    const problems = preconditions({ ...CLEAR, containers: [{ id: 'bae9f0760968', name: 'exciting_proskuriakova', image: 'postgres:17-alpine' }] })
    expect(problems).toEqual(['Stop every container first; running: exciting_proskuriakova (postgres:17-alpine, bae9f0760968).'])
  })

  // The result records a commit; a product file changed and not committed
  // would make that commit a lie about what ran.
  test('refuse a dirty file in the product digest, naming it', () => {
    expect(preconditions({ ...CLEAR, dirtyFiles: ['packages/data-core/src/lookup/query.ts'] })).toEqual([
      'Commit or revert what the measurement runs first; changed: packages/data-core/src/lookup/query.ts.',
    ])
  })

  // Every file whose content the product digest records, the build's
  // configuration included: a tsconfig changed and not committed is built
  // into what runs, and the recorded commit would not hold it. The tools'
  // entries are versions, not files, and git has nothing to say about them.
  test('ask git about every file the product digest records, build configuration included', () => {
    const product = {
      files: { 'packages/data-core/src/lookup/query.ts': 'a'.repeat(64) },
      packages: { postgres: '3.4.9' },
      build: { 'packages/data-core/tsdown.config.ts': 'b'.repeat(64), 'tsconfig.base.json': 'c'.repeat(64), tsdown: '0.23.0', typescript: '6.0.3' },
    }
    expect(measuredPaths(product)).toEqual(['packages/data-core/src/lookup/query.ts', 'packages/data-core/tsdown.config.ts', 'tsconfig.base.json'])
  })

  // Node's fetch honours the proxy variables when NODE_USE_ENV_PROXY is
  // set, and the run's requests to 127.0.0.1 would then cross a proxy.
  test('refuse a proxy without loopback in NO_PROXY', () => {
    expect(preconditions({ ...CLEAR, env: { HTTPS_PROXY: 'http://proxy:3128', NO_PROXY: 'localhost' } })).toEqual([
      'A proxy is set (HTTPS_PROXY), so NO_PROXY must list both 127.0.0.1 and localhost; it lists localhost.',
    ])
    expect(preconditions({ ...CLEAR, env: { http_proxy: 'http://proxy:3128', no_proxy: 'localhost, 127.0.0.1,example.com' } })).toEqual([])
    expect(preconditions({ ...CLEAR, env: { NODE_USE_ENV_PROXY: '1' } })).toHaveLength(1)
  })

  // An image pulled during the run would land in a timed window, and might
  // be a different image from the one the suites tested.
  test('refuse a database image that is not present locally', () => {
    expect(preconditions({ ...CLEAR, missingImages: ['postgres:17-alpine'] })).toEqual(['Pull postgres:17-alpine before the run; it is not on this machine, and a pull must not happen inside it.'])
  })

  // Without P13's tolerance the calibration would wave every block through.
  test('refuse a protocol without a calibration tolerance', () => {
    expect(preconditions({ ...CLEAR, tolerance: null })).toEqual(['The publish protocol has no calibration tolerance: measure P13 and write it into protocol.ts first.'])
  })
})

describe('the quiet check', () => {
  const rule = PUBLISH_PROTOCOL.quiet

  // Ten quiet seconds: nothing else holds a whole CPU.
  test('passes a window below both limits', () => {
    expect(quietVerdict([{ loadAverage: 0.2, busyVcpus: 0.3 }, { loadAverage: 0.3, busyVcpus: 0.9 }], rule)).toEqual({ quiet: true })
  })

  // A load average at or above one says something has been running for the last minute.
  test('refuses a load average of 1.2', () => {
    expect(quietVerdict([{ loadAverage: 1.2, busyVcpus: 0.1 }], rule)).toEqual({ quiet: false, reason: 'the 1-minute load average reached 1.2, at least 1' })
  })

  // A second in which more than one vCPU was busy is something running now.
  test('refuses a busy second above one vCPU', () => {
    expect(quietVerdict([{ loadAverage: 0.1, busyVcpus: 0.2 }, { loadAverage: 0.1, busyVcpus: 1.4 }], rule)).toEqual({ quiet: false, reason: 'one second had 1.4 vCPUs busy, more than 1' })
  })

  test('refuses a window with no samples', () => {
    expect(quietVerdict([], rule).quiet).toBe(false)
  })
})

describe('the container set at a block boundary', () => {
  const recorded = [
    { id: 'a1', name: 'pg', image: 'postgres:17-alpine' },
    { id: 'b2', name: 'ms', image: 'mcr.microsoft.com/mssql/server:2022-latest' },
  ]

  test('is unchanged when the same containers run', () => {
    expect(containerSetChange(recorded, [...recorded].reverse())).toBeUndefined()
  })

  // A container started mid-run shares the CPUs from then on; one that
  // went away was one the run needed.
  test('names a newcomer and a container that went away', () => {
    expect(containerSetChange(recorded, [...recorded, { id: 'c3', name: 'newcomer', image: 'redis:7' }])).toBe('a container started during the run: newcomer (redis:7, c3)')
    expect(containerSetChange(recorded, recorded.slice(0, 1))).toBe('a container stopped during the run: ms (mcr.microsoft.com/mssql/server:2022-latest, b2)')
  })
})

describe('the calibration verdict', () => {
  // A block whose probe ran slower than the baseline by more than the
  // tolerance was measured on a machine somebody else was using: it runs
  // again once, and a second miss refuses the run rather than publishing it.
  test('asks for one repeat past the tolerance, and refuses a second miss', () => {
    expect(calibrationVerdict(1.05, 1.1, 1)).toBe('pass')
    expect(calibrationVerdict(1.2, 1.1, 1)).toBe('repeat')
    expect(calibrationVerdict(1.2, 1.1, 2)).toBe('refuse')
    expect(calibrationVerdict(1.05, 1.1, 2)).toBe('pass')
  })

  // The smoke run shares a machine and refuses nothing for it.
  test('passes anything when the tolerance is unbounded', () => {
    expect(calibrationVerdict(50, 'unbounded', 1)).toBe('pass')
  })

  test('cannot judge without a tolerance', () => {
    expect(() => calibrationVerdict(1, null, 1)).toThrow()
  })
})

describe('a block judged by the probe', () => {
  /**
   * A block whose probe medians in the idle gaps before and after it were
   * `before` and `after`; the samples say which attempt it was. Its probe
   * under the block's own load is not recorded: it slows with the run itself.
   */
  const block = (before: number, after: number, attempt: number): BlockResult => ({
    samples: [attempt],
    seconds: 1,
    rowsAnswered: 0,
    counters: {
      machineBusyPct: 0,
      stealPct: null,
      serverCpuMs: 0,
      databaseCpuMs: 0,
      generatorLagP99Ms: 0,
      loadAvgAtStart: 0,
      idle: { probeBeforeMs: before, probeAfterMs: after, databaseCpuMs: 0, seconds: 4 },
      disturbances: {},
      reconnects: 0,
    },
  })
  const attempts = (...gaps: Array<[number, number]>) => {
    let next = 0
    return async () => {
      const [before, after] = gaps[next] as [number, number]
      return block(before, after, ++next)
    }
  }

  // Within the tolerance the block is kept as measured, once.
  test('keeps a block whose idle gaps are within the tolerance', async () => {
    expect(await judged('pg read', attempts([4.2, 4.1]), 4, 1.1)).toEqual({ block: block(4.2, 4.1, 1) })
  })

  // Past it in either gap, the block runs again and the second attempt is
  // the one kept, marked repeated so the page says so. Contention that was
  // there before a block and went, or came during it and stayed, shows in
  // one gap and not the other; the median of both together would hide it.
  test('runs a block once more when either gap is past the tolerance, and keeps the second', async () => {
    expect(await judged('pg read', attempts([5, 4], [4, 4.1]), 4, 1.1)).toEqual({ block: block(4, 4.1, 2), repeated: true })
    expect(await judged('pg read', attempts([4, 5], [4, 4]), 4, 1.1)).toEqual({ block: block(4, 4, 2), repeated: true })
  })

  // Twice past it, the machine is not the one the baseline described; the
  // run refuses rather than publishing either attempt.
  test('refuses the run on a second miss, naming the block', async () => {
    await expect(judged('pg read at 8 in flight', attempts([5, 5], [4, 5]), 4, 1.1)).rejects.toThrow(Refusal)
    await expect(judged('pg read at 8 in flight', attempts([5, 5], [4, 5]), 4, 1.1)).rejects.toThrow(/pg read at 8 in flight: the probe ran slower than the quiet baseline/)
  })
})
