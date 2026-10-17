import net from 'node:net'
import { afterEach, expect, test } from 'vitest'
import { PRELOGIN_ENCRYPTION, preloginAnswer, startPreloginStandIn, TDS_PACKET, tdsPacket } from './prelogin.js'
import type { PreloginStandIn } from './prelogin.js'

/*
 * The stand-in's own rules, with a raw socket for a client. What it shows
 * of mssql and tedious is data-sqlserver's (encryption.test.ts) and the
 * server's (routes/unencrypted.integration.test.ts); this file shows only
 * that it answers what it is given, keeps each packet's type in order, and
 * closes where it says, so a suite that reads `sent` reads the wire.
 */

const started: PreloginStandIn[] = []

afterEach(async () => {
  for (const standIn of started.splice(0)) await standIn.close()
})

async function standIn(answer: Buffer): Promise<PreloginStandIn> {
  const made = await startPreloginStandIn(answer)
  started.push(made)
  return made
}

/** A raw client: what it has received, and a promise of the connection's close. */
async function client(port: number): Promise<{ socket: net.Socket; received: () => Buffer; closed: Promise<void> }> {
  const socket = net.connect(port, '127.0.0.1')
  socket.on('error', () => {})
  const chunks: Buffer[] = []
  socket.on('data', (chunk: Buffer) => chunks.push(chunk))
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))
  await new Promise<void>((resolve) => socket.once('connect', () => resolve()))
  return { socket, received: () => Buffer.concat(chunks), closed }
}

/** Resolves once `read` holds `length` bytes. */
async function until(read: () => Buffer, length: number): Promise<void> {
  while (read().length < length) await new Promise((resolve) => setTimeout(resolve, 5))
}

// The answer is written as given, after the client's PRELOGIN and not
// before; a LOGIN7 after it is kept as its type and ends the connection,
// as the characterisation in data-sqlserver read it. A stand-in that
// answered before it was asked, or kept no LOGIN7, would show a client
// something no network path does, or hide what the client sent.
test('answers a PRELOGIN with what it was given, keeps the type of what follows, and closes at a LOGIN7', async () => {
  const answer = preloginAnswer(PRELOGIN_ENCRYPTION.NOT_SUP)
  const listener = await standIn(answer)
  const { socket, received, closed } = await client(listener.port)
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(received()).toEqual(Buffer.alloc(0))
  socket.write(tdsPacket(TDS_PACKET.PRELOGIN, Buffer.from([0xff])))
  await until(received, answer.length)
  expect(received()).toEqual(answer)
  socket.write(tdsPacket(TDS_PACKET.LOGIN7, Buffer.alloc(40, 0x61)))
  await closed
  await listener.settled()
  expect(listener.sent).toEqual([[TDS_PACKET.PRELOGIN, TDS_PACKET.LOGIN7]])
})

// A packet is kept from its first byte, not once it is whole: a client
// that sent part of a LOGIN7 -- its header and the first of its payload,
// where the user and password sit -- and then closed has put a login on
// the wire, and a stand-in that waited for the whole packet would read
// `[PRELOGIN]`, what the suites call "LOGIN7 is never sent". Watched
// failing with the type kept only once the packet was whole: `[[0x12]]`.
test('keeps a LOGIN7 a close cuts short', async () => {
  const answer = preloginAnswer(PRELOGIN_ENCRYPTION.NOT_SUP)
  const listener = await standIn(answer)
  const { socket, received, closed } = await client(listener.port)
  socket.write(tdsPacket(TDS_PACKET.PRELOGIN, Buffer.from([0xff])))
  await until(received, answer.length)
  socket.end(tdsPacket(TDS_PACKET.LOGIN7, Buffer.alloc(200, 0x61)).subarray(0, 120))
  await closed
  await listener.settled()
  expect(listener.sent).toEqual([[TDS_PACKET.PRELOGIN, TDS_PACKET.LOGIN7]])
})

// A client that opens with TLS, as an Entra pool does over TDS 8.0, is
// kept as the TLS record's first byte and closed: the stand-in speaks no
// TLS, and a client that waited on it would hang its suite.
test('keeps a TLS record as its first byte, and closes', async () => {
  const listener = await standIn(preloginAnswer(PRELOGIN_ENCRYPTION.OFF))
  const { socket, closed } = await client(listener.port)
  socket.write(Buffer.from([TDS_PACKET.TLS_HANDSHAKE, 0x03, 0x01, 0x00, 0x05]))
  await closed
  expect(listener.sent).toEqual([[TDS_PACKET.TLS_HANDSHAKE]])
})

// `settled()` is what a suite waits on before it reads `sent`, so it must
// not resolve while a connection could still carry a packet: a client
// that is still open keeps it waiting, and its close releases it.
test('settles only once every connection it accepted has closed', async () => {
  const listener = await standIn(preloginAnswer(PRELOGIN_ENCRYPTION.OFF))
  const { socket, closed } = await client(listener.port)
  await new Promise((resolve) => setTimeout(resolve, 20))
  let settled = false
  const settling = listener.settled().then(() => (settled = true))
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(settled).toBe(false)
  socket.destroy()
  await closed
  await settling
  expect(listener.sent).toEqual([[]])
})
