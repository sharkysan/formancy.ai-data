import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { atRisk } from './leave.js'
import type { LeaveRequest, PaneWork, Said } from './leave.js'
import type { Renderer, Session } from './session.js'

/*
 * The guard over every way of leaving a form (0047), as the workspace holds
 * it: a registry of every pane's session -- the record's and each child
 * section's, mounted or not -- and one pending question. leave.ts decides
 * which panes a request drops; this asks them what they hold, and waits for
 * the person when any would lose something.
 */

/** One pane's session as the guard knows it. */
export interface PaneEntry {
  /** `master` for the record's panes, or a child section's key. */
  owner: string
  renderer: Renderer
  session: Session
  /** How the notice names the pane's record: "Order k1:1003", "New Order line". */
  name: () => Said
}

export interface Registry {
  /** Adds the pane, and returns how to remove it. */
  add(entry: PaneEntry): () => void
  /** Every pane, the record's first, then each child's in the order they were added. */
  entries(): PaneEntry[]
}

export function createRegistry(): Registry {
  const held = new Set<PaneEntry>()
  return {
    add(entry) {
      held.add(entry)
      return () => held.delete(entry)
    },
    entries: () => [...held].sort((a, b) => Number(b.owner === 'master') - Number(a.owner === 'master')),
  }
}

/** A request waiting for the person: what it is, the panes it would drop that hold work, and what each answer does. */
export interface Pending {
  request: LeaveRequest
  risky: Array<PaneWork & { session: Session }>
  /** Carries the request out; `discarded` says whether work was dropped for it. */
  proceed(discarded: boolean): void
  /** Gives the keyboard back to what asked. */
  back(): void
  /** Undoes what the request did before it was asked -- Back moved the address -- whether kept from or replaced. */
  cancel(): void
  /** The how-manyth question this is: a second request replaces the first, and takes the focus again. */
  n: number
}

export interface Guard {
  /**
   * Carry `request` out now, or once the person says to discard what it
   * would drop. A request already waiting is replaced, and cancelled first.
   */
  ask(request: LeaveRequest, proceed: (discarded: boolean) => void, back: () => void, cancel?: () => void): void
  pending: Pending | null
  /** Whether a request is waiting for the person now: read when an answer arrives late, outside a render. */
  waiting(): boolean
  keep(): void
  discard(): void
  registry: Registry
}

export function useGuard(): Guard {
  const registry = useMemo(createRegistry, [])
  const [pending, setShown] = useState<Pending | null>(null)
  // Read by the answers, which must act once: a state updater may be run twice.
  const current = useRef<Pending | null>(null)
  const setPending = useCallback((next: Pending | null) => {
    current.current = next
    setShown(next)
  }, [])
  const asked = useRef(0)

  /** Every pane the registry holds that `request` would drop with work in it, as it is now. */
  const atRiskNow = useCallback(
    (request: LeaveRequest) =>
      atRisk(
        request,
        registry.entries().map((entry) => ({ owner: entry.owner, renderer: entry.renderer, name: entry.name(), work: entry.session.work(), session: entry.session })),
      ) as Array<PaneWork & { session: Session }>,
    [registry],
  )

  const ask = useCallback(
    (request: LeaveRequest, proceed: (discarded: boolean) => void, back: () => void, cancel: () => void = () => {}) => {
      const risky = atRiskNow(request)
      // Replaced: the person asked for something else, so what the waiting
      // request already did -- Back moved the address -- is undone first.
      const replaced = current.current
      current.current = null
      replaced?.cancel()
      if (risky.length === 0) {
        setPending(null)
        proceed(false)
        return
      }
      asked.current += 1
      setPending({ request, risky, proceed, back, cancel, n: asked.current })
    },
    [atRiskNow, setPending],
  )

  const waiting = useCallback(() => current.current !== null, [])

  const keep = useCallback(() => {
    const now = current.current
    setPending(null)
    now?.cancel()
    now?.back()
  }, [setPending])

  const discard = useCallback(() => {
    const now = current.current
    if (now === null) return
    // Work typed while the notice was up is named before it is dropped: the
    // question is asked again, with every form at risk now.
    const risky = atRiskNow(now.request)
    if (risky.some((pane) => !now.risky.some((listed) => listed.session === pane.session))) {
      asked.current += 1
      setPending({ ...now, risky, n: asked.current })
      return
    }
    setPending(null)
    for (const pane of risky) pane.session.discard()
    now.proceed(true)
  }, [atRiskNow, setPending])

  return { ask, pending, waiting, keep, discard, registry }
}

export const GuardContext = createContext<Guard | null>(null)

export function useGuardContext(): Guard {
  const guard = useContext(GuardContext)
  if (guard === null) throw new Error('a pane outside the workspace has no guard')
  return guard
}

/** Registers `entries` with the workspace's guard while the component that owns them is mounted. */
export function useRegistered(entries: readonly PaneEntry[]): void {
  const { registry } = useGuardContext()
  useEffect(() => {
    const removes = entries.map((entry) => registry.add(entry))
    return () => {
      for (const remove of removes) remove()
    }
  }, [registry, entries])
}
