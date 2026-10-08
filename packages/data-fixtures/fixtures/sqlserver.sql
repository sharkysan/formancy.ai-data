-- The Formancy Data fixture, SQL Server edition.
--
-- The same business model as postgres.sql, in T-SQL. Read that file's header
-- for what each table is for; the differences below are the dialect's, and
-- the only one that changes a normalised type -- rowversion -- is written down
-- in src/model.ts.
--
-- Batches are separated by GO on a line of its own, as sqlcmd and SSMS expect.
-- The loader splits on it, because a driver sends one batch at a time and
-- CREATE SCHEMA and CREATE VIEW must each be the first statement in theirs.

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
  constraint pk_order_line primary key (order_id, line_no)
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
GO
