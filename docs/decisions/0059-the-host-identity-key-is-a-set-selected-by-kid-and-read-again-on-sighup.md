# 0059 — The host identity key is a set selected by kid, read again from its file on SIGHUP, and nothing is fetched

- **Status:** accepted
- **Date:** 2026-10-13
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-server/src/identity-keys.test.ts` — an Entra-shaped set
  (RSA keys with a kid, `use: sig`, `x5c`, `x5t` and `issuer`, no `alg`) is
  read for RS256 with every key in force; a Keycloak-shaped one is read with
  its signing key in force and its encryption key (`use: enc`,
  `alg: RSA-OAEP`) left out and named `because: 'use'`, its signing key's
  43-character kid quoted as written; a key of another
  `kty`, `crv`, `use`, `key_ops` or `alg` is left out and named, by kid or
  by its place in the file, and its kid is not compared with the others';
  a set is refused, with a sentence naming the key by kid or place, for a
  key in force with no kid, a kid outside the alphabet or not a string, two
  keys in force with one kid, an HS256 key under 32 bytes or with no `k`, a
  `k` that does not encode back to itself, an RSA key whose modulus is
  short (`n: 'AAAA'`, which `createPublicKey` imports) or missing, an RSA
  key whose public exponent is 1, 3 or even, a P-256 point off the curve,
  an Ed25519 key that is any of the eight points of small order or two of
  them written with y at or above p, two Ed25519 encodings that are no
  point (x = 0 with its sign bit set, and a y with no x),
  an empty or missing `keys` array, a JSON array, JSON `null`, no key in
  force, an entry that is not an object, and text that is not JSON; an
  algorithm that is not one of the four (`hs256`, `PS256`, `__proto__`,
  `toString`, `constructor`) is a refusal; a private key
  member refuses the set whether its key is in force or would be left out;
  no eight characters of a random secret, or of a private RSA key's `d`,
  `p`, `q`, `dp`, `dq` or `qi`, appear in any sentence, the secret given as
  the whole file, unquoted as `k`, as `k` of a key without a kid, and as
  the kid of a key with no `k`, of one in force, of one left out and of a
  private one, and a shorter secret as both a key's kid and its `k`; a
  left-out key whose kid is a secret is named by its place;
  `KeySet.fromPem` refuses HS256 and gives a public key for RS256, ES256 and
  EdDSA, and a set read for an asymmetric algorithm holds public keys only;
  the constructor refuses every caller but the builders, and neither a
  look-alike nor an object made from the prototype is a set; only a
  one-key set is written out as a document.
  `identity.test.ts`, the cases under *with a key set* — a kid selects that
  key and no other; an unknown kid is `ERR_JWKS_NO_MATCHING_KEY`, and one
  that is not a string `ERR_JWS_INVALID`; with no
  kid, the third of three keys verifies and a token no key signed is
  `ERR_JWS_SIGNATURE_VERIFICATION_FAILED`; an expired token signed by the
  second of three keys is `ERR_JWT_EXPIRED`; a PS256 token over an RSA key
  without `alg` is `ERR_JOSE_ALG_NOT_ALLOWED`; `''`, `abc`, `a.b.c` and
  `!!.e30.x` are `ERR_JWS_INVALID` under a set and under one key; a token
  signed by another key that carries it in `jwk`, or names a `jku` or `x5u`
  at a local server that counts requests, is refused and the server hears
  nothing; a hand-built set fails at construction, and one handed over
  later, or a `keys` that throws, refuses the token; a `verify` put on a
  set or its prototype, and `KeySet.is` or `KeySet.fromSecret` replaced,
  change nothing a set's or a secret's verifier accepts; the one-key
  settings ignore a kid, as before. `identity-file.test.ts` — a set read again is
  the one the next token meets, with `added`, `removed` and `replaced`
  named, a key replaced under its kid included, and the same file read
  again is "nothing changed"; a file deleted, unreadable, malformed, empty,
  or holding a valid new key beside a refused one leaves the set in force,
  its old key verifying and the new one not; a read that fails other than
  by a refusal is a fixed sentence, so nothing such an error carries reaches
  the log; a FIFO at the path is refused at once, at start and read again,
  and the next read reads; reads run in the order asked.
  `identity-settings.test.ts` — exactly one of the three settings; the
  algorithm required with a key set, and one of four; an absolute path;
  HS256 beside a public key file refused; the secret's algorithm not read;
  `openIdentity`, which main.ts prints and exits on, gives one sentence for
  a secret or a file that cannot be read, a secret under 32 bytes, a public
  key that is not a PEM or is another algorithm's, and a refused key set;
  each SIGHUP one log line, none holding eight characters of a key; a
  one-key setting's SIGHUP one warning; and a real SIGHUP sent to the test's
  own process reaching the listener while the process keeps running.
  `identity-keys-tool.test.ts` — `check` lists what is in force and what is
  left out and exits 0, and exits 1 with the sentence and no material;
  `convert` from a `file:` secret with a trailing newline writes a set that
  verifies the token the minter signs (TextEncoder over the resolved
  secret), as the secret does; from a PEM it writes that key; it refuses an
  environment naming a key set file, what the server refuses, and a public
  key under which anyone signs (an RSA exponent of 1, the Ed25519
  identity), which the public key file itself is not checked for.
  `scripts/mint-token.test.mjs` — the minter refuses a key set file, even
  beside a secret. The `container` job's step "A key set file is read again
  on SIGHUP, and a bad one leaves the set in force", against the image with
  Node as PID 1. Each watched failing on 2026-10-13: requiring `alg` (the
  Entra case and the left-out case); refusing the set on `use: enc`, the
  draft's rule (the Keycloak case); each refusal with its check removed,
  JSON `null` among them (a TypeError, not a sentence), and those this
  record's review added -- the exponent, the points of small order, the
  algorithm, a kid that could be a secret -- each written before its check
  (the set was read, or the sentence held the secret), and the off-curve
  point with the key left for jose to import at the first token; JSON.parse's message passed through (the window property found
  three pieces of the secret: V8 quotes the text around the error, M1),
  the private-member check removed, and the key stringified into a
  sentence; `fromPem` taking HS256 through `createSecretKey`; the
  constructor's check removed, and `is` by `instanceof`; the set verified
  through a public `verify` and checked by `KeySet.is` (the replaced
  `verify` accepted a forgery), and each freeze removed; a kid falling back
  to every key; an unknown kid taken as none; a kid's type unchecked (it
  became `ERR_JWKS_NO_MATCHING_KEY`); a kidless token tried against
  the first key only; every error moving on to the next key (expired became
  a signature failure); `algorithms` dropped; the key chosen through
  `decodeProtectedHeader` (a malformed token became `ERR_JWT_INVALID`, M5);
  a key taken from `header.jwk`; `KeySet` as a structural type; a kid
  selecting under the one-key settings; kids compared without their keys (a
  replaced HS256 key read as unchanged); a failed read replacing the set;
  any error's message passed into the outcome; a read set written out as a
  document; the path read with readFile, and opened without `O_NONBLOCK`
  (each blocked past the two-second bound on the FIFO), and the refusal
  that it is not a regular file turned into "cannot be read"; the verifier
  built outside `openIdentity`'s handling (a short secret threw), and the
  public key's import or file read left unworded;
  the queue removed (the older file's set ended in force); HS256 accepted
  for a public key file; the listener removed (vitest: "Worker exited
  unexpectedly with signal SIGHUP"); `convert` encoding the secret file's
  bytes as read, and the secret's text as `k`; `convert` without reading its
  set back (it wrote an RSA key with an exponent of 1); and the minter
  without its refusal (it minted). The container step was run locally against an image
  built from this branch, green in 4 s, and red against the same image with
  the listener patched out of its built chunk: "Waited 10 s for "identity
  keys read again"", with the container still running; green in 4 s again
  against an image built after this record's review, on another host port.

## Context

0014 verifies the host's token offline, with one key: a shared secret or a
public key, imported once at start. Rotating it is a restart, which closes
every connection and forgets the write ids 0031 keeps in the process, and a
provider rotates on its own schedule: for a while it signs with the new key
while tokens signed by the old one are still valid, so a server that holds
one key refuses one of the two. 0014 rejected a JWKS URL for three reasons:
an outbound request from inside a customer's network, an SSRF surface in
configuration, and a key set that changes under a running server.

Facts this record rests on, read in jose 6.2.12 or measured on 2026-10-12
and 2026-10-13 on Node 22.22.1, and where it matters on Node 22.12.0, the
image's:

- jose's `createLocalJWKSet` refuses secret keys (J3), and refuses a token
  without a kid when two keys fit (J1). An RSA JWK without `alg` verifies any
  RSA algorithm unless the verifier names one (J2). `jwtVerify` checks the
  compact form and the algorithm before it calls a key resolver, calls it
  once, and never uses a key the token carries (J4).
- `JSON.parse`'s message quotes the text around the error, so a secret
  pasted unquoted, or as the whole file, is in it (M1).
- A raw HS256 secret is valid base64url: the composed stack's demo secret
  decodes to 33 bytes and encodes back to itself, and is not the key the
  server verifies with, the base64url of its UTF-8 bytes (M2).
- `createPublicKey({ format: 'jwk' })` refuses a point off P-256 at once,
  where jose refuses it only at the first token, imports an RSA modulus of
  no bits (`modulusLength: 0` on both Nodes), and makes a public key of a
  private JWK (M4). On Node 22.12, the image's, RS256, ES256, EdDSA and
  HS256 sets were each read and verified through the built package, with a
  kid, without one and with the wrong one; EdDSA prints Node's warning that
  its Ed25519 Web Crypto is experimental, as the public key file already
  does.
- `createPublicKey` also imports an RSA public exponent of 1 or 2, and
  every Ed25519 point of small order, on both Nodes. Under such a key a
  signature nobody made verifies: R the identity and S zero verified 64
  messages of 64 under the Ed25519 identity, and 34 of 64 under the point
  of order 2 (Node 22.22.1, 2026-10-13); under an exponent of 1 a signature
  is its message's padding.
- `readFile` on a FIFO waits for a writer, and `process.exit` waits for it:
  a process that asked to exit at 200 ms exited at 3 s, when a writer
  opened the FIFO (Node 22.22.1, 2026-10-13). Opened with `O_NONBLOCK`, a
  FIFO opens at once.
- jose's `decodeProtectedHeader` throws a `TypeError` with no code for a
  malformed token, where `jwtVerify` refuses it as `ERR_JWS_INVALID` (M5).
- Keycloak publishes `rsa-enc-generated` (`use: enc`, `alg: RSA-OAEP`) in
  every realm's certs document (K1), and Entra's keys carry no `alg`.
- Node's default for SIGHUP is to terminate, and a listener removes it. Node
  is PID 1 in the image, which the kernel does not hand a signal it has no
  handler for: an image without the listener kept running after
  `docker kill --signal HUP` and read nothing. With it, both that and
  busybox's `kill -HUP 1` inside the container, as the image's user, reached
  the server.
- A file bind-mounted on its own keeps the inode it was given: a file renamed
  over it on the host was not seen inside the container, nor a write after
  that, while a mounted directory showed the new file (Docker 29.8.1,
  `node:22.12-alpine`, 2026-10-13). Kubernetes' documentation says a Secret
  mounted through `subPath` "does not receive automated Secret updates", and
  any other Secret volume is updated "using an eventually-consistent
  approach".
- `docker compose run -T` writes nothing of Compose's to standard output:
  its progress went to standard error (Compose 5.5.1, with a stand-in
  service, not the server).
- PostgREST takes a JWK or a JWKS as its secret, tries a token without a kid
  against each key, refuses an unknown kid, and reloads on SIGUSR2; Hasura
  fetches its `jwk_url` again by its cache headers.

## Decision

A third setting, `FORMANCY_DATA_IDENTITY_KEYS_FILE`, names a JSON Web Key Set
by absolute path, and `FORMANCY_DATA_IDENTITY_ALGORITHM` -- RS256, ES256,
EdDSA or HS256 -- is required beside it and pinned for every key in it.
Exactly one of the three identity settings may be set, and the two that
exist behave as they did. HS256 beside a public key file stops the process,
as it did, now with a sentence saying why and a test that holds it: a PEM's
text is never an HMAC key.

**Which keys are in force.** Each key is in force, left out, or a reason to
refuse the whole set. It is left out, and named in the log by its kid or its
place in the file with the member that left it out, when its `kty` or `crv`
cannot verify the algorithm, or its `use`, `key_ops` or `alg` says it is not
for it -- `use` asked before `alg`, which is how Keycloak's encryption key is
left out `because: 'use'`. The set is refused for a file that cannot be read
or is not JSON, a `keys` that is not a non-empty array or holds a non-object,
any key with a private member, and a key in force without a kid of
`A-Z a-z 0-9 . _ ~ + / = -`, with another's kid, with a kid that could be a
secret, that does not import with `node:crypto` when the file is read, an
RSA key under 2048 bits measured from the imported key or with a public
exponent that is even or under 65537 -- FIPS 186's floor for an RSA key pair
is an odd e above 2^16 -- an Ed25519 point of small order, computed as [8]A
from the curve, a `k` that is not strict base64url or under 32 bytes, or a
file with no key in force; and for a path that is not a regular file, opened
without waiting for a writer. No sentence holds text of the file. A kid is
logged, so one beside a key that is not a public key, that is its own `k` or
holds 43 base64 characters or more -- as many as a 32-byte secret -- is named
by its place, and refuses the set when its key is in force.

**How a token meets the set.** jose's `jwtVerify`, the algorithm pinned, with
the key chosen by its resolver: a kid that is a string selects that key and
no other, and one the set does not hold is `ERR_JWKS_NO_MATCHING_KEY`; with
no kid the keys are tried in file order, moving on only past a signature that
does not verify. No member of the token's header but its kid chooses a key.
The one-key settings verify as they did, through one `jwtVerify` with one
key, a kid ignored. A `KeySet` is made only by `readKeySet`,
`KeySet.fromSecret` and `KeySet.fromPem`, and the verifier refuses anything
else, at construction and on each token. The class, its prototype and every
set are frozen, and a set offers no `verify`: the verifier reaches it
through a function of its module that index.ts does not export, so code that
reaches the class cannot replace what verifies, and an embedder cannot
verify under a set with looser options.

**Read again on SIGHUP.** The server installs a listener before it listens.
On SIGHUP it reads the same path again: a set that is accepted replaces the
one in force between tokens, and logs "identity keys read again" with the
kids `added`, `removed` and `replaced`, or "nothing changed"; a file that
cannot be read or is refused leaves the set in force and logs, at `error`,
"identity keys not read again; the set in force is unchanged" with
readKeySet's sentence. Reads run one at a time, in the order asked. With a
one-key setting a SIGHUP is a warning and reads nothing. No hash of the file
is logged.

**A tool in the image.** `dist/identity-keys-cli.mjs`, a third build entry
over the server's own functions: `check <file> <algorithm>` prints what is
in force and left out or readKeySet's sentence, exit 0 or 1; `convert <kid>`
reads the one-key setting its environment holds, as main.ts does, and writes
it as a one-key set: the secret's key as the base64url of the bytes the
server verifies with, after resolveSecret has taken one trailing newline off
a file; the PEM as its public JWK, with `alg` set.

**0014's three reasons, answered.** No outbound request: the file is local,
and a provider's set reaches it through the operator's own job, where the
operator allows the request. No SSRF surface: configuration holds a path,
and no member of a token's header but its kid chooses a key -- one that
names a `jku` or `x5u`, or carries a `jwk`, is verified against the set
alone, and nothing is fetched. And the set
changes only when the operator signals, validated whole, swapped at once,
logged with what changed, and never applied after a failed read.

## Consequences

**What it buys.** Rotation is a file written beside the old one, renamed over
it, and a signal: keys overlap, and nothing restarts, so no connection closes
and no write id is forgotten. A provider's published document can be copied
in as it is, Entra's or Keycloak's. Moving from the secret or the public key
is one command that writes the key the server verifies with today. A host
whose kid is wrong fails loudly, by kid.

**What it costs.**
- Nothing fetches the provider's keys. A new key verifies only once the
  operator's copy of the file holds it and the server has been signalled.
- A file that cannot be read, or is refused, when SIGHUP arrives leaves the
  set in force, a key the file removed included, and only the `error` line
  says so. The same file stops the next start -- a restart, a crash
  recovery, a new replica -- until it is fixed; `check` exists so the
  operator's job refuses it before it renames it into place.
- A secret pasted into a set as `k` as it stands is accepted and verifies no
  token: it is valid base64url, another key. `convert` writes the right key,
  and nothing else can tell the two apart.
- A key its provider marks for another use or algorithm is left out and
  named in the log, so a signing key the provider re-marks leaves force at
  the next read.
- A token without a kid costs one signature check per key in force before it
  is refused.
- An HS256 key's kid that could be a secret -- its own `k`, or 43 base64
  characters or more -- refuses the set, so a kid that is a 32-byte
  thumbprint cannot name an HS256 key. A kid is logged as written
  otherwise.
- A key is checked for the weaknesses under which anyone signs -- an RSA
  exponent of 1, an Ed25519 point of small order -- and for its length, not
  for every weak key: a modulus with a factor somebody knows verifies what
  they sign. The public key file is not checked for them, as before; the set
  `convert` writes from it is.
- A path that is not a regular file is refused at once, but a read that
  never returns -- a file on a network mount that stalls -- holds every
  SIGHUP after it, which logs nothing until it does, and SIGTERM's exit
  waits for it.
- One algorithm per server: moving a set to another algorithm is a restart,
  and so are the issuer, the audience and the claim mapping. The one-key
  settings still rotate by restart.
- A SIGHUP no longer stops the server, so one started in a terminal keeps
  running when the terminal closes.
- Where no process can be sent SIGHUP -- natively on Windows, where Node
  raises it only when the console closes -- a set is read only at start. An
  embedder can call `readAgain` itself.
- A file mounted through a Kubernetes `subPath` is never updated, and a
  Secret volume is updated eventually, so a SIGHUP sent before the file
  changed logs "nothing changed". A file bind-mounted on its own is not seen
  after a rename on the host: mount its directory.
- Each instance reads its keys on its own signal; nothing says which keys
  another holds. No route says which keys are in force, only the log, and
  nothing says which kid verified a token.
- `docs/performance.md` was measured before this record changed the
  verifier's path, and is measured again before the next release, as every
  change to the server requires.

**What it does not do.** It fetches no URL: no OIDC discovery, no `jku`, no
`x5u`. It watches no file and polls nothing. It reads nothing else again: the
issuer, the audience, the claim mapping and the rate limit are read at start.
The composed stack stays on its shared secret, and the minter on HS256
without a kid; the minter refuses a key set file. Kubernetes' `kubectl exec
… kill -HUP 1` is busybox's `kill` in the image, measured with `docker exec`,
not through a cluster.

**What it forecloses.** A key a token chooses, or a URL a token names, for as
long as this record stands. A later record that adds a fixed operator URL has
to refuse every URL a token can influence.

## Alternatives considered

**jose's `createLocalJWKSet`.** It refuses HS256 sets, and a host that signs
its own HS256 tokens is the most common kind (J3); with two keys it refuses a
token without a kid (J1).

**Refuse the whole set for any key that cannot verify**, the draft's rule. It
refuses Keycloak's default document (K1), and under an operator's
fetch-and-signal job it keeps the old set at every read until the provider
retires the old key -- and then every form is down.

**Several PEM files.** A PEM has no kid, HS256 has none, and no provider
publishes PEMs.

**Refuse a token without a kid when several keys are in force.** An HS256 host
that has never sent a kid could not rotate without changing its signer first.

**Mixed algorithms in one set.** The key a token chooses would decide its
algorithm.

**A structural `KeySet`, or `instanceof` alone.** An embedder could hand the
verifier keys no builder saw -- mixed algorithms, private keys, short
secrets -- and an object made from the prototype passes `instanceof`. The set
is a brand check over a private field, and its constructor refuses every
caller but the builders, because TypeScript's `private` is gone at run time.

**Choose the key with `decodeProtectedHeader` before `jwtVerify`.** Its
`TypeError` has no code, so a malformed token's reason would change from
`ERR_JWS_INVALID` (M5).

**Watch the file.** inotify does not follow Kubernetes' symlink swap; polling
needs an interval nobody measured; and any write, a partial one included,
would change the set.

**A reload route.** An authenticated route that changes the keys that
authenticate it, and a third plane.

**Restart, as before.** Every connection closes and 0031's write ids are
lost.

**Read the one-key settings again too.** One key cannot overlap with
another.

**Log a hash of the file.** For an HS256 set the file is the secret, and its
hash in the log would let anyone who reads the log confirm a guess at it.
`added`, `removed`, `replaced` and "nothing changed" say what a hash would.

**A README one-liner instead of `convert`.** It gets the key wrong two ways
nothing notices: the secret's text as `k` (M2), and the secret file's bytes
with the newline resolveSecret removes.

**Fetch the provider's set from a URL** (`FORMANCY_DATA_IDENTITY_JWKS_URL`).
Not now: a provider outage would become a form outage once a cache expired,
interception would add keys, and it needs an outbound client behind corporate
proxies. The operator's job fetches, checks, writes and signals instead.

## Older records

Extended, not edited away: 0014 (a third key setting, a set selected by kid
and read again on SIGHUP; HS256 beside a public key file refused; still
offline, and its three reasons against a URL hold); 0032 (the minter
refuses a key set file).
