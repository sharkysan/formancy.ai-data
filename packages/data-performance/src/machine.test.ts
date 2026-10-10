import { describe, expect, test } from 'vitest'
import { busyBetween, parseCgroupPath, parseLoadAverage, parseLscpu, parseMemTotal, parseOsRelease, parsePidStat, parseProcStat, stealSinceBoot } from './machine.js'

// In the shape of the Docker Sandbox VM's /proc/stat (2026-10-09), cut to three
// CPUs, with counts made up so the arithmetic is easy to follow.
const STAT_BEFORE = `cpu  4705 150 1925 136610 40 0 31 0 50 0
cpu0 1593 50 641 45536 13 0 10 0 0 0
cpu1 1556 50 642 45537 14 0 11 0 0 0
cpu2 1556 50 642 45537 13 0 10 0 0 0
intr 1462898 0 9 0 0 0 0
ctxt 2630193
btime 1760040000
`
const STAT_AFTER = `cpu  4905 150 2025 136910 40 0 31 0 150 0
cpu0 1693 50 691 45636 13 0 10 0 0 0
cpu1 1606 50 692 45637 14 0 11 0 0 0
cpu2 1606 50 642 45637 13 0 10 0 0 0
intr 1462998 0 9 0 0 0 0
`

describe('/proc/stat', () => {
  // The aggregate line, in the kernel's column order: user nice system idle
  // iowait irq softirq steal guest guest_nice. Counting the per-CPU lines
  // gives the vCPUs the kernel schedules on.
  test('parses the aggregate line and counts the CPUs', () => {
    const stat = parseProcStat(STAT_BEFORE)
    expect(stat.cpus).toBe(3)
    expect(stat.total).toEqual({ user: 4705, nice: 150, system: 1925, idle: 136610, iowait: 40, irq: 0, softirq: 31, steal: 0, guest: 50, guestNice: 0 })
  })

  // Busy is every tick that was neither idle nor waiting on I/O, as a share
  // of all ticks, and in vCPUs' worth: 300 busy of 600 on three CPUs is one
  // and a half. Guest time is already in user, so it is not counted twice.
  test('gives busy time between two reads in percent and in vCPUs', () => {
    const busy = busyBetween(parseProcStat(STAT_BEFORE), parseProcStat(STAT_AFTER))
    expect(busy.busyPct).toBe(50)
    expect(busy.busyVcpus).toBe(1.5)
    expect(busy.stealPct).toBe(0)
  })

  // A hypervisor that never reported steal since boot says nothing about the
  // host; that is recorded as not reported, never as 0.
  test('says steal is not reported when none was counted since boot', () => {
    expect(stealSinceBoot(parseProcStat(STAT_BEFORE))).toBe(false)
    expect(stealSinceBoot(parseProcStat(STAT_BEFORE.replace('cpu  4705 150 1925 136610 40 0 31 0', 'cpu  4705 150 1925 136610 40 0 31 7')))).toBe(true)
  })

  test('refuses a text without the aggregate line', () => {
    expect(() => parseProcStat('intr 1\n')).toThrow()
  })
})

describe('/proc/<pid>/stat', () => {
  // The process name is in parentheses and may hold spaces and parentheses
  // of its own; the fields are counted from the last ')'. Splitting the line
  // on spaces would read the CPU times from the wrong columns.
  test('reads utime and stime past a name with spaces and parentheses', () => {
    const line = '4242 (node (data) server) S 1 4242 4242 0 -1 4194560 3510 0 0 0 1234 567 0 0 20 0 11 0 9876 1234567 8901 18446744073709551615'
    expect(parsePidStat(line)).toEqual({ utime: 1234, stime: 567 })
  })

  test('refuses a line with no name', () => {
    expect(() => parsePidStat('4242 S 1')).toThrow()
  })
})

describe('the machine as it is presented', () => {
  // Captured from `lscpu` on the Docker Sandbox VM, 2026-10-09: what the
  // hypervisor presents, which is all a VM can know of the host.
  const LSCPU = `Architecture:                            x86_64
CPU op-mode(s):                          32-bit, 64-bit
CPU(s):                                  20
On-line CPU(s) list:                     0-19
Vendor ID:                               GenuineIntel
Model name:                              Intel(R) Core(TM) i9-10900K CPU @ 3.70GHz
Thread(s) per core:                      1
Core(s) per socket:                      20
Socket(s):                               1
Hypervisor vendor:                       Microsoft
Virtualization type:                     full
`
  test('reads lscpu into vCPUs, topology and hypervisor', () => {
    expect(parseLscpu(LSCPU)).toEqual({ model: 'Intel(R) Core(TM) i9-10900K CPU @ 3.70GHz', vcpus: 20, sockets: 1, coresPerSocket: 20, threadsPerCore: 1, hypervisor: 'Microsoft' })
  })

  // Bare metal has no hypervisor line; the page then prints CPUs, not vCPUs.
  test('reads no hypervisor on bare metal', () => {
    expect(parseLscpu(LSCPU.replace('Hypervisor vendor:                       Microsoft\n', '')).hypervisor).toBeNull()
  })

  test('refuses lscpu output without a CPU count', () => {
    expect(() => parseLscpu('Architecture: x86_64\n')).toThrow()
  })

  test('reads the load average, the memory, the OS name and the cgroup', () => {
    expect(parseLoadAverage('0.08 0.12 0.30 1/912 4242\n')).toEqual({ one: 0.08, five: 0.12, fifteen: 0.3 })
    expect(parseMemTotal('MemTotal:       16303212 kB\nMemFree: 1 kB\n')).toBe(16303212 * 1024)
    expect(parseOsRelease('NAME="Ubuntu"\nPRETTY_NAME="Ubuntu 26.04.1 LTS"\nID=ubuntu\n')).toBe('Ubuntu 26.04.1 LTS')
    expect(parseCgroupPath('0::/docker/0123abcd\n')).toBe('/docker/0123abcd')
    expect(() => parseLoadAverage('')).toThrow()
    expect(() => parseMemTotal('MemFree: 1 kB\n')).toThrow()
    expect(() => parseOsRelease('NAME=x\n')).toThrow()
    expect(() => parseCgroupPath('1:cpu:/x\n')).toThrow()
  })
})
