-- The states schema, PostgreSQL's alone (0170).
--
-- An enum, and a domain whose check lists its values, are selects: what
-- discovery reads of each, what the generator draws, and what every
-- operation does over a column of each, answered once in src/states.ts.
-- SQL Server has no enum, and an alias type carries no check, so there is
-- no T-SQL edition of this file: the model is PostgreSQL's, compared by the
-- same comparator as the shared fixture's, over this schema's own scope.
--
-- Outside every other scope, so no snapshot of `sales`, `parity` or
-- `actions` sees it, and the studio's and the examples' captured snapshots
-- do not change when this file does. Owner-only.
--
-- priority's labels are out of the alphabet's order -- low, high, urgent --
-- so an order by the type and an order by its text differ. colour is a
-- domain over varchar whose check lists its values; size the same over an
-- integer; code one whose check is no list, read as its base type; tone a
-- domain over colour, NOT NULL with a default, whose list is colour's;
-- stated a domain over an enum, which is the enum; amount a domain over
-- numeric, which stays unsupported. stage is keyed by an enum, so a record
-- is addressed by a label and a ticket's state is a lookup onto it.

create schema states;

create type states.order_state as enum ('draft', 'placed', 'shipped');
create type states.priority as enum ('low', 'high', 'urgent');

create domain states.colour as varchar(10) check (value in ('red', 'green', 'blue'));
create domain states.size as integer check (value in (1, 2, 3));
create domain states.code as text check (value <> '');
create domain states.tone as states.colour not null default 'red';
create domain states.stated as states.order_state;
create domain states.amount as numeric(10, 2) check (value >= 0);

create table states.stage (
  state states.order_state not null,
  title text not null,
  constraint pk_stage primary key (state)
);

create table states.ticket (
  id integer generated always as identity,
  state states.order_state not null default 'placed',
  priority states.priority,
  colour states.colour,
  size states.size,
  code states.code,
  tone states.tone,
  stated states.stated,
  amount states.amount,
  tags states.order_state[],
  title text,
  version bigint not null default 1,
  constraint pk_ticket primary key (id),
  constraint fk_ticket_stage foreign key (state) references states.stage (state)
);

insert into states.stage (state, title) values ('draft', 'Drafted'), ('placed', 'Placed'), ('shipped', 'Shipped');

insert into states.ticket (state, priority, colour, size, code, title) values
  ('shipped', 'low', 'red', 1, 'A', 'first'),
  ('draft', 'urgent', 'blue', 3, 'B', 'second'),
  ('placed', 'high', 'green', 2, 'C', 'third'),
  ('draft', null, null, null, null, 'fourth');
