import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { stylesheetLinks } from './addresses.mjs'
import { contentSecurityPolicy, policyProblems, POLICY } from './demo-headers.mjs'
import {
  HOST_ALLOWED,
  mapValue,
  NGINX_CONF,
  nginxPolicyProblems,
  pagePolicy,
  parseNginx,
  policyMap,
  STUDIO_ALLOWED,
  WEB_PAGES,
  withPolicyMap,
} from './web-policies.mjs'

/**
 * The composed stack's pages under their Content-Security-Policy (0083):
 * each policy is 0069's with only its named allowances, holds exactly what
 * the built page loads, and is what deploy/web/nginx.conf sends that page.
 * What a browser refuses under it is the browser gates' to hold, and what
 * the web image's nginx sends the getting-started gate's.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...path) => readFileSync(join(repo, ...path), 'utf8').replaceAll('\r\n', '\n')
const conf = read(NGINX_CONF)

describe("the pages' policies (0083)", () => {
  // Each policy is 0069's with the sources its page was measured needing,
  // and nothing else: a second loosening is a change to the record, and
  // fails here first.
  test("are 0069's, the host page's with 'unsafe-inline' in style-src and the studio's with nothing more", () => {
    expect(Object.keys(WEB_PAGES)).toEqual(['/studio/', '/host/'])
    expect(STUDIO_ALLOWED).toEqual({})
    expect(HOST_ALLOWED).toEqual({ 'style-src': ["'unsafe-inline'"] })
    expect(WEB_PAGES['/studio/'].policy).toEqual(POLICY)
    expect(pagePolicy('/studio/')).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    )
    expect(pagePolicy('/host/')).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    )
    expect(() => pagePolicy('/examples/')).toThrow('no page of the web front is served at /examples/')
  })

  // The built page and the stylesheets it links, as the web image serves
  // them: the policy names exactly the hosts the page loads -- none but its
  // own -- allows data: images exactly because the page and its theme use
  // them, and refuses anything inline in index.html. Read from dist, so
  // `pnpm build` first, as for scripts/mint-token.test.mjs.
  test.each(Object.values(WEB_PAGES))(
    '$location holds exactly what its built page loads, with its named allowances and no other',
    ({ location, app, policy, allowed }) => {
      const dist = join(repo, app, 'dist')
      if (!existsSync(join(dist, 'index.html'))) throw new Error(`no built page at ${app}/dist: run \`pnpm build\` first`)
      const html = readFileSync(join(dist, 'index.html'), 'utf8')
      const stylesheets = stylesheetLinks(html).map((href) => readFileSync(join(dist, ...href.replace(/^\.?\//, '').split('/')), 'utf8'))
      expect(stylesheets.length).toBeGreaterThan(0)
      const built = { html, stylesheets, address: `http://localhost:8080${location}` }
      expect(policyProblems(policy, built, { allowed })).toEqual([])
      // An allowance is one source in one directive, and no licence for the
      // page itself to carry what it allows a script to inject.
      if (Object.keys(allowed).length > 0) expect(policyProblems(policy, built)).toEqual(["style-src allows 'unsafe-inline'"])
      expect(policyProblems(policy, { ...built, html: html.replace('<div id="root">', '<div id="root"><script>1</script>') }, { allowed })).toContain(
        'index.html has an inline script, which script-src refuses',
      )
    },
  )

  // Every file of a page is sent with its policy, and the files Vite names
  // with a hash are in assets/: what the map is tested on below.
  test('each page links only files under assets/', () => {
    for (const { app } of Object.values(WEB_PAGES)) {
      const html = readFileSync(join(repo, app, 'dist', 'index.html'), 'utf8')
      expect(readdirSync(join(repo, app, 'dist'))).toContain('assets')
      for (const href of stylesheetLinks(html)) expect(href).toMatch(/^\/assets\//)
    }
  })
})

describe('nginx.conf sends each page its policy (0083)', () => {
  // The committed file: its map is the module's, every location that
  // serves files is a page with its policy, and nothing keeps the header
  // from one.
  test('as committed', () => {
    expect(nginxPolicyProblems(conf)).toEqual([])
    expect(withPolicyMap(conf)).toBe(conf)
    expect(conf).toContain(policyMap())
  })

  // A policy edited in nginx.conf by hand, which the browser gates never
  // saw, is named by the page it reaches.
  test("fails a page's policy that is not the module's", () => {
    const loosened = conf.replace("script-src 'self'; style-src 'self'; font-src", "script-src 'self' 'unsafe-inline'; style-src 'self'; font-src")
    expect(loosened).not.toBe(conf)
    const problems = nginxPolicyProblems(loosened)
    expect(problems[0]).toBe(`${NGINX_CONF}'s policy map is not what scripts/web-policies.mjs writes: run \`node scripts/web-policies.mjs --write\``)
    expect(problems.slice(1)).toEqual([
      `${NGINX_CONF} sends /studio/ "${pagePolicy('/studio/').replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")}", not scripts/web-policies.mjs's "${pagePolicy('/studio/')}"`,
      expect.stringContaining('sends /studio/index.html'),
      expect.stringContaining('sends /studio/assets/index-a1b2c3.js'),
    ])
    expect(withPolicyMap(loosened)).toBe(conf)
  })

  // A third location that serves files is a page served under no policy
  // until the module names one; a page the module names that nginx no
  // longer serves is a policy held for nothing.
  test('fails a location that serves files with no policy, and a policy for a location that serves none', () => {
    const third = conf.replace('    location /v1/ {', '    location /docs/ {\n        alias /usr/share/formancy-data/docs/;\n    }\n\n    location /v1/ {')
    expect(nginxPolicyProblems(third)).toEqual(['location /docs/ serves files, and scripts/web-policies.mjs has no policy for a page there'])
    const gone = conf.replace(/ {4}location \/host\/ \{[^}]*\}\n/, '')
    expect(nginxPolicyProblems(gone)).toEqual([`scripts/web-policies.mjs has a policy for /host/, and no location of ${NGINX_CONF} serves files there`])
  })

  // nginx's rule: a location with an add_header of its own inherits none
  // of its server's, so a Cache-Control added to /host/ alone would send
  // the host page with no policy, and no nosniff either.
  test('fails an add_header inside a location that serves a page, which drops the server-level policy there', () => {
    const own = conf.replace('    location /host/ {\n', '    location /host/ {\n        add_header X-Robots-Tag noindex;\n')
    expect(own).not.toBe(conf)
    expect(nginxPolicyProblems(own)).toEqual([
      expect.stringMatching(
        /^location \/host\/ has an add_header of its own \(line \d+\), which drops every add_header of its server there, the policy among them$/,
      ),
    ])
  })

  // nginx chooses the header's value by the path the response is sent
  // for, and an internal redirect changes that path: with `error_page 404
  // /missing.html;` put in location /host/, the web image's nginx answered
  // /host/nope with a 404 page and no policy, while the guard passed it.
  // So a directive that moves a request under a page -- in the page's
  // location, or at its server's level, which the location inherits -- to
  // a path outside it fails, and one that keeps it inside does not.
  test('fails a directive that moves a request under a page to a path outside it', () => {
    const inHost = (line) => conf.replace('    location /host/ {\n', `    location /host/ {\n        ${line}\n`)
    const moves = (name, target, prefix = '/host/') =>
      expect.stringMatching(
        new RegExp(
          `^${name} \\(line \\d+\\) moves a request under ${prefix} to ${target.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}, outside the page, where nginx sends the header that path is given, not the page's policy$`,
        ),
      )
    expect(nginxPolicyProblems(inHost('error_page 404 /missing.html;'))).toEqual([moves('error_page', '/missing.html')])
    expect(nginxPolicyProblems(inHost('error_page 404 =200 /index.html;'))).toEqual([moves('error_page', '/index.html')])
    expect(nginxPolicyProblems(inHost('try_files $uri /index.html;'))).toEqual([moves('try_files', '/index.html')])
    expect(nginxPolicyProblems(inHost('rewrite ^/host/(.*)$ /$1 break;'))).toEqual([moves('rewrite', '/$1')])
    expect(nginxPolicyProblems(inHost('index /index.html;'))).toEqual([moves('index', '/index.html')])
    expect(nginxPolicyProblems(inHost('if ($arg_x) { rewrite ^ /elsewhere last; }'))).toEqual([moves('rewrite', '/elsewhere')])
    expect(nginxPolicyProblems(inHost('index ../outside.html;'))).toEqual([moves('index', '../outside.html')])
    // At the server's level it moves a request under every page.
    const atServer = conf.replace('    server_tokens off;\n', '    server_tokens off;\n    error_page 404 /404.html;\n')
    expect(nginxPolicyProblems(atServer)).toEqual([moves('error_page', '/404.html', '/studio/'), moves('error_page', '/404.html')])
    // And at the file's, which is nginx's http block, under every page of every server.
    expect(nginxPolicyProblems(`error_page 404 /404.html;\n${conf}`)).toEqual([moves('error_page', '/404.html', '/studio/'), moves('error_page', '/404.html')])
    // What keeps a request under the page is no problem: a target under
    // it, the path tried as it is, a status, a named location, which
    // keeps the path, and a redirect, which sends the browser elsewhere.
    for (const line of [
      'error_page 404 /host/404.html;',
      'error_page 404 @gone;',
      'try_files $uri $uri/ =404;',
      'rewrite ^/host/old$ /studio/ permanent;',
      'rewrite ^/host/a$ /host/b break;',
      'index index.html;',
    ]) {
      expect(nginxPolicyProblems(inHost(line)), line).toEqual([])
    }
  })

  // The guard counts a location as a page when it serves files by alias or
  // root. One that answers some other way could answer with a page too --
  // proxied from somewhere other than the data server, whose answers are
  // JSON, returned with a 200, or served from nginx's own root by a
  // location with no handler of its own -- and the map would give it no
  // policy, so it fails until it is a page here or answers otherwise.
  test('fails a location that could answer with a page and is no page here', () => {
    const add = (block) => conf.replace('    location /v1/ {', `${block}\n\n    location /v1/ {`)
    const unknown = (prefix) =>
      `location ${prefix} answers neither with a page's files, nor from the data server, nor with a redirect or an error, so what it sends could be a page that scripts/web-policies.mjs gives no policy`
    expect(nginxPolicyProblems(add('    location /docs/ {\n        proxy_pass http://docs:8000;\n    }'))).toEqual([unknown('/docs/')])
    expect(nginxPolicyProblems(add('    location = /hello {\n        default_type text/html;\n        return 200 "<p>hello</p>";\n    }'))).toEqual([
      unknown('/hello'),
    ])
    expect(nginxPolicyProblems(add('    location /bare/ {\n    }'))).toEqual([unknown('/bare/')])
    for (const block of [
      '    location = /old {\n        return 301 /studio/;\n    }',
      '    location = /gone {\n        return 410;\n    }',
      '    location = /elsewhere {\n        return https://example.com/;\n    }',
    ]) {
      expect(nginxPolicyProblems(add(block)), block).toEqual([])
    }
  })

  // The header sent without `always` is left off a 404 under the page and
  // every other answer nginx does not count as a success; not sent at all,
  // the map is a variable nobody reads.
  test("fails a server that does not send the map's variable always", () => {
    const line = `    add_header Content-Security-Policy $formancy_content_security_policy always;\n`
    expect(conf).toContain(line)
    for (const changed of [conf.replace(line, ''), conf.replace(line, line.replace(' always;', ';'))]) {
      expect(nginxPolicyProblems(changed)).toEqual([
        'the server on 8080 serves /studio/ and /host/ and has no "add_header Content-Security-Policy $formancy_content_security_policy always;" of its own',
      ])
    }
  })

  // What the map gives a path is what nginx would: the pages' and nothing
  // for the server's routes, the redirects or the 404 nginx answers itself.
  test('gives every other path no policy', () => {
    const [map] = parseNginx(conf).filter((each) => each.name === 'map' && each.args[1] === '$formancy_content_security_policy')
    const entries = map.block.map((entry) => [entry.name, entry.args[0]])
    for (const path of ['/', '/studio', '/host', '/v1/forms', '/health', '/nope', '/x/studio/']) expect(mapValue(entries, path), path).toBe('')
    expect(mapValue(entries, '/host/THIRD-PARTY-NOTICES.txt')).toBe(contentSecurityPolicy(WEB_PAGES['/host/'].policy))
  })
})

describe('parseNginx and mapValue', () => {
  // The guard reads nginx.conf as nginx does, as far as the file uses the
  // grammar: a quoted value with `;` and spaces is one argument, and a `#`
  // inside quotes is no comment.
  test('reads quoted arguments, comments and nested blocks', () => {
    const tree = parseNginx('# a comment\nmap $uri $x {\n    ~^/a/  "a; b \'c\' # d";\n    default "";\n}\nserver { location /a/ { alias /x/; } }\n')
    expect(tree).toEqual([
      {
        name: 'map',
        args: ['$uri', '$x'],
        line: 2,
        block: [
          { name: '~^/a/', args: ["a; b 'c' # d"], line: 3 },
          { name: 'default', args: [''], line: 4 },
        ],
      },
      { name: 'server', args: [], line: 6, block: [{ name: 'location', args: ['/a/'], line: 6, block: [{ name: 'alias', args: ['/x/'], line: 6 }] }] },
    ])
    expect(() => parseNginx('server {')).toThrow('ends inside')
    expect(() => parseNginx('a "b;')).toThrow('never closed')
  })

  // nginx chooses an exact key before any expression, the expressions in
  // their order, and the default last.
  test('chooses as nginx does', () => {
    const entries = [
      ['~^/a/', 'first'],
      ['~*^/A/B', 'second'],
      ['/a/exact', 'exact'],
      ['default', 'none'],
    ]
    expect(mapValue(entries, '/a/b')).toBe('first')
    expect(mapValue(entries, '/a/exact')).toBe('exact')
    expect(mapValue(entries, '/z')).toBe('none')
    expect(mapValue([['~^/a/', 'x']], '/z')).toBe('')
  })
})
