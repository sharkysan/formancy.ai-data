import type { CheckMeta, DatabaseKind } from '@formancy/data-core'
import { readCheckList, readDomainList } from '@formancy/data-core'

/*
 * A column whose values a check lists is a select of exactly them (0152),
 * written once for both adapters' parity suites.
 *
 * Each suite creates LISTED_TABLE as the fixture's owner, in a schema of
 * its own, in its engine's DDL -- the same checks written the way a person
 * writes each in that dialect: an IN list on a varchar, on text past ASCII
 * with a doubled quote, a comma and blanks inside its values (an nvarchar
 * of N literals on SQL Server, whose plain literals are read in a code
 * page), on whole numbers out of order with a negative one, on a bigint
 * past 2^53 beside a zero and a negative one, on a char(2); equalities
 * joined by OR on a column named by a reserved word; a list added NOT
 * VALID or WITH NOCHECK, one with an empty string, two lists on one
 * column, the second the table's; and the near misses that are no list:
 * a range, NOT IN, LIKE, a function of the column, and an IN list holding
 * NULL, which admits every value, since a CHECK passes what it cannot
 * decide. It discovers the table as the owner and generates a form over
 * it, `version` its confirmed version column, expecting what is below.
 *
 * Nothing here is written per engine: each catalog's own spelling of the
 * same DDL is what each suite reads, and the reading, the form, what is
 * stored and what is refused are the same on both. ck_order_status's
 * spelling is what the captured snapshots hold; each catalog's spelling of
 * the others was measured by the suites on PostgreSQL 17.11 and SQL Server
 * 2022 (16.0.4295.3) on 2026-11-15, and is held so a release that spells
 * one otherwise fails on that engine.
 */

/** Where each suite creates the table: a schema of the parity suites' own, outside every scope another suite discovers. */
export const LISTED_TABLE = { schema: 'listed', name: 'listed' } as const

/** A check as data-core reads it out of `kind`'s spelling: its one column and its values, in codepoint order and each once; `null`, no list. */
export function checkListOf(kind: DatabaseKind, check: Pick<CheckMeta, 'expression'>): { column: string; values: string[] } | null {
  const read = check.expression === null ? null : readCheckList(kind, check.expression)
  if (read === null) return null
  return { column: read.column, values: [...new Set(read.literals.map((literal) => literal.text))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) }
}

/** A PostgreSQL domain's check as data-core reads it (0170): its values, in codepoint order and each once; `null`, no list. */
export function domainListOf(check: Pick<CheckMeta, 'expression'>): string[] | null {
  const literals = check.expression === null ? null : readDomainList(check.expression)
  return literals === null ? null : [...new Set(literals.map((literal) => literal.text))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * The shared expectations, by case. `listedCase(name)` is each one's id.
 *
 * - `read`: every check of the table as data-core reads it out of the
 *   engine's spelling, discovered as the owner.
 * - `generated`: the generated form, the same on both engines: each field
 *   drawn as a select and its options in the order drawn -- a whole
 *   number's by its value, text by codepoint -- and the note each list not
 *   drawn says, in the form's order. Every other field keeps its type's
 *   control and says nothing about a list.
 * - `stored`: a create of a listed value of every select, a whole number's
 *   as its text, is stored and read back as those answers.
 * - `narrowed`: ck_listed_status replaced by one that no longer lists
 *   shipped, once no row holds it: drift review stops writes of status, the
 *   runtime does not compare checks and still writes, and the database
 *   refuses shipped with a check violation; generated again, status offers
 *   draft and placed.
 */
export const CHECK_LIST_PARITY = {
  read: {
    ck_listed_big: { column: 'big', values: ['-1', '0', '9007199254740993'] },
    ck_listed_code: { column: 'code', values: ['A', 'BB'] },
    ck_listed_flavour: null,
    ck_listed_group: { column: 'group', values: ['A', 'B'] },
    ck_listed_kind: null,
    ck_listed_label: { column: 'label', values: [' spaced ', 'Zürich', 'a, b', "it's"] },
    ck_listed_level: null,
    ck_listed_mark: { column: 'mark', values: ['', 'x'] },
    ck_listed_priority: { column: 'priority', values: ['-1', '10', '2'] },
    ck_listed_ref: null,
    ck_listed_shout: null,
    ck_listed_stage: { column: 'stage', values: ['a', 'b'] },
    ck_listed_status: { column: 'status', values: ['draft', 'placed', 'shipped'] },
    ck_listed_tier: { column: 'tier', values: ['a', 'b', 'c'] },
    ck_listed_tier_again: { column: 'tier', values: ['a', 'b'] },
  },
  generated: {
    selects: {
      status: ['draft', 'placed', 'shipped'],
      label: [' spaced ', 'Zürich', 'a, b', "it's"],
      priority: ['-1', '2', '10'],
      group: ['A', 'B'],
      code: ['A', 'BB'],
      big: ['-1', '0', '9007199254740993'],
    },
    notes: [
      {
        subject: 'stage',
        message:
          'Not a select of the values ck_listed_stage lists: it was not validated, so a row from before it may hold a value it does not list, which a select could not show.',
      },
      { subject: 'mark', message: 'Not a select of the values ck_listed_mark lists: one of its values is empty, which a select cannot tell from no answer.' },
      {
        subject: 'tier',
        message:
          'Not a select of the values ck_listed_tier lists: ck_listed_tier and ck_listed_tier_again each list its values, and a select is drawn from one check.',
      },
    ],
  },
  stored: {
    answers: { status: 'shipped', label: "it's", priority: '-1', group: 'B', code: 'BB', big: '9007199254740993' },
  },
  narrowed: {
    /** What the replaced check lists, which a regenerated status offers. */
    kept: ['draft', 'placed'],
    /** The value it no longer lists, which the published status still offers. */
    gone: 'shipped',
    /** Review's changes on status and its check, in the report's order. */
    changes: [
      ['column-tightened', 'blocking', 'status'],
      ['check-changed', 'info', 'ck_listed_status'],
    ],
  },
} as const

export type ListedCase = keyof typeof CHECK_LIST_PARITY
