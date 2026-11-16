import type { SavedRecord, SavePart, SaveRefusal } from '@formancy/data-core'
import type { Refusal } from './client.js'
import { isFormRecord, isRecord } from './shapes.js'
import { isUnknownWrite, writeOutcome } from './writes.js'
import type { UnknownWrite, WriteAnswer, WriteIntent } from './writes.js'

/*
 * A save of a record with the rows of its together children (0155), as the
 * client reads its answer: by the rules every write's answer is read by
 * (`writeOutcome`, 0031) -- known only when the data server says what
 * happened, unknown otherwise, never sent again -- and a refusal with the
 * part of the save it is about, which a host places its words by. Kept out
 * of `client.ts`, which only sends it.
 */

/** A save's refusal: the server's code and sentence, and where it said so, the part it is about, every part's field errors, and a child's bound with what the save would leave it. */
export type SaveRefused = Refusal & Pick<SaveRefusal, 'at' | 'parts' | 'rows'>

/** What `save` resolves to: the record and its rows as stored, a refusal, or a save nobody here can say happened. */
export type SaveOutcome = { ok: true; value: SavedRecord } | SaveRefused | UnknownWrite

function isPart(value: unknown): value is SavePart {
  if (!isRecord(value)) return false
  if (value['record'] === true) return Object.keys(value).length === 1
  if (typeof value['form'] !== 'string' || typeof value['field'] !== 'string') return false
  const named = Object.keys(value).length
  return named === 2 || (named === 3 && (typeof value['record'] === 'string' || typeof value['ref'] === 'string'))
}

/** One change as stored: a new row with its ref, a row, or a deleted row's token. */
function isStoredChange(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (typeof value['deleted'] === 'string') return true
  if (!isFormRecord(value['row'])) return false
  return value['ref'] === undefined || typeof value['ref'] === 'string'
}

/** A save's 2xx (0155): the record as stored, and each child with every change as stored -- nothing else is the server saying it saved. */
export function isSavedRecord(body: unknown): body is SavedRecord {
  if (!isRecord(body) || !isFormRecord(body['record']) || !Array.isArray(body['rows'])) return false
  return body['rows'].every(
    (row) =>
      isRecord(row) &&
      typeof row['form'] === 'string' &&
      typeof row['field'] === 'string' &&
      Array.isArray(row['changes']) &&
      row['changes'].every(isStoredChange),
  )
}

/** What a save's refusal says of where it is, read shallowly: a part, parts with their field errors, a child's bound and count. Anything else is left out, never guessed. */
function partsOf(body: unknown): Pick<SaveRefusal, 'at' | 'parts' | 'rows'> {
  if (!isRecord(body)) return {}
  const { at, parts, rows } = body
  const read: Pick<SaveRefusal, 'at' | 'parts' | 'rows'> = {}
  if (isPart(at)) read.at = at
  if (Array.isArray(parts) && parts.every((part) => isRecord(part) && isPart(part['at']) && Array.isArray(part['fieldErrors']))) {
    read.parts = parts as NonNullable<SaveRefusal['parts']>
  }
  const counted = (name: string): boolean => isRecord(rows) && typeof rows[name] === 'number'
  if (isRecord(rows) && typeof rows['form'] === 'string' && typeof rows['field'] === 'string' && ['min', 'max', 'held'].every(counted)) {
    read.rows = rows as NonNullable<SaveRefusal['rows']>
  }
  return read
}

/**
 * The outcome of a save, from what arrived: `writeOutcome`'s rules, a 2xx
 * counting only with a `SavedRecord`, and a refusal carrying the part it is
 * about. The intent is the save's: an update's record and version, or a
 * create's nothing, so a save lost on the way is reconciled as the record's
 * update or create would be.
 */
export function saveOutcome(answer: WriteAnswer, intent: WriteIntent & { operation: 'save' }): SaveOutcome {
  const outcome = writeOutcome(answer, intent, isSavedRecord)
  if (outcome.ok || isUnknownWrite(outcome) || !answer.answered) return outcome
  return { ...outcome, ...partsOf(answer.body) }
}
