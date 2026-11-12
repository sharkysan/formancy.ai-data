/*
 * A new record starts with its column's constant default (0149), written
 * once for both adapters' parity suites.
 *
 * Each suite creates DEFAULT_TABLE as the fixture's owner, in a schema of
 * its own, in its engine's DDL -- the same defaults written the way a
 * person writes each in that dialect: 'draft', 'it''s', a national
 * 'Zürich' on PostgreSQL's varchar and SQL Server's nvarchar, true and 1
 * on a flag, false and 0 on one that may be NULL, 1, -1, 7 on a bigint,
 * 9.5 on a decimal(10,2), 'toolong' on a varchar(3), which CREATE takes
 * and its codec refuses as too long -- every insert here gives it NULL, so
 * its default is never applied -- and the engine's own clock on an
 * instant. It discovers the table as the owner and generates a form over
 * it, `version` its confirmed version column, expecting what is below.
 *
 * One thing is written per engine, and is the reason the reader is: how
 * each catalog spells a default. Those of 'draft', true and 1, 1 and the
 * clocks are what the captured snapshots hold; the others are what
 * `pg_get_expr` and `object_definition` are documented to write, not yet
 * measured here, held so a release that spells one otherwise fails on that
 * engine.
 */

/** Where each suite creates the table: a schema of the parity suites' own, outside every scope another suite discovers. */
export const DEFAULT_TABLE = { schema: 'defaulted', name: 'defaulted' } as const

/**
 * The shared expectations, by case. `defaultCase(name)` is each one's id.
 *
 * - `spelled`: each column's default as the engine's catalog spells it,
 *   read by discovery as the owner.
 * - `started`: the answer each field of the generated form starts with,
 *   the same on both engines and in the field's own type -- a checkbox
 *   ticked, a nullable flag's option, whole numbers as numbers, a bigint
 *   and a decimal as their canonical text -- and nothing for the instant,
 *   whose default is a function, or for `code`, whose constant its column
 *   refuses, which a note says. Every note that says what a field starts
 *   with, in the form's order.
 * - `stored`: a create that sends the answers the form starts with, `code`
 *   NULL, is stored and read back as those answers; and a row whose insert
 *   leaves every defaulted column out but `code` is read back as the same
 *   answers -- the form starts with what the database fills.
 */
export const DEFAULT_PARITY = {
  spelled: {
    postgres: {
      status: "'draft'::character varying",
      quoted: "'it''s'::character varying",
      city: "'Zürich'::character varying",
      active: 'true',
      maybe: 'false',
      quantity: '1',
      below: "'-1'::integer",
      big: '7',
      price: '9.5',
      code: "'toolong'::character varying",
      made_at: 'now()',
      version: '1',
    },
    sqlserver: {
      status: "('draft')",
      quoted: "('it''s')",
      city: "(N'Zürich')",
      active: '((1))',
      maybe: '((0))',
      quantity: '((1))',
      below: '((-1))',
      big: '((7))',
      price: '((9.5))',
      code: "('toolong')",
      made_at: '(sysdatetimeoffset())',
      version: '((1))',
    },
  },
  started: {
    answers: { status: 'draft', quoted: "it's", city: 'Zürich', active: true, maybe: 'false', quantity: 1, below: -1, big: '7', price: '9.50' },
    notes: [
      { subject: 'status', message: "Starts with the column's default, “draft”." },
      { subject: 'quoted', message: "Starts with the column's default, “it's”." },
      { subject: 'city', message: "Starts with the column's default, “Zürich”." },
      { subject: 'active', message: "Starts with the column's default, “true”." },
      { subject: 'maybe', message: "Starts with the column's default, “false”." },
      { subject: 'quantity', message: "Starts with the column's default, “1”." },
      { subject: 'below', message: "Starts with the column's default, “-1”." },
      { subject: 'big', message: "Starts with the column's default, “7”." },
      { subject: 'price', message: "Starts with the column's default, “9.50”." },
      {
        subject: 'code',
        message:
          "Starts empty: the column's default, “toolong”, is not an answer the field takes (at most 3 characters), so the database fills it when a create leaves the field out.",
      },
    ],
  },
  stored: {
    /** What a create gives besides the answers the form starts with: the column whose default the database refuses, as NULL. */
    given: { code: null },
  },
} as const

export type DefaultCase = keyof typeof DEFAULT_PARITY
