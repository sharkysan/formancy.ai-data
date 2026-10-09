#!/bin/bash
# Loads the sample fixture into the composed SQL Server, once, and gives the
# order form's login its password from the secrets volume every time (0032).
# compose.yaml's `seed-sqlserver` service runs it in the SQL Server image the
# database runs, with that image's sqlcmd, after the database is healthy.
#
# The tables and rows are packages/data-fixtures/fixtures/sqlserver.sql and
# sqlserver.restricted.sql, unchanged and byte for byte what every suite runs
# against (0005), split at GO by sqlcmd as the fixture expects. How this
# departs from src/containers.ts is the principals' credentials only: the
# writer's login takes the generated password instead of the fixture's
# constant, and the reader's a random one nobody is told, and is disabled, so
# no password in this repository opens the composed database. The parity file
# is not loaded: it is a test schema outside `sales`, which no form here binds
# to.
#
# The load goes into formancy_fixture_loading and is renamed to
# formancy_fixture only once both files have run. SQL Server cannot put CREATE
# DATABASE and a fixture of GO-separated batches in one transaction, so the
# rename is what makes the load all or nothing: a load that fails or is stopped
# halfway leaves no formancy_fixture, and the next run drops the leftover and
# loads from the start rather than finding half a fixture and calling it done.
set -euo pipefail

# sqlcmd reads both from the environment, so neither is on a command line,
# where any process in the container could read it.
export SQLCMDPASSWORD
SQLCMDPASSWORD=$(cat /run/formancy-secrets/mssql-sa-password)
export WriterPassword
WriterPassword=$(cat /run/formancy-secrets/ms-writer-password)

# It reaches T-SQL as the sqlcmd variable $(WriterPassword) inside N'...', so
# a quote in it would end the literal. secrets.sh writes letters, digits and a
# hyphen; anything else was put there by hand, and is refused, not escaped.
if [[ ! $WriterPassword =~ ^[A-Za-z0-9-]+$ ]]; then
  echo "seed-sqlserver: ms-writer-password may hold only letters, digits and hyphens." >&2
  exit 1
fi

# -I: sqlcmd sets QUOTED_IDENTIFIER off unless asked, where the driver the
# suites load the fixture through leaves it on, and sqlserver.sql's computed
# columns refuse to be created without it ("CREATE TABLE failed because the
# following SET options have incorrect settings", seen on the first run
# without it). -b: an error ends the run.
sql() {
  /opt/mssql-tools18/bin/sqlcmd -S sqlserver -U sa -C -I -b "$@"
}

loaded=$(sql -h -1 -W -Q "set nocount on; select case when db_id(N'formancy_fixture') is null then 0 else 1 end" | tr -d '[:space:]')
if [ "$loaded" != 0 ] && [ "$loaded" != 1 ]; then
  echo "seed-sqlserver: cannot tell whether formancy_fixture exists." >&2
  exit 1
fi

if [ "$loaded" = 0 ]; then
  sql <<'SQL'
if db_id(N'formancy_fixture_loading') is not null
begin
  alter database formancy_fixture_loading set single_user with rollback immediate;
  drop database formancy_fixture_loading;
end;
create database formancy_fixture_loading;
GO
-- Server-level, as src/containers.ts makes them, and kept if a run that
-- failed after this point already made them.
if suser_id(N'formancy_writer') is null
  create login formancy_writer with password = N'$(WriterPassword)', check_policy = off;
if suser_id(N'formancy_reader') is null
begin
  -- A password nobody is told: the reader is a fixture principal the demo
  -- never connects as, and its login is disabled below on every run.
  declare @statement nvarchar(max) = N'create login formancy_reader with password = '
    + quotename(convert(nvarchar(36), newid()) + N'-Aa1', '''') + N', check_policy = off';
  exec (@statement);
end;
GO
SQL
  # -x: no sqlcmd variable substitution inside the fixture files. None uses
  # $( today; a fixture that someday did would be loaded as written.
  sql -d formancy_fixture_loading -x -i /fixtures/sqlserver.sql
  sql -d formancy_fixture_loading -x -i /fixtures/sqlserver.restricted.sql
  sql -Q "alter database formancy_fixture_loading modify name = formancy_fixture"
  echo "seed-sqlserver: fixture loaded"
else
  echo "seed-sqlserver: fixture already loaded"
fi

# Every run, so the login always holds the volume's password.
sql <<'SQL'
alter login formancy_writer with password = N'$(WriterPassword)';
alter login formancy_reader disable;
GO
SQL
echo "seed-sqlserver: formancy_writer has the volume's password; formancy_reader is disabled"
