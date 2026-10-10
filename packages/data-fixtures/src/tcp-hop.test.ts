import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { answerBytes, startTcpHop } from './tcp-hop.js'
import type { TcpHop } from './tcp-hop.js'

/*
 * The hop's own rules, with no database: a tiny `node:net` server plays the
 * database and decides exactly where each chunk ends. Every chunk is written
 * only once the one before it has arrived at the other end, so a chunk the
 * hop reads is a chunk the test wrote -- TCP would otherwise be free to join
 * two writes into one read, and "the chunk in which the marker completes"
 * would mean nothing.
 *
 * What the adapters prove through the hop is theirs (records-lost-answer in
 * each adapter package); this file proves only that the hop drops what it
 * says and forwards everything else.
 */

const MARKER = Buffer.from('MARK-0031')
const HEADER = Buffer.alloc(8, 0xee)

interface Ends {
  /** The test's side of the connection, through the hop. */
  client: net.Socket
  /** The database's side of the same connection. */
  server: net.Socket
  /** Everything each side has received so far. */
  atClient: () => Buffer
  atServer: () => Buffer
}

const closing: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const close of closing.splice(0).reverse()) await close()
})

/** A target that accepts connections and hands each to the test, in the order they arrived. */
async function startTarget(halfOpen: boolean): Promise<{ port: number; next: () => Promise<net.Socket> }> {
  const waiting: Array<(socket: net.Socket) => void> = []
  const arrived: net.Socket[] = []
  const all: net.Socket[] = []
  // Half-open only when a case asks: otherwise a FIN from the hop ends the
  // target's side too, as a database closes a session its client left.
  const server = net.createServer({ allowHalfOpen: halfOpen }, (socket) => {
    socket.on('error', () => {})
    all.push(socket)
    const taker = waiting.shift()
    if (taker === undefined) arrived.push(socket)
    else taker(socket)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  closing.push(
    () =>
      new Promise<void>((resolve) => {
        for (const socket of all) socket.destroy()
        server.close(() => resolve())
      }),
  )
  return {
    port: (server.address() as AddressInfo).port,
    next: () => {
      const ready = arrived.shift()
      return ready === undefined ? new Promise((resolve) => waiting.push(resolve)) : Promise.resolve(ready)
    },
  }
}

function collect(socket: net.Socket): () => Buffer {
  const chunks: Buffer[] = []
  socket.on('data', (chunk: Buffer) => chunks.push(chunk))
  return () => Buffer.concat(chunks)
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function setUp({ halfOpen = false }: { halfOpen?: boolean } = {}): Promise<{ hop: TcpHop; connect: () => Promise<Ends> }> {
  const target = await startTarget(halfOpen)
  const hop = await startTcpHop({ host: '127.0.0.1', port: target.port })
  closing.push(() => hop.close())
  const connect = async (): Promise<Ends> => {
    const client = net.connect(hop.port, '127.0.0.1')
    client.on('error', () => {})
    const atClient = collect(client)
    const server = await target.next()
    const atServer = collect(server)
    return { client, server, atClient, atServer }
  }
  return { hop, connect }
}

/** Write `chunk` from the server and wait until the client has it all: one write, one read at the hop. */
async function fromServer(ends: Ends, chunk: Buffer): Promise<void> {
  const expected = Buffer.concat([ends.atClient(), chunk])
  ends.server.write(chunk)
  await until(() => ends.atClient().equals(expected), `the client received ${JSON.stringify(chunk.toString('latin1'))}`)
}

/** Write `chunk` from the client and wait until the server has it all. */
async function fromClient(ends: Ends, chunk: Buffer): Promise<void> {
  const expected = Buffer.concat([ends.atServer(), chunk])
  ends.client.write(chunk)
  await until(() => ends.atServer().equals(expected), `the server received ${JSON.stringify(chunk.toString('latin1'))}`)
}

/**
 * Write a chunk the hop is expected to swallow, wait for the match, and give
 * loopback a moment to deliver anything it wrongly forwarded. Absence has no
 * event to wait for; 200 ms is orders of magnitude above a loopback delivery,
 * and a single forwarded byte fails the assertion that follows.
 */
async function swallowed(ends: Ends, chunk: Buffer, matched: Promise<void>): Promise<void> {
  ends.server.write(chunk)
  await bounded(matched, 'the marker never appeared in an answer')
  await new Promise((resolve) => setTimeout(resolve, 200))
}

/** `promise`, or a rejection naming what never happened: a hop that never matches fails here, not at the suite's timeout. */
function bounded(promise: Promise<void>, what: string): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(what)), 2_000)))
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

const closed = (socket: net.Socket): Promise<void> => new Promise((resolve) => (socket.destroyed ? resolve() : socket.once('close', () => resolve())))

const text = (value: string): Buffer => Buffer.from(value, 'latin1')

describe('a TCP hop', () => {
  // A hop that changed or held a byte would make every adapter suite behind
  // it test the hop rather than the driver and the server.
  test('forwards both ways, byte for byte', async () => {
    const { connect } = await setUp()
    const ends = await connect()
    await fromClient(ends, text('hello, server'))
    await fromServer(ends, text('hello, client'))
    expect(ends.atServer().toString('latin1')).toBe('hello, server')
    expect(ends.atClient().toString('latin1')).toBe('hello, client')
  })

  // A Node socket holds a small write back while an earlier one is not yet
  // acknowledged (Nagle's algorithm), and Linux's delayed ACK can hold that
  // acknowledgement for 40 ms. tedious turns it off on its own socket and
  // docker-proxy on its own, so a hop that left it on would stall a SQL
  // Server answer of several packets where the direct path never does: in
  // review, a 100-key resolve took 92 ms through the hop and 13.7 ms direct,
  // and the added-latency table would have published the hop. Asked of the
  // sockets, by the call that sets it, because no test here reads a clock.
  test("turns Nagle's algorithm off on both of its sockets", async () => {
    const calls = vi.spyOn(net.Socket.prototype, 'setNoDelay')
    try {
      const { hop, connect } = await setUp()
      const ends = await connect()
      await fromClient(ends, text('request'))
      await fromServer(ends, text('answer'))
      const off = calls.mock.contexts.filter((_, index) => calls.mock.calls[index]?.[0] !== false) as net.Socket[]
      expect(off.filter((socket) => socket.localPort === hop.port), 'the side the driver connects to').toHaveLength(1)
      expect(off.filter((socket) => socket.remotePort === ends.server.localPort), 'the side to the database').toHaveLength(1)
    } finally {
      calls.mockRestore()
    }
  })

  // A server that answers and then closes -- a FATAL ErrorResponse and its
  // FIN, a large answer before a close -- must reach the driver whole, then
  // closed. A hop that tore both sockets down on the first close threw away
  // what it had not yet written: measured, 393216 of 1048576 bytes arrived,
  // so whether a driver saw the server's last words or a bare reset depended
  // on the hop's buffer, not on the database.
  test('passes a close on only after every byte before it, in both directions', async () => {
    const { connect } = await setUp()
    const ends = await connect()
    const big = Buffer.alloc(4 * 1024 * 1024, 0x61)
    const clientEnded = new Promise<void>((resolve) => ends.client.once('end', () => resolve()))
    ends.server.end(big)
    await bounded(clientEnded, 'the client never saw the end')
    expect(ends.atClient().length).toBe(big.length)

    const other = await connect()
    const serverEnded = new Promise<void>((resolve) => other.server.once('end', () => resolve()))
    other.client.end(big)
    await bounded(serverEnded, 'the server never saw the end')
    expect(other.atServer().length).toBe(big.length)
  })

  // TCP lets one side finish sending and still listen: a client that ends its
  // half is still owed the answer. A hop that closed both sides on the first
  // FIN would lose it.
  test('keeps the other half open after one side ends its own', async () => {
    const { connect } = await setUp({ halfOpen: true })
    const ends = await connect()
    const serverEnded = new Promise<void>((resolve) => ends.server.once('end', () => resolve()))
    ends.client.end(text('last question'))
    await bounded(serverEnded, 'the server never saw the end')
    await fromServer(ends, text('the answer, after the question ended'))
    expect(ends.atClient().toString('latin1')).toBe('the answer, after the question ended')
  })

  // The answer is dropped from the chunk in which the marker completes: that
  // chunk carries the commit's answer. A hop that forwarded it and dropped
  // only what followed would hand the driver its answer and prove nothing;
  // one that kept no tail of the last read would never see a marker split
  // between two reads, and the suite behind it would time out.
  test('swallows from the chunk in which a split marker completes, and everything after it', async () => {
    const { hop, connect } = await setUp()
    const ends = await connect()
    await fromServer(ends, text('before;'))
    const lost = hop.swallowAnswersFrom(MARKER)
    await fromServer(ends, Buffer.concat([text('row:'), MARKER.subarray(0, 4)]))
    await swallowed(ends, Buffer.concat([MARKER.subarray(4), text(';done')]), lost.matched)
    ends.server.write(text('after'))
    // The other direction is untouched: the server never waits on the hop.
    await fromClient(ends, text('the client may still speak'))
    expect(ends.atClient().toString('latin1')).toBe(`before;row:${MARKER.subarray(0, 4).toString('latin1')}`)
  })

  // A TDS packet is at most 4096 bytes behind an 8-byte header, so a marker
  // in a long answer can be cut by one. Exactly eight bytes are tolerated,
  // across a read boundary too; seven or nine are another text, and the hop
  // must not swallow an answer that does not carry the marker.
  test('matches through one gap of exactly eight bytes, and through no other', async () => {
    const { hop, connect } = await setUp()
    const header = await connect()
    const lost = hop.swallowAnswersFrom(MARKER)
    await fromServer(header, Buffer.concat([MARKER.subarray(0, 5), HEADER.subarray(0, 3)]))
    await swallowed(header, Buffer.concat([HEADER.subarray(3), MARKER.subarray(5)]), lost.matched)
    expect(header.atClient().equals(Buffer.concat([MARKER.subarray(0, 5), HEADER.subarray(0, 3)]))).toBe(true)
    lost.cut()

    const other = hop.swallowAnswersFrom(MARKER)
    let matched = false
    void other.matched.then(() => (matched = true))
    for (const gap of [7, 9]) {
      const ends = await connect()
      await fromServer(ends, Buffer.concat([MARKER.subarray(0, 4), Buffer.alloc(gap, 0xee), MARKER.subarray(4)]))
    }
    expect(matched).toBe(false)
  })

  // The no-replay proof counts the write's parameter on its way to the
  // server: a marker split between two writes is still one sending, a second
  // sending of it is a second, and what went before the count began is not
  // counted.
  test('counts a marker the client sends, across a split, from the moment it is asked', async () => {
    const { hop, connect } = await setUp()
    const ends = await connect()
    await fromClient(ends, MARKER)
    const sent = hop.countSent(MARKER)
    expect(sent()).toBe(0)
    await fromClient(ends, Buffer.concat([text('bind:'), MARKER.subarray(0, 3)]))
    await fromClient(ends, Buffer.concat([MARKER.subarray(3), text(';')]))
    expect(sent()).toBe(1)
    const another = await connect()
    await fromClient(another, Buffer.concat([MARKER, text('|'), MARKER]))
    expect(sent()).toBe(3)
  })

  // A pool keeps other connections open beside the one that carried the
  // write; cutting them all would fail the next request for a reason that is
  // the test's, not the database's (P6). `cut()` is the old proxy's, every
  // connection, for a cut while a write waits; after it, connections are
  // forwarded unarmed.
  test("a lost answer's cut ends only the connections that swallowed; the hop's cut ends all, and the next is forwarded", async () => {
    const { hop, connect } = await setUp()
    const swallowing = await connect()
    const bystander = await connect()
    const lost = hop.swallowAnswersFrom(MARKER)
    await swallowed(swallowing, MARKER, lost.matched)
    lost.cut()
    await closed(swallowing.client)
    await fromClient(bystander, text('still here'))
    await fromServer(bystander, MARKER)

    hop.swallowAnswersFrom(MARKER)
    hop.cut()
    await Promise.all([closed(bystander.client), closed(bystander.server)])
    const later = await connect()
    await fromClient(later, text('a new connection'))
    await fromServer(later, MARKER)
  })
})

describe('round trips through a hop', () => {
  // A round trip is a turn: the client speaking again after the server last
  // did. A driver that sends Parse, Describe and Flush in one write and Bind
  // and Execute in a second, after the answer, has made two; one that pipes
  // both in one write has made one. Counting the request, then the reply, then
  // the next request as anything but two would make every pinned count in the
  // adapter suites mean something else.
  test('a request, its reply and the next request are two', async () => {
    const { hop, connect } = await setUp()
    const ends = await connect()
    const turns = hop.countRoundTrips()
    await fromClient(ends, text('request'))
    await fromServer(ends, text('reply'))
    await fromClient(ends, text('request'))
    expect(turns()).toBe(2)
  })

  // A client that writes twice before the server answers has not waited for
  // anything: the latency it pays is one round trip's. Counting client chunks
  // would count it twice, and a driver's write buffering would change a pin.
  test('two client writes before a reply are one', async () => {
    const { hop, connect } = await setUp()
    const ends = await connect()
    const turns = hop.countRoundTrips()
    await fromClient(ends, text('parse'))
    await fromClient(ends, text('bind'))
    await fromServer(ends, text('ready'))
    expect(turns()).toBe(1)
  })

  // A long answer arrives in several reads -- a page of rows, a TDS answer
  // past one packet. The client's next request is still one turn after it.
  test('a reply split into two server chunks is one turn before the next request', async () => {
    const { hop, connect } = await setUp()
    const ends = await connect()
    const turns = hop.countRoundTrips()
    await fromClient(ends, text('select'))
    await fromServer(ends, text('rows 1-25;'))
    await fromServer(ends, text('rows 26-51;'))
    expect(turns()).toBe(1)
    await fromClient(ends, text('select'))
    expect(turns()).toBe(2)
  })

  // A pool spreads statements over several connections; an operation's
  // round trips are all of them, wherever each ran.
  test('turns on two connections sum', async () => {
    const { hop, connect } = await setUp()
    const one = await connect()
    const two = await connect()
    const turns = hop.countRoundTrips()
    await fromClient(one, text('a'))
    await fromServer(one, text('b'))
    await fromClient(two, text('c'))
    await fromServer(two, text('d'))
    await fromClient(two, text('e'))
    expect(turns()).toBe(3)
  })

  // The counting pass warms a connection up first and counts one request
  // after it. What went before the call must not be in the count, and a turn
  // already begun -- the client spoke last -- is not a new one.
  test('a counter started later counts only from then', async () => {
    const { hop, connect } = await setUp()
    const ends = await connect()
    await fromClient(ends, text('warm-up'))
    await fromServer(ends, text('warm'))
    await fromClient(ends, text('still the same turn'))
    const turns = hop.countRoundTrips()
    await fromClient(ends, text('and again'))
    expect(turns()).toBe(0)
    await fromServer(ends, text('answer'))
    await fromClient(ends, text('next'))
    expect(turns()).toBe(1)
  })
})

/** A scheduler the test runs by hand: what the hop asked to run, and when, without a clock. */
function manualScheduler(): { schedule: (callback: () => void, ms: number) => unknown; pending: Array<{ callback: () => void; ms: number }> } {
  const pending: Array<{ callback: () => void; ms: number }> = []
  return {
    pending,
    schedule: (callback, ms) => {
      pending.push({ callback, ms })
      return undefined
    },
  }
}

describe('delayed answers', () => {
  // The added-latency block holds every answer for D before the driver sees
  // it. An answer forwarded first and timed afterwards would measure nothing:
  // no byte may reach the client until the scheduled callback runs. Absence
  // has no event, so after the hop has asked for the callback the test gives
  // loopback 200 ms, as `swallowed` does, before it looks.
  test('nothing reaches the client until the scheduler runs', async () => {
    const { hop, connect } = await setUp()
    const ends = await connect()
    const scheduler = manualScheduler()
    hop.delayAnswers(5, scheduler.schedule)
    ends.server.write(text('held'))
    await until(() => scheduler.pending.length === 1, 'the hop scheduled the answer')
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(ends.atClient().length).toBe(0)
    expect(scheduler.pending[0]?.ms).toBe(5)
    scheduler.pending[0]?.callback()
    await until(() => ends.atClient().toString('latin1') === 'held', 'the client received the held answer')
  })

  // A delay that reordered two reads of one answer would hand the driver a
  // corrupt protocol stream. Order is kept even when the callbacks run in the
  // opposite order to the one they were asked for.
  test('two chunks arrive in order, whichever callback runs first', async () => {
    const { hop, connect } = await setUp()
    const ends = await connect()
    const scheduler = manualScheduler()
    hop.delayAnswers(5, scheduler.schedule)
    ends.server.write(text('first;'))
    await until(() => scheduler.pending.length === 1, 'the hop scheduled the first chunk')
    ends.server.write(text('second;'))
    await until(() => scheduler.pending.length === 2, 'the hop scheduled the second chunk')
    scheduler.pending[1]?.callback()
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(ends.atClient().length).toBe(0)
    scheduler.pending[0]?.callback()
    await until(() => ends.atClient().toString('latin1') === 'first;second;', 'the client received both chunks in order')
  })

  // The undelayed pass of the same block goes through the same hop: with a
  // delay of zero nothing is scheduled at all, so it measures the hop and not
  // a timer's granularity.
  test('delayAnswers(0) forwards at once, without scheduling', async () => {
    const { hop, connect } = await setUp()
    const ends = await connect()
    const scheduler = manualScheduler()
    hop.delayAnswers(0, scheduler.schedule)
    await fromServer(ends, text('straight through'))
    expect(scheduler.pending).toEqual([])
  })

  // The latency block switches the delay off between its passes; an answer
  // arriving then must still wait behind the one held from before, or the
  // driver reads the second half of a message before its first.
  test('an answer after the delay is lowered to 0 waits behind the ones still held', async () => {
    const { hop, connect } = await setUp()
    const ends = await connect()
    const scheduler = manualScheduler()
    hop.delayAnswers(5, scheduler.schedule)
    ends.server.write(text('held;'))
    await until(() => scheduler.pending.length === 1, 'the hop scheduled the first chunk')
    hop.delayAnswers(0, scheduler.schedule)
    ends.server.write(text('after;'))
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(ends.atClient().length).toBe(0)
    expect(scheduler.pending).toHaveLength(1)
    scheduler.pending[0]?.callback()
    await until(() => ends.atClient().toString('latin1') === 'held;after;', 'the client received both chunks in order')
    await fromServer(ends, text('straight through'))
  })

  // `setTimeout` reads a negative or NaN delay as one millisecond, so a
  // block configured with one would publish a "delay" nobody chose.
  test('refuses a delay that is not a number of milliseconds, at least 0', async () => {
    const { hop } = await setUp()
    for (const ms of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => hop.delayAnswers(ms)).toThrow(/at least 0/)
  })

  // A server's last words and its FIN: the FIN must wait behind the answers
  // the delay is holding, or the driver sees a closed socket before the
  // error that explains it.
  test('a close waits for the held answers before it', async () => {
    const { hop, connect } = await setUp()
    const ends = await connect()
    const scheduler = manualScheduler()
    hop.delayAnswers(5, scheduler.schedule)
    const clientEnded = new Promise<void>((resolve) => ends.client.once('end', () => resolve()))
    let ended = false
    void clientEnded.then(() => (ended = true))
    ends.server.end(text('last words'))
    await until(() => scheduler.pending.length === 1, 'the hop scheduled the last answer')
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(ended).toBe(false)
    scheduler.pending[0]?.callback()
    await bounded(clientEnded, 'the client never saw the end')
    expect(ends.atClient().toString('latin1')).toBe('last words')
  })

  // The turn counter and the delay together, as the latency block uses them:
  // a turn is counted when the client speaks after hearing the server, so an
  // answer still held by the hop has not been heard.
  test('an answer the hop still holds has not ended the turn', async () => {
    const { hop, connect } = await setUp()
    const ends = await connect()
    const scheduler = manualScheduler()
    const turns = hop.countRoundTrips()
    await fromClient(ends, text('request'))
    hop.delayAnswers(5, scheduler.schedule)
    ends.server.write(text('reply'))
    await until(() => scheduler.pending.length === 1, 'the hop scheduled the reply')
    await fromClient(ends, text('pipelined, before the reply was heard'))
    expect(turns()).toBe(1)
    scheduler.pending[0]?.callback()
    await until(() => ends.atClient().toString('latin1') === 'reply', 'the client received the reply')
    await fromClient(ends, text('after the reply'))
    expect(turns()).toBe(2)
  })
})

describe('answerBytes', () => {
  // postgres.js speaks UTF-8 and tedious UTF-16LE: the same marker in the
  // wrong encoding is never found, and the suite times out saying so.
  test('is UTF-8 for PostgreSQL and UTF-16LE for SQL Server', () => {
    expect(answerBytes('postgres', 'né')).toEqual(Buffer.from([0x6e, 0xc3, 0xa9]))
    expect(answerBytes('sqlserver', 'né')).toEqual(Buffer.from([0x6e, 0x00, 0xe9, 0x00]))
  })
})
