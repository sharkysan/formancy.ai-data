import { useEffect } from 'react'
import { parsePath } from '@formancy/core'
import type { FormEngine } from '@formancy/core'
import type { SaveResult, Session } from './session.js'

/*
 * What a record grid asks of the pane that draws the record its open row
 * is (0179): the row and the form are one draft, the session's, so a save
 * from the grid is the pane's own Save -- said on the pane's line, a stale
 * or a lost one opening the pane's notice -- and F2 on a cell the record's
 * form edits puts the keyboard on that field there. And what the grid
 * hears of every save the pane answers, from either: the row says what
 * the draft's save came to.
 *
 * Kept by session, for as long as a pane draws it (pane.tsx): a session
 * no pane draws -- its renderer not shown -- has none, and the grid saves
 * through the session alone.
 */

/** Where a save was asked from: the form's Save, or the grid leaving its row. */
export type SaveFrom = 'form' | 'grid'

export interface PaneReach {
  /** The pane's submit, as its Save sends it, and its answer said as its own -- but the keyboard, which stays in the grid. Null where the engine refused it and nothing was sent. */
  save(): Promise<SaveResult | null>
  /** The keyboard on `field` in the pane's form, the pane's tab shown first where the record's tabs hide it (0142). */
  goTo(field: string): void
}

type Heard = (result: SaveResult | null, from: SaveFrom) => void

const reaches = new WeakMap<Session, PaneReach>()
const hearing = new WeakMap<Session, Set<Heard>>()

/** `reach` kept for `session` while the pane that calls it is mounted. */
export function usePaneReach(session: Session, reach: PaneReach): void {
  useEffect(() => {
    reaches.set(session, reach)
    return () => {
      if (reaches.get(session) === reach) reaches.delete(session)
    }
  }, [session, reach])
}

/** The reach of the pane drawing `session`, if one does. */
export function reachOf(session: Session): PaneReach | undefined {
  return reaches.get(session)
}

/** `listener` told of every save a pane of `session` answers; returns how to stop. */
export function hearSaves(session: Session, listener: Heard): () => void {
  const set = hearing.get(session) ?? new Set<Heard>()
  hearing.set(session, set)
  set.add(listener)
  return () => {
    set.delete(listener)
  }
}

/** A save of `session` answered, from either: told to whoever hears it. */
export function told(session: Session, result: SaveResult | null, from: SaveFrom): void {
  for (const listener of [...(hearing.get(session) ?? [])]) listener(result, from)
}

/**
 * The keyboard on `field`'s control in the form `engine` draws: by the id
 * the engine gives it, which both renderers draw it with, after the event
 * by which a renderer shows what holds it -- what formancy's error summary
 * does to reach a field.
 */
export function focusField(engine: FormEngine, field: string): void {
  const control = document.getElementById(engine.getFieldSnapshot(parsePath(field)).ids.control)
  if (control === null) return
  control.dispatchEvent(new Event('formancy-reveal', { bubbles: true }))
  control.focus()
  if (document.activeElement !== control) control.querySelector<HTMLElement>('input, select, textarea, button')?.focus()
}
