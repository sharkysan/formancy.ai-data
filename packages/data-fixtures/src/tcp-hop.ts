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
 * The hop is told what crosses it, because only SQL Server's TDS packets can
 * cut a marker, and a match that allowed for a cut where none can occur
 * counted one sending as two (`CUT_BY`).
 *
 * Since 0034 the hop also counts round trips and can delay answers, for the
 * performance measurement and the adapters' pinned counts. A round trip is a
 * turn -- the client speaking again after it last heard the server -- which
 * is what a network's latency multiplies; the measurement's added-latency
 * block is what shows that it does. The delay is one fixed wait per answer,
 * added after loopback: no bandwidth, no loss, no congestion window.
 *
 * Since 0061 it can hold what new connections send, so a PostgreSQL cancel
 * request -- which postgres.js sends on a connection of its own -- arrives
 * when a suite releases it rather than when the scheduler delivers it: the
 * late cancel that lands on the next statement is then made, not waited for.
 * And it can refuse new connections, as a database whose listener went away
 * while its open sessions still answer: the cancel request is then the one
 * connection that fails, which the driver reports on a promise of its own.
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
   * Each sending of `marker` by the client since this call, in order: the
   * connection that carried it, numbered from 1 in the order the hop
   * accepted them; how many requests that connection had carried before the
   * one that carried it -- a request is a turn, as countRoundTrips counts
   * them, on that connection alone, and on HTTP/1.1 without pipelining one
   * turn is one request; and how many other connections the client passed
   * over for it, each idle from before the carrying connection opened until
   * the marker crossed: its last word the server's, nothing sent on it
   * since, and neither side ended or closed. Whether a browser sends a lost
   * POST again depends on the connection it took, and whether it had an
   * idle one to take (0058).
   */
  sentOn(marker: Buffer): () => SentOn[]
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
  /**
   * Holds every byte a client sends on a connection opened after this call,
   * until `release()`, then forwards them in the order they came, a close
   * after them. Connections opened before the call flow as before, the
   * server's answers to a held client flow too, and one opened after
   * `release()` is not held. Held bytes are counted -- as sent and as a turn
   * -- when they are released, which is when the server hears them.
   * `held()` is how many connections this call has held: those opened
   * after it and before its release.
   */
  holdNewConnections(): { release(): void; held(): number }
  /**
   * Holds every byte a client sends from this call on, on the connections
   * open at the call, until `release()`, then forwards them in the order
   * they came, a close after them. Connections opened after the call flow --
   * a cancel request's own, which can then reach the server before the
   * statement it was sent after (0121) -- and the server's answers to a held
   * client flow too. `held()` is how many connections this call holds.
   */
  holdOpenConnections(): { release(): void; held(): number }
  /**
   * Resets every connection a client opens after this call, before it
   * reaches the database, until `release()`: the client sees ECONNRESET.
   * Connections opened before the call flow as before. `refused()` is how
   * many this call has reset.
   */
  refuseNewConnections(): { release(): void; refused(): number }
  /** Destroys every connection, both sides, and disarms every marker; later connections are forwarded. */
  cut(): void
  close(): Promise<void>
}

/** One sending of a marker: the connection that carried it, the requests that connection carried before it, and the idle connections passed over for it. */
export interface SentOn {
  readonly connection: number
  readonly earlier: number
  readonly passedOver: number
}

/** What crosses a hop: one engine's protocol, or HTTP, which is how the host page's browser gate reaches the page. */
export type HopKind = DatabaseKind | 'http'

/**
 * How many bytes can cut a marker on each wire. A TDS packet header is eight
 * bytes, and a packet holds at most 4096, so a text in a long SQL Server
 * request or answer can be interrupted by one; there a match tolerates
 * exactly one such interruption and no other. PostgreSQL puts a bound value,
 * and a column of a row, whole inside one message, and HTTP has no 8-byte
 * packet header, so on those a marker is matched only whole. A gap tolerated
 * where none can occur finds a phantom: the marker less its last byte, eight
 * bytes, and that byte again -- which counted a PostgreSQL insert twice
 * whenever its marker ended in the `e` of the `sales` bound eight bytes on.
 */
const CUT_BY: Record<HopKind, number> = { postgres: 0, sqlserver: 8, http: 0 }

const isHopKind = (value: unknown): value is HopKind => typeof value === 'string' && Object.hasOwn(CUT_BY, value)

/** The text as the engine's driver puts it on the wire: postgres.js in UTF-8, tedious in UTF-16LE. */
export function answerBytes(kind: DatabaseKind, text: string): Buffer {
  return Buffer.from(text, kind === 'postgres' ? 'utf8' : 'utf16le')
}

/**
 * Where each match of `marker` in `hay` ends: the marker whole, or, where the
 * wire can cut it (`cutBy` above 0), split once by exactly `cutBy` bytes.
 * Only ends past `after` are reported, which are the matches that complete
 * in bytes not searched before.
 */
function matchEnds(hay: Buffer, marker: Buffer, after: number, cutBy: number): number[] {
  const ends = new Set<number>()
  const splits = cutBy === 0 ? 1 : marker.length
  for (let split = 0; split < splits; split += 1) {
    // Split 0 is the marker whole; split n is n bytes, a header, and the rest.
    const head = split === 0 ? marker : marker.subarray(0, split)
    const tail = split === 0 ? Buffer.alloc(0) : marker.subarray(split)
    const gap = split === 0 ? 0 : cutBy
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
 * one byte, and a header where the wire has one -- kept from the reads
 * before it.
 */
function watcher(marker: Buffer, cutBy: number): (chunk: Buffer) => number {
  const keep = marker.length + cutBy - 1
  let tail = Buffer.alloc(0)
  return (chunk) => {
    const hay = Buffer.concat([tail, chunk])
    const found = matchEnds(hay, marker, tail.length, cutBy).length
    tail = hay.subarray(Math.max(0, hay.length - keep))
    return found
  }
}

/** Runs `callback` after `ms`: `setTimeout`, unless a test hands the hop its own. */
export type Schedule = (callback: () => void, ms: number) => unknown

interface Pair {
  client: net.Socket
  upstream: net.Socket
  /** This connection's number in the hop, from 1, in the order the hop accepted them. */
  ordinal: number
  /** The client's turns on this connection since it opened: the request in progress is the last of them. */
  turns: number
  /** The hop's clock when it accepted this connection. */
  opened: number
  /** The hop's clock at the last server chunk the client heard on it: idle from then, if the client has not spoken since. */
  answeredAt: number
  /** Neither side has ended or closed it: a connection the client could still send on. */
  open: boolean
  /** Set once an answer on this connection matched: nothing more reaches the client. */
  swallowing: boolean
  /** Who last spoke on this connection as the client heard it: the client's chunk arriving, or a server chunk forwarded to it. */
  lastSpoke: 'client' | 'server' | undefined
  /** Server chunks held by a delay, oldest first; `due` once their wait is over. */
  held: Array<{ chunk: Buffer; due: boolean }>
  /** The server ended its half while chunks were held: the client's end waits for them. */
  endHeld: boolean
  /** Client chunks a gate holds, oldest first; undefined once nothing holds this connection. */
  sending: Buffer[] | undefined
  /** The client ended its half while its chunks were held: the server's end waits for them. */
  sendingEnded: boolean
}

/** One `holdNewConnections()`: the connections it holds until it is released. */
interface Gate {
  released: boolean
  pairs: Set<Pair>
  /** Whether it takes in the connections opened after it (`holdNewConnections`), or only those open when it was made (`holdOpenConnections`). */
  takesNew: boolean
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

interface Sendings {
  marker: Buffer
  watchers: WeakMap<Pair, (chunk: Buffer) => number>
  found: SentOn[]
}

function watcherFor(watchers: WeakMap<Pair, (chunk: Buffer) => number>, pair: Pair, marker: Buffer, cutBy: number): (chunk: Buffer) => number {
  let watch = watchers.get(pair)
  if (watch === undefined) {
    watch = watcher(marker, cutBy)
    watchers.set(pair, watch)
  }
  return watch
}

function destroy(pair: Pair): void {
  pair.client.destroy()
  pair.upstream.destroy()
}

/**
 * A hop in front of `target`, told what crosses it: `kind` decides whether a
 * marker can be cut on that wire. Refused without one, because the browser
 * gate calls it from a script nothing type-checks.
 */
export async function startTcpHop(target: { kind: HopKind; host: string; port: number }): Promise<TcpHop> {
  const kind: unknown = target.kind
  if (!isHopKind(kind)) throw new Error(`a hop is told what crosses it, postgres, sqlserver or http, not ${String(kind)}`)
  const cutBy = CUT_BY[kind]
  const pairs = new Set<Pair>()
  const arms = new Set<Arm>()
  const counts: Count[] = []
  const sendings: Sendings[] = []
  let accepted = 0
  /** Orders the hop's events -- an accept, a chunk heard by the client -- for passedOver; no time, so a test needs no clock. */
  let clock = 0
  const turnCounters: Array<{ total: number }> = []
  const gates = new Set<Gate>()
  const refusals = new Set<{ count: number }>()
  let delay: { ms: number; schedule: Schedule } = { ms: 0, schedule: setTimeout }

  /** A chunk the client hears: the server has spoken, as far as the client knows. */
  function deliver(pair: Pair, chunk: Buffer): void {
    pair.lastSpoke = 'server'
    clock += 1
    pair.answeredAt = clock
    pair.client.write(chunk)
  }

  /** The other connections idle from before `pair` opened until now: answered, unused since, open on both sides. */
  function passedOver(pair: Pair): number {
    let idle = 0
    for (const other of pairs) if (other !== pair && other.open && other.lastSpoke === 'server' && other.answeredAt < pair.opened) idle += 1
    return idle
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
      if (watcherFor(arm.watchers, pair, arm.marker, cutBy)(chunk) === 0) continue
      pair.swallowing = true
      arm.swallowed.add(pair)
      arm.found()
    }
    if (!pair.swallowing) forward(pair, chunk)
  }

  function fromClient(pair: Pair, chunk: Buffer): void {
    if (pair.sending !== undefined) return void pair.sending.push(chunk)
    sendUpstream(pair, chunk)
  }

  /** A held connection whose last gate is released: what it sent, in order, then its close. */
  function unhold(pair: Pair): void {
    if ([...gates].some((gate) => gate.pairs.has(pair))) return
    const held = pair.sending ?? []
    pair.sending = undefined
    for (const chunk of held) sendUpstream(pair, chunk)
    if (pair.sendingEnded) pair.upstream.end()
  }

  function sendUpstream(pair: Pair, chunk: Buffer): void {
    if (pair.lastSpoke !== 'client') {
      pair.turns += 1
      for (const counter of turnCounters) counter.total += 1
    }
    pair.lastSpoke = 'client'
    pair.upstream.write(chunk)
    for (const count of counts) count.total += watcherFor(count.watchers, pair, count.marker, cutBy)(chunk)
    for (const entry of sendings) {
      const found = watcherFor(entry.watchers, pair, entry.marker, cutBy)(chunk)
      for (let at = 0; at < found; at += 1) entry.found.push({ connection: pair.ordinal, earlier: pair.turns - 1, passedOver: passedOver(pair) })
    }
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
    if (refusals.size > 0) {
      for (const refusal of refusals) refusal.count += 1
      client.on('error', () => {})
      // A reset, not a FIN: a quiet close reads to a cancel's sender as a
      // request the server took.
      client.resetAndDestroy()
      return
    }
    const upstream = net.connect({ port: target.port, host: target.host, allowHalfOpen: true })
    client.setNoDelay(true)
    upstream.setNoDelay(true)
    accepted += 1
    clock += 1
    const holding = [...gates].filter((gate) => gate.takesNew)
    const pair: Pair = {
      client,
      upstream,
      ordinal: accepted,
      turns: 0,
      opened: clock,
      answeredAt: 0,
      open: true,
      swallowing: false,
      lastSpoke: undefined,
      held: [],
      endHeld: false,
      sending: holding.length === 0 ? undefined : [],
      sendingEnded: false,
    }
    for (const gate of holding) gate.pairs.add(pair)
    pairs.add(pair)
    client.on('end', () => {
      pair.open = false
      if (pair.sending === undefined) upstream.end()
      else pair.sendingEnded = true
    })
    upstream.on('end', () => {
      pair.open = false
      if (pair.held.length === 0) client.end()
      else pair.endHeld = true
    })
    for (const socket of [client, upstream]) {
      // A cut is the point; its errors are the drivers' to report, not the hop's.
      socket.on('error', () => {})
      socket.on('close', (hadError) => {
        pair.open = false
        if (hadError) destroy(pair)
        if (client.destroyed && upstream.destroyed) pairs.delete(pair)
      })
    }
    client.on('data', (chunk: Buffer) => fromClient(pair, chunk))
    upstream.on('data', (chunk: Buffer) => fromServer(pair, chunk))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  /** A gate in force until its release, which sends on what each connection it held has said, unless another gate holds it still. */
  function hold(gate: Gate): { release(): void; held(): number } {
    gates.add(gate)
    return {
      release: () => {
        if (gate.released) return
        gate.released = true
        gates.delete(gate)
        for (const pair of gate.pairs) unhold(pair)
      },
      held: () => gate.pairs.size,
    }
  }

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
    sentOn(marker) {
      const entry: Sendings = { marker, watchers: new WeakMap(), found: [] }
      sendings.push(entry)
      return () => [...entry.found]
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
    holdNewConnections() {
      return hold({ released: false, pairs: new Set(), takesNew: true })
    },
    holdOpenConnections() {
      const gate: Gate = { released: false, pairs: new Set(), takesNew: false }
      for (const pair of pairs) {
        if (!pair.open) continue
        gate.pairs.add(pair)
        pair.sending ??= []
      }
      return hold(gate)
    },
    refuseNewConnections() {
      const refusal = { count: 0 }
      refusals.add(refusal)
      return { release: () => void refusals.delete(refusal), refused: () => refusal.count }
    },
    cut: cutAll,
    close: () => {
      cutAll()
      return new Promise<void>((resolve, reject) => server.close((error) => (error === undefined ? resolve() : reject(error))))
    },
  }
}
