import type { LookupAddress } from 'node:dns'
import net from 'node:net'
import type { LookupFunction } from 'node:net'
import { Duplex } from 'node:stream'
import { domainToASCII } from 'node:url'

/*
 * A SQL login that asked for TLS is never sent without it (0081).
 *
 * `encrypt: true` is TDS 7's: the client sends PRELOGIN in the clear, and
 * tedious 20.3.3 starts TLS only when the server's PRELOGIN answer says ON
 * or REQ (connection.js, performTlsNegotiation). Answered OFF or NOT_SUP,
 * it sends LOGIN7 next, unencrypted: the user and the password under TDS's
 * reversible obfuscation, to whoever answered in the server's place.
 * [MS-TDS]'s PRELOGIN section says a client that sent ENCRYPT_ON and is
 * answered OFF or NOT_SUP ends the connection, "Error (connection
 * terminated)" (learn.microsoft.com, read 2026-10-17); tedious does not, so
 * this adapter does it for it.
 *
 * How: tedious is given a connector (`options.connector`, which mssql passes
 * through) that opens the TCP connection as tedious's own connectInSequence
 * does and hands tedious a stream in front of it, PreloginGuard. The guard
 * withholds the server's first TDS message, the PRELOGIN answer, until it
 * holds all of it and has read its ENCRYPTION option. ON or REQ: the
 * message, and everything after it, the TLS handshake TDS 7 wraps in
 * PRELOGIN packets included, passes through unchanged, and tedious decides
 * on exactly the bytes the guard read. Anything else: the connection is
 * destroyed with a fixed sentence, and tedious, which sends LOGIN7 only
 * after it has read the answer, never read one.
 *
 * Why a stream in front, and not the socket itself: tedious holds no
 * reference to the TCP socket, so nothing it does, now or in a later
 * release, can read the server's answer except through the guard. A hook on
 * the socket -- its `push`, its `data` events -- would pass the answer on
 * unread the day Node or tedious read it another way. What tedious 20.3.3
 * uses of the socket it is given, read in connection.js and message-io.js:
 * `setNoDelay` and `setKeepAlive`, which the guard forwards; `pipe` and
 * `unpipe` both ways, `destroy`, `end`, and the `error`, `close` and `end`
 * events, which a Duplex has. Its declared type says `net.Socket`, so the
 * one cast is at the connector. A tedious that used more of it would fail
 * every suite that logs in with `encrypt: true`, against a real server on
 * each image of the matrix (adapter.integration.test.ts).
 */

/** The sentence a connection is refused with when the server answers OFF or NOT_SUP. Names nothing of the login. */
export const UNENCRYPTED_ANSWER = 'The server answered that it would not encrypt the connection, so the login was not sent.'
/** The sentence for a first answer that is not a PRELOGIN response saying whether the server encrypts. */
export const UNREADABLE_ANSWER = "The server's first answer was not a PRELOGIN response this adapter could read, so the login was not sent."

/** A TDS packet header's length, and the type and status bit of a server's answer ([MS-TDS], Packet Header). */
const HEADER = 8
const RESPONSE = 0x04
const END_OF_MESSAGE = 0x01
/** PRELOGIN option tokens, and ENCRYPTION's values ([MS-TDS], PRELOGIN). */
const ENCRYPTION = 0x01
const TERMINATOR = 0xff
const ENCRYPT_OFF = 0x00
const ENCRYPT_ON = 0x01
const ENCRYPT_NOT_SUP = 0x02
const ENCRYPT_REQ = 0x03
/**
 * The most of a PRELOGIN payload any option can reach: an option's offset
 * and length are two bytes each. A first message longer than this is not
 * a PRELOGIN answer, and is refused rather than held without end.
 */
const PAYLOAD_LIMIT = 0xffff + 0xffff

/** What the bytes the server has sent so far say: too few to decide, an answer that encrypts and how long it is, or a refusal. */
export type PreloginRead = { kind: 'incomplete' } | { kind: 'encrypts'; length: number } | { kind: 'refused'; reason: string }

const INCOMPLETE: PreloginRead = { kind: 'incomplete' }
const unreadable: PreloginRead = { kind: 'refused', reason: UNREADABLE_ANSWER }

/**
 * Reads the server's first TDS message from the start of `bytes`: packets
 * of type 0x04, each read whole by its header's length, until one with the
 * end-of-message bit; then the PRELOGIN option table their payloads make,
 * walked as tedious walks it (prelogin-payload.js, extractOptions), to the
 * ENCRYPTION byte tedious would act on. Stricter than tedious where tedious
 * would not stop: an option whose data lies past the payload, no
 * terminator, no ENCRYPTION option or two, or one that is not one byte, is
 * unreadable and refused.
 */
export function readPreloginAnswer(bytes: Uint8Array): PreloginRead {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const payload: Buffer[] = []
  let size = 0
  for (let at = 0; ; ) {
    if (at >= buffer.length) return INCOMPLETE
    if (buffer[at] !== RESPONSE) return unreadable
    if (buffer.length - at < HEADER) return INCOMPLETE
    const length = buffer.readUInt16BE(at + 2)
    if (length < HEADER) return unreadable
    size += length - HEADER
    if (size > PAYLOAD_LIMIT) return unreadable
    if (buffer.length - at < length) return INCOMPLETE
    payload.push(buffer.subarray(at + HEADER, at + length))
    const last = ((buffer[at + 1] ?? 0) & END_OF_MESSAGE) !== 0
    at += length
    if (last) return verdict(encryptionOf(Buffer.concat(payload)), at)
  }
}

function verdict(encryption: number | undefined, length: number): PreloginRead {
  if (encryption === ENCRYPT_ON || encryption === ENCRYPT_REQ) return { kind: 'encrypts', length }
  if (encryption === ENCRYPT_OFF || encryption === ENCRYPT_NOT_SUP) return { kind: 'refused', reason: UNENCRYPTED_ANSWER }
  return unreadable
}

/** The ENCRYPTION option's byte, or undefined when the option table is not one this adapter can read. */
function encryptionOf(payload: Buffer): number | undefined {
  let encryption: number | undefined
  for (let at = 0; ; at += 5) {
    const token = payload[at]
    if (token === undefined) return undefined
    if (token === TERMINATOR) return encryption
    if (at + 5 > payload.length) return undefined
    const offset = payload.readUInt16BE(at + 1)
    const length = payload.readUInt16BE(at + 3)
    if (offset + length > payload.length) return undefined
    if (token === ENCRYPTION) {
      if (length !== 1 || encryption !== undefined) return undefined
      encryption = payload[offset]
    }
  }
}

/** The error a guarded connection is destroyed with. Its code is tedious's for a refused negotiation of encryption. */
class EncryptionRefused extends Error {
  readonly code = 'EENCRYPT'
  constructor(message: string) {
    super(message)
    this.name = 'EncryptionRefused'
  }
}

/**
 * The stream tedious reads and writes in place of the TCP socket. Writes
 * go straight through. The server's bytes are withheld until its first
 * message is read and passes; from then on every byte passes as it comes,
 * with the socket paused while the reader is full.
 *
 * Nothing is decided before tedious has written its PRELOGIN, and the
 * socket is paused until then: tedious listens for the stream's `error`
 * before it writes, so a refusal is never an error nobody hears, which
 * would end the process. A server that ends the connection before its
 * answer is whole ends the stream, as a socket would, and what it sent is
 * dropped.
 */
class PreloginGuard extends Duplex {
  readonly #socket: net.Socket
  /** What the server has sent of its first message, and anything after it; undefined once it passed. */
  #withheld: Buffer | undefined = Buffer.alloc(0)
  /** Whether tedious has written anything yet. */
  #spoken = false
  /** Whether the server ended its side: the stream then ends rather than being destroyed by the socket's close. */
  #ended = false

  constructor(socket: net.Socket) {
    super({ allowHalfOpen: false })
    this.#socket = socket
    socket.on('data', (chunk: Buffer) => {
      this.#received(chunk)
    })
    socket.on('end', () => {
      this.#ended = true
      this.#withheld = undefined
      this.push(null)
    })
    socket.on('error', (error) => {
      this.destroy(error)
    })
    socket.on('close', () => {
      if (!this.#ended) this.destroy()
    })
  }

  #received(chunk: Buffer): void {
    if (this.#withheld === undefined) {
      if (!this.push(chunk)) this.#socket.pause()
      return
    }
    this.#withheld = Buffer.concat([this.#withheld, chunk])
    if (this.#spoken) this.#decide()
    else this.#socket.pause()
  }

  #decide(): void {
    const withheld = this.#withheld
    if (withheld === undefined) return
    const read = readPreloginAnswer(withheld)
    if (read.kind === 'refused') {
      this.destroy(new EncryptionRefused(read.reason))
      return
    }
    if (read.kind === 'encrypts') {
      this.#withheld = undefined
      if (!this.push(withheld)) {
        this.#socket.pause()
        return
      }
    }
    this.#socket.resume()
  }

  override _read(): void {
    if (this.#spoken) this.#socket.resume()
  }

  override _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.#socket.write(chunk, encoding, callback)
    if (this.#spoken) return
    this.#spoken = true
    this.#decide()
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.#socket.end()
    callback()
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.#socket.destroy()
    callback(error)
  }

  setNoDelay(noDelay?: boolean): this {
    this.#socket.setNoDelay(noDelay)
    return this
  }

  setKeepAlive(enable?: boolean, initialDelay?: number): this {
    this.#socket.setKeepAlive(enable, initialDelay)
    return this
  }
}

/** `socket`, behind a guard that refuses a first answer that does not encrypt. Exported for the stream's own tests. */
export function guardPrelogin(socket: net.Socket): net.Socket {
  return new PreloginGuard(socket) as unknown as net.Socket
}

/** Where tedious asks the connector to connect: the server's host and port, or a redirect's, and the configured local address. */
interface ConnectTo {
  host: string
  port: number
  localAddress?: string | undefined
}

/**
 * The connector a SQL login with `encrypt: true` is given: tedious's
 * connectInSequence (connector.js), every address the lookup gives tried
 * in turn and each attempt abandoned when the signal aborts, and the socket
 * it opens behind the guard. tedious calls it with the lookup and the
 * signal (connection.js, connectOnPort), on every connection a pool opens,
 * a redirect's and a retry's included. connectInParallel, which tedious
 * takes for `multiSubnetFailover`, is not kept: nothing here sets that
 * option, and nothing an operator writes can.
 */
async function connectGuarded(options: ConnectTo, lookup: LookupFunction, signal: AbortSignal): Promise<net.Socket> {
  signal.throwIfAborted()
  const errors: unknown[] = []
  for (const address of await lookupAll(options.host, lookup, signal)) {
    try {
      return guardPrelogin(await connectTo({ host: address.address, port: options.port, family: address.family, localAddress: options.localAddress }, signal))
    } catch (error) {
      signal.throwIfAborted()
      errors.push(error)
    }
  }
  throw new AggregateError(errors, 'Could not connect (sequence)')
}

/** tedious declares a connector as taking nothing; 20.3.3 passes it what connectGuarded takes. */
export const encryptedConnector = connectGuarded as unknown as () => Promise<net.Socket>

function connectTo(options: { host: string; port: number; family: number; localAddress?: string | undefined }, signal: AbortSignal): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const { localAddress, ...address } = options
    const socket = net.connect(localAddress === undefined ? address : { ...address, localAddress })
    const settle = (): void => {
      signal.removeEventListener('abort', onAbort)
      socket.removeListener('error', onError)
      socket.removeListener('connect', onConnect)
    }
    const onAbort = (): void => {
      settle()
      socket.destroy()
      reject(signal.reason)
    }
    const onError = (error: Error): void => {
      settle()
      socket.destroy()
      reject(error)
    }
    const onConnect = (): void => {
      settle()
      resolve(socket)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    socket.on('error', onError)
    socket.on('connect', onConnect)
  })
}

/** Every address of `host`: the host itself when it is an address, otherwise what the lookup answers, asked for all, as tedious asks. */
async function lookupAll(host: string, lookup: LookupFunction, signal: AbortSignal): Promise<readonly LookupAddress[]> {
  signal.throwIfAborted()
  if (net.isIPv6(host)) return [{ address: host, family: 6 }]
  if (net.isIPv4(host)) return [{ address: host, family: 4 }]
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort)
    const ascii = domainToASCII(host)
    lookup(ascii === '' ? host : ascii, { all: true }, (error, addresses) => {
      signal.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(addresses as LookupAddress[])
    })
  })
}

/** The guard's refusal, wherever mssql and tedious hung it: mssql's `originalError`, tedious's `cause`. */
export function encryptionRefusal(error: unknown): Error | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth++) {
    if (current instanceof EncryptionRefused) return Object.assign(new Error(current.message), { code: current.code })
    const wrapped = current as { originalError?: unknown; cause?: unknown }
    current = wrapped.originalError ?? wrapped.cause
  }
  return undefined
}
