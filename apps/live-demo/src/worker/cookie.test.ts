import { describe, expect, test } from 'vitest'
import { COOKIE_NAME, instanceCookie, instanceNameOf, newInstanceName } from './cookie.js'

/**
 * The one cookie the demo sets (0070): a random name for the visitor's own
 * Durable Object and container, and nothing else. Whoever holds it can sign
 * in to that instance, so it is made to be guessed by nobody, sent nowhere
 * but the demo's path, read by no script, and forgotten with the browser.
 */
describe("the visitor's instance cookie", () => {
  // 128 bits from the platform's CSPRNG: a name somebody could guess is a
  // way into somebody else's data set. Two calls never agree.
  test('names an instance by 32 lowercase hex characters, new every time', () => {
    const names = Array.from({ length: 200 }, () => newInstanceName())
    for (const name of names) expect(name).toMatch(/^[0-9a-f]{32}$/)
    expect(new Set(names).size).toBe(names.length)
  })

  // Secure and the __Secure- prefix: never over plain HTTP. HttpOnly: no
  // script of the page, and nothing a style injects, reads it. SameSite
  // Strict: no other site's page sends it. The demo's path alone, not
  // formancy.ai's whole origin. No Max-Age or Expires: the browser forgets
  // it when it closes.
  test('is set for the demo path only, secure, out of scripts, same-site strict, and for the session', () => {
    const name = newInstanceName()
    const header = instanceCookie(name)
    expect(COOKIE_NAME).toBe('__Secure-formancy-data-demo')
    expect(header.split('; ')).toEqual([`${COOKIE_NAME}=${name}`, 'Path=/data/demo/', 'Secure', 'HttpOnly', 'SameSite=Strict'])
    expect(header).not.toMatch(/max-age|expires|domain/i)
  })

  // What the browser sends back is read as it was set, among whatever other
  // cookies formancy.ai's origin holds.
  test("reads the name back from the browser's Cookie header", () => {
    const name = newInstanceName()
    expect(instanceNameOf(`${COOKIE_NAME}=${name}`)).toBe(name)
    expect(instanceNameOf(`theme=dark; ${COOKIE_NAME}=${name}; other=1`)).toBe(name)
    expect(instanceNameOf(`theme=dark;${COOKIE_NAME}=${name}`)).toBe(name)
  })

  // A value of another shape names no instance the Worker made: read as a
  // name, it would let a visitor choose the Durable Object -- one name for
  // everybody, or a key with a path in it. It is no cookie, as no header is.
  test('treats a value of any other shape, or none, as no cookie', () => {
    const name = newInstanceName()
    for (const header of [
      null,
      '',
      'theme=dark',
      `${COOKIE_NAME}=`,
      `${COOKIE_NAME}=${name.toUpperCase()}`,
      `${COOKIE_NAME}=${name.slice(1)}`,
      `${COOKIE_NAME}=${name}0`,
      `${COOKIE_NAME}=${name.slice(1)}g`,
      `${COOKIE_NAME}="${name}"`,
      `${COOKIE_NAME}=../${name.slice(3)}`,
      `x${COOKIE_NAME}=${name}`,
      `formancy-data-demo=${name}`,
    ]) {
      expect(instanceNameOf(header), String(header)).toBeUndefined()
    }
  })

  // A browser sends a more specific path's cookie first; a second one of the
  // name -- one another page of the origin set with a wider path, say -- does
  // not displace the first that has the shape.
  test('reads the first value of the shape when the name comes twice', () => {
    const first = newInstanceName()
    const second = newInstanceName()
    expect(instanceNameOf(`${COOKIE_NAME}=${first}; ${COOKIE_NAME}=${second}`)).toBe(first)
    expect(instanceNameOf(`${COOKIE_NAME}=nope; ${COOKIE_NAME}=${second}`)).toBe(second)
  })
})
