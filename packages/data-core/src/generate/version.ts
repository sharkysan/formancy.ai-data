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
 * The formancy spec version every generated document says.
 *
 * Spec 5 since 0118, for a field's help text from its column's comment,
 * which spec 5 brought: a host page whose renderer is older than
 * `@formancy/*` 0.8.0 refuses such a document outright, which the record
 * names as the move's cost. Spec 3 before it (0042).
 */
export const GENERATED_SPEC_VERSION = '5'

/**
 * The spec versions the data server serves a stored version in: the one the
 * generator writes, and spec 3, which every release before 0118 wrote, so a
 * version stored before the move is still served rather than refused as
 * corrupt. Never spec 4, which no release generated: a stored document that
 * says it was edited by hand.
 */
export const SERVED_SPEC_VERSIONS: readonly string[] = ['3', GENERATED_SPEC_VERSION]

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
