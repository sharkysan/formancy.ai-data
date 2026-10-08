-- A reader that may read sales.[order] and nothing else in the schema; see
-- postgres.restricted.sql for the question it asks. The login is server-level
-- and is created by src/containers.ts in master; this maps it into the fixture
-- database and grants the one table.
create user formancy_reader for login formancy_reader;
GO

grant select on sales.[order] to formancy_reader;
GO
