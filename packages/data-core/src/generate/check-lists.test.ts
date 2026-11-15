import { describe, expect, test } from 'vitest'
import { readCheckList } from './check-lists.js'

/*
 * A check that lists the values one column may hold (0152), read from the
 * spelling each engine's catalog writes for it, and from nothing else. Each
 * server writes a check again from its parse: PostgreSQL's pg_get_expr in
 * ruleutils.c's spelling, SQL Server's definition in its own. The first
 * case of each engine is the shared fixture's ck_order_status as the
 * captured snapshots hold it; the rest are what each catalog writes for the
 * other shapes, which the parity suites hold on real servers
 * (CHECK_LIST_PARITY). A near miss -- the other engine's spelling, another
 * operator, a cast not named, a spacing the server does not write -- is no
 * list, so its column keeps the control it had.
 */

const text = (value: string, national = false) => ({ kind: 'text', text: value, national })
const number = (digits: string) => ({ kind: 'number', text: digits })

describe('PostgreSQL, as pg_get_expr deparses a check', () => {
  // A list read from one spelling only would leave a varchar's IN list -- the
  // commonest one -- a text box; and a reader that matched a prefix would read
  // `status IN (…) AND amount > 0` as a list, offering what the AND refuses.
  test.each([
    [
      'a varchar IN list, as the captured snapshots hold ck_order_status',
      "((status)::text = ANY ((ARRAY['draft'::character varying, 'placed'::character varying, 'shipped'::character varying])::text[]))",
      { column: 'status', literals: [text('draft'), text('placed'), text('shipped')] },
    ],
    ['a text IN list', "(status = ANY (ARRAY['draft'::text, 'placed'::text]))", { column: 'status', literals: [text('draft'), text('placed')] }],
    ["a char(n)'s", "(code = ANY (ARRAY['A'::bpchar, 'BB'::bpchar]))", { column: 'code', literals: [text('A'), text('BB')] }],
    ['an IN list of one, which PostgreSQL makes an equality', "((status)::text = 'draft'::text)", { column: 'status', literals: [text('draft')] }],
    ['an equality on a text column', "(status = 'draft'::text)", { column: 'status', literals: [text('draft')] }],
    [
      'equalities joined by OR',
      "(((status)::text = 'a'::text) OR ((status)::text = 'b'::text) OR ((status)::text = 'c'::text))",
      { column: 'status', literals: [text('a'), text('b'), text('c')] },
    ],
    [
      'an IN list and an equality joined by OR, nested as written',
      "((status = ANY (ARRAY['a'::text, 'b'::text])) OR ((status = 'c'::text) OR (status = 'd'::text)))",
      { column: 'status', literals: [text('a'), text('b'), text('c'), text('d')] },
    ],
    [
      'whole numbers, bare while positive integers',
      '(priority = ANY (ARRAY[1, 2, 3]))',
      { column: 'priority', literals: [number('1'), number('2'), number('3')] },
    ],
    [
      'a negative one quoted and cast, as one past an integer is',
      "(priority = ANY (ARRAY['-1'::integer, 0, '9007199254740993'::bigint, '7'::smallint]))",
      { column: 'priority', literals: [number('-1'), number('0'), number('9007199254740993'), number('7')] },
    ],
    ['a whole number equality', '(priority = 3)', { column: 'priority', literals: [number('3')] }],
    [
      'quotes doubled, commas, spaces and text past ASCII inside a value',
      "(label = ANY (ARRAY['it''s'::text, 'a, b'::text, ' Zürich '::text, ''::text]))",
      { column: 'label', literals: [text("it's"), text('a, b'), text(' Zürich '), text('')] },
    ],
    [
      'a column named by a reserved word, quoted, and one with a quote in its name',
      "((\"group\")::text = ANY ((ARRAY['A'::character varying, 'B'::character varying])::text[]))",
      { column: 'group', literals: [text('A'), text('B')] },
    ],
    ['a column whose name needs quotes', '("Odd ""name""" = ANY (ARRAY[\'x\'::text]))', { column: 'Odd "name"', literals: [text('x')] }],
  ])('reads %s', (_case, expression, list) => {
    expect(readCheckList('postgres', expression)).toEqual(list)
  })

  test.each([
    ['NOT IN', "(status <> ALL (ARRAY['a'::text, 'b'::text]))"],
    ['a range', '((priority >= 1) AND (priority <= 3))'],
    ['a comparison', '(carrier_code > 0)'],
    ['another operator', "((reference)::text <> ''::text)"],
    ['LIKE', "((status)::text ~~ 'a%'::text)"],
    ['a function of the column', "(lower((status)::text) = ANY (ARRAY['a'::text]))"],
    ['another column on the right', '(status = other)'],
    ['NULL among the values', "(status = ANY (ARRAY['a'::text, NULL::text]))"],
    ['two columns joined by OR', "((status = 'a'::text) OR (other = 'b'::text))"],
    ['an AND with a list', "((status = ANY (ARRAY['a'::text])) AND (amount > (0)::numeric))"],
    ['a COLLATE', '((status)::text = (\'a\'::text COLLATE "C"))'],
    ['a cast with a modifier', "((status)::text = ANY (ARRAY['a'::character varying(20)]))"],
    ['a cast not named', "(status = ANY (ARRAY['a'::citext]))"],
    ['a decimal', '(amount = ANY (ARRAY[1.5, 2.5]))'],
    ['a decimal cast', '(amount = ANY (ARRAY[(1)::numeric, (2)::numeric]))'],
    ['an array literal', "(status = ANY ('{a,b}'::text[]))"],
    ['a backslash, which standard_conforming_strings decides', "(status = ANY (ARRAY['a\\b'::text]))"],
    ['a NOT NULL as PostgreSQL 18 files one', '(amount IS NOT NULL)'],
    ["SQL Server's spelling", "([status]='b' OR [status]='a')"],
    ['a comparison not in parentheses', "status = 'a'::text"],
    ['spacing PostgreSQL does not write', "(status='a'::text)"],
    ['a trailing word', "(status = 'a'::text) OR"],
    ['an unclosed quote', "(status = 'a::text)"],
    ['an empty identifier', '("" = \'a\'::text)'],
    ['the literal on the left', "('a'::text = status)"],
    ['an OR of one term in its own parentheses', "((status = 'a'::text))"],
  ])('reads %s as no list', (_case, expression) => {
    expect(readCheckList('postgres', expression)).toBeNull()
  })
})

describe('SQL Server, as it writes a check definition again', () => {
  // SQL Server stores an IN list as one equality per value, the last first;
  // read as anything but that, the commonest list on the other engine would
  // be a text box there, and the two forms would differ for one DDL.
  test.each([
    [
      'an IN list, as the captured snapshots hold ck_order_status',
      "([status]='shipped' OR [status]='placed' OR [status]='draft')",
      { column: 'status', literals: [text('shipped'), text('placed'), text('draft')] },
    ],
    ['a list of one', "([status]='draft')", { column: 'status', literals: [text('draft')] }],
    ['national literals', "([status]=N'b' OR [status]=N'a')", { column: 'status', literals: [text('b', true), text('a', true)] }],
    ['whole numbers in parentheses, a sign inside', '([priority]=(3) OR [priority]=(-1))', { column: 'priority', literals: [number('3'), number('-1')] }],
    [
      'quotes doubled, commas, spaces and text past ASCII inside a value',
      "([label]=N' Zürich ' OR [label]='a, b' OR [label]='it''s' OR [label]='')",
      { column: 'label', literals: [text(' Zürich ', true), text('a, b'), text("it's"), text('')] },
    ],
    ['a bracket doubled in a name, a reserved word', "([gr]]oup]='A' OR [gr]]oup]='B')", { column: 'gr]oup', literals: [text('A'), text('B')] }],
    ['disjunctions nested', "(([status]='a' OR [status]='b') OR [status]='c')", { column: 'status', literals: [text('a'), text('b'), text('c')] }],
  ])('reads %s', (_case, expression, list) => {
    expect(readCheckList('sqlserver', expression)).toEqual(list)
  })

  test.each([
    ['NOT IN', "([status]<>'a' AND [status]<>'b')"],
    ['NOT around a list', "(NOT ([status]='a' OR [status]='b'))"],
    ['a range', '([priority]>=(1) AND [priority]<=(3))'],
    ['a comparison', '([carrier_code]>(0))'],
    ['LIKE', "([status] like 'a%')"],
    ['a function of the column', "(lower([status])='a')"],
    ['another column on the right', '([status]=[other])'],
    ['NULL among the values', "([status]=NULL OR [status]='a')"],
    ['two columns joined by OR', "([status]='a' OR [other]='b')"],
    ['an AND with a list', "([status]='a' AND [amount]>(0))"],
    ['a COLLATE', "([status]='a' COLLATE Latin1_General_CS_AS)"],
    ['a decimal', '([amount]=(1.5))'],
    ['a hexadecimal', '([priority]=(0x01))'],
    ["PostgreSQL's spelling", "(status = ANY (ARRAY['a'::text]))"],
    ['a comparison not in parentheses', "[status]='a'"],
    ['spacing SQL Server does not write', "([status] = 'a')"],
    ['an unclosed bracket', "([status='a')"],
    ['the literal on the left', "('a'=[status])"],
    ['a trailing word', "([status]='a') OR"],
  ])('reads %s as no list', (_case, expression) => {
    expect(readCheckList('sqlserver', expression)).toBeNull()
  })
})
