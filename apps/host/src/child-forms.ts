import type { DataClient, FormMenu, FormMenuEntry } from '@formancy/data-client'
import type { ChildForm } from './children.js'
import type { LevelForm } from './use-drill.js'

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

/**
 * A form a lookup's record opens in (0141), opened as itself when Open is
 * pressed: its own policy decides what the person may do there. One the
 * menu no longer names for this person, or the server no longer opens for
 * them, is refused, in the server's words where it has some.
 */
export async function levelFormOf(client: DataClient, menu: FormMenu, formId: string): Promise<{ ok: true; form: LevelForm } | { ok: false; message: string }> {
  const entry = menu.forms.find((form) => form.id === formId)
  if (entry === undefined) return { ok: false, message: `${formId} is not one of your forms.` }
  const answer = await client.form(formId)
  return answer.ok ? { ok: true, form: { id: formId, menu: entry, definition: answer.value } } : { ok: false, message: answer.message }
}
