<!-- Part of Formancy Data: https://github.com/sharkysan/formancy.ai-data -->

# @formancy/data-identity

The host identity tokens Formancy Data verifies: a JWT the host
application signs for a person, checked offline under a pinned algorithm
against one shared secret, one public key, or a JSON Web Key Set read from
a file and read again whenever asked
([0014](../../docs/decisions/0014-host-identity-is-verified-offline.md),
[0059](../../docs/decisions/0059-the-host-identity-key-is-a-set-selected-by-kid-and-read-again-on-sighup.md)).

It is the code `@formancy/data-server` verifies with, which the server
re-exports, in a package of its own so that another product verifies the
same tokens without installing a web server and two database drivers
([0091](../../docs/decisions/0091-the-host-identity-verifier-is-a-package-of-its-own-which-the-server-re-exports.md)).
It depends on [jose](https://github.com/panva/jose) and Node's built-ins,
and nothing else.

**Licence.** Source-available under the Formancy Data licence in
[`LICENSE.md`](LICENSE.md), like every package in this repository; see the
licence table in the [repository README](../../README.md).

## What it exports

```ts
createIdentityVerifier(options)   // → (token) => Promise<{ ok: true, identity } | { ok: false, reason }>
readKeySet(text, algorithm)       // → KeySet, or throws KeySetRefusal
KeySet.fromSecret(secret)         // → KeySet: HS256 over the secret's UTF-8 bytes, at least 32 of them
KeySet.fromPem(pem, algorithm)    // → Promise<KeySet>: an SPKI public key, RS256, ES256 or EdDSA
openKeySetFile(path, algorithm)   // → Promise<{ current, readAgain }>
resolveSecret(reference, source?) // → Promise<string>, for env:NAME or file:/absolute/path
isKeySetAlgorithm(value)          // → whether it is RS256, ES256, EdDSA or HS256
oneKeySet(key)                    // → Promise<KeySet>, the set a one-key option verifies with
```

With their types: `HostIdentity`, `IdentityOptions`, `IdentityOutcome`,
`IdentityVerifier`, `OneKey`, `KeySetAlgorithm`, `KeySetChange`,
`LeftOutKey`, `KeySetFile`, `KeySetReadAgain` and `SecretSource`.

## Verifying a token

```ts
import { createIdentityVerifier, openKeySetFile } from '@formancy/data-identity'

// The provider's published keys, copied into a file by the operator's own job.
// A file that does not parse, holds a private key, or a key under which
// anyone signs, throws a KeySetRefusal here, naming keys by kid or by place.
const file = await openKeySetFile('/run/identity/keys.json', 'RS256')

const verify = await createIdentityVerifier({
  key: { kind: 'key-set', keys: file.current },
  issuer: 'https://login.example/tenant',
  audience: 'formancy-report',
  attributes: { tenant: 'tid' },
})

// A set that is accepted replaces the one in force between tokens; one that
// is not leaves it, and the outcome says why, never quoting the file.
process.on('SIGHUP', () => void file.readAgain().then((outcome) => console.log(outcome)))

const outcome = await verify(token)
if (outcome.ok) {
  outcome.identity.actor // { id: the token's sub, roles: its roles claim }
  outcome.identity.attributes // { tenant: '3' }: a whole-number claim as its decimal string
} else {
  outcome.reason // jose's code, or a sentence naming a claim; never the token
}
```

One shared secret is `{ kind: 'secret', secret }`, read from a reference
with `resolveSecret('env:HOST_SECRET')`, and one public key is
`{ kind: 'public-key', pem, algorithm }`. Either ignores a token's `kid`.
In a key set, a `kid` selects that key and no other; a token without one
is tried against each key in force, in file order.

A token is read only as the host signed it: three base64url parts without
padding, joined by dots. One with an `=` after a part, a space or a
newline around it, or base64's `+` and `/` is `ERR_JWS_INVALID` before any
key is asked, so a credential has one spelling
([0100](../../docs/decisions/0100-a-host-token-is-refused-unless-it-is-its-compact-form-exactly.md)).

## What it does not do

- **It fetches nothing.** No key set URL, and no key a token names in its
  header (`jku`, `x5u`, `jwk`): an outbound request from inside a
  customer's network, and a key the token chooses.
- **It reads no setting.** Which key, issuer, audience and claims to
  accept is the caller's to read and pass; the data server reads its
  `FORMANCY_DATA_IDENTITY_*` variables in its own `identity-settings.ts`.
  `resolveSecret` reads the environment or a file only for the reference
  it is handed.
- **It does not mint tokens.** The host signs them.
- **It does not bound a token's lifetime.** `exp` is required and must not
  have passed, give or take `clockToleranceSeconds`; how far ahead it lies
  is not checked, so a token the host signed to last a year is accepted for
  a year.

`src/identity.test.ts` holds the verifier, `src/identity-keys.test.ts` what
a key set accepts and refuses, `src/identity-file.test.ts` a file read again,
`src/secrets.test.ts` that no error repeats a reference, and
`src/index.test.ts` that the entry exports nothing more than the list above.

## Licence

Source-available, not open source. See [`LICENSE.md`](./LICENSE.md): free to
read, fork, evaluate, develop and test; a paid licence for production use.
