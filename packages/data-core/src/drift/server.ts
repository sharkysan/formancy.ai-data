import type { MetadataSnapshot } from '../metadata.js'
import { serverStanding } from '../server.js'
import type { Draft } from './context.js'

/**
 * The server the current snapshot was read from, when this release was not
 * tested on it (0068): for review, on every report against it, whatever
 * else did or did not change. The server is outside the fingerprint, so an
 * in-place upgrade changes nothing else a review compares, and this is
 * where it is said.
 *
 * Never stops anything: nothing refuses a server for being untested
 * (0068), and the runtime, which compares the root's definition alone
 * (0041), is not told. Decided by `current` alone, because the review is
 * of the database as it is now. A snapshot that records no server -- one an
 * adapter took before 0068 -- decides nothing here: it is not called
 * tested, and it is not reported on every review of every form published
 * before the server was recorded.
 */
export function serverChanges(current: MetadataSnapshot): Draft[] {
  if (current.server === undefined) return []
  const standing = serverStanding(current.kind, current.server)
  if (standing.tested) return []
  return [
    {
      kind: 'server-untested',
      subject: { kind: 'scope' },
      affects: [],
      stops: [],
      breaksReads: false,
      otherwise: 'review',
      message: `${standing.says} Nothing is stopped for it: the form is served on it as on a server this release was tested on, and no test of this release has shown what it does differently.`,
    },
  ]
}
