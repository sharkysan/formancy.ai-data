import type { FieldError, FormMenu, FormRecord, LookupResult, LookupRow, PublishedForm, RecordDeleted, RecordList } from '@formancy/data-core'
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

/** What a form's list may be searched and sorted by, or `null` for no list (0044): a reply without one is from no server that has lists. */
function isListColumns(value: unknown): value is PublishedForm['list'] {
  return value === null || (isRecord(value) && isStrings(value['searchable']) && isStrings(value['sortable']))
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

export function isPublishedForm(body: unknown): body is PublishedForm {
  return (
    isRecord(body) &&
    isRecord(body['form']) &&
    isRecord(body['form']['model']) &&
    Array.isArray(body['operations']) &&
    Array.isArray(body['readable']) &&
    isListColumns(body['list']) &&
    isDeleting(body['deleting'], body['operations'] as unknown[])
  )
}

/** A child in a menu: the child form, and the field its list is narrowed by. */
function isMenuChild(value: unknown): boolean {
  return isRecord(value) && typeof value['form'] === 'string' && typeof value['field'] === 'string'
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

/** A page of records (0044): every row a record, and whether more follow. */
export function isRecordList(body: unknown): body is RecordList {
  return isRecord(body) && Array.isArray(body['rows']) && body['rows'].every(isFormRecord) && typeof body['hasMore'] === 'boolean'
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
