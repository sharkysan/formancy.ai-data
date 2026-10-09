#!/bin/sh
# Loads the sample fixture into the composed PostgreSQL, once, and gives the
# order form's account its password from the secrets volume every time (0032).
# compose.yaml's `seed-postgres` service runs it in the postgres image, with
# psql, after the database is healthy.
#
# The tables and rows are packages/data-fixtures/fixtures/postgres.sql and
# postgres.restricted.sql, unchanged and byte for byte what every suite runs
# against (0005). How this departs from src/containers.ts is the principals'
# credentials only: the fixture's constant passwords are replaced, the
# writer's with the generated one and the reader's with none, so no password
# in this repository opens the composed database. The parity file is not
# loaded: it is a test schema outside `sales`, which no form here binds to.
#
# Both files go in one transaction (`-1`), so a load that fails or is stopped
# halfway leaves no `sales` schema, and the next run loads from the start
# rather than finding half a fixture and calling it done. The accounts'
# passwords (postgres-accounts.sql) are set in that same transaction, so the
# fixture's constant ones are never committed as logins, and on every later
# run in a transaction of their own; that file says how the password is kept
# out of PostgreSQL's log.
set -eu

export PGPASSWORD
PGPASSWORD=$(cat /run/formancy-secrets/postgres-owner-password)
# psql reads it with \getenv in postgres-accounts.sql, so it is never on a
# command line, where any process in the container could read it.
export FORMANCY_WRITER_PASSWORD
FORMANCY_WRITER_PASSWORD=$(cat /run/formancy-secrets/pg-writer-password)

run() {
  psql -h postgres -U formancy -d formancy_data -v ON_ERROR_STOP=1 -X -q "$@"
}

# An assignment, so a psql that cannot connect stops the script here rather
# than reading as "already loaded".
missing=$(run -tA -c "select to_regnamespace('sales') is null")
case "$missing" in
  t)
    run -1 -f /fixtures/postgres.sql -f /fixtures/postgres.restricted.sql -f /seed/postgres-accounts.sql
    echo "seed-postgres: fixture loaded"
    ;;
  f)
    run -1 -f /seed/postgres-accounts.sql
    echo "seed-postgres: fixture already loaded"
    ;;
  *)
    echo "seed-postgres: cannot tell whether the sales schema exists." >&2
    exit 1
    ;;
esac

# Either way, the account now holds the volume's password: `:'pw'` is psql's
# own quoting of a variable as a literal, so the value is never spliced into
# the statement's text by this script.
echo "seed-postgres: formancy_writer has the volume's password; formancy_reader cannot log in"
