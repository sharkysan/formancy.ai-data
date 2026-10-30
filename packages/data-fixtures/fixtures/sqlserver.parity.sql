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

-- What a delete is held to (0050): postgres.parity.sql's tables. SQL Server
-- has no RESTRICT, so removable_restrict's key is NO ACTION, which refuses
-- the same delete with the same error number; it has no rules, so
-- removable_ruled is a table and nothing more. A trigger runs AFTER the
-- delete, so 'refuse' rolls it back, and 'restore' inserts the row again
-- under IDENTITY_INSERT; removable_declined's INSTEAD OF trigger declines
-- every delete without an error.
create table parity.removable (
  id int identity(1, 1) not null constraint pk_removable primary key,
  tenant_id int not null,
  note nvarchar(50) null,
  version int not null constraint df_removable_version default 1
);
create table parity.removable_child (
  id int identity(1, 1) not null constraint pk_removable_child primary key,
  removable_id int not null constraint fk_removable_child_removable references parity.removable (id),
  note nvarchar(50) null,
  version int not null constraint df_removable_child_version default 1
);
create table parity.removable_restrict (
  id int identity(1, 1) not null constraint pk_removable_restrict primary key,
  removable_id int not null constraint fk_removable_restrict_removable references parity.removable (id)
);
create table parity.removable_self (
  id int identity(1, 1) not null constraint pk_removable_self primary key,
  parent_id int null constraint fk_removable_self_parent references parity.removable_self (id),
  version int not null constraint df_removable_self_version default 1
);
create table parity.keyed (
  code nvarchar(10) not null constraint pk_keyed primary key,
  note nvarchar(50) null,
  version int not null constraint df_keyed_version default 1
);
create table parity.removable_triggered (
  id int identity(1, 1) not null constraint pk_removable_triggered primary key,
  note nvarchar(50) null,
  version int not null constraint df_removable_triggered_version default 1
);
create table parity.removable_log (
  id int not null,
  note nvarchar(50) null
);
GO
create trigger parity.tr_removable_triggered on parity.removable_triggered after delete as
begin
  set nocount on;
  if exists (select 1 from deleted where note = N'refuse') throw 50001, N'removable_triggered refuses this delete', 1;
  if exists (select 1 from deleted where note = N'restore')
  begin
    set identity_insert parity.removable_triggered on;
    insert into parity.removable_triggered (id, note, version) select id, note, version from deleted where note = N'restore';
    set identity_insert parity.removable_triggered off;
  end
  insert into parity.removable_log (id, note) select id, note from deleted where note = N'log';
end
GO
create table parity.removable_declined (
  id int identity(1, 1) not null constraint pk_removable_declined primary key,
  note nvarchar(50) null,
  version int not null constraint df_removable_declined_version default 1
);
GO
create trigger parity.tr_removable_declined on parity.removable_declined instead of delete as
begin
  set nocount on;
end
GO
create table parity.removable_ruled (
  id int identity(1, 1) not null constraint pk_removable_ruled primary key,
  note nvarchar(50) null,
  version int not null constraint df_removable_ruled_version default 1
);
GO

-- What a delete reaches past its record (0051): postgres.parity.sql's
-- tables. SQL Server's unique key treats NULLs as equal, so the one over
-- removable_null's reference takes its id too, as PostgreSQL's does, and
-- holds any number of cleared rows.
create table parity.removable_parent (
  id int identity(1, 1) not null constraint pk_removable_parent primary key,
  tenant_id int not null,
  note nvarchar(50) null,
  version int not null constraint df_removable_parent_version default 1
);
create table parity.removable_cascade (
  id int identity(1, 1) not null constraint pk_removable_cascade primary key,
  parent_id int not null constraint fk_removable_cascade_parent references parity.removable_parent (id) on delete cascade,
  note nvarchar(50) null,
  version int not null constraint df_removable_cascade_version default 1
);
create table parity.removable_grandchild (
  id int identity(1, 1) not null constraint pk_removable_grandchild primary key,
  cascade_id int not null constraint fk_removable_grandchild_cascade references parity.removable_cascade (id) on delete cascade,
  note nvarchar(50) null
);
create table parity.removable_null (
  id int identity(1, 1) not null constraint pk_removable_null primary key,
  parent_id int null constraint fk_removable_null_parent references parity.removable_parent (id) on delete set null,
  note nvarchar(50) null,
  version int not null constraint df_removable_null_version default 1,
  constraint uq_removable_null_parent unique (parent_id, id)
);
GO

-- A party, and its company details (0109): a table whose key is its foreign
-- key onto the party's, so a party has at most one row of it, which a form
-- generated as a section of the party shows under it while its kind is
-- company. Both versioned by a column the module moves, so both update.
create table parity.party (
  id int identity(1, 1) not null constraint pk_party primary key,
  tenant_id int not null,
  name nvarchar(100) not null,
  kind nvarchar(20) not null,
  version int not null constraint df_party_version default 1
);
create table parity.party_company (
  party_id int not null constraint pk_party_company primary key constraint fk_party_company_party references parity.party (id),
  vat_no nvarchar(20) not null,
  version int not null constraint df_party_company_version default 1
);
GO

update statistics parity.tenant_item with fullscan;
