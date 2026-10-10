import { getContainerRuntimeClient } from 'testcontainers'

/*
 * What Docker says about itself and the containers it runs, through
 * testcontainers' own runtime client, so a reader reaches the daemon exactly
 * as the fixtures that started the containers did: no `docker` binary, no
 * second socket configuration. The performance harness reads the machine,
 * its precondition and each database's CPU through it (0034).
 *
 * Here because only this package declares testcontainers (0035), so that a
 * container is started only through its starters, which record what
 * answered. This reader lists, inspects and reads counters, and starts,
 * stops or changes nothing.
 */

type Dockerode = Awaited<ReturnType<typeof getContainerRuntimeClient>>['container']['dockerode']

/** The daemon: version, OS, storage and cgroup drivers, CPUs and memory as it reports them. */
export interface DockerDaemon {
  version: string
  os: string
  storageDriver: string
  cgroupDriver: string
  ncpu: number
  memTotalBytes: number
}

/** A running container as Docker lists it, by the twelve-character id `docker ps` shows. */
export interface DockerContainer {
  id: string
  name: string
  image: string
}

/** A container's image as the starter named it, the image's id and digests, and its limits: 0 is none. */
export interface DockerContainerFacts {
  id: string
  image: string
  imageId: string
  repoDigests: string[]
  limits: { nanoCpus: number; cpuQuota: number; cpuPeriod: number; memoryBytes: number }
}

export interface DockerReader {
  facts(): Promise<DockerDaemon>
  running(): Promise<DockerContainer[]>
  /** Whether an image is present locally by that name, so a caller can refuse rather than pull it. */
  hasImage(name: string): Promise<boolean>
  describe(id: string): Promise<DockerContainerFacts>
  /** Cumulative CPU nanoseconds and current memory, from one one-shot stats read. */
  usage(id: string): Promise<{ cpuNs: number; memoryBytes: number }>
}

export async function connectDocker(): Promise<DockerReader> {
  const dockerode: Dockerode = (await getContainerRuntimeClient()).container.dockerode
  return {
    async facts() {
      const [info, version] = await Promise.all([dockerode.info() as Promise<Record<string, unknown>>, dockerode.version()])
      return {
        version: version.Version,
        os: String(info['OperatingSystem'] ?? ''),
        storageDriver: String(info['Driver'] ?? ''),
        cgroupDriver: String(info['CgroupDriver'] ?? ''),
        ncpu: Number(info['NCPU'] ?? 0),
        memTotalBytes: Number(info['MemTotal'] ?? 0),
      }
    },
    async running() {
      const listed = await dockerode.listContainers()
      return listed.map((entry) => ({ id: entry.Id.slice(0, 12), name: (entry.Names[0] ?? '').replace(/^\//, ''), image: entry.Image }))
    },
    async hasImage(name) {
      try {
        await dockerode.getImage(name).inspect()
        return true
      } catch (error) {
        if ((error as { statusCode?: unknown }).statusCode === 404) return false
        throw error
      }
    },
    async describe(id) {
      const container = await dockerode.getContainer(id).inspect()
      const image = await dockerode.getImage(container.Image).inspect()
      const host = container.HostConfig
      return {
        id: container.Id.slice(0, 12),
        image: container.Config.Image,
        imageId: image.Id,
        repoDigests: [...(image.RepoDigests ?? [])].sort(),
        limits: { nanoCpus: host.NanoCpus ?? 0, cpuQuota: host.CpuQuota ?? 0, cpuPeriod: host.CpuPeriod ?? 0, memoryBytes: host.Memory ?? 0 },
      }
    },
    async usage(id) {
      // `one-shot` reads the counters once instead of waiting a second for a
      // second sample to compute a rate nobody here uses (0034, P7).
      const stats = (await dockerode.getContainer(id).stats({ stream: false, 'one-shot': true } as { stream: false })) as unknown as {
        cpu_stats?: { cpu_usage?: { total_usage?: number } }
        memory_stats?: { usage?: number }
      }
      const cpuNs = stats.cpu_stats?.cpu_usage?.total_usage
      if (typeof cpuNs !== 'number') throw new Error(`docker stats for ${id} has no cumulative CPU usage`)
      return { cpuNs, memoryBytes: stats.memory_stats?.usage ?? 0 }
    },
  }
}
