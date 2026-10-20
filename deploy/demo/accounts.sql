-- The live demo's one database account, which the server connects as and
-- the forms are generated from (deploy/demo/build.sh loads this in the
-- transaction that loads the fixture and the demo's rows, so no half-made
-- account is ever committed). The fixture's own accounts
-- (postgres.restricted.sql) and their constant passwords are never loaded
-- into the demo.
--
-- It is granted what the four forms use and nothing else: what it may
-- SELECT, INSERT and UPDATE is what the generator reads to decide what each
-- form offers, so these lines are the forms' capabilities as much as the
-- policy is (0027). In particular:
--
-- * an order's customer and amount are written on create only: no UPDATE on
--   customer_no, tenant_id or amount;
-- * the customer form offers create and no update or delete, because the
--   table has no version column the generator could prove an update by: so
--   no UPDATE or DELETE on customer;
-- * a customer's created_at is the database's, from its default: INSERT on
--   every column but that one, so the form shows when a customer was
--   created and no visitor can say it (0089);
-- * an order's lines, deliveries and their parcels are deleted by the
--   cascades of a delete of the order or the delivery, and a delete that
--   reaches a table is held to this account's DELETE on it (0049): hence
--   DELETE on order_line and parcel, which no form deletes from directly;
-- * parcel has no form, so it is read and deleted and never written;
-- * countries and employees are read through the lookups, never written.
--
-- Unlike the composed stack's formancy_writer it may read sales.order_line,
-- so an order's lines are a child grid here. The fixture's row-level
-- security on customer (`current_user <> 'formancy_writer' or tenant_id =
-- 1`) shows this account both tenants; the forms' row filters on the
-- token's tenant separate them, which is the product's own mechanism.
--
-- LOGIN with no password: build.sh and start.sh set one through
-- password.sql, a new one on every start, and the image is left with none.
create role formancy_demo login;
grant usage on schema sales to formancy_demo;

grant select, insert, delete on sales."order" to formancy_demo;
grant update (order_date, status, notes, "group", created_by, approved_by, row_version) on sales."order" to formancy_demo;

grant select, insert, delete on sales.order_line to formancy_demo;
grant update (quantity, unit_price, row_version) on sales.order_line to formancy_demo;

grant select, insert, delete on sales.delivery to formancy_demo;
grant update (carrier, shipped_at, row_version) on sales.delivery to formancy_demo;

grant select, delete on sales.parcel to formancy_demo;

grant select on sales.customer to formancy_demo;
grant insert (tenant_id, customer_no, name, country_code, credit_limit, active) on sales.customer to formancy_demo;

grant select on sales.employee, sales.country to formancy_demo;
