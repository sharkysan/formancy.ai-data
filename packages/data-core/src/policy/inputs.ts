import type { PolicyContext, PolicyOperation, PolicyRefusal, RowFilterRule } from './types.js'

/*
 * The two things a host hands this module — a context and a policy — read at
 * runtime and copied into Sets and Maps before anything is decided.
 *
 * The types say what a host builds. At runtime a context is often assembled
 * from a decoded token and a policy is loaded from a file, and there the type
 * is a hope. Reading them here is what makes the rest fail closed: a role list
 * that is a string would make `includes` a substring match, and a field or an
 * attribute called `constructor` would be found on Object.prototype by a plain
 * property lookup. Once checked and copied, neither can happen.
 */

export const OPERATIONS: readonly PolicyOperation[] = ['read', 'create', 'update']

/**
 * Codepoint order, deliberately not `localeCompare`: a list of problems or of
 * refused keys must read the same on a host set to German and one set to
 * Swedish, or two runs over the same input would differ.
 */
export function byCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A name — of a role, a column, an attribute — is a string with something in it. */
function nameOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/** A context whose shape was checked: roles and attributes nothing can inherit into. */
export interface TrustedContext {
  roles: ReadonlySet<string>
  attributes: ReadonlyMap<string, string>
}

/**
 * The context as the rest of this module uses it, or why it cannot be used.
 *
 * Only own, enumerable attributes are copied. One reachable only through a
 * prototype was not put there by the host, and a filter on it finds nothing,
 * which refuses.
 */
export function readContext(context: PolicyContext): { ok: true; trusted: TrustedContext } | PolicyRefusal {
  const refuse = (message: string): PolicyRefusal => ({ ok: false, code: 'invalid-context', message })
  const raw: unknown = context
  if (!isRecord(raw)) return refuse('the context is not an object')
  const actor = raw['actor']
  if (!isRecord(actor)) return refuse('the context has no actor')
  if (nameOrNull(actor['id']) === null) return refuse('the actor has no id: a context is built after an identity is verified')
  const roles = actor['roles']
  if (!Array.isArray(roles)) return refuse("the actor's roles are not a list")
  const roleSet = new Set<string>()
  for (const role of roles as unknown[]) {
    const name = nameOrNull(role)
    if (name === null) return refuse("one of the actor's roles is not a role name")
    roleSet.add(name)
  }
  const attributes = raw['attributes']
  if (!isRecord(attributes)) return refuse('the context has no attributes object')
  const attributeMap = new Map<string, string>()
  for (const name of Object.keys(attributes)) {
    const value = attributes[name]
    if (typeof value !== 'string') return refuse(`the context's ${name} is not a string`)
    attributeMap.set(name, value)
  }
  return { ok: true, trusted: { roles: roleSet, attributes: attributeMap } }
}

export interface ParsedFieldPolicy {
  read: ReadonlySet<string>
  write: ReadonlySet<string>
}

/** A policy whose shape was checked. Whether it fits a form is `validate.ts`'s question. */
export interface ParsedPolicy {
  operations: Readonly<Record<PolicyOperation, ReadonlySet<string>>>
  fields: ReadonlyMap<string, ParsedFieldPolicy>
  rowFilters: readonly RowFilterRule[]
  lookups: ReadonlyMap<string, readonly RowFilterRule[]>
  /** The lookup fields whose target's filter scopes the root too (0043), each once, in the policy's order; empty when the policy names none. */
  through: readonly string[]
}

/**
 * Refuses a property this release does not read. It would be a rule the
 * person who wrote it believes is enforced — a `delete` operation, an
 * `operator` on a row filter — and that nothing enforces.
 */
function unread(record: Record<string, unknown>, known: readonly string[], where: string, problems: string[]): void {
  for (const key of Object.keys(record).sort(byCodepoint)) {
    if (!known.includes(key)) problems.push(`${where}${key} is not something this release reads, so nothing would enforce it`)
  }
}

function readRoles(value: unknown, where: string, problems: string[]): Set<string> {
  const roles = new Set<string>()
  if (!Array.isArray(value)) {
    problems.push(`${where} is not a list of roles`)
    return roles
  }
  for (const [index, role] of (value as unknown[]).entries()) {
    const name = nameOrNull(role)
    if (name === null) problems.push(`${where}[${String(index)}] is not a role name`)
    else roles.add(name)
  }
  return roles
}

function readRules(value: unknown, where: string, problems: string[]): RowFilterRule[] {
  if (!Array.isArray(value)) {
    problems.push(`${where} is not a list of row filters`)
    return []
  }
  const rules: RowFilterRule[] = []
  for (const [index, rule] of (value as unknown[]).entries()) {
    const at = `${where}[${String(index)}]`
    if (!isRecord(rule)) {
      problems.push(`${at} is not a row filter`)
      continue
    }
    unread(rule, ['column', 'attribute'], `${at}.`, problems)
    const column = nameOrNull(rule['column'])
    const attribute = nameOrNull(rule['attribute'])
    if (column === null) problems.push(`${at} names no column`)
    if (attribute === null) problems.push(`${at} names no attribute`)
    if (column === null || attribute === null) continue
    // One column pinned to two attributes: a create would have to write two
    // values into it, and a read would match only where they happen to agree.
    if (rules.some((earlier) => earlier.column === column)) problems.push(`${at} filters ${column} a second time`)
    else rules.push({ column, attribute })
  }
  return rules
}

function readFields(value: unknown, problems: string[]): Map<string, ParsedFieldPolicy> {
  const fields = new Map<string, ParsedFieldPolicy>()
  if (!isRecord(value)) {
    problems.push('fields is not an object')
    return fields
  }
  for (const key of Object.keys(value).sort(byCodepoint)) {
    const entry = value[key]
    if (!isRecord(entry)) {
      problems.push(`fields.${key} is not a field policy`)
      continue
    }
    unread(entry, ['read', 'write'], `fields.${key}.`, problems)
    fields.set(key, { read: readRoles(entry['read'], `fields.${key}.read`, problems), write: readRoles(entry['write'], `fields.${key}.write`, problems) })
  }
  return fields
}

/** The lookup keys a through names, each once; an absent property is none. */
function readThrough(value: unknown, problems: string[]): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    problems.push('through is not a list of lookup field keys')
    return []
  }
  const keys: string[] = []
  for (const [index, entry] of (value as unknown[]).entries()) {
    const key = nameOrNull(entry)
    if (key === null) problems.push(`through[${String(index)}] is not a field key`)
    else if (keys.includes(key)) problems.push(`through[${String(index)}] names ${key} a second time`)
    else keys.push(key)
  }
  return keys
}

/**
 * The policy as the rest of this module uses it, or every reason it cannot be.
 *
 * Every problem rather than the first, because a person fixes a policy from
 * the list. Keys are read in codepoint order, so the list is the same however
 * the policy's author ordered them.
 */
export function readPolicy(policy: unknown): { parsed: ParsedPolicy; problems: [] } | { parsed: null; problems: string[] } {
  if (!isRecord(policy)) return { parsed: null, problems: ['the policy is not an object'] }
  const problems: string[] = []
  unread(policy, ['version', 'operations', 'fields', 'rowFilters', 'lookups', 'through'], '', problems)
  if (policy['version'] !== 1) problems.push('version is not 1, the only policy version this release reads')

  const rawOperations = policy['operations']
  const operations = { read: new Set<string>(), create: new Set<string>(), update: new Set<string>() }
  if (isRecord(rawOperations)) {
    unread(rawOperations, OPERATIONS, 'operations.', problems)
    for (const operation of OPERATIONS) operations[operation] = readRoles(rawOperations[operation], `operations.${operation}`, problems)
  } else {
    problems.push('operations is not an object')
  }

  const fields = readFields(policy['fields'], problems)
  const rowFilters = readRules(policy['rowFilters'], 'rowFilters', problems)

  const rawLookups = policy['lookups']
  const lookups = new Map<string, RowFilterRule[]>()
  if (isRecord(rawLookups)) {
    for (const key of Object.keys(rawLookups).sort(byCodepoint)) lookups.set(key, readRules(rawLookups[key], `lookups.${key}`, problems))
  } else {
    problems.push('lookups is not an object')
  }

  const through = readThrough(policy['through'], problems)

  if (problems.length > 0) return { parsed: null, problems }
  return { parsed: { operations, fields, rowFilters, lookups, through }, problems: [] }
}
