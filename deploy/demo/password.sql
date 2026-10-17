-- A new password for the demo's account, from the environment of the psql
-- that runs this, never from its command line, where every process in the
-- container could read it. build.sh runs it once for the image's build, and
-- start.sh on every start, as the `postgres` superuser over the socket, in a
-- transaction of its own (`psql -1`): `set local` lasts that transaction.
--
-- The password reaches the server inside this statement's text, and
-- PostgreSQL writes a statement's text to its log when log_statement or a
-- duration or sampling setting says to, and when the statement fails, at
-- log_min_error_statement -- password included, as its ALTER ROLE page
-- warns. Each is turned off here for this transaction alone, as
-- deploy/seed/postgres-accounts.sql does for the composed stack, so neither
-- a setting somebody turns on nor a statement that fails puts it in the
-- container's log. `:'pw'` is psql's own quoting of a variable as a literal.
\getenv pw FORMANCY_DEMO_DB_PASSWORD
set local log_statement = 'none';
set local log_min_duration_statement = -1;
set local log_min_duration_sample = -1;
set local log_transaction_sample_rate = 0;
set local log_min_error_statement = panic;
alter role formancy_demo password :'pw';
