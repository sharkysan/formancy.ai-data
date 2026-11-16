-- The actions schema, PostgreSQL edition (0160).
--
-- What both adapters' action suites run a routine over: one fixture written
-- twice (0005), with the answer each case expects written once in
-- src/actions.ts. sqlserver.actions.sql is the same schema in T-SQL; read the
-- two side by side.
--
-- Outside every other scope, so no snapshot of `sales` or `parity` sees it.
-- formancy_writer is the account a run goes as: it reads the tables, moves a
-- version, and may execute the routines, EXECUTE being revoked from PUBLIC so
-- that a revoke from the writer is one a case can make. It also holds UPDATE
-- on customer, the table an order is scoped through: a run locks the
-- through's row FOR SHARE, which PostgreSQL grants only to an account that
-- may update it (actions.integration.test.ts measures both).
--
-- order is numbered by the database, so its version proves the record
-- (0050), and versioned by a column the module moves. price is a form over
-- versions (0113). call is every call a routine of this schema received,
-- with what it was given: how a case sees whether, and with what, a routine
-- ran. close_order takes one value from each kind of source and does what
-- its note asks: refuse in words for the person, refuse otherwise, sleep,
-- or raise a notice that crosses the wire with the call's answer.
-- broken_order references a column no table has, which PL/pgSQL finds only
-- when it runs.

create schema actions;

create table actions.customer (
  id bigint generated always as identity constraint pk_customer primary key,
  tenant_id int not null,
  name varchar(50) not null
);
create table actions."order" (
  id bigint generated always as identity constraint pk_order primary key,
  customer_id bigint not null constraint fk_order_customer references actions.customer (id),
  note varchar(200) null,
  amount numeric(12, 2) not null default 0,
  status varchar(20) not null default 'open',
  version int not null default 1
);
create table actions.price (
  id bigint generated always as identity constraint pk_price primary key,
  customer_id bigint not null constraint fk_price_customer references actions.customer (id),
  product_no int not null,
  valid_from date not null,
  valid_to date null,
  amount numeric(12, 2) not null,
  version int not null default 1,
  constraint uq_price unique (customer_id, product_no, valid_from)
);
create table actions.call (
  id bigint generated always as identity constraint pk_call primary key,
  routine varchar(64) not null,
  record_id bigint not null,
  note varchar(200) null,
  actor varchar(100) null,
  amount numeric(12, 2) null,
  tenant int null
);

create function actions.close_order(p_order bigint, p_note text, p_actor text, p_amount numeric, p_tenant int) returns void language plpgsql as $$
begin
  insert into actions.call (routine, record_id, note, actor, amount, tenant) values ('close_order', p_order, p_note, p_actor, p_amount, p_tenant);
  if p_note = 'refuse' then
    raise exception 'formancy: refused: This order cannot be closed now.';
  elsif p_note = 'plain' then
    raise exception 'an error not worded for the person';
  elsif p_note like 'sleep %' then
    perform pg_catalog.pg_sleep(pg_catalog.substr(p_note, 7)::pg_catalog.float8);
  elsif p_note like 'lost %' then
    raise notice '%', p_note;
  end if;
  update actions."order" set status = 'closed', note = p_note where id = p_order;
end
$$;
create function actions.broken_order(p_order bigint) returns void language plpgsql as $$
begin
  insert into actions.call (routine, record_id) values ('broken_order', p_order);
  update actions."order" set no_such_column = 1 where id = p_order;
end
$$;
create function actions.reprice(p_price bigint) returns void language plpgsql as $$
begin
  insert into actions.call (routine, record_id) values ('reprice', p_price);
  update actions.price set amount = amount + 1 where id = p_price;
end
$$;

revoke execute on function actions.close_order(bigint, text, text, numeric, int), actions.broken_order(bigint), actions.reprice(bigint) from public;
grant usage on schema actions to formancy_writer;
grant select on actions.customer, actions."order", actions.price to formancy_writer;
grant update on actions.customer, actions."order", actions.price to formancy_writer;
grant insert on actions.call to formancy_writer;
grant execute on function actions.close_order(bigint, text, text, numeric, int), actions.broken_order(bigint), actions.reprice(bigint) to formancy_writer;
