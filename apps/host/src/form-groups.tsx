import { useId } from 'react'
import type { ReactElement } from 'react'
import type { FormList } from './form-list.js'
import { FormLink } from './form-link.js'
import type { FormLinking } from './form-link.js'

/**
 * The forms under their groups (0143, 0144), as `formList` drew them for
 * the search: each group a heading and the list it names, in the order of
 * the headings, the forms in no group last under "Forms". Where no form of
 * the menu is in a group, the forms with no heading over them.
 */
export function FormGroups({ list, ...linking }: FormLinking & { list: FormList }): ReactElement {
  const id = useId()
  return (
    <>
      {list.groups.map((group, index) => {
        const heading = `${id}-group-${String(index)}`
        return (
          <div className="forms-group" key={group.heading}>
            {list.headed ? (
              <h3 className="eyebrow forms-group-heading" id={heading}>
                {group.heading}
              </h3>
            ) : null}
            <ul className="forms-list" aria-labelledby={list.headed ? heading : undefined}>
              {group.forms.map((form) => (
                <li key={form.id}>
                  <FormLink form={form} {...linking} />
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </>
  )
}
