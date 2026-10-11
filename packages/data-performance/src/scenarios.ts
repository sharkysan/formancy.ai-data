import { encodeKeyToken } from '@formancy/data-core'
import type { FormRecord, LookupResult, LookupRow } from '@formancy/data-core'
import type { DataClient, Outcome, WriteOutcome } from '@formancy/data-client'
import { sizedCustomer, sizedLookupPage, sizedResolveKeys, sizedTerms } from '@formancy/data-fixtures'
import { CATALOGUE } from './catalogue.js'
import type { Policy } from './publish.js'
import { formIdOf } from './publish.js'
import type { EngineKey } from './results.js'

/*
 * Each catalogue entry as something the harness can send and check (0034):
 * the request a host sends, through `@formancy/data-client` -- `fetch`
 * directly for `/health`, which the client has no function for -- and the
 * content check run after the timer stops, against answers computed once
 * from the generator before anything is timed. Any answer that is not the
 * expected one ends the run, naming the scenario: nothing is dropped.
 */

export interface Executable {
  name: string
  formId: string | null
  /** One request; inside the timed window. `slot` is the in-flight lane it runs in. */
  send(slot: number): Promise<unknown>
  /** After the timer: throws naming the scenario on any unexpected answer; returns the rows answered. */
  check(answer: unknown, slot: number): number
}

/** One order an in-flight lane of `update` owns, so no update is ever stale. */
export interface UpdateSlot {
  record: string
  version: string
  answers: Record<string, unknown>
}

/** What setup created for one engine: the order `read` reads, and one order per update lane. */
export interface Orders {
  read: FormRecord
  slots: UpdateSlot[]
}

export function customerToken(tenantId: number, customerNo: number): string {
  const encoded = encodeKeyToken([String(tenantId), String(customerNo)])
  if (!encoded.ok) throw new Error(encoded.message)
  return encoded.token
}

const rowsOf = (rows: ReadonlyArray<{ tenantId: number; customerNo: number; name: string }>): LookupRow[] => rows.map((row) => ({ token: customerToken(row.tenantId, row.customerNo), label: row.name }))

/** The answers, from the generator, computed once in setup. */
export interface Expected {
  /** A lookup page as `{rows, hasMore}` JSON, by search name. */
  pages: Record<'first-page' | 'common' | 'unique' | 'absent', { search: string; json: string; rows: number }>
  unique: LookupRow
  /** `sizedResolveKeys(100)` as tokens, and their rows sorted by token as JSON. */
  resolve: { tokens: string[]; json: string }
  /** The customers creates rotate through: one hot customer would measure a PostgreSQL row lock, not the product. */
  rotation: string[]
}

export function expectedAnswers(): Expected {
  const terms = sizedTerms()
  const page = (search: string) => {
    const expected = sizedLookupPage(1, search, 50)
    return { search, json: JSON.stringify({ rows: rowsOf(expected.rows), hasMore: expected.hasMore }), rows: expected.rows.length }
  }
  const unique = sizedLookupPage(1, terms.unique, 50)
  if (unique.rows.length !== 1) throw new Error(`the unique search matches ${String(unique.rows.length)} customers`)
  const keys = sizedResolveKeys(100)
  // Key j is generated row 1,000·j: tenant 1's rows are its first 100,000, numbered from 1,000,001.
  const resolved = keys.map((key, j) => ({ token: customerToken(key.tenantId, key.customerNo), label: sizedCustomer(1000 * j).name }))
  return {
    pages: { 'first-page': page(''), common: page(terms.common), unique: page(terms.unique), absent: page(terms.absent) },
    unique: rowsOf(unique.rows)[0] as LookupRow,
    resolve: { tokens: resolved.map((row) => row.token), json: JSON.stringify(sortByToken(resolved)) },
    rotation: resolved.map((row) => row.token),
  }
}

function sortByToken(rows: readonly LookupRow[]): LookupRow[] {
  return [...rows].sort((a, b) => (a.token < b.token ? -1 : a.token > b.token ? 1 : 0))
}

export interface ScenarioContext {
  client: DataClient
  base: string
  fetch: typeof fetch
  /** Each form's customer source, by form id, as its published bindings name it: the name carries the connection's. */
  sources: Readonly<Record<string, string>>
  expected: Expected
  orders: Record<EngineKey, Orders>
  /** How many creates each engine has sent, for the rotation. */
  creates: Record<EngineKey, number>
}

/** The created order's answers as the next update sends them back. */
export const slotOf = (record: FormRecord): UpdateSlot => ({ record: record.record ?? '', version: record.version ?? '', answers: { ...record.answers } })

/**
 * Every catalogue scenario for one engine, against the direct forms or the
 * ones through the hop: the counting pass and the added-latency block run
 * through the hop, the rounds straight to the database.
 */
export function scenariosFor(engine: EngineKey, via: 'direct' | 'hop', context: ScenarioContext): Map<string, Executable> {
  const { client, expected } = context
  const formOf = (policy: Policy): string => formIdOf(engine, policy, via === 'hop')
  const sourceOf = (formId: string): string => {
    const source = context.sources[formId]
    if (source === undefined) throw new Error(`${formId} was not published`)
    return source
  }
  const fail = (name: string, formId: string | null, what: string): never => {
    throw new Error(`${engine} ${name}${formId === null ? '' : ` on ${formId}`}: ${what}`)
  }
  const ok = <T>(name: string, formId: string, answer: unknown): T => {
    const outcome = answer as Outcome<T> | WriteOutcome
    if (!outcome.ok) fail(name, formId, `answered ${String(outcome.status)} ${outcome.code}: ${outcome.message}`)
    return (outcome as { ok: true; value: T }).value
  }

  const lookup = (name: string, policy: Policy, page: keyof Expected['pages']): Executable => {
    const formId = formOf(policy)
    const want = expected.pages[page]
    const source = sourceOf(formId)
    return {
      name,
      formId,
      send: () => client.query(formId, source, { operation: 'create', search: want.search, limit: 50 }),
      check(answer) {
        const value = ok<LookupResult>(name, formId, answer)
        if (JSON.stringify({ rows: value.rows, hasMore: value.hasMore }) !== want.json) fail(name, formId, 'the page differs from the one the generator expects')
        return value.rows.length
      },
    }
  }
  const orderForm = formOf('order')
  const orderSource = sourceOf(orderForm)
  const all: Executable[] = [
    {
      name: 'health',
      formId: null,
      send: async () => {
        const response = await context.fetch(`${context.base}/health`)
        return { status: response.status, body: (await response.json()) as unknown }
      },
      check(answer) {
        const { status, body } = answer as { status: number; body: unknown }
        if (status !== 200 || JSON.stringify(body) !== '{"status":"ok"}') fail('health', null, `answered ${String(status)} ${JSON.stringify(body)}`)
        return 0
      },
    },
    {
      name: 'form',
      formId: orderForm,
      send: () => client.form(orderForm),
      check(answer) {
        const value = ok<{ operations: string[] }>('form', orderForm, answer)
        if ([...value.operations].sort().join() !== 'create,read,update') fail('form', orderForm, `offers ${value.operations.join(', ')}`)
        return 0
      },
    },
    lookup('lookup-first-page', 'order', 'first-page'),
    lookup('lookup-common', 'order', 'common'),
    lookup('lookup-unique', 'order', 'unique'),
    lookup('lookup-absent', 'order', 'absent'),
    lookup('lookup-first-page-unfiltered', 'order-unfiltered', 'first-page'),
    lookup('lookup-common-unfiltered', 'order-unfiltered', 'common'),
    lookup('lookup-unique-unfiltered', 'order-unfiltered', 'unique'),
    lookup('lookup-absent-unfiltered', 'order-unfiltered', 'absent'),
    {
      name: 'resolve-1',
      formId: orderForm,
      send: () => client.resolve(orderForm, orderSource, { operation: 'update', tokens: [expected.unique.token] }),
      check(answer) {
        const rows = ok<LookupRow[]>('resolve-1', orderForm, answer)
        if (JSON.stringify(rows) !== JSON.stringify([expected.unique])) fail('resolve-1', orderForm, 'the label differs from the generator')
        return rows.length
      },
    },
    {
      name: 'resolve-100',
      formId: orderForm,
      send: () => client.resolve(orderForm, orderSource, { operation: 'update', tokens: expected.resolve.tokens }),
      check(answer) {
        const rows = ok<LookupRow[]>('resolve-100', orderForm, answer)
        if (JSON.stringify(sortByToken(rows)) !== expected.resolve.json) fail('resolve-100', orderForm, 'the rows differ from the generator')
        return rows.length
      },
    },
    {
      name: 'read',
      formId: orderForm,
      send: () => client.read(orderForm, context.orders[engine].read.record ?? ''),
      check(answer) {
        const value = ok<FormRecord>('read', orderForm, answer)
        if (JSON.stringify(value) !== JSON.stringify(context.orders[engine].read)) fail('read', orderForm, 'the record differs from the one setup read')
        return 1
      },
    },
    create(engine, orderForm, context, ok, fail),
    {
      name: 'update',
      formId: orderForm,
      send(slot) {
        const owned = context.orders[engine].slots[slot]
        if (owned === undefined) return fail('update', orderForm, `no order for in-flight lane ${String(slot)}`)
        const status = owned.answers['status'] === 'placed' ? 'shipped' : 'placed'
        return client.update(orderForm, { record: owned.record, version: owned.version, answers: { ...owned.answers, status } })
      },
      check(answer, slot) {
        const owned = context.orders[engine].slots[slot] as UpdateSlot
        const value = ok<FormRecord>('update', orderForm, answer)
        if (value.version === owned.version || value.answers['status'] === owned.answers['status']) fail('update', orderForm, 'the version or the status did not move')
        context.orders[engine].slots[slot] = slotOf(value)
        return 1
      },
    },
  ]
  const known = new Set(CATALOGUE.scenarios.map((scenario) => scenario.name))
  for (const executable of all) if (!known.has(executable.name)) throw new Error(`${executable.name} is not in the catalogue`)
  return new Map(all.map((executable) => [executable.name, executable]))
}

/** Create: the run's i-th create on an engine references the i-th customer of the rotation, mod 100. */
function create(engine: EngineKey, formId: string, context: ScenarioContext, ok: <T>(name: string, formId: string, answer: unknown) => T, fail: (name: string, formId: string | null, what: string) => never): Executable {
  const sentWith = new Map<number, string>()
  return {
    name: 'create',
    formId,
    send(slot) {
      const customer = context.expected.rotation[context.creates[engine] % context.expected.rotation.length] as string
      context.creates[engine] += 1
      sentWith.set(slot, customer)
      return context.client.create(formId, { customer, order_date: '2026-10-09', status: 'placed', amount: '5', notes: 'performance' })
    },
    check(answer, slot) {
      const value = ok<FormRecord>('create', formId, answer)
      if (value.answers['customer'] !== sentWith.get(slot)) fail('create', formId, 'the stored customer is not the one sent')
      return 1
    },
  }
}
