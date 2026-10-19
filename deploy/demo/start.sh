#!/bin/sh
# Every start of the live demo image (0070): its PostgreSQL, as the build
# left it, then the data server as PID 1. The container's disk is the
# image's on every start, so every start is the demo's data as generated
# and nothing a visitor changed.
#
# PostgreSQL runs beside the server as a daemon, on 127.0.0.1, logging to
# the container's output. On SIGTERM the server closes its pools and exits,
# and PostgreSQL stops with the container, uncleanly: nothing on that disk
# outlives it.
set -eu

# PostgreSQL's socket directory, which build.sh made under /run: Cloudflare
# starts the container with /run empty, and PostgreSQL then exits at once,
# "could not create lock file", so the container did (0088).
mkdir -p /run/postgresql
chown postgres:postgres /run/postgresql

gosu postgres pg_ctl -D "$PGDATA" -w -s start

# A new password for the demo's account, known to this start alone: in the
# environment of psql, which reads it in password.sql, and of the server,
# which deploy/demo/connections.json points at it.
FORMANCY_DEMO_DB_PASSWORD=$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))")
export FORMANCY_DEMO_DB_PASSWORD
gosu postgres psql -X -q -v ON_ERROR_STOP=1 -d formancy_demo -1 -f /demo/password.sql

# The identity key is FORMANCY_DATA_DEMO_IDENTITY_SECRET, which whoever
# starts the container sets: the Worker's Durable Object, a new key on
# every start. The server refuses to start without one.
exec gosu node node /app/dist/main.mjs
