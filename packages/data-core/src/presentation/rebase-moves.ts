import type { GeneratedSection } from './layout.js'
import { describeSection, same } from './layout.js'
import { homeOf, placements } from './placement.js'
import type { FieldAnchor, FieldPresentation, PresentationConflict, SectionAnchor } from './types.js'

/** What `carryMoves` needs of the rebase that calls it. */
export interface MoveCarrying {
  /** The published presentation's field entries; those with a `section` are the moves. */
  entries: readonly FieldPresentation[]
  /** The new base's sections. */
  after: readonly GeneratedSection[]
  /** The new base's field keys, in its model order. */
  order: readonly string[]
  /** An old key's new key, followed by what it stands for, or `undefined` when it is gone. */
  follow: (key: string) => string | undefined
  /** Whether a section anchor names one section in both bases (`ambiguousLabels`). */
  told: (anchor: SectionAnchor) => boolean
  /** Where a conflict about an old key goes. */
  report: (key: string, conflict: PresentationConflict) => void
}

export interface CarriedMoves {
  /** Each new key carried with a move: the index of the new base's section it is placed in. */
  moves: Map<string, number>
  /** New keys whose move was dropped and said, as `move-dropped`, and so not said again as `moved-section`. */
  dropped: Set<string>
}

/**
 * The person's moves between sections (0075), carried to the new base by
 * what each field stands for and by the target section's anchor:
 *
 * - a move whose field is gone is not carried here; the caller says it with
 *   the field's other overrides, as `field-gone`;
 * - one into a section the new base does not have, or cannot tell apart
 *   from another of its label, is dropped, and the field goes where the
 *   generator put it (`move-dropped`);
 * - one into the section the generator now puts the field in itself is no
 *   longer an override, and goes without a word;
 * - then, until none does, a section the carried moves would leave with no
 *   field drops every move out of it (`move-dropped`). Moves only ever go,
 *   and with none the generator's sections are never empty, so it ends.
 */
export function carryMoves({ entries, after, order, follow, told, report }: MoveCarrying): CarriedMoves {
  const moves = new Map<string, number>()
  const dropped = new Set<string>()
  const origin = new Map<string, { key: string; anchor: FieldAnchor; section: SectionAnchor }>()
  const drop = (now: string, why: string, to: SectionAnchor) => {
    const from = origin.get(now) as { key: string; anchor: FieldAnchor; section: SectionAnchor }
    dropped.add(now)
    moves.delete(now)
    report(from.key, {
      kind: 'move-dropped',
      field: now,
      anchor: from.anchor,
      section: from.section,
      to,
      resolution: 'dropped',
      message: `The move of ${now} to section ${describeSection(from.section)} was dropped: ${why}.`,
    })
  }

  for (const entry of entries) {
    const now = follow(entry.field)
    if (entry.section === undefined || now === undefined) continue
    origin.set(now, { key: entry.field, anchor: entry.anchor, section: entry.section })
    const home = after[homeOf(after, now)] as GeneratedSection
    const target = told(entry.section) ? after.findIndex((section) => same(section.anchor, entry.section)) : -1
    if (target === homeOf(after, now)) continue
    if (target >= 0) {
      moves.set(now, target)
      continue
    }
    const where = describeSection(entry.section)
    const why = told(entry.section)
      ? `${where} is not in the regenerated form`
      : `the regenerated form's sections labelled "${entry.section.label}" changed in number, so ${where} cannot be told apart`
    drop(now, `${why}, so ${now} is in section ${describeSection(home.anchor)}, where the generator put it`, { ...home.anchor })
  }

  for (;;) {
    const emptied = placements(after, moves, order).flatMap((keys, index) => (keys.length === 0 ? [index] : []))
    if (emptied.length === 0) return { moves, dropped }
    for (const index of emptied) {
      const section = after[index] as GeneratedSection
      for (const key of [...moves.keys()].filter((candidate) => section.keys.includes(candidate))) {
        drop(key, `it would leave section ${describeSection(section.anchor)} with no field, so ${key} stays there`, { ...section.anchor })
      }
    }
  }
}
