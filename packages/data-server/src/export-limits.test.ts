import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { EXPORT_DEADLINE_MS } from './export-limits.js'

/*
 * An export answers nothing until its file is whole (0079), so the proxy in
 * front of the server waits that long for the first byte. The deadline is
 * derived from that wait: past the proxy's read timeout the person gets the
 * proxy's 504 while the server goes on for nobody. These cases hold the
 * deadline, plus a statement in flight when it passes, below every read
 * timeout the composed stack's nginx sets -- or nginx's default where it
 * sets none -- on every location that forwards to the server.
 */
const NGINX_CONF = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'deploy', 'web', 'nginx.conf')

/** nginx's `proxy_read_timeout` where nothing sets one: 60 s, by its documentation (ngx_http_proxy_module). */
const NGINX_DEFAULT_READ_TIMEOUT_MS = 60_000

/**
 * How long a list statement in flight when the deadline passes may still
 * run: the routes pass no signal to a list (0044), so it is bounded only by
 * its driver -- on SQL Server by mssql's default request timeout, 15 000 ms
 * (read by 0044 in mssql 12.7.4). Nothing bounds it on PostgreSQL, which
 * 0079 says.
 */
const STATEMENT_OVERRUN_MS = 15_000

/** nginx's time, in milliseconds: a bare number is seconds, and units add up (`1m30s`). */
const UNITS: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }
function nginxTime(text: string): number {
  const parts = [...text.matchAll(/(\d+)(ms|s|m|h|d)?/g)]
  if (parts.map((part) => part[0]).join('') !== text) throw new Error(`${text} is not a time nginx reads`)
  return parts.reduce((total, [, value, unit]) => total + Number(value) * (UNITS[unit ?? 's'] as number), 0)
}

/**
 * Each location that forwards to the server (`proxy_pass`), and the read
 * timeout it waits by: its own `proxy_read_timeout`, else its server
 * block's, else nginx's default. Blocks are read by their braces; a
 * directive is what precedes a `;`.
 */
function proxiedReadTimeouts(conf: string): Array<{ location: string; ms: number }> {
  const found: Array<{ location: string; ms: number }> = []
  const blocks: Array<{ name: string; timeout?: number; proxied: boolean }> = []
  let text = ''
  for (const char of conf.replace(/#[^\n]*/g, '')) {
    if (char !== '{' && char !== '}' && char !== ';') {
      text += char
      continue
    }
    const statement = text.trim().replace(/\s+/g, ' ')
    text = ''
    if (char === '{') {
      blocks.push({ name: statement, proxied: false })
      continue
    }
    const current = blocks.at(-1)
    if (char === ';') {
      if (current === undefined) continue
      if (statement.startsWith('proxy_pass ')) current.proxied = true
      if (statement.startsWith('proxy_read_timeout ')) current.timeout = nginxTime(statement.slice('proxy_read_timeout '.length))
      continue
    }
    blocks.pop()
    if (current?.name.startsWith('location ') === true && current.proxied) {
      const server = blocks.findLast((block) => block.name === 'server')
      found.push({ location: current.name.slice('location '.length), ms: current.timeout ?? server?.timeout ?? NGINX_DEFAULT_READ_TIMEOUT_MS })
    }
  }
  return found
}

describe('the export deadline', () => {
  // Watched failing with `proxy_read_timeout 30s;` written into the /v1/
  // location of deploy/web/nginx.conf: the deadline and an overrunning
  // statement, 45 s, are past it.
  test('ends, with a statement in flight, before the proxy stops waiting', () => {
    const timeouts = proxiedReadTimeouts(readFileSync(NGINX_CONF, 'utf8'))
    // A guard on the guard: a reading that found no location would hold nothing.
    expect(timeouts.map(({ location }) => location)).toEqual(expect.arrayContaining(['/v1/', '/v1/forms/', '= /v1/forms']))
    expect(timeouts.filter(({ ms }) => EXPORT_DEADLINE_MS + STATEMENT_OVERRUN_MS >= ms)).toEqual([])
  })

  // The reading itself, on a configuration written for it: a location's
  // own timeout over its server's, the server's over nginx's default, the
  // units nginx reads, and a location that forwards nothing left out.
  test('reads each forwarding location’s timeout as nginx would', () => {
    const conf = `
      server {
        proxy_read_timeout 1m30s;
        location /a/ { proxy_pass http://server:4390; proxy_read_timeout 45; }
        location = /b { proxy_pass http://server:4390; }
        location / { return 404; }
      }
      server {
        # proxy_read_timeout 1s; in a comment is no setting
        location /c/ {
          proxy_pass http://server:4390;
        }
        location /d/ { proxy_pass http://server:4390; proxy_read_timeout 2500ms; }
      }`
    expect(proxiedReadTimeouts(conf)).toEqual([
      { location: '/a/', ms: 45_000 },
      { location: '= /b', ms: 90_000 },
      { location: '/c/', ms: NGINX_DEFAULT_READ_TIMEOUT_MS },
      { location: '/d/', ms: 2_500 },
    ])
  })
})
