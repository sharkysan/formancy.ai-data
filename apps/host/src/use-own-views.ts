import { useState } from 'react'
import type { DataClient, ListFilterTerm, ListSortTerm, ListView, Outcome, OwnViews } from '@formancy/data-client'

/*
 * A grid's own views (0126): what the server offered when the form was
 * opened, `list.own`, then what each save and remove answered, which is
 * the server's whole list as it now stands. Kept by the server, never in
 * this browser (0106): the page holds them only while it shows the grid.
 * Each grid holds its own, so a view saved in one grid of a form is
 * offered in another of the same form once that one opens again.
 */

/** A grid's own views, and the two calls that change them: each null once the server agreed, else its sentence. */
export interface OwnViewsHeld {
  own: readonly ListView[]
  save: (view: { name: string; filter: readonly ListFilterTerm[]; sort: readonly ListSortTerm[] }) => Promise<string | null>
  remove: (name: string) => Promise<string | null>
}

export function useOwnViews(client: DataClient, formId: string, offered: readonly ListView[]): OwnViewsHeld {
  const [own, setOwn] = useState(offered)

  function held(outcome: Outcome<OwnViews>): string | null {
    if (!outcome.ok) return outcome.message
    setOwn(outcome.value.own)
    return null
  }

  return {
    own,
    save: async (view) => held(await client.saveView(formId, { name: view.name, filter: [...view.filter], sort: [...view.sort] })),
    remove: async (name) => held(await client.removeView(formId, name)),
  }
}
