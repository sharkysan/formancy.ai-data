// `tunnel-setup`: creates the locally-managed tunnel, routes its hostnames
// and writes its configuration (0037).
//
//   docker compose -f compose.yaml -f deploy/cloudflare/compose.yaml run --rm tunnel-setup --admin formancy.example.com --team example-team --aud <tag> [--app <host> [--app-service <url>]] [--drop <host>]
//
// 1. Every input is checked before anything else (ingress.mjs), and a
//    refusal does nothing; so are arguments that would close a door the
//    configuration in use opens, unless --drop names its hostname.
// 2. `cloudflared tunnel login` prints a URL; the operator opens it in any
//    browser and chooses the zone. Its cert.pem -- an account-wide token that
//    can create, delete and manage every tunnel of the account, valid until
//    revoked -- is written under HOME, which the overlay makes a tmpfs, so it
//    goes with this container, when cloudflared fetches it. When it cannot,
//    cloudflared says the browser will download it instead, and setup says
//    to delete that file and revoke its token.
// 3. The tunnel `formancy-data` is created, unless the volume already holds
//    its credentials, which are made cloudflared's own and readable by it
//    alone.
// 4. While the login lasts, the account's private network routes to the
//    tunnel are listed: one would let enrolled devices reach whatever
//    cloudflared reaches, and no setting of cloudflared turns that off, so
//    setup stops. When cloudflared cannot list them, setup says so and goes
//    on. Nothing checks for a route added later.
// 5. Each hostname the volume's configuration does not route yet is routed
//    in DNS. Never with --overwrite-dns: an existing record stops setup.
// 6. configure.mjs writes and checks the configuration, with no further call
//    to Cloudflare.
// 7. It prints what it did, and how to revoke the login's token, which
//    nothing here can do and nothing checks.
//
// The tunnel's secret is never printed: setup reads only the id. Node's
// built-ins only. scripts/cloudflare/setup.test.mjs holds the order and every
// stop against a stand-in for cloudflared's answers; nothing can run it
// against an account in CI, and the guide lists what an operator's first
// run shows that nothing has measured.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { configure, protect, readDoors } from './configure.mjs'
import { CLOUDFLARED_USER, CONFIG_DIR, droppedDoors, parseInputs, TUNNEL_NAME, tunnelIdOf } from './ingress.mjs'

/** The hostnames the volume's configuration already routes, from the lines configure writes. */
export function routedHostnames(configText) {
  return [...new Set([...configText.matchAll(/^ {2}- hostname: (\S+)$/gm)].map((match) => match[1]))]
}

/** `text` with the secret replaced, should cloudflared ever print it. */
const withoutSecret = (text, secret) => (secret === undefined || secret === '' ? text : text.replaceAll(secret, '[the tunnel secret]'))

/**
 * Setup, step by step. `print` and `report` take a line each, for standard
 * output and standard error; `interactive` runs the login with the
 * terminal attached, so its URL reaches the operator as it is printed.
 * Returns the exit code.
 */
export function setup({ argv, doors = readDoors(), dir = CONFIG_DIR, cloudflared = 'cloudflared', owner = CLOUDFLARED_USER, print = console.log, report = console.error, interactive = true }) {
  const parsed = parseInputs(argv, 'setup')
  if (!parsed.ok) {
    for (const problem of parsed.problems) report(problem)
    report('Nothing was done.')
    return 1
  }
  const { inputs } = parsed
  const run = (args) => spawnSync(cloudflared, args, { encoding: 'utf8' })
  const credentials = join(dir, 'credentials.json')
  const config = join(dir, 'config.yml')

  // Before the login: a door these arguments would close is refused by
  // configure at the end, and a login made for nothing is a token to revoke.
  const dropped = existsSync(config) ? droppedDoors(readFileSync(config, 'utf8'), doors, inputs) : []
  if (dropped.length > 0) {
    for (const problem of dropped) report(problem)
    report('Nothing was done.')
    return 1
  }

  const zone = inputs.app === undefined ? `the zone that holds ${inputs.admin}` : `the zone that holds ${inputs.admin} and ${inputs.app}; both must be in that one zone, where setup routes them`
  print(`Log cloudflared in to your Cloudflare account: open the URL it prints in any browser, and choose ${zone}.`)
  const login = spawnSync(cloudflared, ['tunnel', 'login'], interactive ? { stdio: 'inherit' } : { encoding: 'utf8' })
  if (!interactive) for (const line of `${login.stdout ?? ''}${login.stderr ?? ''}`.trim().split('\n')) if (line !== '') print(line)
  if (login.status !== 0) {
    report(
      "cloudflared could not log in, as it says above, so no tunnel was created. If your browser downloaded a cert.pem, delete it and revoke its token (My Profile → API Tokens → 'Cloudflare Tunnel API Token' → Delete): it can manage every tunnel of the account, and setup cannot use it. Then run setup again; the login lasts only as long as this container.",
    )
    return 1
  }

  let secret
  if (existsSync(credentials)) {
    print(`${credentials} is already there: the tunnel is not created again.`)
  } else {
    const created = run(['tunnel', 'create', '--credentials-file', credentials, TUNNEL_NAME])
    secret = existsSync(credentials) ? safeSecret(readFileSync(credentials, 'utf8')) : undefined
    const said = withoutSecret(`${created.stdout ?? ''}${created.stderr ?? ''}`, secret).trim()
    if (created.status !== 0 || !existsSync(credentials)) {
      if (said !== '') report(said)
      report(`cloudflared could not create the tunnel ${TUNNEL_NAME}, as it says above. If a tunnel by that name already exists in this account without its credentials in this volume, delete it under Networking → Tunnels and run setup again.`)
      return 1
    }
    if (said !== '') print(said)
    protect(credentials, owner)
  }
  let id
  try {
    const text = readFileSync(credentials, 'utf8')
    id = tunnelIdOf(text)
    secret ??= safeSecret(text)
  } catch (error) {
    report(error.message)
    return 1
  }

  const routes = privateRoutes(run(['tunnel', 'route', 'ip', 'show', '--filter-tunnel-id', id, '--output', 'json']), id)
  if (routes === undefined) {
    print(`cloudflared could not list the account's private network routes, so setup could not tell whether a private network route sends traffic to the tunnel ${TUNNEL_NAME}. A tunnel setup has just created has none; nothing else checks it: look under Networking → Routes.`)
  } else if (routes.length > 0) {
    report(
      `${String(routes.length)} private network route${routes.length === 1 ? ' sends' : 's send'} traffic to the tunnel ${TUNNEL_NAME} (${routes.join(', ')}): every device your organisation lets reach ${routes.length === 1 ? 'it' : 'them'} reaches what cloudflared reaches, the web front without Access among it, and no setting of cloudflared stops that. Delete ${routes.length === 1 ? 'it' : 'them'} under Networking → Routes, then run setup again. No hostname was routed.`,
    )
    return 1
  }

  const routed = existsSync(config) ? routedHostnames(readFileSync(config, 'utf8')) : []
  const hostnames = [inputs.admin, ...(inputs.app === undefined ? [] : [inputs.app])]
  const newlyRouted = []
  for (const host of hostnames.filter((name) => !routed.includes(name))) {
    const answer = run(['tunnel', 'route', 'dns', id, host])
    const said = withoutSecret(`${answer.stdout ?? ''}${answer.stderr ?? ''}`, secret).trim()
    if (answer.status !== 0) {
      if (said !== '') report(said)
      report(
        `cloudflared could not route ${host} to the tunnel, as it says above. If the zone already has a DNS record for ${host}, delete it or choose another hostname, then run setup again: setup never overwrites a record.${newlyRouted.length === 0 ? '' : ` ${newlyRouted.join(' and ')} ${newlyRouted.length === 1 ? 'was' : 'were'} routed by this run and stay${newlyRouted.length === 1 ? 's' : ''} routed.`}`,
      )
      return 1
    }
    newlyRouted.push(host)
  }

  const result = configure({ inputs, doors, dir, cloudflared, owner })
  for (const line of result.lines) (result.ok ? print : report)(line)
  if (!result.ok) return 1

  print('')
  print(`Tunnel ${TUNNEL_NAME}, id ${id}. ${newlyRouted.length === 0 ? 'No hostname needed routing.' : `Routed in DNS by this run: ${newlyRouted.join(', ')}.`}`)
  print("Revoke the login now: My Profile → API Tokens → 'Cloudflare Tunnel API Token' (or 'Argo Tunnel API Token') → Delete. Its cert.pem was only in this container's memory, and the running tunnel needs only its credentials.")
  print('Then start the stack with cloudflared:')
  print('  docker compose -f compose.yaml -f deploy/cloudflare/compose.yaml --profile stack --profile cloudflare up -d --build --wait --wait-timeout 900')
  print('or, if cloudflared is running, start it again on this configuration and wait until it is connected:')
  print('  docker compose -f compose.yaml -f deploy/cloudflare/compose.yaml --profile stack --profile cloudflare up -d --wait --no-deps --force-recreate cloudflared')
  return 0
}

/**
 * The networks of the private network routes `answer` (`route ip show
 * --filter-tunnel-id <id> --output json`, as spawnSync returns it) lists
 * for the tunnel `id`, or undefined when cloudflared failed or printed what
 * this does not read. The shape is read from cloudflared 2026.10.0's source
 * -- a JSON list of routes with `network` and `tunnel_id`, `null` when there
 * is none -- not seen from an account.
 */
export function privateRoutes(answer, id) {
  if (answer.status !== 0) return undefined
  let parsed
  try {
    parsed = JSON.parse(answer.stdout ?? '')
  } catch {
    return undefined
  }
  if (parsed === null) return []
  if (!Array.isArray(parsed)) return undefined
  return parsed.filter((route) => route?.tunnel_id === id).map((route) => String(route.network))
}

/** The credentials' secret, to keep it out of anything printed; undefined when the file does not hold one. */
function safeSecret(text) {
  try {
    const secret = JSON.parse(text)?.TunnelSecret
    return typeof secret === 'string' ? secret : undefined
  } catch {
    return undefined
  }
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('deploy/cloudflare/setup.mjs')) {
  process.exitCode = setup({ argv: process.argv.slice(2) })
}
