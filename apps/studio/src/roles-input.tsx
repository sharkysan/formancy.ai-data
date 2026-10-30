import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { formatRoles, parseRoles } from './policy-model.js'

/**
 * A list of roles as text, kept as typed.
 *
 * The draft is the person's; the roles are what it parses to. A change from
 * outside -- "fill every field" -- replaces the draft, and typing never does:
 * otherwise the comma just typed would vanish before the next role could be.
 */
export function RolesInput({
  id,
  label,
  roles,
  onRoles,
}: {
  id: string
  label: ReactElement | string
  roles: readonly string[]
  onRoles: (roles: string[]) => void
}): ReactElement {
  const [draft, setDraft] = useState(formatRoles(roles))
  useEffect(() => {
    if (formatRoles(parseRoles(draft)) !== formatRoles(roles)) setDraft(formatRoles(roles))
    // Only an outside change to the roles resets the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- with the draft a dependency, a keystroke would reset the draft, the comma just typed with it, whenever the parent has not yet applied, or has normalised, the roles the draft parses to
  }, [roles])
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={draft}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => {
          setDraft(event.target.value)
          onRoles(parseRoles(event.target.value))
        }}
      />
    </div>
  )
}
