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
-- security shows it tenant 1 only (src/access.ts, WRITER_ACCESS). It may
-- delete orders and their lines (0049): a delete of an order cascades into
-- order_line, and a delete that reaches a table is to be held to the
-- account's DELETE on it.
--
-- It holds a delivery's and a parcel's grants the way it holds an order's
-- (0056): it reads and inserts both, updates a delivery's carrier, its
-- shipping time and its application-maintained version and a parcel's
-- delivery and label, and deletes both -- where a delete of an order now
-- cascades, through its deliveries, into their parcels. Neither key is
-- granted UPDATE: a key is never set.
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
grant delete on sales."order", sales.order_line to formancy_forms;
grant select (tenant_id, customer_no, name) on sales.customer to formancy_forms;
grant select, insert on sales.delivery, sales.parcel to formancy_forms;
grant update (carrier, shipped_at, row_version) on sales.delivery to formancy_forms;
grant update (delivery_id, label) on sales.parcel to formancy_forms;
grant delete on sales.delivery, sales.parcel to formancy_forms;
create role formancy_writer login password 'writer-fixture-password' in role formancy_forms;
