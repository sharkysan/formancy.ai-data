import type { GeneratedSection } from './layout.js'

/*
 * Where fields sit once a presentation's moves are made (0075). One decision,
 * which `applyPresentation`, `presentationOf` and `rebasePresentation` all
 * ask, so the three cannot disagree about which keys a section holds: a
 * stored order checked against one set and derived against another would
 * publish a form the next read refuses.
 */

/**
 * The keys each generated section holds once `moves` are made -- each key
 * to the index of the section it moved to -- in the order they land: the
 * section's own keys that stayed, in the base's order, then the keys moved
 * into it, in the base's field order (`fieldOrder`). A section's `order`,
 * where a presentation has one, is a rearrangement of exactly these.
 *
 * A move to the key's own section is no move, and leaves the key where it
 * was; the callers refuse or drop one before asking.
 */
export function placements(sections: readonly GeneratedSection[], moves: ReadonlyMap<string, number>, fieldOrder: readonly string[]): string[][] {
  const position = new Map(fieldOrder.map((key, index) => [key, index]))
  const moved = [...moves.keys()].sort((left, right) => (position.get(left) ?? 0) - (position.get(right) ?? 0))
  return sections.map((section, index) => [
    ...section.keys.filter((key) => (moves.get(key) ?? index) === index),
    ...moved.filter((key) => moves.get(key) === index && !section.keys.includes(key)),
  ])
}

/** The index of the generated section that places `key`, or -1 when none does. */
export function homeOf(sections: readonly GeneratedSection[], key: string): number {
  return sections.findIndex((section) => section.keys.includes(key))
}
