import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import YAML from 'yaml'
import {
  CLIMBS,
  hostilePaths,
  ingressYaml,
  matchedRule,
  MEASURED,
  parseInputs,
  probes,
  rules,
  SERVICES,
  STATIC_FILES,
  staticClimbs,
  tunnelIdOf,
} from '../../deploy/cloudflare/ingress.mjs'
import { staticLocations } from './gate.mjs'

/**
 * deploy/cloudflare/ingress.mjs, the tunnel's configuration as data (0037):
 * the operator's inputs refused before anything is done, the configuration
 * file's meaning read back with a YAML parser rather than by its wording, the
 * probes configure asks cloudflared about, and the hostile paths the CI gate
 * sends through cloudflared and the built server. What cloudflared itself
 * makes of all this is the CI job `cloudflare`'s to show, against the
 * binary; here, without Docker, is what this module says.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const doors = JSON.parse(readFileSync(join(repo, 'deploy', 'cloudflare', 'doors.json'), 'utf8'))
const AUD = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const ID = '6ff42ae2-765d-4adf-8112-31c55c1551ef'
const base = ['--admin', 'formancy.example.com', '--team', 'example-team', '--aud', AUD]
const inputs = { admin: 'formancy.example.com', team: 'example-team', aud: AUD }

describe('the inputs', () => {
  // A wrong input caught after the login and the tunnel's creation leaves
  // the account half set up; caught here, nothing is done. Each refusal
  // says what was wrong in a sentence an operator acts on.
  test.each([
    ['an upper-case hostname, which cloudflared would match to no rule', ['--admin', 'Formancy.example.com'], /has upper-case letters/],
    ['a URL where a hostname goes', ['--admin', 'https://formancy.example.com'], /is a URL; give the hostname alone/],
    ['a path, which a door cannot be', ['--admin', 'formancy.example.com/studio'], /holds a path/],
    ['a name that is no DNS name', ['--admin', 'formancy'], /is not a DNS name/],
    ['an AUD tag one character short', ['--aud', AUD.slice(1)], /64 lower-case hexadecimal/],
    ['an AUD tag in upper case', ['--aud', AUD.toUpperCase()], /64 lower-case hexadecimal/],
    ['a team name with a dot', ['--team', 'example.team'], /Zero Trust team name/],
    ['the runtime door on the administrator’s hostname, which would open it', ['--app', 'formancy.example.com'], /same hostname as --admin/],
    ['an app service with a path', ['--app', 'app.example.com', '--app-service', 'http://hostapp:3000/x'], /--app-service must be/],
    ['an app service with credentials', ['--app', 'app.example.com', '--app-service', 'http://user:pw@hostapp:3000'], /--app-service must be/],
    ['an app service without its hostname', ['--app-service', 'http://hostapp:3000'], /--app-service needs --app/],
    ['an option nobody reads', ['--hostname', 'x'], /--hostname is not an option here/],
    ['an option without its value', ['--app'], /--app needs a value/],
  ])('refuses %s', (_, change, sentence) => {
    const argv = [...base]
    for (let index = 0; index < change.length; index += 2) {
      const at = argv.indexOf(change[index])
      if (at === -1) argv.push(...change.slice(index, index + 2))
      else argv[at + 1] = change[index + 1]
    }
    const parsed = parseInputs(argv.filter((value) => value !== undefined))
    expect(parsed.ok).toBe(false)
    expect(parsed.problems.join('\n')).toMatch(sentence)
  })

  // One run names every problem, so an operator fixes the command once.
  test('names every problem at once, and asks for what is missing', () => {
    const parsed = parseInputs(['--admin', 'X.example.com', '--team', 'a.b'])
    expect(parsed.problems).toHaveLength(3)
    expect(parsed.problems.join('\n')).toMatch(/--aud is required/)
  })

  // doors-check is handed names, never what opens a door: an AUD tag or a
  // service there would be a credential-shaped argument with no use.
  test('takes hostnames and the team for the check, and nothing else', () => {
    expect(parseInputs(['--admin', 'formancy.example.com', '--team', 'example-team', '--app', 'app.example.com'], 'check')).toEqual({
      ok: true,
      inputs: { admin: 'formancy.example.com', team: 'example-team', app: 'app.example.com' },
    })
    expect(parseInputs([...base], 'check').problems.join('\n')).toMatch(/--aud is not an option here/)
  })

  // The checks above refuse; this one admits. A check that refused the
  // guide's own example -- a host application with its service -- would stop
  // every operator at the guide's first command, and the refusals above would
  // still pass.
  test('accepts the guide’s example', () => {
    expect(parseInputs([...base, '--app', 'app.example.com', '--app-service', 'http://hostapp:3000'])).toEqual({
      ok: true,
      inputs: { ...inputs, app: 'app.example.com', appService: 'http://hostapp:3000' },
    })
  })
})

describe('the configuration file', () => {
  const read = (extra) => YAML.parse(ingressYaml(doors, { ...inputs, ...extra }, ID))

  // The administrator's door is Access or it is open to the internet: the
  // studio and every administrator route behind nothing but a host token.
  // cloudflared's own `ingress validate` says OK without these keys
  // (measured), so this is what holds them.
  test('puts Access, with the team and the AUD tag, on the administrator’s door', () => {
    const config = read({})
    expect(config.tunnel).toBe(ID)
    expect(config['credentials-file']).toBe('/etc/formancy-cloudflare/credentials.json')
    expect(config.ingress[0]).toEqual({
      hostname: 'formancy.example.com',
      service: 'http://web:8080',
      originRequest: { access: { required: true, teamName: 'example-team', audTag: [AUD] } },
    })
  })

  // Without --app there is no runtime door: one rule that forwarded the
  // runtime pattern on the administrator's hostname would bypass Access.
  test('has no runtime door without --app, and the catch-all last', () => {
    expect(read({}).ingress).toEqual([expect.objectContaining({ hostname: 'formancy.example.com' }), { service: 'http_status:404' }])
  })

  // The runtime door's path is doors.json's pattern, generated from the
  // router, and nothing typed; it goes to the web front's runtime server,
  // 8081, never to 8080, whose locations serve the studio's and the host
  // page's files to a path nginx and cloudflared read differently; a host
  // application's own service, when given, takes the rest of its hostname
  // after it, never before.
  test('forwards the runtime pattern on the app’s hostname to the web front’s runtime server, then its own service, then 404', () => {
    const config = read({ app: 'app.example.com', appService: 'http://hostapp:3000' })
    expect(config.ingress.slice(1)).toEqual([
      { hostname: 'app.example.com', path: doors.runtimePattern, service: 'http://web:8081' },
      { hostname: 'app.example.com', service: 'http://hostapp:3000' },
      { service: 'http_status:404' },
    ])
    expect(rules({ ...inputs, app: 'app.example.com', appService: 'http://hostapp:3000' })).toEqual({
      administrator: 0,
      runtime: 1,
      'app-service': 2,
      'catch-all': 3,
    })
  })

  // A team or a tag of digits alone would be a YAML number.
  test('keeps a team name and an AUD tag of digits alone strings', () => {
    const config = YAML.parse(ingressYaml(doors, { ...inputs, team: '123', aud: '1'.repeat(64) }, ID))
    expect(config.ingress[0].originRequest.access).toEqual({ required: true, teamName: '123', audTag: ['1'.repeat(64)] })
  })

  // The id is the one thing read from the credentials; their secret is never
  // handed on, and an id that is not one cannot write YAML of its own.
  test('takes the tunnel’s id from its credentials, and nothing that is not an id', () => {
    expect(tunnelIdOf(JSON.stringify({ AccountTag: 'a', TunnelSecret: 'c2VjcmV0', TunnelID: ID }))).toBe(ID)
    expect(() => tunnelIdOf(JSON.stringify({ TunnelID: `${ID}\nservice: x` }))).toThrow(/names no tunnel id/)
    expect(() => tunnelIdOf('not json')).toThrow(/is not JSON/)
    expect(() => ingressYaml(doors, inputs, 'x')).toThrow(/is not a tunnel id/)
  })
})

describe('the probes', () => {
  const urls = (list) => list.map((probe) => probe.url)

  // configure refuses a configuration cloudflared matches differently from
  // these; a probe left out is a door nobody asked about.
  test('ask about every route’s sample on both doors, the pages, a trailing slash, a query string and a stranger', () => {
    const app = { ...inputs, app: 'app.example.com' }
    const list = probes(doors, app)
    for (const route of doors.routes) {
      expect(list).toContainEqual(expect.objectContaining({ url: `https://formancy.example.com${route.sample}`, rule: 0 }))
      expect(list).toContainEqual(expect.objectContaining({ url: `https://app.example.com${route.sample}`, rule: route.plane === 'runtime' ? 1 : 2 }))
    }
    expect(urls(list)).toEqual(
      expect.arrayContaining([
        'https://app.example.com/studio/',
        'https://app.example.com/host/',
        'https://app.example.com/health',
        'https://app.example.com/v1/whoami',
      ]),
    )
    expect(list).toContainEqual(expect.objectContaining({ url: 'https://app.example.com/v1/forms/order/', rule: 2 }))
    expect(list).toContainEqual(expect.objectContaining({ url: 'https://app.example.com/v1/forms/order?next=/v1/connections', rule: 1 }))
    expect(list).toContainEqual(expect.objectContaining({ url: 'https://not-a-door.formancy.example.com/v1/whoami', rule: 2 }))
    expect(new Set(urls(list)).size).toBe(list.length)
  })

  // With the host application's own service, everything but the runtime
  // routes on its hostname goes there, and the catch-all moves down one.
  test('send the rest of the app’s hostname to its own service when there is one', () => {
    const list = probes(doors, { ...inputs, app: 'app.example.com', appService: 'http://hostapp:3000' })
    expect(list).toContainEqual(expect.objectContaining({ url: 'https://app.example.com/v1/connections', rule: 2 }))
    expect(list).toContainEqual(expect.objectContaining({ url: 'https://not-a-door.formancy.example.com/v1/whoami', rule: 3 }))
  })

  // cloudflared prints the rule it matched as `Matched rule #N`; an answer
  // without one is no match, never rule 0.
  test('read the rule from cloudflared’s answer, and refuse an answer without one', () => {
    expect(matchedRule('Using rules from x.yml\nMatched rule #1\n\thostname: app.example.com\n')).toBe(1)
    expect(() => matchedRule('error parsing ingress rules\n')).toThrow(/named no rule/)
  })
})

/** What cloudflared 2026.10.0 was measured doing before it matches: each segment decoded, a backslash a slash, `.` and `..` resolved, empty segments dropped. */
function asCloudflaredReadsIt(path) {
  const decoded = path
    .split('/')
    .map((segment) => decodeURIComponent(segment))
    .join('/')
    .replaceAll('\\', '/')
  const out = []
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') out.pop()
    else out.push(segment)
  }
  return `/${out.join('/')}`
}

describe('the hostile paths', () => {
  const list = hostilePaths(doors)
  const routes = new Map(doors.routes.map((route) => [`${route.method} ${route.path}`, route]))
  const runtimePath = new RegExp(doors.runtimePattern)

  // Each derived path is one the router runs the named route for -- as many
  // segments as its template, the parameter one of them -- and one a proxy
  // that decodes and resolves reads as a runtime route: the disagreement the
  // server's path-not-plain refusal exists for. A climb that resolved
  // elsewhere would test nothing.
  test('climb from each parameter to a runtime route, in one segment the router reads as the parameter', () => {
    const derived = list.filter((entry) => entry.route !== null)
    expect(derived.length).toBeGreaterThan(0)
    for (const entry of derived) {
      const route = routes.get(entry.route)
      expect(route?.plane, entry.path).not.toBe('runtime')
      expect(entry.path.split('/').length, entry.path).toBe(route.path.split('/').length)
      expect(asCloudflaredReadsIt(entry.path), entry.path).toMatch(runtimePath)
    }
    expect(new Set(derived.map((entry) => entry.climb))).toEqual(new Set(CLIMBS.map((climb) => climb.name)))
  })

  // Every administrator route with a parameter is climbed from, unless what
  // follows its parameter ends no runtime route: nothing cloudflared
  // resolves removes a segment after the parameter, so such a route cannot
  // be reached through the runtime door at all. Named, so a new route of
  // that kind is seen.
  test('reach every administrator route with a parameter but the one whose tail no runtime route ends in', () => {
    const withParameter = doors.routes.filter((route) => route.plane !== 'runtime' && route.path.includes('/:')).map((route) => `${route.method} ${route.path}`)
    const climbed = new Set(list.map((entry) => entry.route))
    expect(withParameter.filter((route) => !climbed.has(route))).toEqual(['GET /v1/forms/:id/versions/latest'])
  })

  // The measured paths stay in, whatever the derivation does.
  test('hold every path measured', () => {
    for (const entry of MEASURED) expect(list).toContainEqual(entry)
  })
})

/**
 * How nginx on Linux reads a path to choose a location: decoded, `%2F`
 * included, then its dot segments resolved and its slashes merged, with a
 * backslash an ordinary character (nginx's documentation, and the 200s for
 * the studio's page measured on 2026-10-11, which the CI gate repeats).
 */
function asNginxReadsIt(path) {
  const out = []
  for (const segment of decodeURIComponent(path).split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') out.pop()
    else out.push(segment)
  }
  return `/${out.join('/')}`
}

describe('the climbs out of the web front’s file locations', () => {
  const conf = readFileSync(join(repo, 'deploy', 'web', 'nginx.conf'), 'utf8')
  const statics = staticLocations(conf)
  const climbs = staticClimbs(doors, statics)
  const runtimePath = new RegExp(doors.runtimePattern)

  // The locations are read from nginx.conf, so one added there is climbed
  // out of without anybody listing it.
  test('start in every location of nginx.conf that serves files', () => {
    expect(statics).toEqual(['/studio/', '/host/'])
    expect(new Set(climbs.map((entry) => entry.route))).toEqual(new Set(statics.map((location) => `the web front's ${location}`)))
  })

  // Each is a runtime route to cloudflared, and to nginx either a file in
  // the location it climbed out of -- the backslash, which nginx keeps -- or
  // a path under /v1/, which reaches the server as sent: the disagreement
  // the runtime door's server in nginx.conf, which serves no file, exists
  // for. A climb nginx and cloudflared read alike would test nothing.
  test('are a runtime route to cloudflared and a file, or the server, to nginx', () => {
    expect(climbs.length).toBeGreaterThan(0)
    for (const entry of climbs) {
      expect(asCloudflaredReadsIt(entry.path), entry.path).toMatch(runtimePath)
      const location = statics.find((prefix) => entry.route.endsWith(prefix))
      const nginx = asNginxReadsIt(entry.path)
      if (entry.climb.startsWith('%2F')) expect(nginx, entry.path).toMatch(/^\/v1\/forms\//)
      else
        expect(
          Object.values(STATIC_FILES).map((file) => `${location}${file}`),
          entry.path,
        ).toContain(nginx)
    }
    expect(hostilePaths(doors, { statics })).toEqual(expect.arrayContaining(climbs))
  })

  // What the runtime rule names: the web front's server for the runtime
  // door, which must exist, serve no file and pass every runtime route to
  // the server. 8080's locations serve files; a rule that named it again
  // would put the studio's page behind a path nginx resolves into /studio/.
  // Each runtime route's sample meets the location nginx chooses for it --
  // an exact one first, then the longest prefix -- and that location
  // passes it on. `/v1/forms`, the menu (0045), is no path below the
  // `/v1/forms/` prefix: with no location of its own this model gives it
  // to `/`, and nginx in fact answered it with its own 301 to `/v1/forms/`
  // (measured with this file in the web front's nginx, 2026-10-11). Watched
  // failing with that exact location removed: "/v1/forms".
  test('meet, on the runtime rule’s port, an nginx server that serves no file and passes every runtime route on', () => {
    const port = Number(/:(\d+)$/.exec(SERVICES.runtime)?.[1])
    const servers = conf.split(/^server \{$/m).slice(1)
    const runtime = servers.filter((block) => new RegExp(`^\\s*listen ${String(port)};`, 'm').test(block))
    expect(runtime).toHaveLength(1)
    expect(runtime[0]).not.toMatch(/^\s*(alias|root)\s/m)
    const locations = [...runtime[0].matchAll(/^\s*location\s+(=\s+)?(\S+)\s*\{([^}]*)\}/gm)].map(([, exact, path, body]) => ({
      exact: exact !== undefined,
      path,
      passed: /^\s*proxy_pass\s+http:\/\/server:4390;$/m.test(body),
    }))
    const chosen = (path) =>
      locations.find((entry) => entry.exact && entry.path === path) ??
      locations.filter((entry) => !entry.exact && path.startsWith(entry.path)).sort((a, b) => b.path.length - a.path.length)[0]
    for (const route of doors.routes.filter((entry) => entry.plane === 'runtime')) expect(chosen(route.sample)?.passed, route.sample).toBe(true)
    // And nothing else: every other path is nginx's own 404.
    expect(locations).toEqual([
      { exact: true, path: '/v1/forms', passed: true },
      { exact: false, path: '/v1/forms/', passed: true },
      { exact: false, path: '/', passed: false },
    ])
  })
})
