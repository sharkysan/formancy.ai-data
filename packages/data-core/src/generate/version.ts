/**
 * The bindings version this release writes and reads.
 *
 * 2 since 0027, which replaced a field's one `writable` flag with what it
 * writes on each operation. A version-1 file says nothing about which
 * operation a field is written on, so it cannot be read as version 2 by
 * guessing; it is refused, and the form republished.
 */
export const BINDINGS_VERSION = 2

/**
 * Why bindings of this version cannot be read, or `null`.
 *
 * One function for every reader — the planner, the lookup configuration,
 * drift review and the server's bundle check — so none of them can accept a
 * version another refuses.
 */
export function bindingsVersionProblem(version: unknown): string | null {
  if (version === BINDINGS_VERSION) return null
  if (version === 1) return 'bindings version 1 were published before 0027 (per-operation writes); republish the form'
  return `Bindings version ${String(version)} is not one this release reads`
}
