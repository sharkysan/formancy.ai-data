import { describe, expect, test } from 'vitest'
import * as identity from './index.js'

describe('the package entry', () => {
  // The exports map names this entry and nothing else, so what it exports is
  // the whole of what a consumer can reach, and each name is one more to
  // keep. verifyWithKeySet above all: it verifies under a set with whatever
  // options its caller passes, where createIdentityVerifier always passes its
  // issuer, audience and required claims, so exported it would let an
  // embedder verify a token more loosely than the verifier does (0059), and
  // nothing else would fail. isKeySetAlgorithm and oneKeySet are here because
  // the server's settings and its key set file tool make the same decisions
  // with them (0091).
  test('exports exactly the verifier, the key set, the file, the secret reference and the two helpers the server shares', () => {
    expect(Object.keys(identity).sort()).toEqual(['KeySet', 'KeySetRefusal', 'createIdentityVerifier', 'isKeySetAlgorithm', 'oneKeySet', 'openKeySetFile', 'readKeySet', 'resolveSecret'])
  })
})
