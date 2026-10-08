# The Formancy Data server.
#
# Built from the repository root, because a pnpm workspace package cannot be
# built without its lockfile and its sibling packages:
#
#   docker build -f packages/data-server/Dockerfile -t formancy/data-server .
#
# The same shape as formancy.ai's server image, for the same reasons; the
# comments here say only where it differs.

# ---------------------------------------------------------------- build stage
FROM node:22.12-alpine AS build
WORKDIR /repo

# Node 22.12 bundles a corepack whose signature verification fails against the
# current npm registry keys. Upgrading corepack first is the fix.
RUN npm install -g corepack@latest && corepack enable pnpm

# Manifests and lockfile first, so a source change does not invalidate the
# dependency layer. Every workspace package the server depends on is listed
# here AND copied in full below; src/dockerfile.test.ts derives that list from
# the dependency graph and fails when this file forgets one.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/data-server/package.json packages/data-server/

# --ignore-scripts: nothing the server needs runs a postinstall, and a build
# that runs arbitrary install scripts from the network is supply-chain surface
# for no benefit.
RUN pnpm install --frozen-lockfile --ignore-scripts \
      --filter @formancy/data-server... --filter .

COPY LICENSE.md NOTICE tsconfig.base.json ./
COPY scripts/ scripts/
COPY packages/data-server/ packages/data-server/

RUN pnpm --filter @formancy/data-server... build && node scripts/sync-licenses.mjs

# A self-contained tree, so the runtime stage needs neither pnpm nor the
# repository.
RUN pnpm --filter @formancy/data-server --prod deploy /app

# -------------------------------------------------------------- runtime stage
FROM node:22.12-alpine AS runtime
WORKDIR /app

COPY --from=build --chown=node:node /app /app

# Unprivileged. The one place the server writes is the configuration volume,
# which the operator mounts and owns.
USER node

ENV NODE_ENV=production \
    PORT=4390

EXPOSE 4390

# The issuer, audience and identity key have no defaults on purpose: a server
# that started accepting tokens from an issuer nobody named would be worse than
# one that refuses to start. See packages/data-server/src/main.ts.

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4390)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.mjs"]
