import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, test } from 'vitest'
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

describe('answerBytes', () => {
  // postgres.js speaks UTF-8 and tedious UTF-16LE: the same marker in the
  // wrong encoding is never found, and the suite times out saying so.
  test('is UTF-8 for PostgreSQL and UTF-16LE for SQL Server', () => {
    expect(answerBytes('postgres', 'né')).toEqual(Buffer.from([0x6e, 0xc3, 0xa9]))
    expect(answerBytes('sqlserver', 'né')).toEqual(Buffer.from([0x6e, 0x00, 0xe9, 0x00]))
  })
})
