import * as identity from '@formancy/data-identity'
import { describe, expect, test } from 'vitest'
import * as server from './index.js'

describe('what the server exports from @formancy/data-identity', () => {
  // The verifier and the key set left this package for data-identity (0091),
  // and an embedder still imports them from here. A copy instead of a
  // re-export would behave alike until two met: a set is branded by a
  // private field of its own class, so a verifier made by one copy refuses
  // every set the other's readKeySet made, and an instanceof KeySetRefusal
  // of the other copy's throw is false. The same objects, under every name
  // the server exported before.
  test('is the very objects data-identity exports, under the names it exported before', () => {
    const names = ['createIdentityVerifier', 'KeySet', 'KeySetRefusal', 'readKeySet', 'openKeySetFile', 'resolveSecret'] as const
    for (const name of names) {
      expect(identity[name], name).toBeTypeOf('function')
      expect(server[name], name).toBe(identity[name])
    }
  })
})
