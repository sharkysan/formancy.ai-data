import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Calibration } from './calibration.js'
import { busyBetween, readLoadAverage, readProcStat, stealSinceBoot } from './machine.js'
import { dockerProxyFor, lookupOrder, proxySettings } from './network.js'
import { quietVerdict } from './quiet.js'
import type { QuietSample } from './quiet.js'
import type { BundleFacts, EngineKey, Machine, Network, ProductDescription, Protocol } from './results.js'
import { ENGINE_KEYS } from './results.js'
import type { WriterEndpoint } from './stack.js'

/*
 * What the run records about where it ran and what it ran (0034), gathered
 * by asking: git for the commit and what is not clean, the stale check for
 * the product it describes, /proc for a quiet machine, the resolver and
 * /proc for the network path, the store for the published version's size.
 */

const run = promisify(execFile)

/** `node scripts/performance-stale.mjs --describe`: the files, packages and build inputs the release check compares. */
export async function describeProduct(root: string): Promise<ProductDescription> {
  const { stdout } = await run(process.execPath, [join(root, 'scripts', 'performance-stale.mjs'), '--describe'], { cwd: root, maxBuffer: 16 * 1024 * 1024 })
  return JSON.parse(stdout) as ProductDescription
}

export async function gitCommit(root: string): Promise<string> {
  return (await run('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim()
}

/** Which of `files` git does not report clean: changed, staged or untracked. */
export async function dirtyFiles(root: string, files: readonly string[]): Promise<string[]> {
  if (files.length === 0) return []
  const { stdout } = await run('git', ['status', '--porcelain', '--untracked-files=all', '--', ...files], { cwd: root, maxBuffer: 16 * 1024 * 1024 })
  return stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => line.slice(3))
}

const second = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1000))

/**
 * Sampled once a second for the rule's window, with the calibration probe
 * running: the probe's median then is the baseline every block is compared
 * with. Not quiet, it samples again until the rule gives up and refuses --
 * unless the protocol only records it, as the smoke run does.
 */
export async function quietCheck(protocol: Protocol, calibration: Calibration): Promise<Machine['quiet']> {
  const rule = protocol.quiet
  const gaveUpAt = Date.now() + rule.giveUpSeconds * 1000
  for (;;) {
    const samples: QuietSample[] = []
    const started = process.hrtime.bigint()
    for (let s = 0; s < rule.windowSeconds; s += 1) {
      const before = await readProcStat()
      await second()
      const after = await readProcStat()
      samples.push({ loadAverage: (await readLoadAverage()).one, busyVcpus: busyBetween(before, after).busyVcpus })
    }
    const baseline = calibration.medianBetween(started, process.hrtime.bigint())
    const verdict = quietVerdict(samples, rule)
    if (verdict.quiet || !rule.enforced || Date.now() > gaveUpAt) {
      if (!verdict.quiet && rule.enforced) throw new Error(`The machine is not quiet: ${verdict.reason}, for ${String(rule.giveUpSeconds)} s.`)
      if (baseline === null) throw new Error('the calibration probe did not run during the quiet check')
      return {
        enforced: rule.enforced,
        containersBefore: [],
        loadAverage: Math.max(...samples.map((sample) => sample.loadAverage)),
        busyVcpusMax: Math.max(...samples.map((sample) => sample.busyVcpus)),
        stealReported: stealSinceBoot(await readProcStat()),
        calibrationBaselineMs: baseline,
        seconds: rule.windowSeconds,
      }
    }
  }
}

export async function networkFacts(writers: Record<EngineKey, WriterEndpoint>, delayMs: number): Promise<Network> {
  const engines = {} as Network['engines']
  for (const engine of ENGINE_KEYS) {
    const { host, port } = writers[engine]
    engines[engine] = { host, lookup: await lookupOrder(host), port, dockerProxy: await dockerProxyFor(port), tls: false }
  }
  return { client: { transport: 'HTTP/1.1, keep-alive, Node fetch', address: '127.0.0.1', tls: false, proxy: proxySettings(process.env) }, engines, hopDelayMs: delayMs }
}

/** A published version's file size, and its snapshot's size as compact JSON and object count. */
export async function bundleFacts(storeDir: string, formId: string): Promise<BundleFacts> {
  const file = join(storeDir, formId, '1.json')
  const document = JSON.parse(await readFile(file, 'utf8')) as { snapshot: { objects: unknown[] } }
  return { versionBytes: (await stat(file)).size, snapshotBytes: Buffer.byteLength(JSON.stringify(document.snapshot)), snapshotObjects: document.snapshot.objects.length }
}
