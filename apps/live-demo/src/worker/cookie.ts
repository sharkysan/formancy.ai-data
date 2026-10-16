/*
 * The one cookie the live demo sets (0070): the name of the visitor's own
 * Durable Object, and through it their own container, data set and key.
 * It holds a random name and nothing else; it is the instance's
 * credential, since whoever holds it can sign in to that instance, so it
 * is unguessable, sent to the demo's path alone, read by no script, never
 * sent by another site and forgotten when the browser closes. The token a
 * persona signs in with is never in it: the page holds that, as the host
 * page always has (0029).
 */
import { PREFIX } from './limits.js'

/** `__Secure-`: a browser takes it only over HTTPS and only with Secure. */
export const COOKIE_NAME = '__Secure-formancy-data-demo'

/** 128 random bits as lowercase hex, which is the only thing the Worker ever sets. */
const SHAPE = /^[0-9a-f]{32}$/

/** A new instance name: 16 bytes from the platform's CSPRNG, as 32 lowercase hex characters. */
export function newInstanceName(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The Set-Cookie value for `name`: the demo's path, Secure, HttpOnly, SameSite=Strict, and no lifetime, so it lasts the browser's session. */
export function instanceCookie(name: string): string {
  return `${COOKIE_NAME}=${name}; Path=${PREFIX}/; Secure; HttpOnly; SameSite=Strict`
}

/**
 * The instance name in a Cookie header: the first value of COOKIE_NAME
 * that has the shape the Worker makes, or undefined. A value of any other
 * shape is no cookie, so a visitor can never choose which Durable Object
 * they reach.
 */
export function instanceNameOf(header: string | null): string | undefined {
  for (const pair of (header ?? '').split(';')) {
    const at = pair.indexOf('=')
    if (at === -1 || pair.slice(0, at).trim() !== COOKIE_NAME) continue
    const value = pair.slice(at + 1).trim()
    if (SHAPE.test(value)) return value
  }
  return undefined
}
