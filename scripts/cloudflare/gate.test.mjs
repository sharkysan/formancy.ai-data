import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import YAML from 'yaml'
import { cloudflareProblems, guideCommandProblems, imageVolumeProblems } from './gate.mjs'

/**
 * The CI job `cloudflare`'s checks of the overlay and the guide (0037), each
 * held to the edit it must catch. The job runs them on what `docker compose
 * config` resolves; here, without Docker, the two files are resolved by a
 * small reading of Compose's rules -- short volume syntax made long, paths
 * against the first file's directory, a service named in both files merged
 * -- which is enough to make each edit and see its sentence. That Compose
 * resolves them the same is the job's to show, with 2.20.3 and the runner's
 * own.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (path) => readFileSync(join(repo, path), 'utf8')
const BASE = read('compose.yaml')
const OVERLAY = read('deploy/cloudflare/compose.yaml')
const DOCKERFILE = read('deploy/cloudflare/Dockerfile')
const GUIDE = read('docs/deploy/cloudflare.md')

/** A service as Compose prints it: volumes long, a bind's source absolute, build an object. */
function normalised(service) {
  const out = { ...service }
  if (Array.isArray(service.volumes)) {
    out.volumes = service.volumes.map((entry) => {
      if (typeof entry !== 'string') return entry
      const [source, target, flag] = entry.split(':')
      const bind = source.startsWith('.') || isAbsolute(source)
      return { type: bind ? 'bind' : 'volume', source: bind ? join(repo, source) : source, target, ...(flag === 'ro' ? { read_only: true } : {}) }
    })
  }
  if (typeof service.build === 'string') out.build = { context: join(repo, service.build) }
  else if (service.build !== undefined) out.build = { ...service.build, context: join(repo, service.build.context) }
  return out
}

/** compose.yaml (or `baseText`), and `overlay` over it when given, resolved as above. */
function resolved(overlay, baseText = BASE) {
  const base = YAML.parse(baseText, { merge: true })
  const services = Object.fromEntries(Object.entries(base.services).map(([name, service]) => [name, normalised(service)]))
  if (overlay !== undefined) {
    for (const [name, service] of Object.entries(YAML.parse(overlay).services ?? {})) {
      const merged = { ...(services[name] ?? {}), ...service }
      if (services[name]?.environment !== undefined && service.environment !== undefined) merged.environment = { ...services[name].environment, ...service.environment }
      services[name] = normalised(merged)
    }
  }
  return { services }
}

const problems = (overlay = OVERLAY, dockerfile = DOCKERFILE) => cloudflareProblems(resolved(overlay), resolved(), dockerfile)
/** The overlay with `from` replaced by `to`, exactly once. */
function edited(from, to, text = OVERLAY) {
  expect(text.split(from).length, `"${from}" occurs once`).toBe(2)
  return text.replace(from, to)
}
const DIGEST = 'sha256:9b49eed8f62806d5d45ddf59ecefb5710429598ea6d3fcccd2af938f621b2b07'

describe('the overlay', () => {
  // The baseline: every case below is one edit away from it.
  test('passes as committed', () => {
    expect(problems()).toEqual([])
  })

  // Each edit opens something: a log full of host tokens, a token in the
  // configuration, an unpinned or second binary, a published port, a
  // writable credentials volume, an image pulled by a local tag, a base
  // service changed under a command that names one file.
  test.each([
    ['--loglevel debug', ['"--loglevel", "info"', '"--loglevel", "debug"'], /logs below info/],
    ['TUNNEL_TOKEN', ['    volumes:\n      - formancy-data-tunnel:/etc/formancy-cloudflare:ro', '    environment:\n      TUNNEL_TOKEN: x\n    volumes:\n      - formancy-data-tunnel:/etc/formancy-cloudflare:ro'], /cloudflared sets TUNNEL_TOKEN/],
    ['--token on the command line', ['"--config", "/etc/formancy-cloudflare/config.yml", "run"]', '"--config", "/etc/formancy-cloudflare/config.yml", "--token", "x", "run"]'], /is given --token, a secret on its command line/],
    [':latest', [`cloudflare/cloudflared:2026.10.0@${DIGEST}\n    command`, 'cloudflare/cloudflared:latest\n    command'], /not cloudflare\/cloudflared at a release tag and a digest/],
    ['a tag without a digest', [`cloudflare/cloudflared:2026.10.0@${DIGEST}\n    command`, 'cloudflare/cloudflared:2026.10.0\n    command'], /neither built from this checkout nor pinned by digest/],
    ['metrics on every interface', ['"--metrics", "127.0.0.1:20241", "--management', '"--metrics", "0.0.0.0:20241", "--management'], /serves its metrics past loopback/],
    ['diagnostics left on', ['"--management-diagnostics=false", ', ''], /diagnostics on/],
    ['a published port', ['    volumes:\n      - formancy-data-tunnel:/etc/formancy-cloudflare:ro', '    ports: ["7844:7844"]\n    volumes:\n      - formancy-data-tunnel:/etc/formancy-cloudflare:ro'], /cloudflared publishes a port/],
    [':rw on cloudflared’s mount', ['formancy-data-tunnel:/etc/formancy-cloudflare:ro', 'formancy-data-tunnel:/etc/formancy-cloudflare:rw'], /cloudflared can write the tunnel’s volume/],
    ['setup on compose’s network', ['    user: "0"\n    network_mode: bridge\n    environment:', '    user: "0"\n    environment:'], /tunnel-setup is on compose’s network, not bridge/],
    ['setup’s HOME on disk', ['    tmpfs:\n      - /tmp/login\n', ''], /HOME is not a tmpfs/],
    ['doors-check as root', ['    user: node', '    user: "0"'], /doors-check runs as root/],
    ['the tunnel’s volume on doors-check', ['      - ./deploy/cloudflare/check.mjs:', '      - formancy-data-tunnel:/etc/formancy-cloudflare\n      - ./deploy/cloudflare/check.mjs:'], /doors-check mounts the tunnel's volume/],
  ])('fails with %s', (_, [from, to], sentence) => {
    expect(problems(edited(from, to)).join('\n')).toMatch(sentence)
  })

  // A doors-check without build: is pulled by a local tag from Docker Hub,
  // where anybody could publish that name.
  test('fails with doors-check’s build: dropped', () => {
    const withoutBuild = OVERLAY.replace(/( {2}doors-check:\n {4}profiles: \[tools\]\n) {4}build:\n {6}context: \.\/deploy\/cloudflare\n/, '$1')
    expect(withoutBuild).not.toBe(OVERLAY)
    expect(problems(withoutBuild).join('\n')).toMatch(/doors-check is neither built from this checkout nor pinned by digest/)
  })

  // An overlay that touched a service of compose.yaml would be recreated by
  // every command naming one file but not the other, and differ between the
  // getting-started guide's stack and this one.
  test('fails with an overlay entry for compose.yaml’s server', () => {
    expect(problems(edited('\nservices:\n', '\nservices:\n  server:\n    environment:\n      FORMANCY_DATA_RATE_LIMIT: "100"\n\n'))).toEqual(
      expect.arrayContaining(['deploy/cloudflare/compose.yaml changes compose.yaml\'s server, so a command naming compose.yaml alone would recreate it']),
    )
  })

  // cloudflared holds the one connection to Cloudflare, and whoever can
  // change its ingress -- a local edit of config.yml, a configuration
  // pushed by somebody with Tunnel edit permission -- or add a private
  // network route to the tunnel sends traffic wherever its container
  // reaches. On compose's network that is the server, past nginx, and both
  // databases; on `edge` alone it is the web front. So it joins `edge` and
  // nothing else, and nothing but the web front joins `edge` beside it.
  test('fails with cloudflared on compose’s network, or another service beside it', () => {
    expect(problems(edited('    networks: [edge]\n', '')).join('\n')).toMatch(/cloudflared is on default, not on edge alone/)
    expect(problems(edited('    networks: [edge]\n', '    networks: [default, edge]\n')).join('\n')).toMatch(/cloudflared is on default, edge, not on edge alone/)
    const serverOnEdge = BASE.replace('    image: formancy/data-server:compose\n    environment:', '    image: formancy/data-server:compose\n    networks: [default, edge]\n    environment:')
    expect(serverOnEdge).not.toBe(BASE)
    expect(cloudflareProblems(resolved(OVERLAY, serverOnEdge), resolved(undefined, serverOnEdge), DOCKERFILE).join('\n')).toMatch(/server joins edge, beside cloudflared/)
    const webOffEdge = BASE.replace('    networks: [default, edge]\n', '')
    expect(webOffEdge).not.toBe(BASE)
    expect(cloudflareProblems(resolved(OVERLAY, webOffEdge), resolved(undefined, webOffEdge), DOCKERFILE).join('\n')).toMatch(/web is not on edge, so cloudflared cannot reach it/)
  })

  // The tools must check with the binary that runs the tunnel.
  test('fails with a Dockerfile that copies cloudflared from another image', () => {
    const other = DOCKERFILE.replace(DIGEST, `sha256:${'0'.repeat(64)}`)
    expect(other).not.toBe(DOCKERFILE)
    expect(problems(OVERLAY, other).join('\n')).toMatch(/copies cloudflared from .*, not from the image the cloudflared service runs/)
  })

  // A VOLUME an image declares and no mount covers leaves an anonymous
  // volume behind every container (0032).
  test('fails with an image that declares a volume nothing covers', () => {
    const config = resolved(OVERLAY)
    expect(imageVolumeProblems(config, resolved(), { [config.services.cloudflared.image]: null })).toEqual([])
    expect(imageVolumeProblems(config, resolved(), { [config.services.cloudflared.image]: { '/home/nonroot': {} } })).toEqual(["cloudflared's image declares a volume at /home/nonroot that the service mounts nothing over"])
    // The tools share one image; setup's tmpfs covers the path, and the other two have nothing over it.
    expect(imageVolumeProblems(config, resolved(), { [config.services['tunnel-setup'].image]: { '/tmp/login': {} } }).map((problem) => problem.split("'")[0])).toEqual(['tunnel-config', 'doors-check'])
  })
})

describe('the guide’s commands', () => {
  test('name both files and only what the overlay has, as committed', () => {
    expect(guideCommandProblems(GUIDE, resolved(OVERLAY), 'docs/deploy/cloudflare.md')).toEqual([])
  })

  // A service renamed in the overlay and not in the guide is a command an
  // operator types and Compose refuses.
  test('fail when doors-check is renamed in the overlay only', () => {
    const found = guideCommandProblems(GUIDE, resolved(edited('  doors-check:\n', '  door-check:\n')), 'docs/deploy/cloudflare.md')
    expect(found.length).toBeGreaterThanOrEqual(2)
    expect(found.every((problem) => /^docs\/deploy\/cloudflare\.md line \d+: doors-check is no service of either file$/.test(problem))).toBe(true)
  })

  // One file alone leaves cloudflared out of the command, and its down
  // leaves it running; a profile nobody has starts nothing.
  test('fail on a command with one file, or a profile nobody has, in a block or in the prose', () => {
    const guide = `${GUIDE}\n\`\`\`sh\ndocker compose --profile stack down\n\`\`\`\n\n\`\`\`sh\ndocker compose -f compose.yaml -f deploy/cloudflare/compose.yaml --profile tunnel up -d\n\`\`\`\n\nOr \`docker compose logs cloudflared\`.\n`
    expect(guideCommandProblems(guide, resolved(OVERLAY), 'docs/deploy/cloudflare.md')).toEqual([
      expect.stringMatching(/"docker compose --profile stack down" does not open with "docker compose -f compose.yaml -f deploy\/cloudflare\/compose.yaml"/),
      expect.stringMatching(/no service has the profile tunnel/),
      expect.stringMatching(/`docker compose logs cloudflared` in the prose does not name both files/),
    ])
  })
})
