import { describe, expect, test } from 'vitest'
import type { CheckMeta, DomainMeta, NormalizedType, ObjectMeta } from '@formancy/data-core'
import { createSnapshot } from '@formancy/data-core'
import { snapshotDisagreements } from './conformance.js'
import { readFixture } from './load.js'
import type { ExpectedDomain } from './model.js'
import { STATES_MODEL, STATES_SCOPE } from './states.js'

/*
 * The comparator holds an enum and a domain as the model says them (0170):
 * each test starts from the snapshot a perfect adapter would make of the
 * states schema, built from the model itself, and breaks one thing, so
 * each proves the comparator notices exactly that thing. Against a real
 * server it runs in states.integration.test.ts, first in CI.
 */

/** A domain's check as PostgreSQL deparses one: a varchar list, an integer list, or a comparison, which is no list. */
function spelled(listed: readonly string[] | null | undefined): string {
  if (listed === null || listed === undefined) return "(VALUE <> ''::text)"
  if (listed.every((value) => /^[0-9]+$/.test(value))) return `(VALUE = ANY (ARRAY[${listed.join(', ')}]))`
  return `((VALUE)::text = ANY ((ARRAY[${listed.map((value) => `'${value}'::character varying`).join(', ')}])::text[]))`
}

const domainOf = (domain: ExpectedDomain): DomainMeta => ({
  ref: { ...domain.ref },
  checks: domain.checks.map((check): CheckMeta => ({
    name: check.name,
    expression: spelled(check.listed),
    enforced: check.enforced ?? true,
    validated: check.validated ?? true,
  })),
})

function perfect(): ObjectMeta[] {
  return STATES_MODEL.map((entry) => ({
    ref: { ...entry.ref },
    kind: entry.kind,
    comment: null,
    columns: entry.columns.map((column, index) => ({
      name: column.name,
      ordinal: index + 1,
      databaseType: 'fixture',
      type: structuredClone(column.type ?? { kind: 'unsupported' }) as unknown as NormalizedType,
      nullable: column.nullable ?? true,
      hasDefault: column.hasDefault ?? false,
      defaultExpression: null,
      generated: column.generated ?? 'none',
      comment: null,
      access: { select: true, insert: true, update: true },
      ...(column.domains === undefined ? {} : { domains: column.domains.map(domainOf) }),
    })),
    primaryKey: entry.primaryKey === null ? null : { name: `pk_${entry.ref.name}`, columns: [...entry.primaryKey] },
    uniqueKeys: [],
    foreignKeys: entry.foreignKeys.map((key) => ({
      name: key.name,
      columns: [...key.columns],
      references: { table: { ...key.references.table }, columns: [...key.references.columns] },
      onUpdate: 'no-action' as const,
      onDelete: key.onDelete,
      enforced: true,
      validated: key.validated,
    })),
    checks: [],
    rowSecurity: 'none' as const,
    access: { delete: true },
    referencedBy:
      entry.ref.name === 'stage'
        ? [
            {
              table: { schema: 'states', name: 'ticket' },
              name: 'fk_ticket_stage',
              columns: ['state'],
              referencedColumns: ['state'],
              onDelete: 'no-action',
              onUpdate: 'no-action',
              enforced: true,
            },
          ]
        : [],
  }))
}

function snapshot(edit: (objects: ObjectMeta[]) => void = () => {}) {
  const objects = perfect()
  edit(objects)
  return createSnapshot({ kind: 'postgres', serverVersion: 'x', account: { user: 'owner', login: 'owner' }, scope: STATES_SCOPE, objects, gaps: [] })
}

const ticket = (objects: ObjectMeta[], name: string) => {
  const found = objects.find((entry) => entry.ref.name === 'ticket')?.columns.find((column) => column.name === name)
  if (found === undefined) throw new Error(`no ticket.${name}`)
  return found
}

describe('the states model', () => {
  test('a perfect snapshot has no disagreements', () => {
    expect(snapshotDisagreements(snapshot(), STATES_MODEL)).toEqual([])
  })

  // The type's order is the select's and the engine's sort: labels read in
  // another order are another form. Watched failing with a type's
  // properties compared by identity: every enum disagreed with itself.
  test("notices an enum's labels in another order, and another type's name", () => {
    const shuffled = snapshot((objects) => {
      Object.assign(ticket(objects, 'priority').type, { labels: ['high', 'low', 'urgent'] })
      Object.assign(ticket(objects, 'state').type, { name: { schema: 'states', name: 'stage_state' } })
    })
    expect(snapshotDisagreements(shuffled, STATES_MODEL)).toEqual([
      'states.ticket.state type name is {"schema":"states","name":"stage_state"}, expected {"schema":"states","name":"order_state"} (database type fixture)',
      'states.ticket.priority type labels is ["high","low","urgent"], expected ["low","high","urgent"] (database type fixture)',
    ])
  })

  // A column of no domain carries none, not an empty list, or every
  // snapshot of a catalog without a domain would fingerprint otherwise than
  // before 0170; and a domain missing, or its list read otherwise, is
  // another column. Watched failing with the domains left uncompared.
  test('notices domains on a column with none, a domain missing, and a list read otherwise', () => {
    const broken = snapshot((objects) => {
      ticket(objects, 'title').domains = [{ ref: { schema: 'states', name: 'note' }, checks: [] }]
      ticket(objects, 'tone').domains = (ticket(objects, 'tone').domains ?? []).slice(0, 1)
      const colour = ticket(objects, 'colour').domains?.[0]?.checks[0] as CheckMeta
      colour.expression = spelled(['green', 'red'])
    })
    expect(snapshotDisagreements(broken, STATES_MODEL)).toEqual([
      `states.ticket.colour domain states.colour colour_check reads as [green, red] from ${JSON.stringify(spelled(['green', 'red']))}, expected [blue, green, red]`,
      'states.ticket.tone domains are [states.tone], expected [states.tone, states.colour]',
      'states.ticket.title has domains [states.note], expected none',
    ])
  })

  test("notices a domain's check not validated where the model says it is", () => {
    const broken = snapshot((objects) => {
      const size = ticket(objects, 'size').domains?.[0]?.checks[0] as CheckMeta
      size.validated = false
    })
    expect(snapshotDisagreements(broken, STATES_MODEL)).toEqual(['states.ticket.size domain states.size size_check validated is false, expected true'])
  })
})

describe('the states fixture', () => {
  // A table the model names that the file does not create is a missing
  // object far from the edit that caused it; derived from the CREATE TABLE
  // statements, as the shared fixture's two editions are held.
  test('creates exactly the tables the model names', () => {
    const tables = [
      ...readFixture('postgres.states.sql')
        .replaceAll(/--.*$/gm, '')
        .matchAll(/create\s+table\s+states\.(\w+)/gi),
    ]
      .map((match) => match[1])
      .sort()
    expect(tables).toEqual(STATES_MODEL.map((entry) => entry.ref.name).sort())
  })
})
