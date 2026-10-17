#!/bin/sh
# The live demo image's build (0070), run once by the Dockerfile's
# `RUN sh /demo/build.sh`, as root: PostgreSQL initialised and loaded, the
# demo's forms published through the real administrator plane, and both
# stopped, leaving no usable credential behind. start.sh is every start.
#
# PGDATA (the Dockerfile's ENV) is not the base image's
# /var/lib/postgresql/data, which the base declares a VOLUME: the
# Dockerfile says why.
set -eu

PG_LOG=/tmp/postgres-build.log
SERVER_LOG=/tmp/server-build.log

# On a failure, what the database and the server said, which is how a
# refused build is diagnosed; neither logs a statement's text or a header
# (password.sql; the server logs no request header).
on_exit() {
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "build.sh failed with status $status; the build-time logs follow." >&2
    cat "$PG_LOG" "$SERVER_LOG" >&2 2>/dev/null || true
  fi
}
trap on_exit EXIT

# 32 random bytes as base64url: 43 characters, over the server's 32-byte
# minimum for a key, and nothing a shell or SQL literal has to escape.
random() {
  node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
}

sql() {
  gosu postgres psql -X -q -v ON_ERROR_STOP=1 "$@"
}

mkdir -p "$PGDATA" /run/postgresql "$FORMANCY_DATA_STORE_DIR"
chown -R postgres:postgres "$(dirname "$PGDATA")" /run/postgresql
chmod 700 "$PGDATA"
chown node:node "$FORMANCY_DATA_STORE_DIR"

# Peer over the socket, so only the `postgres` OS user is the superuser
# there -- the server runs as `node`, which has no such role -- and a
# password over TCP, which only the demo's account will have.
gosu postgres initdb --username=postgres --auth-local=peer --auth-host=scram-sha-256 >/dev/null
# Loopback only: the server beside it is the one client.
echo "listen_addresses = '127.0.0.1'" >>"$PGDATA/postgresql.conf"
gosu postgres pg_ctl -D "$PGDATA" -l "$PG_LOG" -w -s start

# The fixture's schema and rows, byte for byte as every suite loads them,
# replaced by the demo's rows and given the demo's account, in one
# transaction: a load that fails leaves nothing half made.
sql -d postgres -c 'create database formancy_demo'
sql -d formancy_demo -1 -f /demo/postgres.sql -f /demo/demo-data.sql -f /demo/accounts.sql

# This build's password and key: in this shell's environment, which the
# server and the publish read and which ends with this RUN; never a file,
# never a command line.
FORMANCY_DEMO_DB_PASSWORD=$(random)
FORMANCY_DATA_DEMO_BUILD_KEY=$(random)
FORMANCY_DATA_ADMIN_ROLES=data-admin
export FORMANCY_DEMO_DB_PASSWORD FORMANCY_DATA_DEMO_BUILD_KEY FORMANCY_DATA_ADMIN_ROLES
sql -d formancy_demo -1 -f /demo/password.sql

# The server with its administrator's plane on, for this build only: the
# running image sets no FORMANCY_DATA_ADMIN_ROLES. The publish waits for
# /health itself.
FORMANCY_DATA_IDENTITY_SECRET=env:FORMANCY_DATA_DEMO_BUILD_KEY gosu node node /app/dist/main.mjs >"$SERVER_LOG" 2>&1 &
server=$!
if ! gosu node node /tools/dist/image/cli.mjs; then
  kill "$server" 2>/dev/null || true
  exit 1
fi
kill -TERM "$server"
wait "$server"

# No password the image carries opens the database: start.sh sets a new
# one on every start. Checked, so a build that left one fails here.
sql -d formancy_demo -c 'alter role formancy_demo password null'
nulled=$(sql -d formancy_demo -tA -c "select rolpassword is null from pg_authid where rolname = 'formancy_demo'")
if [ "$nulled" != t ]; then
  echo "build.sh: formancy_demo still has a password." >&2
  exit 1
fi

# A clean shutdown, so a start replays nothing, and no build log in the image.
gosu postgres pg_ctl -D "$PGDATA" -w -s -m fast stop
rm -f "$PG_LOG" "$SERVER_LOG"
echo "build.sh: database loaded, forms published, stopped"
