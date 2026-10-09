-- Two restricted principals; see postgres.restricted.sql for the questions
-- they ask. The logins are server-level and are created by src/containers.ts
-- in master, with the passwords src/containers.ts holds; this maps them into
-- the fixture database and grants what each may do.
--
-- formancy_reader may read sales.[order] and nothing else in the schema.
--
-- formancy_writer holds the order form's grants through the role
-- formancy_forms, as on PostgreSQL, except that SQL Server writes the
-- rowversion itself, so row_version is granted no UPDATE. The role also holds
-- VIEW DEFINITION on the database, the minimum for a snapshot that can
-- establish that no security policy applies (0027, B10c, B19). sqlserver.sql's
-- security policy shows the writer tenant 1 only.
create user formancy_reader for login formancy_reader;
GO

grant select on sales.[order] to formancy_reader;
GO

create role formancy_forms;
grant select, insert on sales.[order] to formancy_forms;
grant update (status, notes, [group], approved_by) on sales.[order] to formancy_forms;
grant select (tenant_id, customer_no, name) on sales.customer to formancy_forms;
grant view definition to formancy_forms;
create user formancy_writer for login formancy_writer;
alter role formancy_forms add member formancy_writer;
GO
