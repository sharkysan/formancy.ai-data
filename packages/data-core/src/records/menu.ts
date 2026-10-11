import type { FormBindings } from '../generate/types.js'
import { authorizeOperation } from '../policy/evaluate.js'
import { byCodepoint, OPERATIONS } from '../policy/inputs.js'
import type { FormPolicy, PolicyContext, PolicyOperation } from '../policy/types.js'
import type { FormMenu, FormMenuChild } from '../runtime.js'
import { childLookups, parentKey, referencingFields } from './children.js'
import type { ChildLookup, ParentKey, PublishedTable } from './children.js'
import { listable } from './list.js'

/*
 * The forms a person's menu names, and the children under each (0045):
 * decided from the published bundles and the policy alone, asking no
 * database, so a menu over many forms is no statement at all. What the
 * database as it is now still allows is decided when a form is opened
 * (`GET /v1/forms/:id`, 0041), and on every request after.
 *
 * Pure and isomorphic, as the planners are.
 */

/**
 * The operations this person may use on the form as published, in read,
 * create, update order: those the policy grants them -- an operation it
 * cannot scope for their context is not granted (`authorizeOperation`) --
 * of those the bindings offer. `GET /v1/forms/:id` narrows this by the
 * database as it is now; the menu says it as it is. One function, so the
 * two cannot disagree about the policy.
 */
export function grantedOperations(bindings: FormBindings, policy: FormPolicy, context: PolicyContext): PolicyOperation[] {
  return OPERATIONS.filter((operation) => (operation === 'read' || bindings.operations[operation] !== false) && authorizeOperation(policy, context, operation).ok)
}

/** One published form as the menu reads it: its id, its title, and what deciding its entry needs. */
export interface MenuBundle extends PublishedTable {
  id: string
  title: string
  policy: FormPolicy
}

/**
 * One published form as one person's menu reads it, from its bundle alone:
 * the operations the policy grants them, the fields they may narrow its
 * list by (`listable`, which the list route asks; `null` when they are
 * offered no list of it), and what its records offer a child and what its
 * lookups reference (`parentKey`, `childLookups`). Empty but for its
 * operations when they may not read it: nothing more of it is needed.
 */
export interface MenuForm {
  id: string
  title: string
  operations: PolicyOperation[]
  listedBy: string[] | null
  key: ParentKey | null
  lookups: ChildLookup[]
}

/**
 * `bundle`'s `MenuForm` for this person. Everything the menu reads of a
 * bundle is read here, so bindings a hand edit left in a shape its check
 * does not read throw here, for this form alone, and the caller leaves it
 * out; `formMenu` only compares what this read.
 */
export function menuForm(bundle: MenuBundle, context: PolicyContext): MenuForm {
  const operations = grantedOperations(bundle.bindings, bundle.policy, context)
  if (!operations.includes('read')) return { id: bundle.id, title: bundle.title, operations, listedBy: null, key: null, lookups: [] }
  const listed = listable(bundle.snapshot, bundle.bindings, bundle.policy, context)
  return { id: bundle.id, title: bundle.title, operations, listedBy: listed.ok ? [...listed.fields] : null, key: parentKey(bundle), lookups: childLookups(bundle) }
}

/**
 * The menu of `forms` for the person they were read for: every form the
 * policy lets them read, in codepoint order of its id, and nothing about
 * any other. A form they may only create with is not named either: the
 * menu opens grids, and a grid reads.
 *
 * Under each form, the children a page may show below one of its records:
 * another form named in this menu -- a form can be its own child -- whose
 * rows reference that record through a lookup field (`referencingFields`,
 * as `childFields` decides it), whose list this person is offered, and
 * whose field they may read, which a list's `parent` must be. So a child is
 * named only where a page asking its list with that parent would be served
 * by the policy; the database as it is now, which can still refuse a page
 * as drift, is asked when the child form is opened.
 */
export function formMenu(forms: readonly MenuForm[]): FormMenu {
  const named = forms.filter((form) => form.operations.includes('read')).sort((left, right) => byCodepoint(left.id, right.id))
  return {
    forms: named.map((parent) => {
      const children: FormMenuChild[] = []
      for (const child of named) {
        if (child.listedBy === null) continue
        for (const field of referencingFields(parent.key, child.lookups)) if (child.listedBy.includes(field)) children.push({ form: child.id, field })
      }
      return { id: parent.id, title: parent.title, operations: [...parent.operations], children }
    }),
  }
}
