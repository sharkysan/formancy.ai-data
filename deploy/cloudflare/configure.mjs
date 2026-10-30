// `tunnel-config`, and the last step of `tunnel-setup`: the tunnel's
// configuration file, written from doors.json and checked by the cloudflared
// that will run it, before it is used (0037).
//
//   docker compose -f compose.yaml -f deploy/cloudflare/compose.yaml run --rm tunnel-config --admin formancy.example.com --team example-team --aud <tag> [--app <host> [--app-service <url>]] [--drop <host>]
//
// It makes no call to Cloudflare and needs no login: it reads the tunnel's
// id from the credentials setup created -- never its secret -- renders the
// configuration beside the one in use, and only when cloudflared says it is
// valid and matches every probe to the rule ingress.mjs expects does it
// replace the one in use. On any failure the old file stays and it exits 1.
// It remembers no earlier argument, so arguments that would close a door the
// configuration in use opens are refused, unless --drop names its hostname.
// cloudflared runs as 65532 and reads the volume read-only, so both files
// are that user's, readable by it alone.
//
// Node's built-ins only: it runs in the tools image with nothing installed.
// scripts/cloudflare/configure.test.mjs holds its steps against a stand-in
// for cloudflared's answers; the CI job `cloudflare` runs it in the tools
// image against the real binary.

import { spawnSync } from 'node:child_process'
import { chmodSync, chownSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CLOUDFLARED_USER, CONFIG_DIR, droppedDoors, ingressYaml, matchedRule, parseInputs, probes, rules, tunnelIdOf } from './ingress.mjs'

/** Readable by its owner alone: the credentials hold the tunnel's secret, and the configuration says where it is. */
const MODE = 0o400

/** `path` made cloudflared's own and readable by it alone. `owner` null leaves the owner as it is (a test, not as root). */
export function protect(path, owner) {
  chmodSync(path, MODE)
  if (owner !== null) chownSync(path, owner.uid, owner.gid)
}

/** What `cloudflared tunnel --config <config> ingress rule <url>` says for each URL: `[{ url, rule }]`, `rule` undefined with `said` when it named none. */
export function matchAll(cloudflared, config, urls) {
  return urls.map((url) => {
    const result = spawnSync(cloudflared, ['tunnel', '--config', config, 'ingress', 'rule', url], { encoding: 'utf8' })
    try {
      return { url, rule: matchedRule(result.stdout) }
    } catch {
      return { url, rule: undefined, said: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n')[0] ?? '' }
    }
  })
}

/**
 * Writes `dir`/config.yml for `inputs`, or explains why not. Returns `{ ok,
 * lines }`: what to print, success or not. `cloudflared` is the binary to
 * ask; `owner` the user that runs it.
 */
export function configure({ inputs, doors, dir = CONFIG_DIR, cloudflared = 'cloudflared', owner = CLOUDFLARED_USER }) {
  const credentials = join(dir, 'credentials.json')
  const config = join(dir, 'config.yml')
  const next = join(dir, 'config.yml.new')
  if (!existsSync(credentials)) {
    return { ok: false, lines: [`${credentials} does not exist, so there is no tunnel to configure: run tunnel-setup, which creates it.`] }
  }
  let id
  try {
    id = tunnelIdOf(readFileSync(credentials, 'utf8'))
  } catch (error) {
    return { ok: false, lines: [error.message] }
  }
  protect(credentials, owner)
  const dropped = existsSync(config)
    ? droppedDoors(readFileSync(config, 'utf8'), doors, inputs)
    : inputs.drop === undefined
      ? []
      : [`--drop ${inputs.drop} removes no door: there is no configuration in use yet.`]
  if (dropped.length > 0) return { ok: false, lines: [...dropped, `${config} was left as it was.`] }

  rmSync(next, { force: true })
  writeFileSync(next, ingressYaml(doors, inputs, id), 'utf8')
  protect(next, owner)
  const refuse = (sentences) => {
    rmSync(next, { force: true })
    return { ok: false, lines: [...sentences, existsSync(config) ? `${config} was left as it was.` : `Nothing was written to ${config}.`] }
  }

  const version = spawnSync(cloudflared, ['--version'], { encoding: 'utf8' })
  const validate = spawnSync(cloudflared, ['tunnel', '--config', next, 'ingress', 'validate'], { encoding: 'utf8' })
  if (validate.status !== 0 || !/^OK$/m.test(validate.stdout ?? '')) {
    return refuse([`cloudflared refused the configuration it would run: ${`${validate.stdout ?? ''}${validate.stderr ?? ''}`.trim()}`])
  }
  const expected = probes(doors, inputs)
  const answers = matchAll(
    cloudflared,
    next,
    expected.map((probe) => probe.url),
  )
  const wrong = expected.flatMap((probe, index) => {
    const { rule, said } = answers[index]
    if (rule === probe.rule) return []
    return [
      `${probe.url} matched ${rule === undefined ? `no rule (${String(said)})` : `rule #${String(rule)}`} under cloudflared, where it must match rule #${String(probe.rule)}: ${probe.why}.`,
    ]
  })
  if (wrong.length > 0)
    return refuse(['cloudflared reads the configuration differently from what deploy/cloudflare/doors.json says, so it was not used:', ...wrong])

  renameSync(next, config)
  const order = rules(inputs)
  return {
    ok: true,
    lines: [
      `${(version.stdout ?? '').trim() || 'cloudflared'} says the configuration is valid, and matched all ${String(expected.length)} probes to the rules doors.json gives:`,
      `  rule #${String(order.administrator)}: ${inputs.admin}, everything, behind Access for team ${inputs.team}`,
      ...(inputs.app === undefined ? [] : [`  rule #${String(order.runtime)}: ${inputs.app}, the runtime plane's routes only`]),
      ...(inputs.appService === undefined ? [] : [`  rule #${String(order['app-service'])}: ${inputs.app}, every other path, to ${inputs.appService}`]),
      `  rule #${String(order['catch-all'])}: everything else, answered 404 by cloudflared`,
      `Wrote ${config} for tunnel ${id}. A running cloudflared reads it when it starts: start it again, and wait until it is connected, with`,
      '  docker compose -f compose.yaml -f deploy/cloudflare/compose.yaml --profile stack --profile cloudflare up -d --wait --no-deps --force-recreate cloudflared',
    ],
  }
}

/** doors.json, from beside this file: in the tools image, the copy the overlay mounts from the checkout. */
export const readDoors = () => JSON.parse(readFileSync(new URL('./doors.json', import.meta.url), 'utf8'))

if (process.argv[1]?.replaceAll('\\', '/').endsWith('deploy/cloudflare/configure.mjs')) {
  const parsed = parseInputs(process.argv.slice(2), 'setup')
  if (!parsed.ok) {
    console.error(parsed.problems.join('\n'))
    process.exitCode = 1
  } else {
    const result = configure({ inputs: parsed.inputs, doors: readDoors() })
    ;(result.ok ? console.log : console.error)(result.lines.join('\n'))
    process.exitCode = result.ok ? 0 : 1
  }
}
