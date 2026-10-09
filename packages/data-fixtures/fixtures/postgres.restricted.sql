-- Two restricted principals.
--
-- formancy_reader may read sales."order" and nothing else in the schema. The
-- question it exists to ask: when discovery runs as an account that cannot
-- read sales.customer, what does it say about fk_order_customer, which points
-- there? Either the right target, or a coverage gap -- never nothing
-- (src/conformance.ts, restrictedDisagreements). Since 0027 it also asks
-- whether every privilege is reported as the database answers it
-- (src/access.ts, READER_ACCESS).
--
-- formancy_writer is the order form's account, holding its grants through
-- the role formancy_forms: it reads and inserts orders, updates some of their
-- columns, reads three columns of customer, and postgres.sql's row-level
-- security shows it tenant 1 only (src/access.ts, WRITER_ACCESS).
--
-- The passwords are fixture constants for a container that lives for one
-- test run; src/containers.ts holds the same values, and src/load.test.ts
-- fails if the two drift apart.
create role formancy_reader login password 'reader-fixture-password';
grant usage on schema sales to formancy_reader;
grant select on sales."order" to formancy_reader;

create role formancy_forms nologin;
grant usage on schema sales to formancy_forms;
grant select, insert on sales."order" to formancy_forms;
grant update (status, notes, "group", approved_by, row_version) on sales."order" to formancy_forms;
grant select (tenant_id, customer_no, name) on sales.customer to formancy_forms;
create role formancy_writer login password 'writer-fixture-password' in role formancy_forms;
