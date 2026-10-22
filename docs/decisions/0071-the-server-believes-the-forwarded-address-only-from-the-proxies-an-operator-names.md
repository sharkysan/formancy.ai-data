# 0071 — The server believes a forwarded client address only from the proxies an operator names, each by its address, and the composed stack names its nginx and cloudflared alone

- **Status:** accepted; narrowed by [0099](0099-a-proxy-list-whose-entries-together-trust-every-peer-is-refused.md): a list whose entries together trust every IPv4 or every IPv6 peer is refused as a prefix of 0 is
- **Date:** 2026-10-16
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-server/src/trusted-proxies.test.ts` —
  `FORMANCY_DATA_TRUSTED_PROXIES` unset, `''` and only space trust nothing;
  it accepts addresses and ranges of both families, an IPv4-mapped address
  and range, space around an entry, and an entry written twice, kept once;
  it refuses, naming the entry by its place and never repeating it, `true`
  in either case, `*`, `0.0.0.0/0` and `::/0` as trusting every peer, `2`
  as counting hops, a trailing, doubled and leading comma as an empty
  entry, `172.16.238.250/24`, `2001:db8::1/64` and `::ffff:10.0.0.1/104` as
  having bits set past their prefix, and a netmask, a prefix with a leading
  zero or past its family's length, a bare slash, a zone, `loopback`, a
  leading zero, a short form, a port, brackets, a URL with a password and a
  host name as no address or range; one bad entry refuses the list, naming
  the first; `trustedProxies` is held to the same rule by index, untrimmed,
  and must be a list. `packages/data-server/src/forwarded.test.ts`, through
  the real server with a limit of two and its log — with the proxy named,
  three requests forwarded for Alice are 401, 401, 429 and Bob's after them
  401, and the log names each; what a client wrote to the left of the
  address a trusted hop wrote is not believed, through one hop and through
  two named ones; a forwarded `S3cret-pw-e81`, an address with a port and
  `unknown` are counted and logged as the peer's, and none of them reaches
  the log; IPv6 clients of one /64 share a bucket and another /64 has its
  own, from a peer reported as `::ffff:10.0.0.2` and from one inside a
  listed IPv6 range; createDataServer refuses `*` and an interface address
  with its prefix by index, and with `[]` a forged header changes nothing;
  with no list a forged header changes neither the bucket nor the log; a
  peer not in the list is not believed, whatever hop its header names;
  over a real socket a believed client is logged without the proxy's port
  and an unbelieved peer with its own; and from a trusted proxy, forged
  `X-Forwarded-Host` and `X-Forwarded-Proto` change no answer of either
  plane, the health route, `/v1/whoami`, a granted and a refused preflight,
  a request across origins listed and not, or a 404.
  `scripts/getting-started/trust.test.mjs` (`pnpm test:repo`) —
  `compose.yaml` as committed, alone and with the Cloudflare overlay, has
  the server trusting the web front's fixed address on a network they share
  and cloudflared's on the network it shares with the web front, each one
  address inside a fixed range, outside the part Docker hands out and not
  its gateway, held by no service but a proxy; it refuses the server not
  naming the web front, a web front with no fixed address, cloudflared with
  none or one not named, a range, a gateway, an address Docker hands out,
  one in no network of the file, a database holding a trusted address, and
  a configuration without the server or the web front; and the server's
  log refused when a request line names the web front's own address or
  none names any. The `getting-started` job runs that check on what Compose
  itself resolves, then reads the composed server's log after the journey
  and fails if a request is logged by the web front's own address; the
  `cloudflare` job runs it on both files as Compose resolves them. The
  `container` job's step "FORMANCY_DATA_TRUSTED_PROXIES splits the limit by
  the address a named proxy forwards, and true stops the server". Each
  watched failing on 2026-10-16: `true` read as an address, the prefix-0
  rule, the empty-entry rule and the host-bits rule each removed, and the
  entry put into the sentence; against the server before this record,
  which ignored the option (Bob's request was 429); Fastify given `true`
  whenever a list was given (the forged left-hand addresses were buckets
  of their own, and a peer outside the list was believed) and given `true`
  whatever the list (five cases); `request.ip` used as it came (the limit
  was never reached and the typed text was logged); the forwarded address
  used as the key unmasked (a second address of one /64 was a bucket of
  its own); createDataServer's check removed (proxy-addr's own error, not
  the sentence); the port kept for a forwarded address; a scratch onSend
  hook echoing `request.host` and `request.protocol`; and in trust.mjs,
  each of its eleven rules removed in turn. The container step was run
  locally on 2026-10-16 against an image built from this branch, green in
  8 s, and red with the setting left out of it: 401 401 429 429.

## Context

The rate limit counts requests per client address (0034), and the log
names that address on every request line. Behind a proxy the address is
the proxy's: the composed stack has nginx in front of the server
([0032](0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)),
and the Cloudflare overlay puts cloudflared in front of nginx
([0037](0037-cloudflare-is-the-edge-not-the-runtime.md)). So everybody
behind them was one bucket: one script spending it refused every other
person with it, which the Cloudflare guide answered with an edge rule that
on Free turns a blocked write into an unknown one. 0034 left `trustProxy`
out, and 0037 rejected `FORMANCY_DATA_TRUSTED_PROXIES` because Docker's
gateway would be trusted, so any local process could choose its own
address; because it reversed 0034's sentence; because it would put
visitors' addresses into the server's log; and because shape (b) gains
nothing. This record takes the first as the rule it must keep -- a list of
addresses, and the composed stack naming two addresses and no network --
and the other three as costs, below. More than one instance, the roadmap
item this is part of, needs the address to be the client's before buckets
can be shared between instances at all.

Facts this record rests on, read or measured on 2026-10-16:

- **Fastify 5.12.5** (`lib/request.js`): `trustProxy` as a list is
  compiled by @fastify/proxy-addr 5.1.1; `request.ip` is then the last of
  proxy-addr's walk -- the socket's address, then `X-Forwarded-For` from
  the right, stopping at the first address the list does not hold, or the
  leftmost when it holds them all. `true` trusts every peer, and a number
  trusts none (the comment says so: hop counts cannot validate the peer).
  From a trusted peer, `request.host` is the last entry of
  `X-Forwarded-Host` and `request.protocol` of `X-Forwarded-Proto`. Without
  `trustProxy` none of these headers is read.
- **@fastify/proxy-addr 5.1.1** reads `X-Forwarded-For` alone, through
  @fastify/forwarded 3.0.2, not RFC 7239's `Forwarded`. It canonicalises an
  IPv4-mapped candidate to IPv4 before matching, so `::ffff:10.0.0.2`
  matches `10.0.0.2`. It throws on a prefix of 0, expands `loopback`,
  `linklocal` and `uniquelocal` to ranges, takes a netmask after the slash,
  and parses through ipaddr.js 2.5.0, measured: `2` is the address 0.0.0.2,
  `010.0.0.1` is 8.0.0.1, `10.1` is 10.0.0.1, and `0x0a000001` is 10.0.0.1.
  Whatever text stands where the walk stops is returned as it is: from a
  trusted peer, `abc, 198.51.100.7:4711` gives `198.51.100.7:4711`.
- **@fastify/rate-limit 11.2.0**'s default key normalises the address,
  maps an IPv4-mapped one to IPv4 and masks IPv6 to a /64, and exports the
  function that does it, `normalizeIP`.
- **Nothing in the server reads `request.host` or `request.protocol`**:
  the cross-origin rule compares `Origin` byte for byte with the list and
  reads `Sec-Fetch-Site`
  ([0060](0060-the-runtime-plane-answers-the-origins-an-operator-lists-and-the-administrators-plane-none.md)),
  and the log names the route, never the Host.
- **nginx** in `deploy/web/nginx.conf` sends `X-Forwarded-For
  $proxy_add_x_forwarded_for` on every location that reaches the server:
  what the client sent, and the address nginx saw appended.
- **Cloudflare's edge** sends `X-Forwarded-For` ending with the address
  that connected to it, appended to whatever the visitor sent
  (developers.cloudflare.com `fundamentals/reference/http-headers`, read
  2026-10-16). **cloudflared 2026.10.0** (`5eb7b90`) adds only
  `X-Forwarded-Host`, and only with `httpHostHeader`, which the generated
  configuration does not set (`ingress/origin_proxy.go`); a search of its
  repository for "Forwarded" found no other place that sets one. Nothing
  here has an account, so what the edge sends was not measured.
- **Docker** (moby `daemon/libnetwork/ipamutils/utils.go` at `3f38b15`)
  makes local networks from 172.17.0.0/16 to 172.31.0.0/16 and from
  192.168.0.0/16, never from 172.16.0.0/16, unless its daemon is given
  other pools. Measured on Docker Desktop, Engine 28.3.3: a second network
  in a range another holds is refused, "Pool overlaps with other one on
  this address space"; a container given an address inside a network's
  range but outside its `ip_range` gets it, and one given none gets the
  first free address of the `ip_range`. Compose 2.39.2 does not make a
  network that only a service of a profile not asked for joins.
- **Through the real nginx**, measured with the web front's base image,
  `nginxinc/nginx-unprivileged:1.30.5-alpine`
  (`sha256:56b8272e43a0525f67aed68d1e0794a712d10e3e45a563e118e9a77c817e6f86`),
  this repository's `nginx.conf`, and the server image built from this
  branch with compose.yaml's list and a limit of two, on the two networks
  as compose.yaml fixes them: from the host, three requests with three
  forged `X-Forwarded-For` were 401, 401, 429, logged by edge's gateway,
  172.16.239.1, the address Docker Desktop forwarded the published port
  from; from two containers on `edge`, three and one requests were 401,
  401, 429 and 401, each logged by its own address; from cloudflared's
  address with visitors Alice three times and Bob once, 401, 401, 429, 401,
  logged as Alice and Bob; and from another container on `edge` naming
  cloudflared as its last hop, 401, 401, 429, logged by its own address.
  No request was logged by the web front's address.

## Decision

**`FORMANCY_DATA_TRUSTED_PROXIES`** names, comma-separated, the proxies
whose `X-Forwarded-For` the server believes, each an IP address or a CIDR
range. An entry is accepted only as Node's `isIP` reads an address --
dotted decimal without a leading zero, or IPv6 without a zone -- alone or
with `/` and a decimal prefix of 1 to 32 or 128 with no bit set past it.
Unset, empty or only space trusts nothing, which is how every earlier
release ran. `true`, `*` and a prefix of 0 are refused as trusting every
peer; a whole number as counting hops; an empty entry, which is where an
interpolated value went missing; a range with bits set past its prefix,
which is what `ip addr` prints for one interface; and anything else as no
address or range. The process stops with a sentence naming the entry by its
place and never repeating it. The list is read at start. An embedder passes
it as `trustedProxies`, which createDataServer checks by the same rule.

**What the server does with it.** A non-empty list is handed to Fastify's
`trustProxy`; an empty one leaves `trustProxy` out, so no `X-Forwarded-*`
header is read at all. The rate limit's key and the log's `remoteAddress`
are one function's: `request.ip` when it is an IP address, and the peer's
address otherwise, so a forwarded value that is not one -- an address with
its port, a word -- is not believed. The key is
masked as the limiter's default masks it, an IPv6 client by its /64. A
request line names a believed address without the socket's port, which is
the proxy's connection; the peer's address keeps its port. The startup
`planes` line names the list in force.

**The composed stack** fixes two networks, outside Docker's pools:
`proxy`, 172.16.238.0/24, which the web front and the server alone join,
and `edge`, 172.16.239.0/24, as before the web front's and cloudflared's,
each handing out only its lower half. The web front holds 172.16.238.250
on `proxy`, and the Cloudflare overlay gives cloudflared 172.16.239.250 on
`edge`; the server trusts those two addresses and no range. The web front
leaves compose's network: on two networks with the server, which address
`server` resolves to would be Docker's choice. Without the overlay nothing
holds the second address, and Docker never gives it out.

## Consequences

**What it buys.** Behind nginx, and behind cloudflared and nginx, each
client is a bucket of its own, so a script spends its own and nobody
else's; the log names the client where it named the proxy. A client that
forges `X-Forwarded-For` gains nothing: the proxy appends what it saw, and
only that is believed. The Cloudflare guide's edge rule is no longer what
keeps one visitor from refusing everybody; it keeps a visitor's requests
off the machine. Unset, nothing changes.

**What it costs.**
- **A list too wide believes clients about themselves.** A client that can
  connect from an address in the list chooses its own bucket and the
  address the log gives it. A range includes its network's gateway, which
  is where a local process reaches a container from; the composed stack
  names addresses for that reason, and nothing checks an operator's own
  list beyond its shape.
- **A proxy that does not append is never safe to name.** One that passes a
  client's `X-Forwarded-For` on without adding the address it saw leaves
  the client's own text where the walk stops: an address there is
  believed, so the client chooses its bucket, and only text that is no
  address falls back to the peer. Nothing can tell such a proxy from one
  that appends.
- **A list too narrow is one bucket again**, and nothing reports it: a
  deployment whose proxy's address changes, or that names nginx and not
  cloudflared, counts everybody behind the one not named as one.
- **The log names people.** With a proxy listed, the server's log -- the
  audit trail's stream -- holds each client's address where it held the
  proxy's; behind the tunnel, each visitor's, as nginx's own log already
  did. It is personal data, kept as long as the log is.
- **Behind the tunnel the server believes Cloudflare's edge**, as read in
  its documentation and not measured. A private network route to the
  tunnel, which the guide says to have none of, would let an enrolled
  device name its own address in the header and choose its own bucket.
- **A client is an address.** People behind one NAT or one proxy of their
  own share a bucket, and an IPv6 client is counted by its /64; shape (b)'s
  backend is one client to the server as to the edge.
- **Two stacks from `compose.yaml` no longer run at once on one machine**:
  the second's networks are refused, the getting-started gate's included,
  where before each project had ranges of its own. A machine where
  another network holds either range must free it or edit five values in
  two files together -- both ranges, both addresses and the server's list
  -- which the guide's section 0 says; trust.mjs holds them to each other
  in this repository and the gates on Compose's own resolution, and
  nothing checks an operator's edited copy.
- **Changing the list is a restart**, with 0031's cost: the write ids are
  forgotten. It is not read again on SIGHUP, as 0059's key set is.
- **From a listed peer, Fastify's `request.host` and `request.protocol`
  follow `X-Forwarded-Host` and `X-Forwarded-Proto`**, which nginx passes
  on from any client. Nothing reads them, and forwarded.test.ts fails when
  an answer starts to depend on them; a change that reads them needs a
  decision of its own.
- **What was measured through nginx was measured on Docker Desktop**; on a
  Linux host the address Docker forwards a published port from was not
  read, and the getting-started gate's log check is what shows the server
  believes nginx there.
- **`docs/performance.md` was measured before this record** added a key
  function to every request, and is measured again before the next
  release, as every change to the server requires.
- **The getting-started gate's log check and the Cloudflare gate's run of
  the configuration check were not run where this was written**: they
  need the composed stack and the overlay's images, which were not started
  there. The configuration check was run on Compose 2.39.2's resolution of
  both files, and the log check on cases; CI runs both on the pull request.

**What it does not do.** No RFC 7239 `Forwarded`, no `X-Real-IP`, no
`CF-Connecting-IP`: only `X-Forwarded-For`, as Fastify reads it. No hop
count and no named range. No per-route limit, no shared store between
instances: each process counts its own buckets. No change to what an audit
event holds; the request line beside it names the address. nginx's
configuration is unchanged.

**What it forecloses.** Trusting every peer, by any spelling, for as long
as this record stands.

## Alternatives considered

**The proxies' networks rather than their addresses.** One line each and
no fixed address, but the gateway is in the range: a local process on a
Linux host reaches the server past nginx from it, and would choose its own
address -- 0037's objection, which stands.

**Compose's network fixed, the web front kept on it.** One network fewer,
but every developer's `docker compose up -d` for the databases alone would
then take the fixed range too, and a second network shared with the
server leaves which address `server` resolves to to Docker.

**The ranges as variables, the gate choosing free ones.** Two stacks would
run at once again, but the gate would no longer run the values the guide's
reader gets, and the server's list would have to be derived from two
variables by interpolation Compose 2.20 was not shown to support.

**Trusting cloudflared only when the operator opts in.** The server's log
would hold no visitor's address by default, but the overlay cannot change
the server's environment (0037's gate fails when it does), so the opt-in
would be a third variable, and behind the tunnel the default would stay
one bucket for every visitor, which is what this change is for.

**Our own walk over `X-Forwarded-For`, leaving Fastify's `trustProxy` off.**
`request.host` and `request.protocol` would never follow a forwarded
header, but it is a second implementation of proxy-addr's walk and its
IPv4-mapped rules, which would have to agree with the one every Fastify
plugin reads.

**`CF-Connecting-IP`, or nginx's realip module.** One address and no walk,
but a header the server believes from one proxy only, or a second place
that decides who is trusted, which nginx would need cloudflared's address
for all the same.

**Hop counts, `true`, or proxy-addr's named ranges.** A count trusts by
position, not by who connected, and Fastify 5.12.5 trusts nothing for one;
`true` trusts everybody; `uniquelocal` is every private address, a
Docker gateway among them.

**Refusing a forwarded value that is not an address with 400.** A
misconfigured proxy would refuse every request instead of counting them as
its own, and the client would see a refusal for the operator's mistake.

## Older records

Narrowed, not edited away: 0034, whose sentence that `trustProxy` is still
not offered, behind a proxy raising the one shared bucket, holds now only
where no proxy is named; 0037, whose "rate limiting stays one bucket at the
server" and per-address limiting as the edge's hold only where the
operator names no proxy -- the composed stack names nginx and cloudflared,
and the edge rule keeps a visitor's requests off the machine rather than
protecting everybody's bucket -- and whose rejected alternative is taken
up here with its first objection kept as a rule. Extended: 0032, whose
stack gains the network `proxy` and two fixed ranges, whose web front
leaves compose's network for it, and whose gate reads the server's log for
whom it believed.
