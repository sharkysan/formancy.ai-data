import { useCallback, useMemo, useState } from 'react'
import type { ReactElement, RefObject } from 'react'
import { CHOICES } from './panes.js'
import { browserStorage, readDemo, writeDemo } from './prefs.js'
import type { RendererChoice } from './prefs.js'
import { RecordBar } from './record-bar.js'
import { Segmented } from './segmented.js'

/**
 * The demo's controls (0146): the renderer switch -- React, Angular or both
 * side by side (0047) -- and opening a record by its token (record-bar.tsx),
 * which show what the module does and are not what a person works with. One
 * disclosure at the end of the record's header holds them, a button that
 * says whether it is expanded, the ARIA pattern, as Open by record token's
 * was before them: closed until the viewer opens it, and then as they left
 * it (`useDemo`). Closed, nothing in it is in the accessibility tree or the
 * Tab order; the renderer chosen is drawn all the same, since the choice is
 * the workspace's and only its switch is here.
 */
export function DemoTools({
  formId,
  open,
  onToggle,
  renderer,
  onRenderer,
  refusal,
  loadRef,
  onLoad,
}: {
  formId: string
  open: boolean
  onToggle: (open: boolean) => void
  renderer: RendererChoice
  onRenderer: (choice: RendererChoice) => void
  /** The server's sentence for the last Load. */
  refusal: string | null
  loadRef: RefObject<HTMLButtonElement | null>
  onLoad: (token: string) => void
}): ReactElement {
  return (
    <div className="demo-tools">
      <button type="button" className="button quiet disclosure" aria-expanded={open} aria-controls="demo-panel" onClick={() => onToggle(!open)}>
        <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 12 12">
          <path d={open ? 'M2 4l4 4 4-4' : 'M4 2l4 4-4 4'} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        For the demo
      </button>
      <div id="demo-panel" className="demo-panel" hidden={!open}>
        <Segmented legend="Renderer" name={`renderer-${formId}`} className="renderer" options={CHOICES} value={renderer} onChange={onRenderer} />
        <RecordBar refusal={refusal} loadRef={loadRef} onLoad={onLoad} />
      </div>
    </div>
  )
}

/** Whether the demo's controls are shown; the viewer's choice, which is kept; and the page's showing them, which is not. */
export interface Demo {
  open: boolean
  choose: (open: boolean) => void
  reveal: () => void
}

/**
 * The demo's controls as this viewer left them (prefs.ts). The viewer's
 * opening or closing is kept; the page's showing them for a refused Load is
 * not, since the viewer did not choose it, and the next page opens them as
 * the viewer left them.
 */
export function useDemo(): Demo {
  const storage = useMemo(browserStorage, [])
  const [open, setOpen] = useState(() => readDemo(storage))
  const choose = useCallback(
    (next: boolean) => {
      setOpen(next)
      writeDemo(storage, next)
    },
    [storage],
  )
  const reveal = useCallback(() => setOpen(true), [])
  return useMemo(() => ({ open, choose, reveal }), [open, choose, reveal])
}
