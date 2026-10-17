import net from 'node:net'
import type { AddressInfo } from 'node:net'

/*
 * A TCP listener that answers in a SQL Server's place, as whoever is on the
 * network path between a client and its server can (0081). It reads the
 * client's PRELOGIN, writes the answer it was given -- a PRELOGIN response
 * whose ENCRYPTION option says OFF or NOT_SUP, say -- and from then on only
 * listens: it keeps the type of every TDS packet the client sends, from
 * the packet's first byte, so one a close cuts short is kept too, and
 * closes the connection at the first that is not a PRELOGIN, or at a TLS
 * record, since it speaks no more TDS than that and no TLS at all.
 *
 * It is a network fixture, not a mocked driver (0003): the real mssql and
 * tedious run against it, and what it shows is what the client puts on the
 * wire, which no real server can show, since none declines TLS on purpose.
 * It keeps the first byte of each packet and never a packet's bytes, so a
 * test never holds a login's password, and nothing can assert on one.
 */

/** The ENCRYPTION option's values in a PRELOGIN message ([MS-TDS], PRELOGIN). */
export const PRELOGIN_ENCRYPTION = { OFF: 0x00, ON: 0x01, NOT_SUP: 0x02, REQ: 0x03 } as const

/** The TDS packet types the stand-in tells apart, and a TLS handshake record's first byte, which is no TDS type. */
export const TDS_PACKET = { RESPONSE: 0x04, LOGIN7: 0x10, PRELOGIN: 0x12, TLS_HANDSHAKE: 0x16 } as const

/** A TDS packet's header: type, status, length, SPID, packet id, window ([MS-TDS], Packet Header). */
const HEADER = 8
/** The status bit that says a packet is its message's last. */
const END_OF_MESSAGE = 0x01

/** One TDS packet of `type` holding `payload`, the last of its message unless `last` is false. */
export function tdsPacket(type: number, payload: Uint8Array, last = true): Buffer {
  const header = Buffer.alloc(HEADER)
  header[0] = type
  header[1] = last ? END_OF_MESSAGE : 0x00
  header.writeUInt16BE(HEADER + payload.length, 2)
  header[6] = 1
  return Buffer.concat([header, payload])
}

/**
 * A PRELOGIN response's payload as SQL Server lays it out: an option table
 * -- a token, a two-byte offset and a two-byte length each -- closed by
 * 0xFF, and then each option's data. VERSION, six bytes, and ENCRYPTION,
 * one, are all a client needs to decide.
 */
export function preloginPayload(encryption: number): Buffer {
  const table = Buffer.alloc(11)
  table[0] = 0x00
  table.writeUInt16BE(11, 1)
  table.writeUInt16BE(6, 3)
  table[5] = 0x01
  table.writeUInt16BE(17, 6)
  table.writeUInt16BE(1, 8)
  table[10] = 0xff
  return Buffer.concat([table, Buffer.from([16, 0, 0x10, 0, 0, 0]), Buffer.from([encryption])])
}

/** A whole PRELOGIN response in one packet, its ENCRYPTION option `encryption`. */
export function preloginAnswer(encryption: number): Buffer {
  return tdsPacket(TDS_PACKET.RESPONSE, preloginPayload(encryption))
}

export interface PreloginStandIn {
  /** The loopback port a client connects to in the server's place. */
  readonly port: number
  /** For each connection, in the order they were accepted, the type of each packet the client sent, in order. */
  readonly sent: readonly (readonly number[])[]
  /** Resolves once every connection accepted so far has closed: nothing more can be sent on any of them. */
  settled(): Promise<void>
  close(): Promise<void>
}

/** Starts a stand-in that answers each connection's PRELOGIN with `answer`, written as it is. */
export async function startPreloginStandIn(answer: Uint8Array): Promise<PreloginStandIn> {
  const sent: number[][] = []
  const closed: Promise<void>[] = []
  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    const types: number[] = []
    sent.push(types)
    sockets.add(socket)
    closed.push(new Promise((resolve) => socket.once('close', () => resolve())))
    socket.once('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    let buffered = Buffer.alloc(0)
    /** Whether the packet `buffered` starts with has had its type kept: at its first byte, before it is whole. */
    let kept = false
    socket.on('data', (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk])
      while (buffered.length > 0) {
        const type = buffered[0] ?? 0
        if (!kept) types.push(type)
        kept = true
        if (type === TDS_PACKET.TLS_HANDSHAKE) {
          socket.destroy()
          return
        }
        if (buffered.length < HEADER) return
        const length = buffered.readUInt16BE(2)
        if (buffered.length < length) return
        buffered = buffered.subarray(Math.max(length, HEADER))
        kept = false
        if (type !== TDS_PACKET.PRELOGIN || types.length > 1) {
          socket.destroy()
          return
        }
        socket.write(answer)
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    port: (server.address() as AddressInfo).port,
    sent,
    settled: async () => {
      await Promise.all(closed)
    },
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
