/**
 * The paths this server routes (0037).
 *
 * A proxy in front of the server may choose where to forward a request by its
 * path after decoding it, resolving its `.` and `..` segments and collapsing
 * its slashes. cloudflared 2026.10.0 was measured doing all three, so that
 * `/v1/forms/a/versions/..%2F..%2Fb` matched a door meant for the runtime
 * route `/v1/forms/b`, while Fastify, which routes the path as sent, ran the
 * administrator's version-read for it. Rather than model anybody's
 * normalisation, the server routes only a path in which there is nothing to
 * normalise, and refuses every other before any route's work.
 *
 * No name the server accepts needs more. A form id and a connection id start
 * with a lower-case letter or digit and hold only those, `.`, `-` and `_`; a
 * version is digits or `latest`; a lookup source is formancy's option-source
 * name, lower case, digits and hyphens. None can be `.` or `..`, and
 * `encodeURIComponent`, which the studio and data-client send names through,
 * leaves each as it is. paths.test.ts derives that for form and connection
 * ids from the store's and the allowlist's own checks; for versions and
 * sources it holds a sample.
 */

/** One segment: RFC 3986's unreserved characters, its sub-delims, `:` and `@`. No `%`, no `\`, nothing outside ASCII. */
const SEGMENT = /^[A-Za-z0-9\-._~!$&'()*+,;=:@]+$/

/**
 * Whether a request target is a plain path: before any `?`, a `/` and then
 * one or more segments, each non-empty, neither `.` nor `..`, and made only of
 * characters a path carries as themselves. So no escape, no backslash, no
 * empty segment (a doubled or trailing slash, or `/` alone), no dot segment
 * and no `#`. The query is not looked at: neither the router nor a door
 * routes by it.
 */
export function plainPath(target: string): boolean {
  const query = target.indexOf('?')
  const path = query === -1 ? target : target.slice(0, query)
  if (!path.startsWith('/')) return false
  return path
    .slice(1)
    .split('/')
    .every((segment) => segment !== '.' && segment !== '..' && SEGMENT.test(segment))
}

/** The answer to a path that is not plain, with 400: a code and a sentence, and nothing of the path, which is whatever the caller typed. */
export const PATH_NOT_PLAIN = {
  code: 'path-not-plain',
  message:
    "This path holds an encoded character, an empty or a dot segment, or a character a path does not carry as itself. No name here is written that way, and a proxy in front of this server may read such a path differently, so it was not routed to any route's work.",
} as const
