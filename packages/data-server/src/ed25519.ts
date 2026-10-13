/**
 * What an Ed25519 public key's 32 bytes are, as far as a verifier has to ask
 * (0059): a point on the curve, and whether it is one of small order.
 *
 * createPublicKey imports every point of small order, and under such a key a
 * signature nobody made verifies: R the identity and S zero verified 64
 * messages of 64 under the identity, and 34 of 64 under the point of order 2
 * (Node 22.22.1, 2026-10-13). A key A is of small order exactly when [8]A,
 * its multiple by the curve's cofactor, is the identity, which is what this
 * computes from the curve itself: no list of points is transcribed.
 */

const P = 2n ** 255n - 19n

function mod(value: bigint): bigint {
  const rest = value % P
  return rest < 0n ? rest + P : rest
}

function power(base: bigint, exponent: bigint): bigint {
  let result = 1n
  let square = mod(base)
  for (let rest = exponent; rest > 0n; rest >>= 1n) {
    if ((rest & 1n) === 1n) result = (result * square) % P
    square = (square * square) % P
  }
  return result
}

/** d = -121665/121666 (RFC 8032 section 5.1). */
const D = mod(-121665n * power(121666n, P - 2n))
/** A square root of -1 modulo p (RFC 8032 section 5.1.3). */
const ROOT_OF_MINUS_ONE = power(2n, (P - 1n) / 4n)

/**
 * The point an encoding names, or undefined when it names none (RFC 8032
 * section 5.1.3). y is read modulo p, as OpenSSL reads it, where the RFC
 * refuses y at or above p: such a key is what the server would verify with.
 */
function decode(bytes: Uint8Array): { x: bigint; y: bigint } | undefined {
  let y = 0n
  for (let index = 31; index >= 0; index--) y = (y << 8n) | BigInt(index === 31 ? (bytes[index] as number) & 0x7f : (bytes[index] as number))
  y = mod(y)
  const sign = BigInt((bytes[31] as number) >> 7)
  const u = mod(y * y - 1n)
  const v = mod(D * y * y + 1n)
  let x = mod(u * power(v, 3n) * power(u * power(v, 7n), (P - 5n) / 8n))
  const check = mod(v * x * x)
  if (check === mod(-u)) x = mod(x * ROOT_OF_MINUS_ONE)
  else if (check !== u) return undefined
  if (x === 0n && sign === 1n) return undefined
  if ((x & 1n) !== sign) x = P - x
  return { x, y }
}

/** [8]A in projective coordinates, by doubling three times (a = -1; dbl-2008-hwcd), and whether it is the identity. */
function eightTimesIsIdentity({ x, y }: { x: bigint; y: bigint }): boolean {
  let [X, Y, Z] = [x, y, 1n]
  for (let doubling = 0; doubling < 3; doubling++) {
    const A = mod(X * X)
    const B = mod(Y * Y)
    const C = mod(2n * Z * Z)
    const E = mod((X + Y) * (X + Y) - A - B)
    const G = mod(B - A)
    const F = mod(G - C)
    const H = mod(-A - B)
    ;[X, Y, Z] = [mod(E * F), mod(G * H), mod(F * G)]
  }
  return X === 0n && Y === Z
}

export type Ed25519Point = 'no point' | 'small order' | 'a point'

/** What the 32 bytes of an Ed25519 public key are: a JWK's `x`, once createPublicKey has imported it, which refuses any other length. */
export function ed25519Point(bytes: Uint8Array): Ed25519Point {
  const point = decode(bytes)
  if (point === undefined) return 'no point'
  return eightTimesIsIdentity(point) ? 'small order' : 'a point'
}
