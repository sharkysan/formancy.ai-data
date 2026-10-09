-- The parity schema, PostgreSQL edition (0028).
--
-- What both adapters' parity suites run against: one row filter, one label
-- and one refusal per case in src/parity.ts, with the expected answer written
-- there once for both engines. sqlserver.parity.sql is the same schema in
-- T-SQL; read the two side by side.
--
-- Outside FIXTURE_SCOPE on purpose: discovery of `sales` never sees it, so
-- the studio's and the examples' captured snapshots do not change when this
-- file does. Owner-only: neither restricted principal is granted anything here.
--
-- tenant_item.tenant_code uses a case-insensitive ICU collation that is not
-- deterministic, the case where `tenant_code = $1` with an untyped parameter
-- let tenant `acme` read `ACME`'s rows (C3c). Its four named rows differ by
-- case, a trailing space and an accent; the 20,000 fillers are the size at
-- which the plans in C4 and C5 were read, so a filter that stops using the
-- primary key is seen to. A filler's code is `fill-<n>`, which fits
-- varchar(10) up to n = 20000. fixed_code is `AB` but for one row, `ab`,
-- which differs only by case: on SQL Server a char(n) compared under the
-- column's case-insensitive collation alone would admit it. The version
-- column guards an update (0015), so each filter case is run through one.

create schema parity;

create collation parity.ci (provider = icu, locale = 'und-u-ks-level2', deterministic = false);

create table parity.tenant_item (
  tenant_code varchar(10) collate parity.ci not null,
  item_no int not null,
  fixed_code char(3) not null,
  label varchar(50) not null,
  version int not null default 0,
  constraint pk_tenant_item primary key (tenant_code, item_no)
);
create index ix_tenant_item_fixed_code on parity.tenant_item (fixed_code);

insert into parity.tenant_item (tenant_code, item_no, fixed_code, label) values
  ('acme', 1, 'AB', 'Lower'),
  ('ACME', 2, 'ab', 'Upper'),
  ('acme ', 3, 'AB', 'Trailing'),
  ('Acmé', 4, 'AB', 'Accent');
insert into parity.tenant_item (tenant_code, item_no, fixed_code, label)
  select 'fill-' || n, n + 10, 'XY', 'Filler' from generate_series(1, 20000) as n;

-- The root a tenant_item lookup is generated from. The foreign key's columns
-- use the nondeterministic collation, which PostgreSQL 17 accepts (C4b).
create table parity.item_use (
  id int not null constraint pk_item_use primary key,
  tenant_code varchar(10) collate parity.ci not null,
  item_no int not null,
  constraint fk_item_use_item foreign key (tenant_code, item_no) references parity.tenant_item (tenant_code, item_no)
);

-- One row holding one value of every kind a label shows. src/parity.ts
-- names the label each must read as, on both engines. The floats are ones
-- whose text depends on the session: 0.1 + 0.2 needs 17 digits, and reads
-- 0.3 at extra_float_digits 0; the real 1234567.875 is 1234567.9 at its
-- shortest and 1.23457e+06 at extra_float_digits 0.
create table parity.display_kinds (
  id int not null constraint pk_display_kinds primary key,
  t varchar(20) not null,
  fixed char(5) not null,
  i bigint not null,
  d numeric(14, 2) not null,
  b boolean not null,
  f double precision not null,
  r real not null,
  dt date not null,
  tm time(3) not null,
  ts timestamptz(3) not null,
  tz timestamp(3) not null,
  u uuid not null
);
insert into parity.display_kinds values (
  1, 'Text', 'AB', 9007199254740993, 12.50, true, 0.1::float8 + 0.2::float8, 1234567.875, '2026-10-08', '10:34:56.789',
  '2026-10-08 10:34:56.789+02', '2026-10-08 10:34:56.789', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
);

create table parity.display_use (
  id int not null constraint pk_display_use primary key,
  kinds_id int not null constraint fk_display_use_kinds references parity.display_kinds (id)
);

-- A trigger's own errors: 'refuse' is the ordinary RAISE (P0001), 'odd' an
-- SQLSTATE no adapter recognises (38000, C11), and 'slow' sleeps a second,
-- for a statement timeout (57014, C11b). Each is raised before the row is
-- written, so nothing is.
create table parity.guarded (
  id int not null constraint pk_guarded primary key,
  note varchar(50) null,
  version int not null default 0
);
create function parity.guard() returns trigger language plpgsql as $$
begin
  if new.note = 'refuse' then
    raise exception 'guarded refuses this note';
  elsif new.note = 'odd' then
    raise exception using errcode = '38000', message = 'guarded found an odd note';
  elsif new.note = 'slow' then
    perform pg_catalog.pg_sleep(1);
  end if;
  return new;
end
$$;
create trigger tr_guarded before insert or update on parity.guarded for each row execute function parity.guard();

-- A write declined without an error: a BEFORE trigger that returns NULL.
create table parity.declined (
  id int not null constraint pk_declined primary key,
  note varchar(50) null
);
create function parity.decline() returns trigger language plpgsql as $$
begin
  return null;
end
$$;
create trigger tr_declined before insert on parity.declined for each row execute function parity.decline();

-- A generated column a write names: 428C9 (C8).
create table parity.generated (
  id int generated always as identity constraint pk_generated primary key,
  note varchar(50) null
);

-- A deadlock victim (C10): updating row 1 locks row 2, so a session that
-- holds row 2 and then asks for row 1 closes the cycle.
create table parity.contended (
  id int not null constraint pk_contended primary key,
  note varchar(50) null,
  version int not null default 0
);
insert into parity.contended (id, note) values (1, 'one'), (2, 'two');
create function parity.contend() returns trigger language plpgsql as $$
begin
  if new.id = 1 then
    perform 1 from parity.contended where id = 2 for update;
  end if;
  return new;
end
$$;
create trigger tr_contended before update on parity.contended for each row execute function parity.contend();

analyze parity.tenant_item;
