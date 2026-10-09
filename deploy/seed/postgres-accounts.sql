-- The order form's account takes the volume's password, and the fixture's
-- reader can no longer log in (0032). postgres.sh runs this in one
-- transaction with the fixture on the first load, so the fixture's own
-- passwords are never committed as logins, and in one of its own after that.
--
-- The writer's password reaches the server inside this statement's text, and
-- PostgreSQL writes a statement's text to its log when log_statement or a
-- duration or sampling setting says to, and when the statement fails, at
-- log_min_error_statement -- password included, as its ALTER ROLE page
-- warns. Each is turned off here for this transaction alone, which the
-- owner, a superuser, may do; so neither a setting somebody turns on nor a
-- statement that fails puts the password in `docker compose logs postgres`.
-- scripts/getting-started.mjs turns on log_statement = 'all' and
-- log_min_duration_statement = 0 before the seed runs again, and fails if the
-- password then reaches a log.
\getenv pw FORMANCY_WRITER_PASSWORD
set local log_statement = 'none';
set local log_min_duration_statement = -1;
set local log_min_duration_sample = -1;
set local log_transaction_sample_rate = 0;
set local log_min_error_statement = panic;
alter role formancy_writer password :'pw';
alter role formancy_reader nologin password null;
