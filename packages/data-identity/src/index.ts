// The host identity tokens Formancy Data verifies (0014, 0059), for any
// product that verifies the same tokens without the server (0091).
export { createIdentityVerifier, oneKeySet } from './identity.js'
export type { HostIdentity, IdentityOptions, IdentityOutcome, IdentityVerifier, OneKey } from './identity.js'
// A key set (0059): made only by readKeySet and the builders, which an
// embedder's `keys` returns; and the file read again whenever it is asked.
// verifyWithKeySet stays inside: the verifier is the one way to verify
// under a set, with the options it was built with.
export { isKeySetAlgorithm, KeySet, KeySetRefusal, readKeySet } from './identity-keys.js'
export type { KeySetAlgorithm, KeySetChange, LeftOutKey } from './identity-keys.js'
export { openKeySetFile } from './identity-file.js'
export type { KeySetFile, KeySetReadAgain } from './identity-file.js'
export { resolveSecret } from './secrets.js'
export type { SecretSource } from './secrets.js'
