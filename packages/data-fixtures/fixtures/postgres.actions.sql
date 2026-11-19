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
-- ran and kept what it did. called is a sequence each routine draws from as
-- it begins: a rollback takes its call away and never the number it drew,
-- so a case sees a routine called and then rolled back as called, and one
-- never called as not. close_order takes one value from each kind of
-- source and does what its note asks: refuse in words for the person,
-- refuse otherwise, sleep, raise a notice that crosses the wire with the
-- call's answer, or raise the server's own unknown outcome (40003). It
-- also refuses in words for the person an order whose amount is 66.60,
-- whatever its note: what one record of a selection refuses while the
-- others would not, its amount read from the locked row (0165). Noted
-- 'raise others', it raises the amount of its customer's other orders by
-- one: what one call of a selection writes to a column another record of
-- it passes (0165).
-- broken_order references a column no table has, which PL/pgSQL finds only
-- when it runs. weigh_order is STRICT: PostgreSQL answers NULL for a call
-- given a NULL argument without running it, which discovery records and the
-- generator refuses to bind (0167); a run's description refuses it too.

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

create sequence actions.called;

create function actions.close_order(p_order bigint, p_note text, p_actor text, p_amount numeric, p_tenant int) returns void language plpgsql as $$
begin
  perform pg_catalog.nextval('actions.called');
  insert into actions.call (routine, record_id, note, actor, amount, tenant) values ('close_order', p_order, p_note, p_actor, p_amount, p_tenant);
  if p_note = 'refuse' or p_amount = 66.60 then
    raise exception 'formancy: refused: This order cannot be closed now.';
  elsif p_note = 'plain' then
    raise exception 'an error not worded for the person';
  elsif p_note like 'sleep %' then
    perform pg_catalog.pg_sleep(pg_catalog.substr(p_note, 7)::pg_catalog.float8);
  elsif p_note like 'lost %' then
    raise notice '%', p_note;
  elsif p_note = 'unknown' then
    raise exception 'completion unknown' using errcode = '40003';
  elsif p_note = 'raise others' then
    update actions."order" set amount = amount + 1 where customer_id = (select customer_id from actions."order" where id = p_order) and id <> p_order;
  end if;
  update actions."order" set status = 'closed', note = p_note where id = p_order;
end
$$;
create function actions.broken_order(p_order bigint) returns void language plpgsql as $$
begin
  perform pg_catalog.nextval('actions.called');
  insert into actions.call (routine, record_id) values ('broken_order', p_order);
  update actions."order" set no_such_column = 1 where id = p_order;
end
$$;
create function actions.reprice(p_price bigint) returns void language plpgsql as $$
begin
  perform pg_catalog.nextval('actions.called');
  insert into actions.call (routine, record_id) values ('reprice', p_price);
  update actions.price set amount = amount + 1 where id = p_price;
end
$$;

create function actions.weigh_order(p_order bigint) returns void language plpgsql strict as $
begin
  perform pg_catalog.nextval('actions.called');
  insert into actions.call (routine, record_id) values ('weigh_order', p_order);
end
$;

revoke execute on function actions.close_order(bigint, text, text, numeric, int), actions.broken_order(bigint), actions.reprice(bigint), actions.weigh_order(bigint) from public;
grant usage on schema actions to formancy_writer;
grant select on actions.customer, actions."order", actions.price to formancy_writer;
grant update on actions.customer, actions."order", actions.price to formancy_writer;
grant insert on actions.call to formancy_writer;
grant usage on sequence actions.called to formancy_writer;
grant execute on function actions.close_order(bigint, text, text, numeric, int), actions.broken_order(bigint), actions.reprice(bigint), actions.weigh_order(bigint) to formancy_writer;
