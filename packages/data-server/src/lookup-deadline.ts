import { DEFAULT_LOOKUP_DEADLINE_MS, MAX_LOOKUP_DEADLINE_MS } from '@formancy/data-core'

/**
 * How long a lookup statement may run, and the setting that changes it
 * (0061). `FORMANCY_DATA_LOOKUP_DEADLINE_MS` is read by the composition root
 * (main.ts) and parsed here, so the rule is tested without starting a
 * process; `createDataServer` holds its `runtime.lookupDeadlineMs` to the
 * same rule. One value for the server, not one per lookup: what it should be
 * depends on the deployment's hardware and data, not on a form.
 */

export type LookupDeadlineSetting = { ok: true; ms: number } | { ok: false; problem: string }

/** What is wrong with `ms` as a deadline, said of `name`, or undefined: a whole number from 1 to the longest a Node timer holds. */
export function lookupDeadlineProblem(name: string, ms: number, written: string = String(ms)): string | undefined {
  if (Number.isSafeInteger(ms) && ms >= 1 && ms <= MAX_LOOKUP_DEADLINE_MS) return undefined
  return `${name} is a whole number of milliseconds from 1 to ${String(MAX_LOOKUP_DEADLINE_MS)}; it is ${written}.`
}

/**
 * `FORMANCY_DATA_LOOKUP_DEADLINE_MS` as written: unset is the measured
 * default; otherwise decimal digits only, no sign, fraction, exponent or
 * space, from 1 to the longest a Node timer holds. The refusal quotes what
 * was written, which is a number of milliseconds and never a secret.
 */
export function lookupDeadlineSetting(text: string | undefined): LookupDeadlineSetting {
  if (text === undefined) return { ok: true, ms: DEFAULT_LOOKUP_DEADLINE_MS }
  const ms = /^[0-9]+$/.test(text) ? Number(text) : Number.NaN
  const problem = lookupDeadlineProblem('FORMANCY_DATA_LOOKUP_DEADLINE_MS', ms, JSON.stringify(text))
  return problem === undefined ? { ok: true, ms } : { ok: false, problem }
}

/** One lookup statement's signal, and the call that stops its timer and its listening once the statement is done. */
export interface LookupDeadline {
  readonly signal: AbortSignal
  clear(): void
}

/**
 * A signal that aborts when `ms` have passed, with a TimeoutError, or when
 * `within` aborts, with `within`'s own reason (0061).
 *
 * A timer of its own rather than `AbortSignal.any` over
 * `AbortSignal.timeout`: a timeout signal cannot be cleared, and the
 * composite stayed reachable from it until it fired -- about 730 bytes a
 * request, for up to 24.8 days at the longest deadline (2026-10-15 review,
 * Node 24.21.0). `clear()` stops the timer and the listening, so a lookup
 * that answered holds nothing. The timer is unreferenced, as a timeout
 * signal's is: a deadline never keeps the process alive.
 */
export function lookupDeadline(ms: number, within?: AbortSignal): LookupDeadline {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException(`The lookup passed its deadline of ${String(ms)} ms.`, 'TimeoutError')), ms)
  // A browser-like global's setTimeout, as the host page's suites run the
  // server under jsdom, returns a number, which keeps nothing alive.
  if (typeof timer === 'object') timer.unref()
  const left = (): void => controller.abort(within?.reason)
  if (within?.aborted === true) controller.abort(within.reason)
  else within?.addEventListener('abort', left, { once: true })
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer)
      within?.removeEventListener('abort', left)
    },
  }
}
