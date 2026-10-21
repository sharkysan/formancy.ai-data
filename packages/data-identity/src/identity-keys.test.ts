import { generateKeyPairSync, randomBytes } from 'node:crypto'
import type { JsonWebKey } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { KeySet, readKeySet } from './identity-keys.js'

/*
 * What a key set file holds, as the server reads it (0059): every key in force
 * selected by its kid, every key that cannot verify the pinned algorithm left
 * out and named, and anything unsafe or malformed a refusal of the whole set
 * -- in a sentence that never holds a byte of the file, because the sentence
 * goes to the server's log and the file may hold a secret.
 */

const rsa = (): JsonWebKey => generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'jwk' })
const p256 = (): JsonWebKey => generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' })
const oct = (kid: string, bytes = 32): Record<string, unknown> => ({ kty: 'oct', kid, k: randomBytes(bytes).toString('base64url') })
const set = (...keys: unknown[]): string => JSON.stringify({ keys })
const ed25519 = (hex: string): Record<string, unknown> => ({ kty: 'OKP', crv: 'Ed25519', x: Buffer.from(hex, 'hex').toString('base64url') })

/** The sentence `read` throws, or a failure naming what it returned instead. */
function refusal(text: string, algorithm: Parameters<typeof readKeySet>[1]): string {
  try {
    readKeySet(text, algorithm)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('the set was read, and it should have been refused')
}

/** Every eight characters of `material` that a sentence holds. Eight, so a sentence cannot carry a secret a piece at a time either. */
function windows(sentence: string, material: string): string[] {
  const found: string[] = []
  for (let start = 0; start + 8 <= material.length; start++) {
    const window = material.slice(start, start + 8)
    if (sentence.includes(window)) found.push(window)
  }
  return found
}

describe('a provider’s document', () => {
  // Microsoft Entra publishes RSA keys with a kid, use "sig", certificates and
  // an issuer of its own, and no alg. A reader that wanted alg, or refused a
  // member it does not know, would refuse the most common provider's document.
  test('an Entra-shaped set is read for RS256 with every key in force', () => {
    const keys = ['k1', 'k2'].map((kid) => ({ ...rsa(), kid, use: 'sig', x5t: 'nOo3ZDrODXEK1jKWhXslHR_KXEg', x5c: ['MIIC/TCCAeWgAwIBAgII'], issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0' }))
    const read = readKeySet(set(...keys), 'RS256')
    expect(read.kids).toEqual(['k1', 'k2'])
    expect(read.leftOut).toEqual([])
    expect(read.algorithm).toBe('RS256')
  })

  // Keycloak's certs document holds an encryption key, rsa-enc-generated
  // (use "enc", alg RSA-OAEP), in every realm that has not removed it. The
  // draft's rule refused a set over it; leaving it out keeps "copy the
  // provider's document in" true, and the log names it with the member that
  // left it out. Keycloak's kids are 43-character thumbprints, as long as an
  // HS256 secret: beside a public key such a kid is a name, and is quoted.
  test('a Keycloak-shaped set is read for RS256, its encryption key left out because of its use', () => {
    const thumbprint = 'Wq9j5fOYr8z2p6X1vNfoTZ6I-v8uPDqRsBUQMwzg1V0'
    const signing = { ...rsa(), kid: thumbprint, alg: 'RS256', use: 'sig', x5c: ['MIICnTCCAYUCBgGS'], x5t: 'a5T2', 'x5t#S256': 'Yk1' }
    const encryption = { ...rsa(), kid: 'rsa-enc', alg: 'RSA-OAEP', use: 'enc', x5c: ['MIICnTCCAYUCBgGT'] }
    const read = readKeySet(set(signing, encryption), 'RS256')
    expect(read.kids).toEqual([thumbprint])
    expect(read.leftOut).toEqual([{ key: 'rsa-enc', because: 'use' }])
  })

  // Each member that says a key is not for the pinned algorithm leaves it out
  // and nothing else: it can never verify a token under that algorithm, so
  // leaving it out only narrows. A left-out key's kid is not compared with
  // the others', and one without a kid is named by its place in the file.
  test('a key of another kind, curve, use, operation or algorithm is left out and named; its kid is not compared', () => {
    const inForce = { ...p256(), kid: 'a' }
    const read = readKeySet(
      set(
        inForce,
        { ...rsa(), kid: 'a' },
        { ...generateKeyPairSync('ec', { namedCurve: 'P-384' }).publicKey.export({ format: 'jwk' }) },
        { ...p256(), kid: 'enc', use: 'enc' },
        { ...p256(), kid: 'ops', key_ops: ['encrypt'] },
        { ...p256(), kid: 'other', alg: 'ES384' },
      ),
      'ES256',
    )
    expect(read.kids).toEqual(['a'])
    expect(read.leftOut).toEqual([
      { key: 'a', because: 'kty' },
      { key: '#3', because: 'crv' },
      { key: 'enc', because: 'use' },
      { key: 'ops', because: 'key_ops' },
      { key: 'other', because: 'alg' },
    ])
  })
})

describe('a refused set', () => {
  // Each of these is a set the server must not run on, and the sentence is
  // all an operator gets: it names the key by its kid, or by its place in the
  // file where the kid cannot be named, and never quotes a value.
  const p256Key = p256()
  const cases: Array<{ why: string; text: string; algorithm: Parameters<typeof readKeySet>[1]; says: RegExp }> = [
    { why: 'a key in force without a kid', text: set(oct('a'), { kty: 'oct', k: randomBytes(32).toString('base64url') }), algorithm: 'HS256', says: /^key #2 has no "kid"/ },
    { why: 'two keys in force with one kid', text: set(oct('a'), oct('a')), algorithm: 'HS256', says: /^two keys in force are both "a"/ },
    { why: 'a kid outside the alphabet', text: set({ ...oct('a'), kid: 'a b' }), algorithm: 'HS256', says: /^key #1's "kid" is not/ },
    { why: 'a kid that is not a string', text: set({ ...oct('a'), kid: 7 }), algorithm: 'HS256', says: /^key #1's "kid" is not/ },
    { why: 'an HS256 key under 32 bytes', text: set(oct('short', 31)), algorithm: 'HS256', says: /^key "short" is shorter than 32 bytes/ },
    { why: 'an HS256 key with no k', text: set({ kty: 'oct', kid: 'a' }), algorithm: 'HS256', says: /^key "a" has no "k"/ },
    { why: 'a k that is not strict base64url', text: set({ kty: 'oct', kid: 'a', k: `${randomBytes(33).toString('base64url')}=` }), algorithm: 'HS256', says: /^key "a"'s "k" is not base64url/ },
    // createPublicKey accepts an RSA modulus of no bits at all (M4); jose
    // refuses one under 2048 only when a token arrives.
    { why: 'an RSA key whose modulus is short', text: set({ kty: 'RSA', kid: 'a', n: 'AAAA', e: 'AQAB' }), algorithm: 'RS256', says: /^key "a" is an RSA key of fewer than 2048 bits/ },
    // An off-curve point imports in jose only when the first token arrives;
    // createPublicKey refuses it when the file is read.
    { why: 'a P-256 point off the curve', text: set({ ...p256Key, y: p256Key.x, kid: 'a' }), algorithm: 'ES256', says: /^key "a" does not import as an EC public key/ },
    { why: 'an RSA key missing its modulus', text: set({ kty: 'RSA', kid: 'a', e: 'AQAB' }), algorithm: 'RS256', says: /^key "a" does not import as an RSA public key/ },
    // createPublicKey imports an RSA public exponent of 1, under which a
    // signature is its own message's padding, so anyone signs any token; and
    // one of 2 or 3 (measured on Node 22.22.1 and 22.12.0, 2026-10-13).
    // FIPS 186's floor for an RSA key pair is an odd e above 2^16.
    { why: 'an RSA key whose public exponent is 1', text: set({ ...rsa(), e: 'AQ', kid: 'a' }), algorithm: 'RS256', says: /^key "a"'s RSA public exponent is not an odd number of at least 65537/ },
    { why: 'an RSA key whose public exponent is 3', text: set({ ...rsa(), e: 'Aw', kid: 'a' }), algorithm: 'RS256', says: /^key "a"'s RSA public exponent is not an odd number of at least 65537/ },
    { why: 'an RSA key whose public exponent is even', text: set({ ...rsa(), e: 'AQAC', kid: 'a' }), algorithm: 'RS256', says: /^key "a"'s RSA public exponent is not an odd number of at least 65537/ },
    // createPublicKey imports every Ed25519 point of small order, and under
    // such a key a signature nobody made verifies: R the identity and S zero
    // verified 64 messages of 64 under the identity, and 34 of 64 under the
    // point of order 2 (Node 22.22.1, 2026-10-13). The encodings are the
    // eight points of order 1, 2, 4 and 8, and two of them again with y
    // written at or above p, which OpenSSL reads modulo p.
    ...Object.entries({
      'the identity': `01${'00'.repeat(31)}`,
      'the identity, y written as p + 1': `ee${'ff'.repeat(30)}7f`,
      'the point of order 2': `ec${'ff'.repeat(30)}7f`,
      'a point of order 4': '00'.repeat(32),
      'the other point of order 4': `${'00'.repeat(31)}80`,
      'a point of order 8': '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
      'its negative': '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85',
      'another point of order 8': 'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
      'and its negative': 'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa',
      'zero, y written as p': `ed${'ff'.repeat(30)}7f`,
    }).map(([point, hex]) => ({ why: `an Ed25519 key that is ${point}`, text: set({ ...ed25519(hex), kid: 'a' }), algorithm: 'EdDSA' as const, says: /^key "a" is an Ed25519 point of small order/ })),
    // x = 0 with its sign bit set, and a y with no x on the curve, are no
    // point at all (RFC 8032 section 5.1.3), though createPublicKey imports
    // both: such a key verifies nothing.
    { why: 'an Ed25519 encoding of x = 0 with its sign bit set', text: set({ ...ed25519(`01${'00'.repeat(30)}80`), kid: 'a' }), algorithm: 'EdDSA', says: /^key "a" does not import as an Ed25519 public key/ },
    { why: 'an Ed25519 encoding whose y has no x', text: set({ ...ed25519(`02${'00'.repeat(31)}`), kid: 'a' }), algorithm: 'EdDSA', says: /^key "a" does not import as an Ed25519 public key/ },
    { why: 'an empty keys array', text: set(), algorithm: 'HS256', says: /^the identity key set is not an object with a non-empty "keys" array/ },
    { why: 'a document with no keys member', text: JSON.stringify({ kty: 'oct', kid: 'a' }), algorithm: 'HS256', says: /^the identity key set is not an object with a non-empty "keys" array/ },
    { why: 'a JSON array', text: JSON.stringify([oct('a')]), algorithm: 'HS256', says: /^the identity key set is not an object with a non-empty "keys" array/ },
    // The one document whose "keys" is not even undefined: null['keys']
    // throws a TypeError, which is not a sentence.
    { why: 'JSON null', text: 'null', algorithm: 'HS256', says: /^the identity key set is not an object with a non-empty "keys" array/ },
    { why: 'no key in force', text: set({ ...rsa(), kid: 'r' }), algorithm: 'HS256', says: /^no key in the file can verify HS256 \(left out: r \(kty\)\)/ },
    { why: 'an entry that is not an object', text: set(oct('a'), 'b'), algorithm: 'HS256', says: /^key #2 of the identity key set is not an object/ },
    { why: 'text that is not a set', text: 'not a key set', algorithm: 'HS256', says: /^the identity key set file is not JSON$/ },
  ]

  test.each(cases)('$why', ({ text, algorithm, says }) => {
    expect(refusal(text, algorithm)).toMatch(says)
  })

  // readKeySet is exported, and an embedder's algorithm is not checked by
  // the server's main.ts: one that is not one of the four -- written in lower
  // case, another algorithm, or a name every object has -- is a refusal,
  // never a TypeError and never a set read for no algorithm.
  test.each(['hs256', 'PS256', '__proto__', 'toString', 'constructor'])('an algorithm, %s, that is not one of the four', (algorithm) => {
    expect(refusal(set(oct('a'), { kid: 'z' }), algorithm as Parameters<typeof readKeySet>[1])).toBe('the algorithm of a key set is RS256, ES256, EdDSA or HS256')
  })
})

describe('material', () => {
  // A verifier's file that holds a private key is a key in the wrong place,
  // whatever that key is for, so the whole set is refused, even where the key
  // would have been left out.
  //
  // And no sentence holds any material. JSON.parse's own message quotes the
  // file around the error (M1), so a secret pasted without its quotes, or as
  // the whole file, would reach the log through it.
  const secret = randomBytes(32).toString('base64url')
  // Under 32 bytes, so only "kid is its k" catches it where it is the kid.
  const shortSecret = randomBytes(31).toString('base64url')
  const privateRsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'jwk' })
  const material = [secret, shortSecret, ...(['d', 'p', 'q', 'dp', 'dq', 'qi'] as const).map((member) => String(privateRsa[member]))]

  const files: Array<{ why: string; text: string; algorithm: Parameters<typeof readKeySet>[1]; says: RegExp }> = [
    { why: 'the secret as the whole file', text: secret, algorithm: 'HS256', says: /^the identity key set file is not JSON$/ },
    { why: 'the secret unquoted as k', text: `{"keys":[{"kty":"oct","kid":"a","k":${secret}}]}`, algorithm: 'HS256', says: /^the identity key set file is not JSON$/ },
    { why: 'the secret as k of a key without a kid', text: set({ kty: 'oct', k: secret }), algorithm: 'HS256', says: /^key #1 has no "kid"/ },
    { why: 'a private RSA key in force', text: set({ ...privateRsa, kid: 'p' }), algorithm: 'RS256', says: /^key "p" holds the private member "d"/ },
    { why: 'a private RSA key that would be left out', text: set({ ...p256(), kid: 'e' }, { ...privateRsa }), algorithm: 'ES256', says: /^key #2 holds the private member "d"/ },
    // A kid is logged: in a refusal, and on every planes and SIGHUP line. A
    // secret pasted where the kid belongs fits the kid's alphabet, so a kid
    // that is not beside a public key, and is its own k or as long as a
    // secret, is named by its place and refuses an HS256 set.
    { why: 'the secret as the kid of a key with no k', text: set({ kty: 'oct', kid: secret }), algorithm: 'HS256', says: /^key #1's "kid" could be a secret/ },
    { why: 'the secret as the kid of a key in force', text: set(oct('a'), { kty: 'oct', kid: secret, k: randomBytes(32).toString('base64url') }), algorithm: 'HS256', says: /^key #2's "kid" could be a secret/ },
    { why: 'a short secret as both the kid and k', text: set({ kty: 'oct', kid: shortSecret, k: shortSecret }), algorithm: 'HS256', says: /^key #1's "kid" could be a secret/ },
    { why: 'the secret as the kid of a key left out', text: set({ kty: 'oct', kid: secret }), algorithm: 'RS256', says: /^no key in the file can verify RS256 \(left out: #1 \(kty\)\)$/ },
    { why: 'the secret as the kid of a private key', text: set({ kty: 'oct', kid: secret, d: 'x' }), algorithm: 'HS256', says: /^key #1 holds the private member "d"/ },
  ]

  test.each(files)('$why is refused with a sentence holding none of it', ({ text, algorithm, says }) => {
    const sentence = refusal(text, algorithm)
    expect(material.flatMap((value) => windows(sentence, value))).toEqual([])
    expect(sentence).toMatch(says)
  })

  // A set that is read logs its left-out keys by name: one whose kid is a
  // secret is named by its place, and the kids in force hold none of it.
  test('a left-out key whose kid is a secret is named by its place', () => {
    const read = readKeySet(set({ ...rsa(), kid: 'r' }, { kty: 'oct', kid: secret, k: randomBytes(32).toString('base64url') }), 'RS256')
    expect(read.leftOut).toEqual([{ key: '#2', because: 'kty' }])
    expect(material.flatMap((value) => windows(JSON.stringify([read.kids, read.leftOut]), value))).toEqual([])
  })
})

describe('key kinds', () => {
  // The key-confusion attack 0014 refuses: a public key's text taken as an
  // HMAC secret verifies any token its holder signs. A PEM is only ever a
  // public key, and a set read for an asymmetric algorithm holds public keys
  // only.
  test('a PEM is never a secret: fromPem refuses HS256, and its key is public for each algorithm it takes', async () => {
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'pem' }).toString()
    await expect(KeySet.fromPem(ec, 'HS256')).rejects.toThrow(/never a public key/)
    const pems = {
      RS256: generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      ES256: ec,
      EdDSA: generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    } as const
    for (const [algorithm, pem] of Object.entries(pems)) {
      expect((await KeySet.fromPem(pem, algorithm)).keyTypes).toEqual(['public'])
    }
  })

  test('a set read for an asymmetric algorithm holds public keys, and one read for HS256 secret keys', () => {
    expect(readKeySet(set({ ...rsa(), kid: 'r' }), 'RS256').keyTypes).toEqual(['public'])
    expect(readKeySet(set({ ...p256(), kid: 'e' }), 'ES256').keyTypes).toEqual(['public'])
    expect(readKeySet(set({ ...generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }), kid: 'o' }), 'EdDSA').keyTypes).toEqual(['public'])
    expect(readKeySet(set(oct('h1'), oct('h2')), 'HS256').keyTypes).toEqual(['secret', 'secret'])
  })

  // The verifier's promise that a configuration it never checked cannot
  // accept anything (identity.ts) holds only if a set cannot be made but by
  // the functions that check one: TypeScript's private constructor is gone
  // at run time, so the constructor checks for itself.
  test('a set is made only by its builders, and only a set they made is one', () => {
    const Construct = KeySet as unknown as new (...args: unknown[]) => KeySet
    expect(() => new Construct(undefined, 'HS256', [], [], undefined)).toThrow(/made by readKeySet/)
    expect(KeySet.is(readKeySet(set(oct('a')), 'HS256'))).toBe(true)
    expect(KeySet.is(KeySet.fromSecret('a-shared-secret-of-at-least-thirty-two-bytes'))).toBe(true)
    expect(KeySet.is(Object.create(KeySet.prototype))).toBe(false)
    expect(KeySet.is({ kids: ['a'], leftOut: [], algorithm: 'HS256' })).toBe(false)
  })

  // convert writes a one-key setting's key as a set; a set read from a file
  // is one already, and writing it out again would put every key of a file
  // the operator chose into another.
  test('only a one-key set is written out as a document', async () => {
    await expect(readKeySet(set(oct('a')), 'HS256').document('a')).rejects.toThrow(/is a key set file already/)
  })
})
