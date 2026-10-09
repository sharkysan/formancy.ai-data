import type { FieldError, FormRecord, LookupResult, LookupRow, PublishedForm } from '@formancy/data-core'
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

export function isPublishedForm(body: unknown): body is PublishedForm {
  return isRecord(body) && isRecord(body['form']) && isRecord(body['form']['model']) && Array.isArray(body['operations']) && Array.isArray(body['readable'])
}

export function isFormRecord(body: unknown): body is FormRecord {
  return isRecord(body) && isNullableString(body['record']) && isNullableString(body['version']) && isRecord(body['answers'])
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
