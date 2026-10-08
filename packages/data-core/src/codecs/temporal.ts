import { TEMPORAL_SHAPES } from '@formancy/spec'

/**
 * Dates and times in formancy's own shapes, read from `@formancy/spec` rather
 * than restated, so a form's answer and this module's value are one string
 * (formancy.ai 0067): `YYYY-MM-DD`, `HH:MM`, and `YYYY-MM-DDTHH:MM:SSZ` for an
 * instant.
 *
 * The shapes say what a string looks like. Whether it names a day that exists
 * is checked here: `2026-02-30` matches the date shape, and a database would
 * refuse it after the person had moved on.
 */
const DATE = new RegExp(TEMPORAL_SHAPES.date)
const TIME = new RegExp(TEMPORAL_SHAPES.time)
const INSTANT = new RegExp(TEMPORAL_SHAPES.datetime)

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/**
 * Whether `YYYY-MM-DD` names a real day between 0001-01-01 and 9999-12-31,
 * the range both engines store. Year zero does not exist in the proleptic
 * Gregorian calendar SQL Server uses, so it is refused for both.
 */
function realDay(text: string): boolean {
  const year = Number(text.slice(0, 4))
  const month = Number(text.slice(5, 7))
  const day = Number(text.slice(8, 10))
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const length = month === 2 && isLeap(year) ? 29 : (DAYS[month - 1] ?? 0)
  return day <= length
}

export function isDate(text: string): boolean {
  return DATE.test(text) && realDay(text)
}

export function isTime(text: string): boolean {
  return TIME.test(text)
}

export function isInstant(text: string): boolean {
  return INSTANT.test(text) && realDay(text.slice(0, 10))
}
