import type { ReactElement, ReactNode } from 'react'

/**
 * One choice of a few, drawn as a segmented control (UX-SPEC §5.6): native
 * radios in a fieldset, each laid over its option, so the group is one Tab
 * stop and the arrows choose. The Layout group and the renderer switch.
 *
 * Controlled: a radio the arrows reach is checked by the browser, and stays
 * checked only once `onChange` has made it the value -- so a choice the
 * unsaved-changes guard holds back shows the old one until it is carried out.
 * Each input's id is `<name>-<value>`, for giving the keyboard back to it.
 */
export function Segmented<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  describedBy,
  className,
  children,
}: {
  legend: string
  name: string
  options: ReadonlyArray<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
  describedBy?: string | undefined
  className: string
  /** What follows the options inside the group: a note that describes it. */
  children?: ReactNode
}): ReactElement {
  return (
    <fieldset className={`choice ${className}`} aria-describedby={describedBy}>
      <legend className="eyebrow">{legend}</legend>
      <div className="segmented">
        {options.map((option) => (
          <label className="segment" key={option.value}>
            <input
              type="radio"
              id={`${name}-${option.value}`}
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
      {children}
    </fieldset>
  )
}

/** The keyboard on the radio of `value` in the group `name`. */
export function focusChoice(name: string, value: string): void {
  document.getElementById(`${name}-${value}`)?.focus()
}
