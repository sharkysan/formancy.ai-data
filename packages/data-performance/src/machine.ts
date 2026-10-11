import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { release } from 'node:os'
import { promisify } from 'node:util'

/*
 * The machine as Linux presents it to the run: CPU ticks, load, a process's
 * CPU time, the topology the hypervisor shows, memory, the OS and the
 * harness's cgroup. Each reader is a file or a command and a pure parser,
 * and the parsers are what `machine.test.ts` holds, on captured text.
 *
 * Inside a VM this is the VM's view. Host activity outside it is invisible
 * unless the hypervisor reports steal, and this one reports none (0034).
 */

const run = promisify(execFile)

export interface CpuTicks {
  user: number
  nice: number
  system: number
  idle: number
  iowait: number
  irq: number
  softirq: number
  steal: number
  guest: number
  guestNice: number
}

/** `/proc/stat`'s aggregate `cpu` line, and how many per-CPU lines follow it. */
export function parseProcStat(text: string): { total: CpuTicks; cpus: number } {
  const lines = text.split('\n')
  const aggregate = lines.find((line) => /^cpu\s/.test(line))
  if (aggregate === undefined) throw new Error('/proc/stat has no aggregate cpu line')
  const [user, nice, system, idle, iowait, irq, softirq, steal, guest, guestNice] = aggregate.trim().split(/\s+/).slice(1).map(Number)
  const total = { user, nice, system, idle, iowait, irq, softirq, steal: steal ?? 0, guest: guest ?? 0, guestNice: guestNice ?? 0 } as CpuTicks
  return { total, cpus: lines.filter((line) => /^cpu\d+\s/.test(line)).length }
}

/** Guest time is counted in user and nice already, so the sum leaves it out. */
const allTicks = (t: CpuTicks): number => t.user + t.nice + t.system + t.idle + t.iowait + t.irq + t.softirq + t.steal

/** Busy between two reads: every tick neither idle nor waiting on I/O, as a share and in vCPUs; steal as a share. */
export function busyBetween(before: { total: CpuTicks; cpus: number }, after: { total: CpuTicks; cpus: number }): { busyPct: number; busyVcpus: number; stealPct: number } {
  const all = allTicks(after.total) - allTicks(before.total)
  if (all <= 0) return { busyPct: 0, busyVcpus: 0, stealPct: 0 }
  const resting = after.total.idle + after.total.iowait - (before.total.idle + before.total.iowait)
  const share = (all - resting) / all
  return { busyPct: share * 100, busyVcpus: share * after.cpus, stealPct: ((after.total.steal - before.total.steal) / all) * 100 }
}

/** Whether the hypervisor has reported any steal since boot; if not, steal is "not reported", never 0. */
export function stealSinceBoot(stat: { total: CpuTicks }): boolean {
  return stat.total.steal > 0
}

/** utime and stime, in clock ticks, from `/proc/<pid>/stat`, counted from the last `)` so a name cannot shift them. */
export function parsePidStat(text: string): { utime: number; stime: number } {
  const close = text.lastIndexOf(')')
  if (close === -1) throw new Error('a /proc/<pid>/stat line has its name in parentheses')
  // After the name: state is field 3, utime field 14 and stime field 15.
  const fields = text.slice(close + 2).trim().split(/\s+/)
  return { utime: Number(fields[11]), stime: Number(fields[12]) }
}

export function parseLoadAverage(text: string): { one: number; five: number; fifteen: number } {
  const [one, five, fifteen] = text.trim().split(/\s+/).map(Number)
  if (one === undefined || five === undefined || fifteen === undefined || [one, five, fifteen].some(Number.isNaN)) throw new Error('/proc/loadavg has three averages first')
  return { one, five, fifteen }
}

export interface PresentedCpu {
  model: string
  vcpus: number
  sockets: number
  coresPerSocket: number
  threadsPerCore: number
  hypervisor: string | null
}

/** `lscpu`'s CPU count, topology and hypervisor vendor: what the hypervisor presents, not the host. */
export function parseLscpu(text: string): PresentedCpu {
  const fields = new Map<string, string>()
  for (const line of text.split('\n')) {
    const at = line.indexOf(':')
    if (at > 0) fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
  }
  const count = (name: string): number => {
    const value = Number(fields.get(name))
    if (!Number.isInteger(value) || value < 1) throw new Error(`lscpu says no ${name}`)
    return value
  }
  return {
    model: fields.get('Model name') ?? '',
    vcpus: count('CPU(s)'),
    sockets: count('Socket(s)'),
    coresPerSocket: count('Core(s) per socket'),
    threadsPerCore: count('Thread(s) per core'),
    hypervisor: fields.get('Hypervisor vendor') ?? null,
  }
}

export function parseMemTotal(text: string): number {
  const match = /^MemTotal:\s+(\d+) kB$/m.exec(text)
  if (match === null) throw new Error('/proc/meminfo has no MemTotal')
  return Number(match[1]) * 1024
}

export function parseOsRelease(text: string): string {
  const match = /^PRETTY_NAME="?([^"\n]*)"?$/m.exec(text)
  if (match === null) throw new Error('/etc/os-release has no PRETTY_NAME')
  return match[1] as string
}

/** The unified (v2) cgroup line of `/proc/self/cgroup`: `0::<path>`. */
export function parseCgroupPath(text: string): string {
  const match = /^0::(.*)$/m.exec(text)
  if (match === null) throw new Error('/proc/self/cgroup has no unified cgroup line')
  return match[1] as string
}

export const readProcStat = async (): Promise<{ total: CpuTicks; cpus: number }> => parseProcStat(await readFile('/proc/stat', 'utf8'))
export const readLoadAverage = async (): Promise<{ one: number; five: number; fifteen: number }> => parseLoadAverage(await readFile('/proc/loadavg', 'utf8'))
export const readPidTicks = async (pid: number): Promise<{ utime: number; stime: number }> => parsePidStat(await readFile(`/proc/${String(pid)}/stat`, 'utf8'))

/** Clock ticks a second, for turning a process's ticks into milliseconds. */
export async function clockTicks(): Promise<number> {
  const { stdout } = await run('getconf', ['CLK_TCK'])
  return Number(stdout.trim())
}

/** The machine as presented: CPU, memory, OS, kernel, and this process's cgroup with its CPU limit. */
export async function describeMachine(): Promise<{ cpu: PresentedCpu; memoryBytes: number; os: { prettyName: string; kernel: string; clkTck: number }; cgroup: { path: string; cpuMax: string } }> {
  const cpu = parseLscpu((await run('lscpu', [], { env: { ...process.env, LC_ALL: 'C' } })).stdout)
  const path = parseCgroupPath(await readFile('/proc/self/cgroup', 'utf8'))
  // Without a cgroup namespace of its own the hierarchy is mounted from its
  // root, and this cgroup is at its path below it (the Docker Sandbox VM,
  // 2026-10-09); with one, /sys/fs/cgroup is this cgroup.
  const cpuMax = (
    await readFile(`/sys/fs/cgroup${path}/cpu.max`, 'utf8')
      .catch(() => readFile('/sys/fs/cgroup/cpu.max', 'utf8'))
      .catch(() => 'not readable')
  ).trim()
  return {
    cpu,
    memoryBytes: parseMemTotal(await readFile('/proc/meminfo', 'utf8')),
    os: { prettyName: parseOsRelease(await readFile('/etc/os-release', 'utf8')), kernel: release(), clkTck: await clockTicks() },
    cgroup: { path, cpuMax },
  }
}
