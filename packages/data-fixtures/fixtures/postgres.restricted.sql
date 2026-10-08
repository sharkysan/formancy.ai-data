-- A reader that may read sales."order" and nothing else in the schema.
--
-- The question this principal exists to ask: when discovery runs as an account
-- that cannot read sales.customer, what does it say about fk_order_customer,
-- which points there? Either the right target, or a coverage gap -- never
-- nothing (src/conformance.ts, restrictedDisagreements).
--
-- The password is a fixture constant for a container that lives for one test
-- run; src/containers.ts holds the same value, and the fixture-load test fails
-- if the two drift apart.
create role formancy_reader login password 'reader-fixture-password';
grant usage on schema sales to formancy_reader;
grant select on sales."order" to formancy_reader;
