import type {
  FieldError,
  FilterableField,
  FilterDays,
  FilterInput,
  FilterOp,
  FormMenu,
  FormRecord,
  ListView,
  LookupResult,
  LookupRow,
  PublishedForm,
  RecordDeleted,
  RecordList,
} from '@formancy/data-core'
import type { Refusal } from './client.js'

/*
 * The shape each runtime route answers with, and a refusal's. Shallow on
 * purpose: enough that a captive portal's `{}` or a proxy's page is not taken
 * for the data server's answer, without restating the server's validation of
 * a document. One place, because a read and a write must agree on what a
 * record and a refusal look like (0029, 0031).
 */

export const UNEXPECTED = 'The data server did not answer in a way this client understands.'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isFieldError(value: unknown): value is FieldError {
  return isRecord(value) && typeof value['field'] === 'string' && typeof value['code'] === 'string' && typeof value['message'] === 'string'
}

function isRows(value: unknown): value is LookupRow[] {
  return Array.isArray(value) && value.every((row) => isRecord(row) && typeof row['token'] === 'string' && typeof row['label'] === 'string')
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

/**
 * Every operator and every input a filter has (0104), keyed by data-core's
 * own unions, so one added or removed there is a type error here before it
 * is a reply this client refuses or an offer it passes unread.
 */
const FILTER_OPERATORS: Readonly<Record<FilterOp, true>> = { equals: true, range: true, contains: true, null: true, 'not-null': true }
const FILTER_INPUTS: Readonly<Record<FilterInput, true>> = { text: true, integer: true, decimal: true, date: true, uuid: true, boolean: true }
const FILTER_DAYS: Readonly<Record<FilterDays, true>> = { utc: true, wall: true }

/**
 * One field's filter offer: a field key, the operators it offers -- at
 * least one, each one data-core names -- what a value is typed as, `null`
 * exactly when it offers only `null` and `not-null`, and whose clock a
 * timestamp's days are on, one data-core names on a date input and `null`
 * on every other. A panel draws its inputs from this, so an offer it could
 * not draw is not the server's.
 */
function isFilterableField(value: unknown): value is FilterableField {
  if (!isRecord(value) || typeof value['field'] !== 'string' || !isStrings(value['operators'])) return false
  const operators = value['operators']
  if (operators.length === 0 || !operators.every((op) => Object.hasOwn(FILTER_OPERATORS, op))) return false
  const { input, days } = value
  const valued = operators.some((op) => op !== 'null' && op !== 'not-null')
  if (!(valued ? typeof input === 'string' && Object.hasOwn(FILTER_INPUTS, input) : input === null)) return false
  return days === null || (input === 'date' && typeof days === 'string' && Object.hasOwn(FILTER_DAYS, days))
}

/**
 * One list view (0105): a name, conditions that each name a field and an
 * operator data-core names, an order of fields each ascending or
 * descending, and `default` absent or `true`. A picker sends what a view
 * holds as a list request, so one it could not send is not the server's.
 * Each condition's values are the server's to check, as a person's are.
 */
function isListView(value: unknown): value is ListView {
  if (!isRecord(value) || typeof value['name'] !== 'string') return false
  const { filter, sort } = value
  const isCondition = (term: unknown) =>
    isRecord(term) && typeof term['field'] === 'string' && typeof term['op'] === 'string' && Object.hasOwn(FILTER_OPERATORS, term['op'])
  const isOrder = (term: unknown) => isRecord(term) && typeof term['field'] === 'string' && (term['direction'] === 'asc' || term['direction'] === 'desc')
  if (!Array.isArray(filter) || !filter.every(isCondition) || !Array.isArray(sort) || !sort.every(isOrder)) return false
  return !Object.hasOwn(value, 'default') || value['default'] === true
}

/**
 * What a form's list may be searched, sorted and filtered by, or `null` for
 * no list (0044): a reply without one is from no server that has lists, one
 * without `filterable` from no server that has filters (0104), whose page
 * would offer conditions the server cannot apply, and one without `views`
 * from no server that has views (0105).
 */
function isListColumns(value: unknown): value is PublishedForm['list'] {
  if (value === null) return true
  return (
    isRecord(value) &&
    isStrings(value['searchable']) &&
    isStrings(value['sortable']) &&
    Array.isArray(value['filterable']) &&
    value['filterable'].every(isFilterableField) &&
    Array.isArray(value['views']) &&
    value['views'].every(isListView)
  )
}

/**
 * What a delete also does (0050): `null` exactly when the form offers no
 * delete, otherwise its three flags. A reply that says delete without them,
 * or them without delete -- or neither, a server older than delete -- is no
 * form this server sent, and a page that worded a confirmation from it
 * would say what nobody decided.
 */
function isDeleting(value: unknown, operations: readonly unknown[]): value is PublishedForm['deleting'] {
  if (!operations.includes('delete')) return value === null
  return isRecord(value) && typeof value['cascades'] === 'boolean' && typeof value['clears'] === 'boolean' && typeof value['restricted'] === 'boolean'
}

/**
 * What a copy of a record carries (0107): `null` exactly when the form
 * offers no create, otherwise field keys. A reply that offers create without
 * them -- a server older than copies -- or names them without create is no
 * form this server sent, and a page that copied by it would offer a copy
 * nobody decided.
 */
function isCopied(value: unknown, operations: readonly unknown[]): value is PublishedForm['copied'] {
  if (!operations.includes('create')) return value === null
  return isStrings(value)
}

export function isPublishedForm(body: unknown): body is PublishedForm {
  return (
    isRecord(body) &&
    isRecord(body['form']) &&
    isRecord(body['form']['model']) &&
    Array.isArray(body['operations']) &&
    Array.isArray(body['readable']) &&
    isListColumns(body['list']) &&
    isDeleting(body['deleting'], body['operations'] as unknown[]) &&
    isCopied(body['copied'], body['operations'] as unknown[])
  )
}

/** A child in a menu: the child form, and the field its list is narrowed by. */
/**
 * A section's condition (0109): `null`, or a field and the answer that shows
 * the section -- text, a number or a yes/no, as a record's answers hold it.
 */
function isSectionWhen(value: unknown): boolean {
  if (value === null) return true
  if (!isRecord(value) || typeof value['field'] !== 'string') return false
  const equals = value['equals']
  return typeof equals === 'string' || typeof equals === 'number' || typeof equals === 'boolean'
}

/** One child: its form and field, whether it is a section (0109), and only a section with a condition. */
function isMenuChild(value: unknown): boolean {
  if (!isRecord(value) || typeof value['form'] !== 'string' || typeof value['field'] !== 'string' || typeof value['one'] !== 'boolean') return false
  return value['one'] ? isSectionWhen(value['when']) : value['when'] === null
}

/** One menu entry: a page draws a link from it, and a grid per child. */
function isMenuEntry(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['title'] === 'string' &&
    isStrings(value['operations']) &&
    Array.isArray(value['children']) &&
    value['children'].every(isMenuChild)
  )
}

/** The menu (0045): every entry in the server's shape, children included, so an entry of a server with no children is not drawn as a form with none. */
export function isFormMenu(body: unknown): body is FormMenu {
  return isRecord(body) && Array.isArray(body['forms']) && body['forms'].every(isMenuEntry)
}

/** A delete's answer (0050): the token of the row deleted, and `deleted: true`, nothing else that a 2xx could be mistaken for. */
export function isRecordDeleted(body: unknown): body is RecordDeleted {
  return isRecord(body) && typeof body['record'] === 'string' && body['deleted'] === true
}

export function isFormRecord(body: unknown): body is FormRecord {
  return isRecord(body) && isNullableString(body['record']) && isNullableString(body['version']) && isRecord(body['answers'])
}

/** A page of records (0044): every row a record, whether more follow, and the cursor the next is asked for after (0108). */
export function isRecordList(body: unknown): body is RecordList {
  if (!isRecord(body) || !Array.isArray(body['rows']) || !body['rows'].every(isFormRecord) || typeof body['hasMore'] !== 'boolean') return false
  // A cursor exactly when more follow (0108): a page from a server that pages by offset has none, and a host could never ask for the next.
  return body['hasMore'] ? typeof body['next'] === 'string' && body['next'] !== '' : body['next'] === null
}

export function isLookupResult(body: unknown): body is LookupResult {
  return isRecord(body) && isRows(body['rows']) && typeof body['hasMore'] === 'boolean' && typeof body['omitted'] === 'number'
}

export function isResolved(body: unknown): body is { rows: LookupRow[] } {
  return isRecord(body) && isRows(body['rows'])
}

/** A non-2xx answer: the server's refusal when it carries a sentence, otherwise not the server's to have said. */
export function refusalOf(status: number, body: unknown): Refusal {
  if (!isRecord(body) || typeof body['message'] !== 'string') return { ok: false, status, code: 'unexpected', message: UNEXPECTED }
  const code = typeof body['code'] === 'string' ? body['code'] : `http-${String(status)}`
  const refusal: Refusal = { ok: false, status, code, message: body['message'] }
  if (Array.isArray(body['fieldErrors'])) refusal.fieldErrors = body['fieldErrors'].filter(isFieldError)
  return refusal
}
