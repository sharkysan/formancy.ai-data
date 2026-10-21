import type { DataClient, FormMenu, FormMenuEntry } from '@formancy/data-client'
import type { ChildForm } from './children.js'

/**
 * The children the menu names for `entry`, each opened as itself: its own
 * policy decides what its list returns, and a child the server no longer
 * lists for this person now, or whose list it does not offer, is left out
 * (0045). Asked when a form is chosen, and in Drill down for each level's
 * form (0090).
 */
export async function childFormsOf(client: DataClient, menu: FormMenu, entry: FormMenuEntry): Promise<ChildForm[]> {
  const ids = menu.forms.map((form) => form.id)
  const children = await Promise.all(
    entry.children
      .filter((child) => ids.includes(child.form))
      .map(async (child) => {
        const answer = await client.form(child.form)
        const own = menu.forms.find((form) => form.id === child.form)
        return answer.ok && answer.value.list !== null && own !== undefined ? { child, menu: own, definition: answer.value } : null
      }),
  )
  return children.filter((child): child is ChildForm => child !== null)
}
