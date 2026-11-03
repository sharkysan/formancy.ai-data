import { createContext, createElement, useContext, useState, useSyncExternalStore } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { DataClient, ListFilterTerm, ListSortTerm, ListView, Outcome, OwnViews, PublishedForm } from '@formancy/data-client'

/*
 * A person's own views of each form (0126), as one open form holds them
 * across its grids (0128): the Records panel, every child section and each
 * level of Drill down that lists the same form. What a grid shows is what
 * the server last answered a save or a remove of that form with, in any of
 * them -- the server's whole list as it then stood -- and, before any, what
 * the grid's definition offered when the form was opened, `list.own`. An
 * answer beats a definition: a child section opened after a save draws
 * from a definition read before it.
 *
 * Kept by the server, never in this browser (0106): the page holds them
 * only while the form is open, so a view saved in another page is offered
 * once the form is opened again.
 */

/** The answers heard while one form is open: a form's views as the server last answered a save or a remove of them. */
interface OwnViewsHeard {
  get: (formId: string) => readonly ListView[] | undefined
  set: (formId: string, views: readonly ListView[]) => void
  subscribe: (listener: () => void) => () => void
}

function createHeard(): OwnViewsHeard {
  const heard = new Map<string, readonly ListView[]>()
  const listeners = new Set<() => void>()
  return {
    get: (formId) => heard.get(formId),
    set: (formId, views) => {
      heard.set(formId, views)
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const HeardContext = createContext<OwnViewsHeard | null>(null)

/** Where the grids of one open form share what the server answered: the workspace draws one per form it opens, keyed by the form. */
export function OwnViewsScope({ children }: { children: ReactNode }): ReactElement {
  const [heard] = useState(createHeard)
  return createElement(HeardContext.Provider, { value: heard }, children)
}

/** A grid's own views, and the two calls that change them: each null once the server agreed, else its sentence. */
export interface OwnViewsHeld {
  own: readonly ListView[]
  save: (view: { name: string; filter: readonly ListFilterTerm[]; sort: readonly ListSortTerm[] }) => Promise<string | null>
  remove: (name: string) => Promise<string | null>
}

/** The views of `formId` this grid shows, from `definition` until a grid of the same open form hears an answer; outside a scope, the grid's own. */
export function useOwnViews(client: DataClient, formId: string, definition: PublishedForm): OwnViewsHeld {
  const shared = useContext(HeardContext)
  const [alone] = useState(createHeard)
  const heard = shared === null ? alone : alone
  const answered = useSyncExternalStore(heard.subscribe, () => heard.get(formId))
  const own = answered ?? definition.list?.own ?? []

  function held(outcome: Outcome<OwnViews>): string | null {
    if (!outcome.ok) return outcome.message
    heard.set(formId, outcome.value.own)
    return null
  }

  return {
    own,
    save: async (view) => held(await client.saveView(formId, { name: view.name, filter: [...view.filter], sort: [...view.sort] })),
    remove: async (name) => held(await client.removeView(formId, name)),
  }
}
