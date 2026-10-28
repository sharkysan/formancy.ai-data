import type { FormBindings } from '../generate/types.js'
import { listColumns } from '../records/list.js'
import type { ListView } from '../runtime.js'
import type { PresentationConflict } from './types.js'
import { viewFit } from './views.js'

/** What `carryViews` reads: the published views, how an old key is followed, the new bindings, and where a dropped view is said. */
export interface ViewCarry {
  views: readonly ListView[]
  /** An old key's new key, followed by what it stands for, or `undefined` when it is gone (`rebase.ts`). */
  follow: (key: string) => string | undefined
  bindings: FormBindings
  /** A view at `index` of the published ones could not be carried. */
  report: (index: number, conflict: Extract<PresentationConflict, { kind: 'view-dropped' }>) => void
}

/**
 * The published list views carried to a regenerated base (0105): each field
 * a view names followed by what it stands for, as a label is, and the view
 * fitted again to the new bindings by `viewFit`, against every field a list
 * of them offers, as a write fits it. A view naming a field that is gone, or
 * one that no longer offers what the view asks -- a column retyped from date
 * to timestamp has no equality -- is dropped whole and said: carried without
 * the condition it would show a wider list under the same name. A default
 * goes with its view.
 */
export function carryViews({ views, follow, bindings, report }: ViewCarry): ListView[] {
  const columns = listColumns(bindings, bindings.fields.map((binding) => binding.field), [])
  const carried: ListView[] = []
  for (const [index, view] of views.entries()) {
    const gone = [...view.filter, ...view.sort].find((term) => follow(term.field) === undefined)
    if (gone !== undefined) {
      report(index, { kind: 'view-dropped', view: view.name, resolution: 'dropped', message: `View “${view.name}” names ${gone.field}, which is not in the regenerated form, so it was dropped.` })
      continue
    }
    const moved: ListView = {
      name: view.name,
      filter: view.filter.map((term) => ({ ...term, field: follow(term.field) as string })),
      sort: view.sort.map((term) => ({ ...term, field: follow(term.field) as string })),
      ...(view.default === true ? { default: true } : {}),
    }
    const why = viewFit(moved, bindings, columns)
    if (why !== null) {
      report(index, { kind: 'view-dropped', view: view.name, resolution: 'dropped', message: `View “${view.name}” was dropped: ${why}` })
      continue
    }
    carried.push(moved)
  }
  return carried
}
