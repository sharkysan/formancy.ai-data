import net from 'node:net'
import type { AddressInfo } from 'node:net'
import type { DatabaseKind } from '@formancy/data-core'

/*
 * A TCP hop in front of a real database that can lose an answer after the
 * database has sent it (0031). Every byte that crosses it is the real
 * driver's and the real server's; only the network fails, so a suite behind
 * it is not a mocked driver (0003).
 *
 * Why not a kill timed against a sleep: KILL and pg_terminate_backend end the
 * session before it commits (P1, P2), which is a different state. What the
 * no-replay proof needs is a write the database committed and whose answer
 * the client never got. So the hop watches the server's answers for a text
 * the write's answer echoes -- a RETURNING row on PostgreSQL, the row SQL
 * Server's batch selects after `commit transaction` -- and from the read in
 * which that text completes, drops everything the server sends on that
 * connection. It goes on reading, so the server is never blocked on a full
 * socket.
 *
 * A matched marker is not proof of a commit: PostgreSQL sends a deferred
 * constraint's refusal after the row (P2b). A suite polls a connection of its
 * own until the write is visible before it calls `cut()`.
 *
 * Since 0034 the hop also counts round trips and can delay answers, for the
 * performance measurement and the adapters' pinned counts. A round trip is a
 * turn -- the client speaking again after it last heard the server -- which
 * is what a network's latency multiplies; the measurement's added-latency
 * block is what shows that it does. The delay is one fixed wait per answer,
 * added after loopback: no bandwidth, no loss, no congestion window.
 */

/** One armed marker: what its match resolves, and the connections it has silenced. */
export interface LostAnswer {
  /** Resolves when an answer carrying the marker has been read, and dropped, on some connection. */
  readonly matched: Promise<void>
  /** Destroys only the connections whose answers were swallowed, both sides, and disarms the marker. */
  cut(): void
}

export interface TcpHop {
  /** The loopback port a driver connects to instead of the database's. */
  readonly port: number
  /**
   * Arms `marker` on every current and later connection: from the
   * server-to-client read in which it completes, that connection's answers
   * are read and dropped.
   */
  swallowAnswersFrom(marker: Buffer): LostAnswer
  /** How many times the client has sent `marker`, on every connection, since this call -- across reads. */
  countSent(marker: Buffer): () => number
  /**
   * Turns since this call, on every connection: each time a client chunk
   * arrives on a connection whose last word, as the client heard it, was not
   * the client's. Two writes before an answer are one turn; an answer in
   * several reads is one. An answer the hop is still delaying has not been
   * heard. What a network's latency multiplies, measured by the delay block.
   */
  countRoundTrips(): () => number
  /**
   * Holds every server-to-client chunk on every connection for `ms` before
   * forwarding it, in arrival order, from this call on; 0 forwards at once and
   * schedules nothing. A close from the server waits behind what is held.
   * `schedule` is injectable so a test needs no clock. One fixed delay per
   * answer, after loopback: no bandwidth, loss or congestion window.
   */
  delayAnswers(ms: number, schedule?: Schedule): void
  /** Destroys every connection, both sides, and disarms every marker; later connections are forwarded. */
  cut(): void
  close(): Promise<void>
}

/**
 * A TDS packet header is eight bytes, and a packet holds at most 4096, so a
 * text in a long SQL Server answer can be interrupted by one. A match
 * tolerates exactly one such interruption and no other.
 */
const PACKET_HEADER = 8

/** The text as the engine's driver puts it on the wire: postgres.js in UTF-8, tedious in UTF-16LE. */
export function answerBytes(kind: DatabaseKind, text: string): Buffer {
  return Buffer.from(text, kind === 'postgres' ? 'utf8' : 'utf16le')
}

/**
 * Where each match of `marker` in `hay` ends: the marker whole, or split once
 * by exactly PACKET_HEADER bytes. Only ends past `after` are reported, which
 * are the matches that complete in bytes not searched before.
 */
function matchEnds(hay: Buffer, marker: Buffer, after: number): number[] {
  const ends = new Set<number>()
  for (let split = 0; split < marker.length; split += 1) {
    // Split 0 is the marker whole; split n is n bytes, a header, and the rest.
    const head = split === 0 ? marker : marker.subarray(0, split)
    const tail = split === 0 ? Buffer.alloc(0) : marker.subarray(split)
    const gap = split === 0 ? 0 : PACKET_HEADER
    for (let at = hay.indexOf(head); at >= 0; at = hay.indexOf(head, at + 1)) {
      const from = at + head.length + gap
      const end = from + tail.length
      if (end > after && end <= hay.length && hay.subarray(from, end).equals(tail)) ends.add(end)
    }
  }
  return [...ends]
}

/**
 * A stream of reads searched for one marker: each read is searched with the
 * longest prefix of a match that can still be incomplete -- the marker less
 * one byte, and a header -- kept from the reads before it.
 */
function watcher(marker: Buffer): (chunk: Buffer) => number {
  const keep = marker.length + PACKET_HEADER - 1
  let tail = Buffer.alloc(0)
  return (chunk) => {
    const hay = Buffer.concat([tail, chunk])
    const found = matchEnds(hay, marker, tail.length).length
    tail = hay.subarray(Math.max(0, hay.length - keep))
    return found
  }
}

/** Runs `callback` after `ms`: `setTimeout`, unless a test hands the hop its own. */
export type Schedule = (callback: () => void, ms: number) => unknown

interface Pair {
  client: net.Socket
  upstream: net.Socket
  /** Set once an answer on this connection matched: nothing more reaches the client. */
  swallowing: boolean
  /** Who last spoke on this connection as the client heard it: the client's chunk arriving, or a server chunk forwarded to it. */
  lastSpoke: 'client' | 'server' | undefined
  /** Server chunks held by a delay, oldest first; `due` once their wait is over. */
  held: Array<{ chunk: Buffer; due: boolean }>
  /** The server ended its half while chunks were held: the client's end waits for them. */
  endHeld: boolean
}

interface Arm {
  marker: Buffer
  found: () => void
  watchers: WeakMap<Pair, (chunk: Buffer) => number>
  swallowed: Set<Pair>
}

interface Count {
  marker: Buffer
  watchers: WeakMap<Pair, (chunk: Buffer) => number>
  total: number
}

function watcherFor(watchers: WeakMap<Pair, (chunk: Buffer) => number>, pair: Pair, marker: Buffer): (chunk: Buffer) => number {
  let watch = watchers.get(pair)
  if (watch === undefined) {
    watch = watcher(marker)
    watchers.set(pair, watch)
  }
  return watch
}

function destroy(pair: Pair): void {
  pair.client.destroy()
  pair.upstream.destroy()
}

export async function startTcpHop(target: { host: string; port: number }): Promise<TcpHop> {
  const pairs = new Set<Pair>()
  const arms = new Set<Arm>()
  const counts: Count[] = []
  const turnCounters: Array<{ total: number }> = []
  let delay: { ms: number; schedule: Schedule } = { ms: 0, schedule: setTimeout }

  /** A chunk the client hears: the server has spoken, as far as the client knows. */
  function deliver(pair: Pair, chunk: Buffer): void {
    pair.lastSpoke = 'server'
    pair.client.write(chunk)
  }

  /** Forwards every held chunk whose wait is over, oldest first, stopping at the first still waiting; then a held end. */
  function release(pair: Pair): void {
    while (pair.held[0]?.due === true) deliver(pair, (pair.held.shift() as { chunk: Buffer }).chunk)
    if (pair.held.length === 0 && pair.endHeld) {
      pair.endHeld = false
      pair.client.end()
    }
  }

  function forward(pair: Pair, chunk: Buffer): void {
    // Behind anything already held, even with no delay now: order is the protocol.
    if (delay.ms === 0 && pair.held.length === 0) return deliver(pair, chunk)
    const entry = { chunk, due: delay.ms === 0 }
    pair.held.push(entry)
    if (entry.due) return release(pair)
    delay.schedule(() => {
      // After a cut the writes below fail on a destroyed socket, and the hop ignores a socket's errors.
      entry.due = true
      release(pair)
    }, delay.ms)
  }

  function fromServer(pair: Pair, chunk: Buffer): void {
    if (pair.swallowing) return
    for (const arm of arms) {
      if (watcherFor(arm.watchers, pair, arm.marker)(chunk) === 0) continue
      pair.swallowing = true
      arm.swallowed.add(pair)
      arm.found()
    }
    if (!pair.swallowing) forward(pair, chunk)
  }

  function fromClient(pair: Pair, chunk: Buffer): void {
    if (pair.lastSpoke !== 'client') for (const counter of turnCounters) counter.total += 1
    pair.lastSpoke = 'client'
    pair.upstream.write(chunk)
    for (const count of counts) count.total += watcherFor(count.watchers, pair, count.marker)(chunk)
  }

  // Half-open on both sides, so a FIN is passed on as a FIN, and only after
  // every byte that came before it: `end()` writes what is buffered first.
  // Only an error -- a reset, a refused connection -- tears the other side
  // down at once, as the network would. A cut is a `destroy()` on purpose,
  // and loses what was in flight, which is what it is for.
  //
  // Nagle's algorithm off on both sockets, as tedious turns it off on its own
  // and docker-proxy on its: a Node socket holds a small write back while an
  // earlier one is unacknowledged, and the receiver's delayed ACK made a SQL
  // Server answer of several packets wait about 40 ms here that it never waits
  // on the direct path. A hop that adds a stall of its own is measuring itself.
  const server = net.createServer({ allowHalfOpen: true }, (client) => {
    const upstream = net.connect({ port: target.port, host: target.host, allowHalfOpen: true })
    client.setNoDelay(true)
    upstream.setNoDelay(true)
    const pair: Pair = { client, upstream, swallowing: false, lastSpoke: undefined, held: [], endHeld: false }
    pairs.add(pair)
    client.on('end', () => upstream.end())
    upstream.on('end', () => {
      if (pair.held.length === 0) client.end()
      else pair.endHeld = true
    })
    for (const socket of [client, upstream]) {
      // A cut is the point; its errors are the drivers' to report, not the hop's.
      socket.on('error', () => {})
      socket.on('close', (hadError) => {
        if (hadError) destroy(pair)
        if (client.destroyed && upstream.destroyed) pairs.delete(pair)
      })
    }
    client.on('data', (chunk: Buffer) => fromClient(pair, chunk))
    upstream.on('data', (chunk: Buffer) => fromServer(pair, chunk))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  const cutAll = (): void => {
    arms.clear()
    for (const pair of [...pairs]) destroy(pair)
  }

  return {
    port: (server.address() as AddressInfo).port,
    swallowAnswersFrom(marker) {
      let found = (): void => {}
      const matched = new Promise<void>((resolve) => (found = resolve))
      const arm: Arm = { marker, found, watchers: new WeakMap(), swallowed: new Set() }
      arms.add(arm)
      return {
        matched,
        cut: () => {
          arms.delete(arm)
          for (const pair of arm.swallowed) destroy(pair)
        },
      }
    },
    countSent(marker) {
      const count: Count = { marker, watchers: new WeakMap(), total: 0 }
      counts.push(count)
      return () => count.total
    },
    countRoundTrips() {
      const counter = { total: 0 }
      turnCounters.push(counter)
      return () => counter.total
    },
    delayAnswers(ms, schedule = setTimeout) {
      if (!Number.isFinite(ms) || ms < 0) throw new Error(`a delay is a number of milliseconds, at least 0, not ${String(ms)}`)
      delay = { ms, schedule }
    },
    cut: cutAll,
    close: () => {
      cutAll()
      return new Promise<void>((resolve, reject) => server.close((error) => (error === undefined ? resolve() : reject(error))))
    },
  }
}
