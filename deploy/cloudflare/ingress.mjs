// The tunnel's configuration, as data (0037).
//
// What setup.mjs and configure.mjs write into the tunnel's volume, and what
// the cloudflared binary that runs it must say of it before it is used, are
// both derived here from deploy/cloudflare/doors.json -- the routes the
// built data server registers, which scripts/cloudflare/doors.mjs writes --
// and the operator's four inputs. Nothing security-relevant is typed by
// hand: the runtime door's path pattern, and Access on the administrator's
// door with its team and AUD tag, are rendered here, and a rendering that
// cloudflared reads differently fails configure before anything runs it.
//
// Pure and on Node's built-ins only: the tools image runs it with nothing
// installed, and scripts/cloudflare/ingress.test.mjs holds it without Docker.

/** Where the tunnel's volume is mounted, in the tools and in cloudflared. */
export const CONFIG_DIR = '/etc/formancy-cloudflare'
export const CREDENTIALS = `${CONFIG_DIR}/credentials.json`
export const CONFIG = `${CONFIG_DIR}/config.yml`
/**
 * The service each door's rule names. Both go through nginx, never straight
 * to the server: its body limit, its headers and 0032's rule that only `web`
 * reaches the server. The administrator's is the web front's origin, 8080,
 * with the studio, the host page and both planes; the runtime door's is the
 * server deploy/web/nginx.conf keeps for it, 8081, which serves no file and
 * forwards only /v1/forms and what is below it, so a path nginx resolves
 * differently from cloudflared reaches no file there.
 */
export const SERVICES = { administrator: 'http://web:8080', runtime: 'http://web:8081' }
export const TUNNEL_NAME = 'formancy-data'
/** The user the cloudflared image runs as (`docker image inspect`, 2026.10.0): it owns what it reads, and nobody else may read it. */
export const CLOUDFLARED_USER = { uid: 65532, gid: 65532 }

/**
 * A DNS name in lower case: labels of letters, digits and hyphens, at least
 * two of them. cloudflared 2026.10.0 matched `APP.example.com` to no rule
 * written `app.example.com` (measured), so a name is lower case here, as a
 * browser sends it.
 */
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/
/** A Zero Trust team name, as in `<team>.cloudflareaccess.com`. */
const TEAM = /^[a-z0-9-]+$/
/** An Access application's AUD tag, as the dashboard shows it. */
const AUD = /^[0-9a-f]{64}$/
/** A host application's own service on compose's network: a scheme, a host and an optional port, nothing else. */
const SERVICE = /^https?:\/\/[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?(?::[1-9][0-9]{0,4})?$/
/** A tunnel's id, as cloudflared writes it into the credentials file. */
const TUNNEL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** What each tool takes. doors-check takes names only: nothing it is given opens a door or holds a credential. */
const OPTIONS = { setup: ['--admin', '--team', '--aud', '--app', '--app-service', '--drop'], check: ['--admin', '--team', '--app'] }

/** Why a hostname is refused, or undefined when it is one. */
function hostProblem(flag, value) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return `${flag} ${value} is a URL; give the hostname alone, such as formancy.example.com.`
  if (/[/?#]/.test(value)) return `${flag} ${value} holds a path; a door is a whole hostname, so give the hostname alone.`
  if (/[A-Z]/.test(value)) return `${flag} ${value} has upper-case letters; cloudflared matches a rule's hostname as written, and a browser sends it in lower case, so write it in lower case.`
  if (!HOST.test(value)) return `${flag} ${value} is not a DNS name: lower-case letters, digits and hyphens, in labels separated by dots, such as formancy.example.com.`
  return undefined
}

/**
 * The operator's inputs, checked before anything is done: `{ ok: true,
 * inputs }`, or `{ ok: false, problems }` with a sentence for every problem,
 * so one run names them all. `tool` is `setup` (setup and configure, which
 * write the configuration) or `check` (doors-check, which reads the doors).
 */
export function parseInputs(argv, tool = 'setup') {
  const allowed = OPTIONS[tool]
  const problems = []
  const given = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (!allowed.includes(flag)) {
      problems.push(`${String(flag)} is not an option here; the options are ${allowed.join(', ')}.`)
      continue
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      problems.push(`${flag} needs a value.`)
      continue
    }
    if (given[flag] !== undefined) problems.push(`${flag} is given twice.`)
    given[flag] = value
    index += 1
  }
  if (given['--admin'] === undefined) problems.push('--admin is required: the administrator’s hostname, such as formancy.example.com.')
  if (given['--team'] === undefined) problems.push('--team is required: your Zero Trust team name, as in <team>.cloudflareaccess.com.')
  if (tool === 'setup' && given['--aud'] === undefined) problems.push('--aud is required: the AUD tag of the Access application on the administrator’s hostname.')
  for (const flag of ['--admin', '--app', '--drop']) {
    if (given[flag] === undefined) continue
    const problem = hostProblem(flag, given[flag])
    if (problem !== undefined) problems.push(problem)
  }
  if (given['--team'] !== undefined && !TEAM.test(given['--team'])) {
    problems.push('--team must be your Zero Trust team name: lower-case letters, digits and hyphens only, as in <team>.cloudflareaccess.com.')
  }
  if (given['--aud'] !== undefined && !AUD.test(given['--aud'])) {
    problems.push('--aud must be the Access application’s AUD tag: 64 lower-case hexadecimal characters, from the application’s Additional settings.')
  }
  if (given['--app'] !== undefined && given['--app'] === given['--admin']) {
    problems.push('--app is the same hostname as --admin; the runtime door needs a hostname of its own, since it has no Access in front of it.')
  }
  if (given['--app-service'] !== undefined) {
    if (given['--app'] === undefined) problems.push('--app-service needs --app: it names the service that answers the rest of that hostname.')
    if (!SERVICE.test(given['--app-service'])) {
      problems.push('--app-service must be http://host:port or https://host:port, the host application’s own service on compose’s network, with no path, query or credentials.')
    }
  }
  if (problems.length > 0) return { ok: false, problems }
  return {
    ok: true,
    inputs: {
      admin: given['--admin'],
      team: given['--team'],
      ...(given['--aud'] === undefined ? {} : { aud: given['--aud'] }),
      ...(given['--app'] === undefined ? {} : { app: given['--app'] }),
      ...(given['--app-service'] === undefined ? {} : { appService: given['--app-service'] }),
      ...(given['--drop'] === undefined ? {} : { drop: given['--drop'] }),
    },
  }
}

/**
 * The doors a configuration opens, read from the lines ingressYaml writes:
 * `[{ hostname, door }]`, `door` being `administrator` (the rule with
 * Access), `runtime` (the rule with the path pattern) or `app-service` (the
 * rest of a host application's hostname, to its own service).
 */
export function doorsOf(configText) {
  const found = []
  let rule
  for (const line of configText.split('\n')) {
    const hostname = /^ {2}- hostname: (\S+)$/.exec(line)?.[1]
    if (hostname !== undefined) {
      rule = { hostname, path: false, access: false }
      found.push(rule)
    } else if (/^ {2}- /.test(line)) rule = undefined
    else if (rule !== undefined && /^ {4}path: /.test(line)) rule.path = true
    else if (rule !== undefined && /^ {6}access:$/.test(line)) rule.access = true
  }
  return found.map(({ hostname, path, access }) => ({ hostname, door: path ? 'runtime' : access ? 'administrator' : 'app-service' }))
}

const DOOR_SAYS = {
  administrator: (host) => `opens ${host} as the administrator’s door`,
  runtime: (host) => `forwards the runtime routes on ${host}`,
  'app-service': (host) => `sends every other path of ${host} to the host application’s own service`,
}

/**
 * Why `inputs` may not replace the configuration in use, `configText`: a
 * door it opens that `inputs` would not, unless `--drop` names that door's
 * hostname; or a `--drop` that removes nothing. Sentences, empty when
 * nothing is wrong. configure remembers no earlier argument, so without
 * this a rerun with fewer arguments -- the guide's command for one shape
 * followed on the other -- would close a door and say nothing.
 */
export function droppedDoors(configText, doors, inputs) {
  const before = doorsOf(configText)
  const after = doorsOf(ingressYaml(doors, inputs, '00000000-0000-0000-0000-000000000000')).map((entry) => `${entry.hostname} ${entry.door}`)
  const removed = before.filter((entry) => !after.includes(`${entry.hostname} ${entry.door}`))
  const problems = removed
    .filter((entry) => entry.hostname !== inputs.drop)
    .map((entry) => `The configuration in use ${DOOR_SAYS[entry.door](entry.hostname)}, and these arguments would not: give the arguments setup was given, or add --drop ${entry.hostname} to remove it.`)
  if (inputs.drop !== undefined && !removed.some((entry) => entry.hostname === inputs.drop)) {
    problems.push(`--drop ${inputs.drop} removes no door: the configuration in use opens none on it that these arguments leave out.`)
  }
  return problems
}

/**
 * The tunnel's rules in the order cloudflared tries them, each with its
 * index, which `ingress rule` prints as `Matched rule #N`, counting from 0.
 */
export function rules(inputs) {
  const order = ['administrator', ...(inputs.app === undefined ? [] : ['runtime']), ...(inputs.appService === undefined ? [] : ['app-service']), 'catch-all']
  return Object.fromEntries(order.map((name, index) => [name, index]))
}

/** The id in a credentials file's text, checked to be one; the file's secret is never read into anything returned. */
export function tunnelIdOf(credentialsText) {
  let parsed
  try {
    parsed = JSON.parse(credentialsText)
  } catch {
    throw new Error(`${CREDENTIALS} is not JSON, so it is no tunnel's credentials; run setup again.`)
  }
  const id = parsed?.TunnelID
  if (typeof id !== 'string' || !TUNNEL_ID.test(id)) throw new Error(`${CREDENTIALS} names no tunnel id cloudflared writes (TunnelID); run setup again.`)
  return id
}

/**
 * The configuration file cloudflared runs, as text. `doors` is doors.json;
 * every value in it was checked by `parseInputs` or `tunnelIdOf`, so none
 * can carry YAML of its own -- no quote, colon-space, `#` or newline -- and
 * the pattern is single-quoted and checked to hold no quote.
 */
export function ingressYaml(doors, inputs, tunnelId) {
  if (!TUNNEL_ID.test(tunnelId)) throw new Error(`${String(tunnelId)} is not a tunnel id`)
  const pattern = doors.runtimePattern
  if (typeof pattern !== 'string' || !pattern.startsWith('^') || !pattern.endsWith('$') || pattern.includes("'")) {
    throw new Error('doors.json’s runtimePattern is not an anchored pattern this file can write; run node scripts/cloudflare/doors.mjs --write')
  }
  const lines = [
    '# generated by deploy/cloudflare/configure.mjs from deploy/cloudflare/doors.json; do not edit',
    `tunnel: ${tunnelId}`,
    `credentials-file: ${CREDENTIALS}`,
    'ingress:',
    // The administrator's door: everything nginx serves, and cloudflared
    // refuses a request without a valid Access token for this application.
    `  - hostname: ${inputs.admin}`,
    `    service: ${SERVICES.administrator}`,
    '    originRequest:',
    '      access:',
    '        required: true',
    // Quoted: a team name or an AUD tag of digits alone would otherwise be
    // a YAML number. `ingress validate` does not read these keys at all
    // (measured: it says OK without them), so what cloudflared would do
    // with a number here is not known, and is not left to chance.
    `        teamName: '${inputs.team}'`,
    '        audTag:',
    `          - '${inputs.aud}'`,
  ]
  if (inputs.app !== undefined) {
    // The runtime door: the runtime plane's routes and no other path.
    lines.push(`  - hostname: ${inputs.app}`, `    path: '${pattern}'`, `    service: ${SERVICES.runtime}`)
  }
  if (inputs.appService !== undefined) lines.push(`  - hostname: ${inputs.app}`, `    service: ${inputs.appService}`)
  lines.push('  - service: http_status:404')
  return `${lines.join('\n')}\n`
}

/**
 * What `ingress rule` must say for each URL, under the configuration
 * `ingressYaml` writes for `inputs`: `[{ url, rule, why }]`. Every route's
 * sample on both doors, the pages and the root, a trailing slash, a query
 * string, and a hostname the tunnel does not serve.
 */
export function probes(doors, inputs) {
  const rule = rules(inputs)
  const found = new Map()
  const add = (host, path, expected, why) => {
    const url = `https://${host}${path}`
    if (!found.has(url)) found.set(url, { url, rule: expected, why })
  }
  const pages = ['/', '/studio/', '/host/', '/nothing']
  for (const route of doors.routes) add(inputs.admin, route.sample, rule.administrator, `${route.method} ${route.path} is behind Access`)
  for (const path of pages) add(inputs.admin, path, rule.administrator, 'everything on the administrator’s hostname is behind Access')
  if (inputs.app !== undefined) {
    const other = rule['app-service'] ?? rule['catch-all']
    const elsewhere = inputs.appService === undefined ? 'is answered 404 by cloudflared' : 'goes to the host application’s own service'
    for (const route of doors.routes) {
      if (route.plane === 'runtime') add(inputs.app, route.sample, rule.runtime, `${route.method} ${route.path} is the runtime plane’s`)
      else add(inputs.app, route.sample, other, `${route.method} ${route.path} is the ${route.plane} plane’s, and ${elsewhere}`)
    }
    for (const route of doors.routes.filter((entry) => entry.plane === 'runtime')) {
      add(inputs.app, `${route.sample}/`, other, `a trailing slash is no route, and ${elsewhere}`)
      add(inputs.app, `${route.sample}?next=/v1/connections`, rule.runtime, 'the query string is not matched')
    }
    for (const path of pages) add(inputs.app, path, other, `a page ${elsewhere}`)
  }
  add(`not-a-door.${inputs.admin}`, '/v1/whoami', rule['catch-all'], 'a hostname the tunnel does not serve is answered 404')
  return [...found.values()]
}

/** The rule number in `cloudflared tunnel ingress rule`'s output. Throws when it names none. */
export function matchedRule(output) {
  const match = /^Matched rule #(\d+)\s*$/m.exec(String(output))
  if (match === null) throw new Error(`cloudflared named no rule: ${String(output).trim().split('\n')[0] ?? ''}`)
  return Number(match[1])
}

/**
 * How a path parameter can hold a climb that the router reads as one
 * segment and cloudflared, which decodes and resolves before it matches,
 * reads as a walk up the path: the way `..` and `/` are written inside it.
 */
export const CLIMBS = [
  { name: '..%2F', up: '..', slash: '%2F' },
  { name: '%2E%2E%2F', up: '%2E%2E', slash: '%2F' },
  { name: '..%5C', up: '..', slash: '%5C' },
  { name: '..\\', up: '..', slash: '\\' },
]

/**
 * Paths cloudflared 2026.10.0 matched to the runtime door's rule on
 * 2026-10-09 and again on 2026-10-11, each with the method of the route
 * Fastify 5.12.5 ran for it or would: the measured list, kept beside the
 * derived one.
 */
export const MEASURED = [
  ['POST', '/v1/connections/..%2Fforms/test'],
  ['GET', '/v1/connections/..%2Fforms/metadata'],
  ['GET', '/v1/forms/x%2F../versions'],
  ['GET', '/v1/forms/a/versions/..%2F..%2Fb'],
  ['GET', '/v1/forms/a/versions/%2E%2E/%2E%2E/b'],
  ['GET', '/v1/forms/a/versions/..%5C..%5Cb'],
  ['GET', '/v1/forms/a/versions/..\\..\\b'],
  ['GET', '/v1/forms/x/../versions'],
  ['POST', '/v1/forms/a/./records/read'],
  ['POST', '/v1/forms/a//records/read'],
  ['GET', '/v1/forms/a%2Frecords%2Fread'],
  ['GET', '/v1/forms/a%252Fb'],
  ['GET', '//v1/forms/a'],
].map(([method, path]) => ({ method, path, route: null, climb: 'measured' }))

const segmentsOf = (path) => path.split('/').slice(1)

/** Whether a route's tail `template` (its segments, `:name` for a parameter) matches the path segments `values`. */
const tailMatches = (template, values) => template.length === values.length && template.every((segment, index) => segment.startsWith(':') || segment === values[index])

/**
 * Paths a proxy that decodes and resolves before it matches could send to
 * the runtime door while the router, reading them as sent, runs another
 * plane's route: for each administrator or shared route with a parameter,
 * each parameter filled with a climb (CLIMBS) to the root and down to a
 * runtime route, wherever the rest of the route after the parameter is that
 * runtime route's tail -- a literal equal, or a parameter of the runtime
 * route, as `/v1/connections/..%2Fforms/test` climbs to `/v1/forms/test`;
 * then the climbs out of the web front's file locations `statics`
 * (staticClimbs); then MEASURED. `[{ method, path, route, climb }]`, where
 * `route` is the route the parameter belongs to, or the location climbed
 * out of. A parameter followed by a tail no runtime route ends in has no
 * climb: cloudflared resolves before it matches, and nothing it resolves
 * removes a segment after the parameter.
 */
export function hostilePaths(doors, { statics = [] } = {}) {
  const runtime = doors.routes.filter((route) => route.plane === 'runtime').map((route) => ({ template: segmentsOf(route.path), sample: segmentsOf(route.sample) }))
  const found = new Map()
  for (const route of doors.routes.filter((entry) => entry.plane !== 'runtime')) {
    const template = segmentsOf(route.path)
    const sample = segmentsOf(route.sample)
    template.forEach((segment, position) => {
      if (!segment.startsWith(':')) return
      const before = sample.slice(0, position)
      const after = sample.slice(position + 1)
      for (const target of runtime) {
        const cut = target.template.length - after.length
        if (cut <= 0 || !tailMatches(target.template.slice(cut), after)) continue
        const head = target.sample.slice(0, cut)
        for (const climb of CLIMBS) {
          const value = [...before.map(() => climb.up), ...head].join(climb.slash)
          const path = `/${[...before, value, ...after].join('/')}`
          const key = `${route.method} ${path}`
          if (!found.has(key)) found.set(key, { method: route.method, path, route: `${route.method} ${route.path}`, climb: climb.name })
        }
      }
    })
  }
  for (const entry of [...staticClimbs(doors, statics), ...MEASURED]) if (!found.has(`${entry.method} ${entry.path}`)) found.set(`${entry.method} ${entry.path}`, entry)
  return [...found.values()]
}

/** The file each climb out of a location asks for, by how deep below the location it starts: what the gate's stand-in web front holds there. */
export const STATIC_FILES = { '': 'index.html', 'assets/': 'assets/index.js' }

/**
 * Paths that climb out of a location of the web front that serves files,
 * which cloudflared and nginx read differently: cloudflared counts a
 * backslash, raw or `%5C`, as a slash, and nginx on Linux keeps it as a
 * character. So in `/studio/..\v1\forms\Z/%2E%2E/index.html` nginx reads
 * one segment, `..\v1\forms\Z`, which the `..` after it removes, and serves
 * /studio/index.html; cloudflared reads /studio/../v1/forms/Z/../index.html,
 * which is /v1/forms/index.html, a runtime route (measured 2026-10-11).
 * For each of `statics` -- the prefixes of deploy/web/nginx.conf's
 * locations that serve files, such as `/studio/` -- and one directory
 * below it, where the apps' bundles are, each runtime route that ends in a
 * parameter is climbed to, the file landing in that parameter. `%2F` is
 * among the slashes too: nginx decodes it, so that path reaches the server.
 */
export function staticClimbs(doors, statics) {
  const targets = doors.routes.filter((route) => route.plane === 'runtime' && segmentsOf(route.path).at(-1).startsWith(':'))
  const found = []
  for (const location of statics) {
    for (const [below, file] of Object.entries(STATIC_FILES)) {
      const base = `${location}${below}`
      const depth = segmentsOf(base).filter((segment) => segment !== '').length
      for (const target of targets) {
        const head = segmentsOf(target.sample).slice(0, -1)
        for (const slash of ['%5C', '\\', '%2F']) {
          for (const up of ['%2E%2E', '..']) {
            const climb = [...Array.from({ length: depth }, () => '..'), ...head, 'Z'].join(slash)
            found.push({ method: 'GET', path: `${base}${climb}/${up}/${file.split('/').at(-1)}`, route: `the web front's ${location}`, climb: `${slash} out of ${base}` })
          }
        }
      }
    }
  }
  return found
}
