import { describe, expect, test } from 'vitest'
import { corsOriginsSetting, originsProblem, varyWith } from './cors.js'

/*
 * `FORMANCY_DATA_CORS_ORIGINS` as main.ts reads it, and `runtime.origins` as
 * createDataServer checks it (0060): the origins a page may call the runtime
 * plane from, each exactly as a browser sends `Origin`. What the server does
 * with the list is cross-origin.test.ts's; this is what the list may hold.
 */

const RUNTIME = { runtime: true }

describe('FORMANCY_DATA_CORS_ORIGINS', () => {
  // A browser sends the origin in one spelling, and the server compares it
  // byte for byte: an entry is accepted only in that spelling, so what the
  // operator wrote is exactly what is granted. Plain HTTP only on loopback,
  // where a developer's page is (decision 5). Compose passes "" for a
  // variable it was not given, so empty and only commas and spaces are the
  // same as unset: nothing is listed. Watched failing with "" taken as an
  // entry.
  test('accepts origins as a browser sends them, and empty is the same as unset', () => {
    expect(corsOriginsSetting('https://app.example, https://app.example:8443,http://localhost:3000,http://127.0.0.1,http://[::1]:3000,https://xn--bcher-kva.example,https://[2001:db8::1],https://10.0.0.5', RUNTIME)).toEqual({
      ok: true,
      origins: ['https://app.example', 'https://app.example:8443', 'http://localhost:3000', 'http://127.0.0.1', 'http://[::1]:3000', 'https://xn--bcher-kva.example', 'https://[2001:db8::1]', 'https://10.0.0.5'],
    })
    for (const empty of [undefined, '', ' , ', ',,']) expect(corsOriginsSetting(empty, RUNTIME)).toEqual({ ok: true, origins: [] })
    expect(corsOriginsSetting('', { runtime: false })).toEqual({ ok: true, origins: [] })
  })

  // Each of these is a mistake the browser would never match, or a grant
  // wider than one origin: `*` and `null` are 0024's wildcard and the
  // origin of a sandboxed frame or a file, a pattern is several origins,
  // and the rest are spellings a browser does not send -- so the server
  // stops rather than starting with an entry that grants nothing or too
  // much. Each row names the rule that refuses it, so a row another rule
  // happens to catch does not stand for this one. The sentence names the
  // entry by its place and never repeats it: an entry pasted with a password
  // in it stays out of the terminal and the log. Watched failing by
  // comparing case-insensitively (App.example was accepted), by allowing
  // `*`, by putting the entry in the sentence, with the loopback rule off
  // (the three plain-HTTP rows were accepted) and with the host rule off
  // (the four host rows were accepted or refused for another reason).
  const WILDCARD = /is a wildcard or the opaque origin/
  const SPELLING = /is not written as a browser sends Origin/
  const HOST = /names a pattern or a host that is no DNS name or IP address/
  const SCHEME = /is not an https: origin/
  const PLAIN = /is plain HTTP on a host other than localhost, 127\.0\.0\.1 or \[::1\]/
  test.each([
    ['*', 'a wildcard', WILDCARD],
    ['null', 'null', WILDCARD],
    ['https://*.example', 'a pattern', HOST],
    ['https://app.example/', 'a trailing slash', SPELLING],
    ['https://app.example/path', 'a path', SPELLING],
    ['https://App.example', 'upper case', SPELLING],
    ['HTTPS://app.example', 'an upper-case scheme', SPELLING],
    ['https://app.example:443', 'a default port written out', SPELLING],
    ['https://bücher.example', 'a name that is not punycode', SPELLING],
    ['https://user:S3cret-pw-e81@app.example', 'user information', SPELLING],
    ['https://app.example?x=1', 'a query', SPELLING],
    ['ftp://app.example', 'another scheme', SCHEME],
    ['wss://app.example', 'a WebSocket scheme', SCHEME],
    ['http://app.example', 'plain HTTP off loopback', PLAIN],
    ['http://localhost.example', 'plain HTTP to a name that only begins with localhost', PLAIN],
    ['http://127.0.0.2', 'plain HTTP to a loopback address that is not 127.0.0.1', PLAIN],
    ['http://localhost.', 'localhost with a trailing dot', HOST],
    ['https://app.example.', 'a trailing dot', HOST],
    ['https://a!b.example', 'a host that is no DNS name', HOST],
    ['app.example', 'no scheme', /is not an origin: a scheme, a host/],
  ])('refuses %s (%s), naming it by its place and never repeating it', (entry, _what, reason) => {
    const outcome = corsOriginsSetting(`https://ok.example,${entry}`, RUNTIME)
    expect(outcome.ok).toBe(false)
    const problem = outcome.ok ? '' : outcome.problem
    expect(problem).toMatch(/^FORMANCY_DATA_CORS_ORIGINS: entry 2 /)
    expect(problem).toMatch(reason)
    expect(problem).not.toContain(entry)
    expect(problem).not.toContain('S3cret')
  })

  // The list grants the runtime plane's routes, so a server without that
  // plane would start with a setting that does nothing: it stops instead,
  // with a sentence that says what is missing. An empty list needs nothing.
  test('a list needs the runtime plane', () => {
    expect(corsOriginsSetting('https://app.example', { runtime: false })).toEqual({ ok: false, problem: expect.stringMatching(/^FORMANCY_DATA_CORS_ORIGINS lists origins, and the runtime plane is off/) })
  })
})

describe('runtime.origins', () => {
  // An embedder hands createDataServer the list directly, past main.ts: the
  // same rule, so `['*']` is as impossible there, and an entry that is not
  // a string is named by its place too.
  test('is held to the same rule, by place', () => {
    expect(originsProblem([])).toBeUndefined()
    expect(originsProblem(['https://app.example', 'http://localhost:5173'])).toBeUndefined()
    expect(originsProblem(['https://app.example', '*'])).toMatch(/^runtime\.origins\[1\] /)
    expect(originsProblem([7])).toMatch(/^runtime\.origins\[0\] /)
    expect(originsProblem(' https://app.example' as unknown as string[])).toMatch(/^runtime\.origins is not a list/)
    expect(originsProblem([' https://app.example'])).toMatch(/^runtime\.origins\[0\] /)
  })
})

describe('Vary on a runtime answer', () => {
  // The server adds Origin to whatever Vary an answer already has, once:
  // no runtime route sets one today, so this is what keeps a route that
  // later varies by Accept from losing either. Watched failing with the
  // existing value replaced, and with Origin appended a second time.
  test('adds Origin once to whatever the answer says already', () => {
    expect(varyWith(undefined, 'Origin')).toBe('Origin')
    expect(varyWith('Accept', 'Origin')).toBe('Accept, Origin')
    expect(varyWith('accept, origin', 'Origin')).toBe('accept, origin')
    expect(varyWith(['Accept', 'Accept-Encoding'], 'Origin')).toBe('Accept, Accept-Encoding, Origin')
    expect(varyWith('*', 'Origin')).toBe('*')
  })
})
