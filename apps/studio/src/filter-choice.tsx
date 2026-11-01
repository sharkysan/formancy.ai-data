import type { ReactElement } from 'react'
import type { FilterableField } from '@formancy/data-core'

/**
 * Which fields a form's Filter panel offers a person (0123), in the
 * Presentation step's List views: one checkbox each, over every field a list
 * of the form is filtered by, ticked where the panel offers it. Unticked, a
 * field is still one a list is filtered by -- a view here may name it -- so
 * this is presentation, carried by a regeneration as a label is, and never
 * what a person may filter by: that is the policy's.
 */
export function FilterChoice({
  offers,
  label,
  unfiltered,
  onUnfiltered,
}: {
  /** Every field a list of the form is filtered by, in the bindings' order. */
  offers: readonly FilterableField[]
  label: (key: string) => string
  /** The fields the panel does not offer. */
  unfiltered: readonly string[]
  /** In the bindings' order, as the presentation keeps them. */
  onUnfiltered: (next: string[]) => void
}): ReactElement | null {
  if (offers.length === 0) return null
  const toggle = (key: string, offered: boolean): void =>
    onUnfiltered(offers.map((offer) => offer.field).filter((field) => (field === key ? !offered : unfiltered.includes(field))))
  return (
    <fieldset className="filter-choice">
      <legend>The Filter panel offers</legend>
      <p className="hint">A person filters the list by a field ticked here. A view may filter by any of them.</p>
      {offers.map((offer) => (
        <span key={offer.field} className="check">
          <input
            type="checkbox"
            id={`filter-choice-${offer.field}`}
            checked={!unfiltered.includes(offer.field)}
            onChange={(event) => toggle(offer.field, event.target.checked)}
          />
          <label htmlFor={`filter-choice-${offer.field}`}>{label(offer.field)}</label>
        </span>
      ))}
    </fieldset>
  )
}
