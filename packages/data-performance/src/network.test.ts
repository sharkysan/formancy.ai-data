import { describe, expect, test } from 'vitest'
import { proxySettings, withoutCredentials } from './network.js'

describe('the proxy settings the page records', () => {
  // A proxy URL can carry a user and a password; results.json is committed
  // and the page is published, so the credentials go before either sees it.
  test('drop the credentials from a proxy URL and keep the rest', () => {
    expect(withoutCredentials('http://alice:s3cret@proxy.example:3128')).toBe('http://proxy.example:3128')
    expect(withoutCredentials('http://proxy.example:3128')).toBe('http://proxy.example:3128')
    expect(withoutCredentials('localhost,127.0.0.1')).toBe('localhost,127.0.0.1')
  })

  // Fail closed: whatever does not parse as the URL a stripper expects still
  // reaches the page. curl takes a proxy with no scheme, which a URL parser
  // reads as a scheme `alice:` with no user at all; a value that does not
  // parse came back exactly as given. Anything before the last `@` goes,
  // whatever the shape around it.
  test('drop the credentials from a value no URL parser reads as having them', () => {
    expect(withoutCredentials('alice:s3cret@proxy.example:3128')).toBe('proxy.example:3128')
    expect(withoutCredentials('http://alice:s3cret@[bad')).toBe('http://[bad')
    expect(withoutCredentials('https://alice:p@ss/w0rd@proxy.example')).toBe('https://proxy.example')
  })

  // Upper case wins over lower, as Node's fetch reads them; unset is null,
  // never an empty string that reads as "set to nothing".
  test('read each variable once, upper case first, credentials removed', () => {
    expect(proxySettings({ https_proxy: 'http://bob:pw@lower:1', HTTPS_PROXY: 'http://carol:pw@upper:2', no_proxy: 'localhost', NODE_USE_ENV_PROXY: '' })).toEqual({
      HTTP_PROXY: null,
      HTTPS_PROXY: 'http://upper:2',
      NO_PROXY: 'localhost',
      NODE_USE_ENV_PROXY: null,
    })
  })
})
