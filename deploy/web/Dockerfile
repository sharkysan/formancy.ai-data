# The composed stack's web front (0032): the studio and the host page, built
# from this checkout, behind nginx with the data server's /v1/ and /health on
# the same origin. compose.yaml builds it from the repository root:
#
#   docker compose --profile stack up -d --build
#
# Built locally and never published: the studio is private (0024) and the host
# page is an example (0029). It carries LICENSE.md and NOTICE because what it
# serves is this repository's source-available code, and each app's build
# writes THIRD-PARTY-NOTICES.txt beside its index.html for the packages it
# bundles (0046), served with the page.

# ------------------------------------------------------------ manifests stage
# What pnpm reads to install, cut from the whole checkout (less what
# .dockerignore drops). The install below is cached on these files alone, so
# editing a source file, a script or compose.yaml neither reinstalls nor
# leaves another copy of the dependency tree in Docker's build cache. Before
# this stage each such edit left one of 760 MB (`docker buildx du`,
# 2026-10-09, Docker Sandbox VM on Windows 11, where four of them helped fill
# a 9.8 GB Docker disk). Taken by name from the checkout rather than listed by
# package, so a new workspace package cannot be forgotten here.
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

# --ignore-scripts as in the server image: nothing the two builds need runs an
# install script, and their native bundlers arrive as prebuilt optional
# packages. The two apps' workspace dependencies come from the graph, not from
# a list here.
COPY --from=manifests /repo/ ./
RUN pnpm install --frozen-lockfile --ignore-scripts \
      --filter @formancy/data-studio... --filter @formancy/data-host...

# Their workspace dependencies, then each app at the path nginx serves it
# from. The base is a flag here, not a change to either vite config, so the
# apps' own browser gates keep building them at /.
COPY . .
RUN pnpm --filter "@formancy/data-studio^..." --filter "@formancy/data-host^..." build
RUN pnpm --filter @formancy/data-studio exec vite build --base=/studio/
RUN pnpm --filter @formancy/data-host exec vite build --base=/host/

# -------------------------------------------------------------- runtime stage
# Unprivileged: uid 101, listening on 8080. An exact release, so a rebuild next
# month serves with the nginx this one was checked against.
FROM nginxinc/nginx-unprivileged:1.30.5-alpine AS runtime

COPY LICENSE.md NOTICE /usr/share/formancy-data/
COPY --from=build /repo/apps/studio/dist/ /usr/share/formancy-data/studio/
COPY --from=build /repo/apps/host/dist/ /usr/share/formancy-data/host/
COPY deploy/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
