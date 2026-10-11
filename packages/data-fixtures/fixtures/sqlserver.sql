-- The Formancy Data fixture, SQL Server edition.
--
-- The same business model as postgres.sql, in T-SQL. Read that file's header
-- for what each table is for; the differences below are the dialect's. Those
-- that change a normalised fact -- rowversion, what a text length counts,
-- binary(32)'s padding against bytea, shipment's sequence default against an
-- identity, and the check SQL Server disables -- are each written down in
-- src/model.ts with byKind.
--
-- Batches are separated by GO on a line of its own, as sqlcmd and SSMS expect.
-- The loader splits on it, because a driver sends one batch at a time and
-- CREATE SCHEMA, CREATE VIEW and CREATE FUNCTION must each be the first
-- statement in theirs.
--
-- The security policy on customer is postgres.sql's row-level security in
-- T-SQL: the writer (sqlserver.restricted.sql) sees tenant 1 only. SQL Server
-- exempts nobody from an enabled policy, dbo included, so this one passes
-- every account but the writer -- and its existence is what the owner's
-- snapshot reports as row security that applies (0027).

create schema sales;
GO

create table sales.country (
  id int identity(1, 1) not null constraint pk_country primary key,
  iso_code char(2) not null constraint uq_country_iso_code unique,
  name nvarchar(100) not null,
  flag varbinary(max) null,
  shape geography null
);

create table sales.employee (
  id int not null constraint pk_employee primary key,
  name nvarchar(200) not null,
  manager_id int null
);

create table sales.customer (
  tenant_id int not null,
  customer_no int not null,
  name nvarchar(200) not null,
  country_code char(2) null constraint fk_customer_country references sales.country (iso_code),
  credit_limit decimal(14, 2) null,
  active bit not null constraint df_customer_active default 1,
  created_at datetimeoffset not null constraint df_customer_created_at default sysdatetimeoffset(),
  constraint pk_customer primary key (tenant_id, customer_no)
);

exec sys.sp_addextendedproperty
  @name = N'MS_Description', @value = N'A buyer, numbered within its tenant.',
  @level0type = N'SCHEMA', @level0name = N'sales',
  @level1type = N'TABLE', @level1name = N'customer';

create table sales.[order] (
  id bigint identity(1, 1) not null constraint pk_order primary key,
  tenant_id int not null,
  customer_no int not null,
  order_date date not null,
  status varchar(20) not null constraint df_order_status default 'draft'
    constraint ck_order_status check (status in ('draft', 'placed', 'shipped')),
  amount decimal(18, 4) not null,
  notes nvarchar(max) null,
  [group] nvarchar(50) null,
  created_by int null constraint fk_order_created_by references sales.employee (id),
  approved_by int null constraint fk_order_approved_by references sales.employee (id),
  -- An automatically generated binary version, not a timestamp of any clock.
  row_version rowversion not null,
  constraint fk_order_customer foreign key (tenant_id, customer_no)
    references sales.customer (tenant_id, customer_no)
);

create table sales.order_line (
  order_id bigint not null
    constraint fk_order_line_order references sales.[order] (id) on delete cascade,
  line_no int not null,
  quantity int not null,
  unit_price decimal(12, 2) not null,
  line_total as (quantity * unit_price) persisted,
  -- As order's: SQL Server writes it, where PostgreSQL's file has an application-maintained column (0043).
  row_version rowversion not null,
  constraint pk_order_line primary key (order_id, line_no)
);

create sequence sales.shipment_id as int start with 1;
create table sales.shipment (
  id int not null constraint df_shipment_id default (next value for sales.shipment_id)
    constraint pk_shipment primary key,
  tenant_id int not null,
  tracking_no uniqueidentifier not null,
  carrier_code smallint not null,
  reference varchar(20) collate Latin1_General_100_CI_AS_SC_UTF8 not null,
  pickup_time time(0) not null,
  dispatched_at datetime2(3) null,
  weight_kg float null,
  temperature_c real null,
  manifest_hash binary(32) null,
  signature varbinary(256) null,
  constraint uq_shipment_tracking unique (tenant_id, tracking_no),
  constraint ck_shipment_weight check (weight_kg > 0),
  constraint ck_shipment_reference check (reference <> '')
);
GO

create view sales.customer_summary as
  select c.tenant_id, c.customer_no, c.name, count(o.id) as order_count
  from sales.customer c
  left join sales.[order] o on o.tenant_id = c.tenant_id and o.customer_no = c.customer_no
  group by c.tenant_id, c.customer_no, c.name;
GO

insert into sales.country (iso_code, name) values ('CH', N'Switzerland'), ('DE', N'Germany');

-- Employee 3 names a manager that does not exist; the self-reference is added
-- WITH NOCHECK afterwards, so it is enforced for new rows and not trusted.
insert into sales.employee (id, name, manager_id) values (1, N'Ada', null), (2, N'Grace', 1), (3, N'Orphan', 99);
alter table sales.employee with nocheck
  add constraint fk_employee_manager foreign key (manager_id) references sales.employee (id);

insert into sales.customer (tenant_id, customer_no, name, country_code, credit_limit, active)
values (1, 1001, N'Muster AG', 'CH', 999999999999.99, 1),
       (2, 1001, N'Other Tenant GmbH', 'DE', 0.01, 0);

-- 2^53 + 1, as in postgres.sql.
set identity_insert sales.[order] on;
insert into sales.[order] (id, tenant_id, customer_no, order_date, status, amount, notes, [group], created_by)
values (9007199254740993, 1, 1001, '2026-10-08', 'placed', 99999999999999.9999, null, N'A', 1);
set identity_insert sales.[order] off;

insert into sales.order_line (order_id, line_no, quantity, unit_price)
values (9007199254740993, 1, 3, 0.10);

-- As in postgres.sql: the second shipment's carrier is 0, and the check that
-- refuses it is added WITH NOCHECK afterwards, so it is enforced and untrusted.
insert into sales.shipment (tenant_id, tracking_no, carrier_code, reference, pickup_time, dispatched_at, weight_kg, temperature_c, manifest_hash, signature)
values (1, 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11', 32767, N'Zürich-01', '09:30', '2026-10-08 12:34:56.5', 0.30000000000000004e0, 0.1e0, 0x01, 0x01),
       (1, 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', 0, N'B', '17:05', '2026-10-08 12:34:56', null, null, null, null);
alter table sales.shipment with nocheck add constraint ck_shipment_carrier check (carrier_code > 0);
-- Disabled: not checked for new rows, and SQL Server marks it untrusted too.
alter table sales.shipment nocheck constraint ck_shipment_reference;
GO

-- Row-level security that binds one account, as in postgres.sql (0027). A
-- filter predicate hides rows from reads, updates and deletes; it does not
-- stop an insert, and foreign-key checks are not filtered (B11).
-- SCHEMABINDING, so no reader needs EXECUTE on the function; it also blocks
-- an ALTER of customer.tenant_id, which nothing in the suites does.
create function sales.fn_customer_tenant(@tenant_id int)
returns table with schemabinding
as return select 1 as visible where user_name() <> N'formancy_writer' or @tenant_id = 1;
GO

create security policy sales.customer_tenant
  add filter predicate sales.fn_customer_tenant(tenant_id) on sales.customer
  with (state = on);
GO
