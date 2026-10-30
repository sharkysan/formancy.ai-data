import { createRequire } from 'node:module'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { inspect } from 'node:util'
import { PRELOGIN_ENCRYPTION, preloginAnswer, preloginPayload, startPreloginStandIn, TDS_PACKET, tdsPacket } from '@formancy/data-fixtures'
import { afterEach, describe, expect, test } from 'vitest'
import { connectSqlServer, sqlServerConfig } from './connect.js'
import { encryptedConnector, guardPrelogin, readPreloginAnswer, UNENCRYPTED_ANSWER, UNREADABLE_ANSWER } from './encryption.js'

/*
 * A SQL login that asked for TLS, refused when the server answers that it
 * will not encrypt (0081), without a container.
 *
 * Through connectSqlServer the client is the real mssql and tedious, and
 * the server a stand-in from data-fixtures that answers PRELOGIN in the
 * server's place, as whoever is on the network path can, and keeps the
 * type of every packet the client sends after: a network fixture, not a
 * mocked driver (0003). Before the guard, answered NOT_SUP or OFF, the
 * client's next packet was LOGIN7 (0x10), its password in it.
 *
 * The parser and the stream are tested below over bytes and a loopback
 * socket: what a real server sends -- one answer in one packet, in one
 * read -- cannot show an answer split across packets and reads, or one
 * with bytes after it. That a real server's answer, and the TLS handshake
 * after it, pass the guard on every image of the matrix is
 * adapter.integration.test.ts's.
 */

const USER = 'erp_app'
const PASSWORD = 'stand-in-password-6d1'

/** A SQL login over TDS 7 with TLS asked for, to the stand-in's port. */
function sqlLogin(port: number) {
  return { host: '127.0.0.1', port, database: 'erp', user: USER, password: PASSWORD, encrypt: true, trustServerCertificate: false }
}

/** Every place an error could carry something: its message, its whole inspected graph, causes and hidden properties included, and its JSON. */
function everywhere(error: unknown): string {
  return [String((error as Error).message), inspect(error, { depth: Infinity, showHidden: true }), JSON.stringify(error)].join('\n')
}

/** What connectSqlServer rejects with when the stand-in answers `answer`, and the packets the client sent it. */
async function refusedBy(answer: Buffer): Promise<{ error: unknown; sent: readonly (readonly number[])[] }> {
  const standIn = await startPreloginStandIn(answer)
  try {
    const error = await connectSqlServer(sqlLogin(standIn.port)).then(
      () => undefined,
      (rejected: unknown) => rejected,
    )
    await standIn.settled()
    return { error, sent: standIn.sent }
  } finally {
    await standIn.close()
  }
}

describe.each([
  ['NOT_SUP', PRELOGIN_ENCRYPTION.NOT_SUP],
  ['OFF', PRELOGIN_ENCRYPTION.OFF],
])('a SQL login with encrypt: true, answered %s', (_name, encryption) => {
  // The defect: tedious starts TLS only for ON or REQ, and sent LOGIN7 next
  // for any other answer, so whoever answered in the server's place was
  // sent the password. Now the connection ends after the client's PRELOGIN,
  // and the stand-in hears nothing more on it. The characterisation this
  // replaced passed against 0.1.0's code with [PRELOGIN, LOGIN7], and this
  // was watched failing so with the refusal removed from the guard.
  test('is refused after PRELOGIN, and LOGIN7 is never sent', async () => {
    const { error, sent } = await refusedBy(preloginAnswer(encryption))
    expect(sent).toEqual([[TDS_PACKET.PRELOGIN]])
    expect(error).toMatchObject({ code: 'EENCRYPT', message: UNENCRYPTED_ANSWER })
  })

  // What the operator reads names nothing of the login: not the user, not
  // the password, in the message, the error's whole graph or its JSON.
  // Watched failing with connectSqlServer's refusal naming both.
  test('rejects with a sentence that holds nothing of the login', async () => {
    const { error } = await refusedBy(preloginAnswer(encryption))
    const text = everywhere(error)
    expect(text).not.toContain(PASSWORD)
    expect(text).not.toContain(USER)
  })
})

// An answer the guard cannot read is refused as well, rather than handed
// to tedious, whose parser would start no TLS for a missing ENCRYPTION
// option and send LOGIN7. Watched failing with the guard passing what it
// cannot read: the stand-in heard LOGIN7.
test('a SQL login with encrypt: true is refused an answer with no ENCRYPTION option, and sends no LOGIN7', async () => {
  const { error, sent } = await refusedBy(tdsPacket(TDS_PACKET.RESPONSE, options([[0x00, Buffer.from([16, 0, 0x10, 0, 0, 0])]])))
  expect(sent).toEqual([[TDS_PACKET.PRELOGIN]])
  expect(error).toMatchObject({ code: 'EENCRYPT', message: UNREADABLE_ANSWER })
})

// Why the guard stays now that tedious 20.3.7 refuses an unencrypted answer
// itself: a server that sends part of its first message -- a packet not
// marked last -- and then closes leaves tedious's connect pending without
// end, past its own connect timeout, because readPreloginResponse, abandoned,
// awaits its iterator's `return()`, which waits on the read it abandoned
// (measured on 2026-10-17 with 20.3.7: not settled 40 s after the close).
// The server's registry then holds that connection's open as pending until
// the process is killed. The guard withholds the part and ends with the
// socket, so the connect fails at once. Watched failing with the guard
// left out of the config: still pending 2 s after the close.
test('a SQL login with encrypt: true, sent part of an answer and then closed, fails at once and sends no LOGIN7', async () => {
  const standIn = await startPreloginStandIn(tdsPacket(TDS_PACKET.RESPONSE, preloginPayload(PRELOGIN_ENCRYPTION.NOT_SUP), false))
  let outcome: unknown = 'pending'
  void connectSqlServer(sqlLogin(standIn.port)).then(
    () => (outcome = 'connected'),
    (error: unknown) => (outcome = error),
  )
  try {
    while (standIn.sent[0]?.length !== 1) await new Promise((resolve) => setTimeout(resolve, 5))
    // The stand-in answers as the PRELOGIN is in; on loopback the part is read well within this.
    await new Promise((resolve) => setTimeout(resolve, 100))
  } finally {
    await standIn.close()
  }
  for (let waited = 0; outcome === 'pending' && waited < 2000; waited += 20) await new Promise((resolve) => setTimeout(resolve, 20))
  expect(standIn.sent).toEqual([[TDS_PACKET.PRELOGIN]])
  expect(outcome).toMatchObject({ code: 'ESOCKET' })
})

describe('what mssql is given', () => {
  // The guard is where it is needed and nowhere else: every SQL login that
  // asked for TLS, and not one the operator set unencrypted -- the login
  // goes unencrypted there by their choice -- nor an Entra pool, which is
  // TDS 8.0, TLS before any TDS message (0074). Watched failing with the
  // connector left out of the SQL login's options.
  test('a SQL login with encrypt: true is given the guarded connector, and no other pool is', () => {
    const address = { host: 'erp.example', port: 1433, database: 'erp' }
    expect(sqlServerConfig({ ...address, user: USER, password: PASSWORD, encrypt: true, trustServerCertificate: false }).options?.connector).toBe(
      encryptedConnector,
    )
    expect(sqlServerConfig({ ...address, user: USER, password: PASSWORD, encrypt: true, trustServerCertificate: true }).options?.connector).toBe(
      encryptedConnector,
    )
    expect(sqlServerConfig({ ...address, user: USER, password: PASSWORD, encrypt: false, trustServerCertificate: true }).options).not.toHaveProperty(
      'connector',
    )
    expect(sqlServerConfig({ ...address, encrypt: true, trustServerCertificate: false, entra: { type: 'managed-identity' } }).options).not.toHaveProperty(
      'connector',
    )
  })
})

/** A PRELOGIN payload of `entries`, each a token and its data, laid out as SQL Server lays one out, with the terminator unless told otherwise. */
function options(entries: ReadonlyArray<readonly [number, Buffer]>, terminated = true): Buffer {
  const table = Buffer.alloc(entries.length * 5 + (terminated ? 1 : 0))
  let offset = table.length
  entries.forEach(([token, data], index) => {
    table[index * 5] = token
    table.writeUInt16BE(offset, index * 5 + 1)
    table.writeUInt16BE(data.length, index * 5 + 3)
    offset += data.length
  })
  if (terminated) table[table.length - 1] = 0xff
  return Buffer.concat([table, ...entries.map(([, data]) => data)])
}

const VERSION = Buffer.from([16, 0, 0x10, 0, 0, 0])

/** tedious's own PRELOGIN parser, from the copy mssql loads, to hold the guard's reading to the one tedious acts on. */
const PreloginPayload = createRequire(createRequire(import.meta.url).resolve('mssql'))('tedious/lib/prelogin-payload') as new (data: Buffer) => {
  encryptionString?: string
}

describe('readPreloginAnswer', () => {
  // A real server's answer, ON or REQ, passes, and the guard says where it
  // ends, so the bytes after it pass too. Refusing these would refuse every
  // server that encrypts.
  test.each([
    ['ON', PRELOGIN_ENCRYPTION.ON],
    ['REQ', PRELOGIN_ENCRYPTION.REQ],
  ])('reads an answer of %s as encrypting, and its length', (_name, encryption) => {
    const answer = preloginAnswer(encryption)
    expect(readPreloginAnswer(answer)).toEqual({ kind: 'encrypts', length: answer.length })
  })

  // The two answers tedious went on from without TLS.
  test.each([
    ['OFF', PRELOGIN_ENCRYPTION.OFF],
    ['NOT_SUP', PRELOGIN_ENCRYPTION.NOT_SUP],
  ])('refuses an answer of %s', (_name, encryption) => {
    expect(readPreloginAnswer(preloginAnswer(encryption))).toEqual({ kind: 'refused', reason: UNENCRYPTED_ANSWER })
  })

  // A decision on part of an answer would read an ENCRYPTION byte that is
  // not there yet, or another packet's byte in its place: every proper
  // prefix of a one-packet and of a two-packet answer is too few bytes.
  test('decides nothing on any proper prefix of an answer, in one packet or two', () => {
    const payload = preloginPayload(PRELOGIN_ENCRYPTION.ON)
    const split = Buffer.concat([tdsPacket(TDS_PACKET.RESPONSE, payload.subarray(0, 7), false), tdsPacket(TDS_PACKET.RESPONSE, payload.subarray(7))])
    for (const answer of [preloginAnswer(PRELOGIN_ENCRYPTION.ON), split]) {
      for (let length = 0; length < answer.length; length++)
        expect(readPreloginAnswer(answer.subarray(0, length)), `${String(length)} bytes`).toEqual({ kind: 'incomplete' })
      expect(readPreloginAnswer(answer)).toEqual({ kind: 'encrypts', length: answer.length })
    }
  })

  // A message is its packets up to the one marked last, whose payloads
  // make one option table: reading the first packet alone would find no
  // terminator, and reading the ENCRYPTION byte at its offset in the first
  // packet's payload would read the wrong byte. Split between the option
  // table and the data, NOT_SUP is still refused.
  test('reads an answer split across packets as one message', () => {
    const payload = preloginPayload(PRELOGIN_ENCRYPTION.NOT_SUP)
    const split = Buffer.concat([
      tdsPacket(TDS_PACKET.RESPONSE, payload.subarray(0, 11), false),
      tdsPacket(TDS_PACKET.RESPONSE, payload.subarray(11, 15), false),
      tdsPacket(TDS_PACKET.RESPONSE, payload.subarray(15)),
    ])
    expect(readPreloginAnswer(split)).toEqual({ kind: 'refused', reason: UNENCRYPTED_ANSWER })
  })

  // The bytes after the answer are not part of it: the length the guard
  // passes on is the answer's, and what follows is not read as a packet of
  // it -- a TLS record after an answer of ON would otherwise be unreadable.
  test('says where an answer ends when bytes follow it', () => {
    const answer = preloginAnswer(PRELOGIN_ENCRYPTION.REQ)
    expect(readPreloginAnswer(Buffer.concat([answer, Buffer.from([0x16, 0x03, 0x03, 0x00])]))).toEqual({ kind: 'encrypts', length: answer.length })
  })

  // Each is an answer tedious would not have started TLS for, or would
  // have read another way than the guard: refused, never passed on.
  test.each([
    ['a first message that is not a response', tdsPacket(TDS_PACKET.PRELOGIN, preloginPayload(PRELOGIN_ENCRYPTION.ON))],
    ['a packet shorter than its header', Buffer.from([TDS_PACKET.RESPONSE, 0x01, 0x00, 0x04, 0, 0, 1, 0])],
    ['no ENCRYPTION option', tdsPacket(TDS_PACKET.RESPONSE, options([[0x00, VERSION]]))],
    [
      'two ENCRYPTION options',
      tdsPacket(
        TDS_PACKET.RESPONSE,
        options([
          [0x01, Buffer.from([PRELOGIN_ENCRYPTION.ON])],
          [0x01, Buffer.from([PRELOGIN_ENCRYPTION.NOT_SUP])],
        ]),
      ),
    ],
    ['an ENCRYPTION option of two bytes', tdsPacket(TDS_PACKET.RESPONSE, options([[0x01, Buffer.from([PRELOGIN_ENCRYPTION.ON, 0])]]))],
    ['an option whose data lies past the payload', tdsPacket(TDS_PACKET.RESPONSE, Buffer.from([0x01, 0x00, 0xc8, 0x00, 0x01, 0xff, PRELOGIN_ENCRYPTION.ON]))],
    ['an option table with no terminator', tdsPacket(TDS_PACKET.RESPONSE, options([[0x01, Buffer.from([PRELOGIN_ENCRYPTION.ON])]], false))],
    ['an option entry cut short', tdsPacket(TDS_PACKET.RESPONSE, Buffer.from([0x01, 0x00, 0x05]))],
    ['ON with the client-certificate bit, which tedious does not know', preloginAnswer(0x81)],
    ['an encryption value MS-TDS does not name', preloginAnswer(0x04)],
  ])('refuses %s', (_name, answer) => {
    expect(readPreloginAnswer(answer)).toEqual({ kind: 'refused', reason: UNREADABLE_ANSWER })
  })

  // A server that never marks a packet last would otherwise be held
  // without end. No option can reach past 0xFFFF + 0xFFFF bytes of
  // payload, so the third full-size packet is refused from its header,
  // before its bytes arrive.
  test('refuses a first message longer than any PRELOGIN payload can be, from the header that makes it so', () => {
    const full = (): Buffer => tdsPacket(TDS_PACKET.RESPONSE, Buffer.alloc(0xffff - 8), false)
    expect(readPreloginAnswer(Buffer.concat([full(), full()]))).toEqual({ kind: 'incomplete' })
    expect(readPreloginAnswer(Buffer.concat([full(), full(), full().subarray(0, 8)]))).toEqual({ kind: 'refused', reason: UNREADABLE_ANSWER })
  })

  // If the guard and tedious ever read an answer differently, the guard's
  // check is of another answer than the one tedious acts on. For every
  // answer above that the guard passes, tedious's own parser reads ON or
  // REQ, and for every one it refuses as unencrypted, OFF or NOT_SUP.
  test('passes only what tedious reads as ON or REQ', () => {
    const answers = [PRELOGIN_ENCRYPTION.ON, PRELOGIN_ENCRYPTION.REQ, PRELOGIN_ENCRYPTION.OFF, PRELOGIN_ENCRYPTION.NOT_SUP].map((encryption) =>
      preloginAnswer(encryption),
    )
    answers.push(
      tdsPacket(
        TDS_PACKET.RESPONSE,
        options([
          [0x01, Buffer.from([PRELOGIN_ENCRYPTION.REQ])],
          [0x00, VERSION],
          [0x02, Buffer.from([0])],
          [0x04, Buffer.from([0])],
        ]),
      ),
    )
    for (const answer of answers) {
      const read = readPreloginAnswer(answer)
      const tedious = new PreloginPayload(answer.subarray(8)).encryptionString
      if (read.kind === 'encrypts') expect(['ON', 'REQ']).toContain(tedious)
      else expect(['OFF', 'NOT_SUP']).toContain(tedious)
    }
  })
})

/** A loopback connection: the client's end behind the guard, the server's end raw, and the client's raw socket. */
interface Loopback {
  guarded: net.Socket
  raw: net.Socket
  server: net.Socket
}

const opened: Array<{ loopback: Loopback; listener: net.Server }> = []

async function loopback(): Promise<Loopback> {
  const listener = net.createServer()
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve))
  const accepted = new Promise<net.Socket>((resolve) => listener.once('connection', resolve))
  const raw = net.connect((listener.address() as AddressInfo).port, '127.0.0.1')
  await new Promise<void>((resolve) => raw.once('connect', () => resolve()))
  const server = await accepted
  server.setNoDelay(true)
  server.on('error', () => {})
  // Flowing, so that it reads the client's FIN and closes, as a server does.
  server.resume()
  const made = { guarded: guardPrelogin(raw), raw, server }
  opened.push({ loopback: made, listener })
  return made
}

afterEach(async () => {
  for (const { loopback: made, listener } of opened.splice(0)) {
    made.guarded.destroy()
    made.server.destroy()
    await new Promise<void>((resolve) => listener.close(() => resolve()))
  }
})

/** Everything the guard passes on, collected, and the error it ends with. */
function reader(guarded: net.Socket): { bytes: () => Buffer; errors: Error[]; ended: Promise<void> } {
  const chunks: Buffer[] = []
  const errors: Error[] = []
  guarded.on('data', (chunk: Buffer) => chunks.push(chunk))
  guarded.on('error', (error) => errors.push(error))
  const ended = new Promise<void>((resolve) => {
    guarded.once('end', () => resolve())
    guarded.once('close', () => resolve())
  })
  return { bytes: () => Buffer.concat(chunks), errors, ended }
}

/** Resolves when the client's raw socket has received at least `length` bytes in all. */
function rawReceived(raw: net.Socket, length: number): Promise<void> {
  let seen = 0
  return new Promise((resolve) => {
    const onData = (chunk: Buffer): void => {
      seen += chunk.length
      if (seen < length) return
      raw.removeListener('data', onData)
      resolve()
    }
    raw.on('data', onData)
  })
}

/** Lets the event loop run every I/O callback that is due. */
function turn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20))
}

describe('the guard', () => {
  // The answer in two packets over two reads: nothing reaches tedious
  // until the last byte of the answer is in, so tedious never decides on
  // part of one, and then every byte, in order, unchanged. Watched failing
  // with the withholding removed: the first read was passed on alone.
  test('passes nothing of an answer split across reads and packets until it is whole, then all of it', async () => {
    const { guarded, raw, server } = await loopback()
    const read = reader(guarded)
    guarded.write(Buffer.from([TDS_PACKET.PRELOGIN]))
    const payload = preloginPayload(PRELOGIN_ENCRYPTION.ON)
    const first = tdsPacket(TDS_PACKET.RESPONSE, payload.subarray(0, 9), false)
    const second = tdsPacket(TDS_PACKET.RESPONSE, payload.subarray(9))
    const firstIn = rawReceived(raw, first.length + 3)
    server.write(Buffer.concat([first, second.subarray(0, 3)]))
    await firstIn
    await turn()
    expect(read.bytes()).toEqual(Buffer.alloc(0))
    server.write(second.subarray(3))
    await turn()
    expect(read.bytes()).toEqual(Buffer.concat([first, second]))
    expect(read.errors).toEqual([])
  })

  // The answer and what follows it in one read -- a TLS record, say -- all
  // pass, unchanged: dropping the rest would stall the TLS handshake
  // tedious wraps in PRELOGIN packets after an answer of ON. And from then
  // on everything passes as it comes, both ways.
  test('passes an answer with bytes after it in one read, and everything after, both ways', async () => {
    const { guarded, server } = await loopback()
    const read = reader(guarded)
    const heard: Buffer[] = []
    server.on('data', (chunk: Buffer) => heard.push(chunk))
    guarded.write(Buffer.from([TDS_PACKET.PRELOGIN]))
    const after = Buffer.from([0x16, 0x03, 0x03, 0x00, 0x02, 0xaa, 0xbb])
    server.write(Buffer.concat([preloginAnswer(PRELOGIN_ENCRYPTION.ON), after]))
    await turn()
    expect(read.bytes()).toEqual(Buffer.concat([preloginAnswer(PRELOGIN_ENCRYPTION.ON), after]))
    server.write(Buffer.from([0x17, 0x01]))
    guarded.write(Buffer.from([0x17, 0x02]))
    await turn()
    expect(read.bytes().subarray(-2)).toEqual(Buffer.from([0x17, 0x01]))
    expect(Buffer.concat(heard)).toEqual(Buffer.from([TDS_PACKET.PRELOGIN, 0x17, 0x02]))
  })

  // What every connection with TLS on pays for the guard (0081): after the
  // answer, each chunk the socket reads is passed on as that same memory,
  // queued and emitted once more, and only the first message, withheld
  // until it is read, is copied. A guard that copied each chunk would
  // allocate and copy everything the server sends a second time, a cost
  // 0081 says it does not have. Watched failing with each chunk after the
  // answer passed on as a copy.
  test("passes on each chunk after the answer as the socket's own memory, not a copy", async () => {
    const { guarded, raw, server } = await loopback()
    const fromSocket: Buffer[] = []
    raw.on('data', (chunk: Buffer) => fromSocket.push(chunk))
    const passed: Buffer[] = []
    guarded.on('data', (chunk: Buffer) => passed.push(chunk))
    guarded.write(Buffer.from([TDS_PACKET.PRELOGIN]))
    server.write(preloginAnswer(PRELOGIN_ENCRYPTION.ON))
    await turn()
    for (const fill of [1, 2, 3, 4, 5]) {
      server.write(Buffer.alloc(30_000, fill))
      await turn()
    }
    const after = passed.slice(1)
    expect(Buffer.concat(after)).toEqual(Buffer.concat([1, 2, 3, 4, 5].map((fill) => Buffer.alloc(30_000, fill))))
    const own = (chunk: Buffer): boolean =>
      fromSocket.some((read) => read.buffer === chunk.buffer && read.byteOffset === chunk.byteOffset && read.length === chunk.length)
    expect(after.filter((chunk) => !own(chunk))).toEqual([])
  })

  // A refusal ends the TCP connection, so nothing tedious might write
  // after it reaches the server, and passes nothing of the answer on.
  test('ends the connection on an answer of NOT_SUP, with the sentence, and passes nothing', async () => {
    const { guarded, server } = await loopback()
    const read = reader(guarded)
    let closed = false
    const closing = new Promise<void>((resolve) => server.once('close', () => resolve()))
    void closing.then(() => (closed = true))
    guarded.write(Buffer.from([TDS_PACKET.PRELOGIN]))
    server.write(preloginAnswer(PRELOGIN_ENCRYPTION.NOT_SUP))
    await Promise.race([closing, new Promise((resolve) => setTimeout(resolve, 2000))])
    expect(closed).toBe(true)
    expect(read.bytes()).toEqual(Buffer.alloc(0))
    expect(read.errors.map((error) => error.message)).toEqual([UNENCRYPTED_ANSWER])
  })

  // An answer that arrives before the client has written anything is not
  // decided on until it has: tedious listens for the stream's error before
  // it writes its PRELOGIN, and an error emitted before anyone listened
  // would end the process. Watched failing with the decision made on
  // arrival: the error came before the write.
  test('decides on an answer that came before the client spoke only once it has', async () => {
    const { guarded, raw, server } = await loopback()
    const errors: Error[] = []
    const arrived = rawReceived(raw, 1)
    server.write(preloginAnswer(PRELOGIN_ENCRYPTION.OFF))
    await arrived
    await turn()
    guarded.on('error', (error) => errors.push(error))
    expect(errors).toEqual([])
    guarded.write(Buffer.from([TDS_PACKET.PRELOGIN]))
    await turn()
    expect(errors.map((error) => error.message)).toEqual([UNENCRYPTED_ANSWER])
  })

  // A server that ends the connection before its answer is whole ends the
  // stream, as a socket would, without a refusal it did not earn: tedious
  // then says the socket hung up. What it sent is dropped, so tedious
  // never decides on part of an answer.
  test('ends, without an error, when the server ends before its answer is whole', async () => {
    const { guarded, server } = await loopback()
    const read = reader(guarded)
    guarded.write(Buffer.from([TDS_PACKET.PRELOGIN]))
    server.end(preloginAnswer(PRELOGIN_ENCRYPTION.ON).subarray(0, 12))
    await read.ended
    expect(read.bytes()).toEqual(Buffer.alloc(0))
    expect(read.errors).toEqual([])
  })
})
