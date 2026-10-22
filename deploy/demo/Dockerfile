# The live demo's image (0070): PostgreSQL with the demo's sample sales data,
# and the data server from this checkout beside it, with the demo's four
# forms published at build time through its real administrator's plane.
# Each visitor's Cloudflare Container runs one; its disk is the image's on
# every start, so every start is the data as generated. Built from the
# repository root, as apps/live-demo/wrangler.json's image_build_context
# says, so .dockerignore applies and no local dist/ reaches it:
#
#   docker build --platform linux/amd64 -f deploy/demo/Dockerfile -t formancy/data-demo .
#   FORMANCY_DATA_DEMO_IDENTITY_SECRET=<a key of 32 bytes or more> \
#     docker run --rm -p 127.0.0.1:4390:4390 -e FORMANCY_DATA_DEMO_IDENTITY_SECRET formancy/data-demo
#
# The running server has the runtime plane only, verifies tokens signed with
# the key its starter sets, and reaches PostgreSQL on 127.0.0.1 as the demo's
# own account (accounts.sql), whose password start.sh makes new on every
# start. Not a deployment of the product: no durable store (0013), no
# durable write ids (0031), no administrator's plane.
#
# apps/live-demo/src/image/dockerfile.test.ts holds this file to the code
# that meets it: the PostgreSQL image the suites run on, the Node the
# server's image runs, the issuer, audience and tenant claim the Worker
# signs, the port, the key's variable and every file the scripts name.
#
# Measured on 2026-10-16 on a Windows 11 workstation, Docker Desktop engine
# 28.3.3 (BuildKit, linux/amd64), with postgres:17-alpine (PostgreSQL 17.11,
# Alpine 3.24.1) and node:22.12-alpine already pulled; CPU and memory as
# `docker run --cpus 0.25 --memory 1g`, a quota emulating Cloudflare's
# `basic` instance, not Cloudflare's scheduler:
#
#   built with --no-cache in 53.1 s and 56.4 s (two builds): pnpm install
#     14.6-24.2 s, building 8.9-10.4 s, the deploys and the SQL 4.8-9.2 s,
#     build.sh 7.0-8.0 s, of which publishing the four forms 40-186 ms each;
#   531,629,545 bytes (`docker image inspect`), 197,538,291 through
#     `docker save | gzip -1`: the base 297 MB, Node 122 MB, /app 57.7 MB,
#     the database and store build.sh writes 49.5 MB, /tools 4.4 MB;
#   from `docker run` to /health answering 200 in 4,825-5,278 ms over six
#     starts, and a 13-request journey -- the three personas' menus, a list,
#     a typeahead, an order and a line created, two reads, a refused create,
#     an update -- in 1,911-2,118 ms over three, with the container's peak
#     memory (`memory.max_usage_in_bytes`, cgroup v1 here) 108,863,488 to
#     111,026,176 bytes and never killed;
#   `docker stop` 934-1,192 ms, exit status 0, over three;
#   neither the key nor the database password in `docker logs`, the server
#     PID 1 as `node`, and after a start again with a new key the created
#     order gone, the old token refused 401 and the data there.
#
# Every container of this image also gets an empty anonymous volume at the
# base's declared /var/lib/postgresql/data, which nothing uses and which
# `docker rm` without -v leaves behind: run it with --rm, as above.

# ------------------------------------------------------------ manifests stage
# deploy/web/Dockerfile's, for its reason: the install below is cached on
# what pnpm reads alone, taken by name, so no workspace package can be
# forgotten here.
FROM node:22.12-alpine AS manifests
WORKDIR /repo
COPY . .
RUN find . -type f ! -name package.json ! -name pnpm-lock.yaml ! -name pnpm-workspace.yaml ! -name .npmrc -delete \
 && find . -type d -empty -delete

# ---------------------------------------------------------------- build stage
FROM node:22.12-alpine AS build
WORKDIR /repo

# The server image's lines, for its reason: Node 22.12's bundled corepack
# fails signature verification against the current npm registry keys.
RUN npm install -g corepack@latest && corepack enable pnpm

# The server and the demo's own code, each with its workspace dependencies
# from the graph, not a list here. --ignore-scripts as in the other images.
COPY --from=manifests /repo/ ./
RUN pnpm install --frozen-lockfile --ignore-scripts \
      --filter @formancy/data-server... --filter @formancy/data-live-demo... --filter .

COPY . .
RUN pnpm --filter @formancy/data-server... --filter @formancy/data-live-demo... build && node scripts/sync-licenses.mjs

# Self-contained trees, so the runtime stage needs neither pnpm nor the
# repository: the server, and the demo's programs -- the SQL its database is
# loaded with, written here, and the publish build.sh runs.
RUN pnpm --filter @formancy/data-server --prod deploy /app \
 && pnpm --filter @formancy/data-live-demo --prod deploy /tools \
 && mkdir /seed \
 && node /tools/dist/data/cli.mjs > /seed/demo-data.sql

# -------------------------------------------------------------- runtime stage
FROM postgres:17-alpine AS runtime

# Node's C++ runtime, which it links and the base happens to hold today,
# named so a base without it fails here; and the user the server runs as,
# with the uid the other images give it.
RUN apk add --no-cache libstdc++ \
 && addgroup -g 1000 node \
 && adduser -u 1000 -G node -s /sbin/nologin -D node

COPY --from=build /usr/local/bin/node /usr/local/bin/node
# Root's, so the server, run as node by start.sh, cannot change the code it
# runs (0101); it writes only the store and PostgreSQL's data.
COPY --from=build /app /app
COPY --from=build /tools /tools
COPY LICENSE.md NOTICE /usr/share/formancy-data/
COPY packages/data-fixtures/fixtures/postgres.sql deploy/demo/accounts.sql deploy/demo/password.sql deploy/demo/connections.json deploy/demo/build.sh deploy/demo/start.sh /demo/
COPY --from=build /seed/demo-data.sql /demo/

# PGDATA outside the base's VOLUME, /var/lib/postgresql/data. There, Docker
# makes an anonymous volume for every container, copied from the image at
# each start and left behind by `docker rm` without -v; and whether a build's
# writes there are kept at all is the builder's choice: BuildKit kept them
# (Docker 28.3.3, 2026-10-16), the classic builder is documented to discard
# them. Here the database is part of the image's own filesystem, whichever
# builds it.
ENV PGDATA=/var/lib/formancy-demo/pg \
    FORMANCY_DATA_ISSUER=formancy-data-demo \
    FORMANCY_DATA_AUDIENCE=formancy-data-demo \
    FORMANCY_DATA_ATTRIBUTES=tenant=tid \
    FORMANCY_DATA_STORE_DIR=/var/lib/formancy-data \
    FORMANCY_DATA_CONNECTIONS=/demo/connections.json \
    NODE_ENV=production \
    PORT=4390

RUN sh /demo/build.sh

# Set after the build, whose server verified with a key of its own. A
# reference, env:NAME, never a key, which BuildKit's SecretsUsedInArgOrEnv
# check cannot tell apart and warns about on every build; the check is left
# on for a line that would hold one.
ENV FORMANCY_DATA_IDENTITY_SECRET=env:FORMANCY_DATA_DEMO_IDENTITY_SECRET

# The server's lookup deadline at the share of a CPU the container runs at:
# the default, 892 ms, is the slowest lookup measured on a whole machine
# (0061), and basic gives a quarter of one, so 892 / 0.25. At the default,
# three cold visitors at once beside a type-check had a new order's three
# lookups answer 503 lookup-timeout (2026-10-17, `docker run --cpus 0.25`).
# scripts/live-demo-gate/docker.test.mjs derives it from data-core's default
# and apps/live-demo/wrangler.json's instance type, and fails when this differs.
ENV FORMANCY_DATA_LOOKUP_DEADLINE_MS=3568

EXPOSE 4390

# The base says SIGINT. Cloudflare stops a container with SIGTERM, and so
# should a local run: the server closes its pools on it.
STOPSIGNAL SIGTERM

# No HEALTHCHECK: Cloudflare runs none, and the Worker's Durable Object asks
# /health itself. The base's CMD would reach start.sh as an argument.
ENTRYPOINT ["sh", "/demo/start.sh"]
CMD []
