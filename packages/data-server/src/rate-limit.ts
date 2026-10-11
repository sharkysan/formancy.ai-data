/**
 * The per-address request limit, and the setting that changes it.
 *
 * `FORMANCY_DATA_RATE_LIMIT` is read by the composition root (main.ts) and
 * parsed here, so the rule is tested without starting a process.
 */

/** Requests per client address per window, unless the operator says otherwise: 600 a minute, as every earlier release had. */
export const DEFAULT_RATE_LIMIT = { max: 600, timeWindowMs: 60_000 } as const

/** What main.ts prints, and stops, when the setting is anything but a whole number of at least one. */
export const RATE_LIMIT_REFUSAL = 'FORMANCY_DATA_RATE_LIMIT is a whole number of requests a minute per client address, at least 1.'

export type RateLimitSetting = { ok: true; rateLimit: { max: number; timeWindowMs: number } } | { ok: false; problem: string }

/**
 * `FORMANCY_DATA_RATE_LIMIT` as written: unset is the default; otherwise
 * decimal digits only, no sign, no fraction, no exponent, no space, and a
 * value a JavaScript number holds exactly. The window is always a minute, so
 * the number an operator writes is the number of requests.
 */
export function rateLimitSetting(text: string | undefined): RateLimitSetting {
  if (text === undefined) return { ok: true, rateLimit: { ...DEFAULT_RATE_LIMIT } }
  const max = /^[0-9]+$/.test(text) ? Number(text) : Number.NaN
  if (!Number.isSafeInteger(max) || max < 1) return { ok: false, problem: RATE_LIMIT_REFUSAL }
  return { ok: true, rateLimit: { max, timeWindowMs: DEFAULT_RATE_LIMIT.timeWindowMs } }
}
