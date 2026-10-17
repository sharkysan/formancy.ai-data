// What the live demo's gate (0070) asks Docker, and how it reads the
// answers: pure, so scripts/live-demo-gate/docker.test.mjs holds it without
// Docker.

/**
 * Cloudflare Containers' instance types, as its documentation lists them
 * (partials/containers/instance-types.mdx in cloudflare/cloudflare-docs at
 * 0a7e37ca, read on 2026-10-16): the vCPU share and the memory each is
 * given. The gate runs a visitor's container at the share of the type
 * apps/live-demo/wrangler.json asks for. A quota emulates the share; it is
 * not Cloudflare's scheduler, and its numbers are this machine's.
 */
export const INSTANCE_TYPES = Object.freeze({
  lite: { vcpu: 0.0625, memoryMiB: 256 },
  basic: { vcpu: 0.25, memoryMiB: 1024 },
  'standard-1': { vcpu: 0.5, memoryMiB: 4096 },
  'standard-2': { vcpu: 1, memoryMiB: 6144 },
  'standard-3': { vcpu: 2, memoryMiB: 8192 },
  'standard-4': { vcpu: 4, memoryMiB: 12288 },
})

/** The `docker run` quota for `type`: its CPU share, its memory, and no swap, which Cloudflare's instances have none of. */
export function quotaOf(type) {
  const found = INSTANCE_TYPES[type]
  if (found === undefined) throw new Error(`${String(type)} is no instance type Cloudflare lists: ${Object.keys(INSTANCE_TYPES).join(', ')}`)
  const memory = `${String(found.memoryMiB)}m`
  return { cpus: String(found.vcpu), memory, swap: memory }
}

/**
 * The arguments of the `docker run` that is one visitor's container:
 * linux/amd64, under `quota`, `port` published on loopback alone at a port
 * the engine picks, and each of `variables` named without a value, so the
 * CLI copies it from the environment it is spawned with and no key is ever
 * on a command line. Attached, not detached: the process lives as long as
 * the container, which is how the stand-in learns it stopped.
 */
export function runArguments({ image, name, port, quota, variables }) {
  for (const variable of variables) if (variable.includes('=')) throw new Error(`runArguments takes a variable's name, never its value: ${variable.slice(0, variable.indexOf('='))}`)
  return [
    'run',
    '--name',
    name,
    '--platform',
    'linux/amd64',
    '--cpus',
    quota.cpus,
    '--memory',
    quota.memory,
    '--memory-swap',
    quota.swap,
    '--publish',
    `127.0.0.1::${String(port)}`,
    ...variables.flatMap((variable) => ['--env', variable]),
    image,
  ]
}

/** The loopback port `docker port <name> <port>` says the container's port is published on; undefined before it is. */
export function publishedPort(output) {
  const found = /^127\.0\.0\.1:(\d+)$/m.exec(output)
  return found === null ? undefined : Number(found[1])
}

/**
 * The container's peak memory, from what its cgroup said: `memory.peak`
 * under cgroup v2, `memory.max_usage_in_bytes` under v1 (Docker Desktop on
 * this workstation, 2026-10-16, has v1 and no memory.peak). Throws when
 * neither answered: a peak of zero would pass every budget.
 */
export function memoryUsed({ v2, v1 }) {
  if (typeof v2 === 'string' && /^\d+\s*$/.test(v2)) return { bytes: Number(v2.trim()), from: 'memory.peak' }
  if (typeof v1 === 'string' && /^\d+\s*$/.test(v1)) return { bytes: Number(v1.trim()), from: 'memory.max_usage_in_bytes' }
  throw new Error("the container's cgroup answered neither memory.peak nor memory.max_usage_in_bytes")
}

/** Shorter than this, a secret is found by chance; the demo's are 43 characters. */
const LOOKED_FOR = 16

/**
 * Where a secret is, as sentences: each of `secrets` (by what it is) found
 * in each of `places` (`{ where, text }`). Never the secret's value.
 */
export function leaks(places, secrets) {
  for (const [what, value] of Object.entries(secrets)) {
    if (typeof value !== 'string') throw new Error(`${what} is not known, so the leak check cannot look for it`)
    if (value.length < LOOKED_FOR) throw new Error(`${what} is ${String(value.length)} characters: too short to be looked for`)
  }
  return places.flatMap(({ where, text }) => Object.entries(secrets).filter(([, value]) => text.includes(value)).map(([what]) => `${what} is in ${where}`))
}
