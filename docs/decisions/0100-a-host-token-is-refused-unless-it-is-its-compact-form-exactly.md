# 0100 — A host token is refused unless it is its compact form exactly

- **Status:** accepted; narrows [0014](0014-host-identity-is-verified-offline.md): a token is verified only in the one spelling the host signed
- **Date:** 2026-10-22
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-identity/src/identity.test.ts`, *refuses a
  token that is not its compact form exactly* -- a token the host signed
  verifies, and the same token with `=` after its signature, after its
  header or after its payload, with a space before it or a newline after
  it, or with its signature in base64's `+` and `/` and a padding `+`, is
  `ERR_JWS_INVALID` (watched failing before this record: the signature with
  `=` after it verified as the host's). The rest of the file, under one key
  and under a key set, passes as before, `a malformed token is
  ERR_JWS_INVALID under a set, as under one key` among it.

## Context

The host signs a JWT and the server verifies it offline
([0014](0014-host-identity-is-verified-offline.md)), through
`@formancy/data-identity` and jose
([0091](0091-the-host-identity-verifier-is-a-package-of-its-own-which-the-server-re-exports.md)).
A JWT is a compact JWS: three parts, each base64url without padding, joined
by dots (RFC 7515, sections 2 and 7.1).

jose 6 decodes a part with an `=` after it to the same bytes. Measured on
2026-10-22 against the verifier as built at `d37dae9`: the host's token with
`=` after its signature verified as the host's own, with two `=` it was
refused, and an `=` after the payload was refused because the signature no
longer matched. So one credential had two spellings, and anything that keys
by a token's text -- a cache, a log line's digest, a list of revoked tokens a
host or a proxy keeps -- could be handed the other. Found by the
formancy.ai-report repository's review of its own server, which verifies its
tokens with this package.

The server's `Authorization` header reads a token as RFC 6750's `b64token`,
which allows `=`, `+`, `/` and `~` (`app.ts`), so the spelling reached the
verifier.

## Decision

**`createIdentityVerifier` refuses, before any key is asked, a token that is
not three non-empty parts of base64url's alphabet joined by two dots**, with
jose's code for what is not a JWS, `ERR_JWS_INVALID`. Every token a JWT
library signs is that form; nothing the host sends changes.

## Alternatives

- **Narrow the server's header pattern.** It would mend the server and not
  another product that verifies with this package, which is why the package
  exists (0091).
- **Report it to jose and wait.** Its decoder is lenient on purpose for
  other inputs; this package says what it accepts either way.

## Consequences

**What it buys.** A host token has one spelling, the one the host signed.

**What it costs.** A token wrapped by something between the host and the
server -- a space or a newline kept from a header value, base64 written for
base64url -- is refused, where jose would have read some of those; such a
token was never what the host signed.
