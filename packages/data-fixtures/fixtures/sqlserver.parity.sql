-- The parity schema, SQL Server edition (0028).
--
-- postgres.parity.sql in T-SQL; read that file's header for what each table
-- is for. The differences below are the dialect's.
--
-- tenant_item.tenant_code is nvarchar(10) under the database's own collation,
-- SQL_Latin1_General_CP1_CI_AS: case-insensitive, accent-sensitive, and like
-- every SQL Server collation blind to trailing spaces, so tenant `acme` read
-- `acme `'s rows under a BIN2-only comparison (C2-table). An nvarchar column
-- is the case where an exact filter can still seek its index (C5b).
--
-- A trigger cannot return a result set, so contended's trigger locks row 2
-- into a variable. guarded's trigger runs AFTER the write, as most do on SQL
-- Server, and its error rolls the write back. Batches are separated by GO.

create schema parity;
GO

create table parity.tenant_item (
  tenant_code nvarchar(10) not null,
  item_no int not null,
  fixed_code char(3) not null,
  label nvarchar(50) not null,
  version int not null constraint df_tenant_item_version default 0,
  constraint pk_tenant_item primary key (tenant_code, item_no)
);
create index ix_tenant_item_fixed_code on parity.tenant_item (fixed_code);

insert into parity.tenant_item (tenant_code, item_no, fixed_code, label) values
  (N'acme', 1, 'AB', N'Lower'),
  (N'ACME', 2, 'ab', N'Upper'),
  (N'acme ', 3, 'AB', N'Trailing'),
  (N'Acmé', 4, 'AB', N'Accent');
with numbers as (
  select top (20000) row_number() over (order by (select null)) as n
  from sys.all_objects as a cross join sys.all_objects as b
)
insert into parity.tenant_item (tenant_code, item_no, fixed_code, label)
  select N'fill-' + convert(nvarchar(10), n), n + 10, 'XY', N'Filler' from numbers;

create table parity.item_use (
  id int not null constraint pk_item_use primary key,
  tenant_code nvarchar(10) not null,
  item_no int not null,
  constraint fk_item_use_item foreign key (tenant_code, item_no) references parity.tenant_item (tenant_code, item_no)
);

-- The uuid is inserted upper case, as SQL Server prints one; its label is
-- lower case on both engines. The double is the sum of two floats, not a
-- literal, which T-SQL would read as a decimal first.
create table parity.display_kinds (
  id int not null constraint pk_display_kinds primary key,
  t nvarchar(20) not null,
  fixed char(5) not null,
  i bigint not null,
  d decimal(14, 2) not null,
  b bit not null,
  f float not null,
  r real not null,
  dt date not null,
  tm time(3) not null,
  ts datetimeoffset(3) not null,
  tz datetime2(3) not null,
  u uniqueidentifier not null
);
insert into parity.display_kinds values (
  1, N'Text', 'AB', 9007199254740993, 12.50, 1, cast(0.1 as float) + cast(0.2 as float), 1234567.875, '2026-10-08', '10:34:56.789',
  '2026-10-08T10:34:56.789+02:00', '2026-10-08T10:34:56.789', 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11'
);

create table parity.display_use (
  id int not null constraint pk_display_use primary key,
  kinds_id int not null constraint fk_display_use_kinds references parity.display_kinds (id)
);

-- 'refuse' is THROW 50001, 'odd' a RAISERROR the adapter does not recognise
-- (50000), 'slow' waits a second (C9).
create table parity.guarded (
  id int not null constraint pk_guarded primary key,
  note nvarchar(50) null,
  version int not null constraint df_guarded_version default 0
);
GO
create trigger parity.tr_guarded on parity.guarded after insert, update as
begin
  set nocount on;
  if exists (select 1 from inserted where note = N'refuse') throw 50001, N'guarded refuses this note', 1;
  if exists (select 1 from inserted where note = N'odd') raiserror(N'guarded found an odd note', 16, 1);
  if exists (select 1 from inserted where note = N'slow') waitfor delay '00:00:01';
end
GO

-- A write declined without an error: an INSTEAD OF trigger that does nothing (C9b).
create table parity.declined (
  id int not null constraint pk_declined primary key,
  note nvarchar(50) null
);
GO
create trigger parity.tr_declined on parity.declined instead of insert as
begin
  set nocount on;
end
GO

-- An identity a write names: 544 on insert, 8102 on update (C8).
create table parity.generated (
  id int identity(1, 1) not null constraint pk_generated primary key,
  note nvarchar(50) null
);

create table parity.contended (
  id int not null constraint pk_contended primary key,
  note nvarchar(50) null,
  version int not null constraint df_contended_version default 0
);
insert into parity.contended (id, note) values (1, N'one'), (2, N'two');
GO
create trigger parity.tr_contended on parity.contended after update as
begin
  set nocount on;
  declare @locked int;
  if exists (select 1 from inserted where id = 1)
    select @locked = id from parity.contended with (updlock, rowlock) where id = 2;
end
GO

update statistics parity.tenant_item with fullscan;
