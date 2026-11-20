-- The actions schema, SQL Server edition (0160).
--
-- postgres.actions.sql in T-SQL; read that file's header for what each table
-- and routine is for. The differences below are the dialect's, and three
-- that are SQL Server's alone.
--
-- A routine is a procedure, and reaches its owner's tables by ownership
-- chaining, so formancy_writer needs no grant on call to have a call
-- recorded, nor on called, the sequence each procedure draws from as it
-- begins, which no rollback gives back (NO CACHE, so its last value is the
-- last one drawn); it holds SELECT and UPDATE on the tables a run locks and
-- moves, EXECUTE on the schema, and VIEW DEFINITION, so that discovery as
-- the writer reads the schema with no gap. close_order also returns a status
-- other than 0, commits or rolls back the run's own transaction, and
-- returns a result set, as its note asks. broken_order is created while
-- the column it sets exists, which SQL Server checks at CREATE, and the
-- column is dropped after.
--
-- ticket is SQL Server's alone: a rowversion form, whose run moves the
-- rowversion by setting its confirmed touch column, note, to itself (0155,
-- 0159), and whose label is a varchar under Greek_CI_AS, code page 1253,
-- beside the database's own SQL_Latin1_General_CP1_CI_AS, code page 1252.
-- label_ticket takes three varchar parameters in the database's collation:
-- the label, an answer and the actor's id, each of which SQL Server would
-- pass as `?` where code page 1252 lacks a character, without an error
-- (0159, Decision 3). tag is SQL Server's alone too: a rowversion form keyed
-- by text under a case-insensitive collation, so two tokens of a selection,
-- `alpha` and `ALPHA`, name one row (0165), which touch_tag is run over.
-- close_order refuses in words for the person an order whose amount is
-- 66.60, and raises the amount of its customer's other orders noted
-- 'raise others', as PostgreSQL's does; noted 'drop others' it deletes
-- them, which it may by ownership chaining, the writer holding no DELETE:
-- a call that removes a later record of its selection (0165). weigh_order
-- cannot be a procedure, which SQL Server calls whatever its arguments: it
-- is a scalar function declared RETURNS NULL ON NULL INPUT, which SQL Server
-- answers NULL for given a NULL without running it, as PostgreSQL's STRICT
-- one (0167). Batches are separated by GO.

create schema actions;
GO
create table actions.customer (
  id bigint identity(1, 1) not null constraint pk_customer primary key,
  tenant_id int not null,
  name nvarchar(50) not null
);
create table actions.[order] (
  id bigint identity(1, 1) not null constraint pk_order primary key,
  customer_id bigint not null constraint fk_order_customer references actions.customer (id),
  note nvarchar(200) null,
  amount decimal(12, 2) not null constraint df_order_amount default 0,
  status nvarchar(20) not null constraint df_order_status default N'open',
  version int not null constraint df_order_version default 1
);
create table actions.price (
  id bigint identity(1, 1) not null constraint pk_price primary key,
  customer_id bigint not null constraint fk_price_customer references actions.customer (id),
  product_no int not null,
  valid_from date not null,
  valid_to date null,
  amount decimal(12, 2) not null,
  version int not null constraint df_price_version default 1,
  constraint uq_price unique (customer_id, product_no, valid_from)
);
create table actions.call (
  id bigint identity(1, 1) not null constraint pk_call primary key,
  routine nvarchar(64) not null,
  record_id bigint not null,
  note nvarchar(200) null,
  actor nvarchar(100) null,
  amount decimal(12, 2) null,
  tenant int null
);
create table actions.ticket (
  id bigint identity(1, 1) not null constraint pk_ticket primary key,
  note nvarchar(200) null,
  label varchar(50) collate Greek_CI_AS null,
  row_version rowversion not null
);
create table actions.tag (
  code nvarchar(20) collate Latin1_General_CI_AS not null constraint pk_tag primary key,
  note nvarchar(200) null,
  row_version rowversion not null
);
alter table actions.[order] add obsolete int null;
create sequence actions.called as bigint start with 1 increment by 1 no cache;
GO
create procedure actions.close_order @p_order bigint, @p_note nvarchar(200), @p_actor nvarchar(100), @p_amount decimal(12, 2), @p_tenant int as
begin
  set nocount on;
  declare @called bigint = next value for actions.called;
  insert actions.call (routine, record_id, note, actor, amount, tenant) values (N'close_order', @p_order, @p_note, @p_actor, @p_amount, @p_tenant);
  if @p_note = N'refuse' or @p_amount = 66.60 throw 50001, N'formancy: refused: This order cannot be closed now.', 1;
  if @p_note = N'plain' throw 50002, N'an error not worded for the person', 1;
  if @p_note like N'sleep %'
  begin
    declare @wait datetime = dateadd(millisecond, convert(int, convert(float, substring(@p_note, 7, 20)) * 1000), convert(datetime, 0));
    waitfor delay @wait;
  end
  if @p_note like N'lost %' select @p_note as [echo];
  if @p_note like N'rows %'
    select top (convert(int, substring(@p_note, 6, 20))) replicate(N'x', 500) as [filler] from sys.all_objects as a cross join sys.all_objects as b;
  if @p_note = N'raise others'
    update actions.[order] set amount = amount + 1 where customer_id = (select customer_id from actions.[order] where id = @p_order) and id <> @p_order;
  if @p_note = N'drop others'
    delete actions.[order] where customer_id = (select customer_id from actions.[order] where id = @p_order) and id <> @p_order;
  if @p_note = N'status' return 7;
  if @p_note = N'commit' commit transaction;
  if @p_note = N'rollback'
  begin
    rollback transaction;
    throw 50003, N'rolled back inside the procedure', 1;
  end
  update actions.[order] set status = N'closed', note = @p_note where id = @p_order;
end
GO
create procedure actions.broken_order @p_order bigint as
begin
  set nocount on;
  declare @called bigint = next value for actions.called;
  insert actions.call (routine, record_id) values (N'broken_order', @p_order);
  update actions.[order] set obsolete = 1 where id = @p_order;
end
GO
alter table actions.[order] drop column obsolete;
GO
create procedure actions.reprice @p_price bigint as
begin
  set nocount on;
  declare @called bigint = next value for actions.called;
  insert actions.call (routine, record_id) values (N'reprice', @p_price);
  update actions.price set amount = amount + 1 where id = @p_price;
end
GO
create procedure actions.label_ticket @p_ticket bigint, @p_label varchar(50), @p_remark varchar(50), @p_actor varchar(50) as
begin
  set nocount on;
  declare @called bigint = next value for actions.called;
  insert actions.call (routine, record_id, note, actor) values (N'label_ticket', @p_ticket, convert(nvarchar(50), @p_label) + N'|' + convert(nvarchar(50), @p_remark), @p_actor);
  update actions.ticket set note = @p_remark where id = @p_ticket;
end
GO
create procedure actions.touch_tag @p_code nvarchar(20) as
begin
  set nocount on;
  declare @called bigint = next value for actions.called;
  insert actions.call (routine, record_id, note) values (N'touch_tag', 0, @p_code);
end
GO
create function actions.weigh_order(@p_order bigint) returns int with returns null on null input as
begin
  return 1;
end
GO
grant select, update on actions.customer to formancy_writer;
grant select, update on actions.[order] to formancy_writer;
grant select, update on actions.price to formancy_writer;
grant select, update on actions.ticket to formancy_writer;
grant select, update on actions.tag to formancy_writer;
grant execute on schema::actions to formancy_writer;
grant view definition on schema::actions to formancy_writer;
GO
