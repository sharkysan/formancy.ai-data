import type { DockerReader } from '@formancy/data-fixtures'
import { describe, expect, test } from 'vitest'
import type { Calibration } from './calibration.js'
import { idleGap } from './sampler.js'

/** A probe that has run nothing whole in a window until `nullsFirst` windows were asked about; the windows it was asked about. */
function calibration(nullsFirst: number, median = 4.2): Calibration & { asked: Array<{ from: bigint; to: bigint }> } {
  const asked: Array<{ from: bigint; to: bigint }> = []
  return {
    asked,
    probes: () => [],
    medianBetween(from, to) {
      asked.push({ from, to })
      return asked.length > nullsFirst ? median : null
    },
    stop: async () => {},
  }
}

/** A container whose cumulative CPU climbs 3 ms a reading. */
function docker(): Pick<DockerReader, 'usage'> {
  let cpuNs = 0
  return {
    usage: async () => {
      cpuNs += 3e6
      return { cpuNs, memoryBytes: 0 }
    },
  }
}

describe('an idle gap', () => {
  // A gap is judged by a probe that ran inside it, with nothing in flight.
  // One that held no whole probe -- the probe's thread was held up -- is
  // waited on, still idle, until one has; standing for it with the next probe
  // after the gap would judge it by a probe that ran under the next block's
  // warm-up, which slows it for reasons of the run's own.
  test('lasts until a whole probe has run in it, every window starting where the gap did', async () => {
    const probe = calibration(2)
    const gap = await idleGap({ docker: docker() as DockerReader, containerId: 'c', calibration: probe, gapMs: 5 })
    expect(gap.probeMs).toBe(4.2)
    expect(probe.asked).toHaveLength(3)
    expect(new Set(probe.asked.map((window) => window.from)).size).toBe(1)
    expect(gap.databaseCpuMs).toBe(3)
  })

  // A probe that never reports is not a quiet machine; the run stops rather
  // than wait for ever or judge the gap by nothing.
  test('gives up on a probe that never reports', async () => {
    await expect(idleGap({ docker: docker() as DockerReader, containerId: 'c', calibration: calibration(Number.POSITIVE_INFINITY), gapMs: 5 }, 30)).rejects.toThrow(/has not reported/)
  })
})
