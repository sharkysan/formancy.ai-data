import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { CustomCellEditorProps } from 'ag-grid-react'
import { parsePath } from '@formancy/core'
import type { FormEngine } from '@formancy/core'
import { createFormText, errorSentence } from '@formancy/core/words'
import { resolvedLocale } from '@formancy/spec'
import type { GridRow } from './grid-datasource.js'
import type { CellEditor } from './grid-edit.js'

/*
 * The editors a record grid's cells are edited in (0179): native controls
 * of the page's own, through AG Grid's custom editor -- an input for text,
 * a number and a date, a checkbox, a select -- each writing what the
 * person types straight into the open record's form engine, so the row and
 * the record's form are one draft. AG Grid holds no value of its own: its
 * editor's value is never changed, and with `readOnlyEdit` it would write
 * none to the row if it were (grid-options.tsx).
 *
 * - **Its keys are its own.** Every key typed in an editor stops there, so
 *   AG Grid neither moves nor ends anything on one; Tab, Shift+Tab and
 *   Enter are handed to the page, which saves the row where they leave it
 *   (use-grid-edit.ts), and Escape puts back what the field held when the
 *   edit began and ends the edit, the row's other changes kept.
 * - **Its keyboard is its own** while it is open: the record's form's
 *   error summary, which focuses itself when a first problem appears --
 *   as a keystroke here can make one, after a save touched every field --
 *   gives it back, and AG Grid never hears it leave. A press on the
 *   summary's region itself, not one of its links, gives it back too.
 * - **Named for its field and record**: "Status, Order k1:9". Invalid --
 *   by the engine or by the server, once a save has said so -- it is
 *   `aria-invalid`, described by the form's own sentence for each problem,
 *   the renderers' words (formancy's `errorSentence`).
 * - **Styled by its own style attribute**, in the room's variables, as a
 *   row's box is (choose-column.tsx): no rule of the host's reaches into a
 *   grid (0047), and the cell's frame while it edits is the theme's
 *   (grid-theme.ts).
 * - **A number is its text** while it is typed: what the engine holds is
 *   what the renderers' number box gives -- no answer for nothing, else the
 *   number, which is not one for text that spells none. An exact decimal is
 *   a text field already, so its digits are never a JavaScript number.
 */

/** What an editor asks of the page, and tells it: implemented by use-grid-edit.ts over the open record's session. */
export interface CellEditing {
  /** The engine of the record the row is: the session the detail draws, while the open row is that record's; null otherwise. */
  engine(): FormEngine | null
  /** The editor a cell of the open row is edited in now, or null where it is not. */
  editorFor(field: string): CellEditor | null
  /** What an editor of `field` is named: its label, then the record's noun and token. */
  nameOf(field: string): string
  /** An answer of the editor's, into the engine. */
  put(field: string, value: unknown): void
  /** Tab, Shift+Tab, Enter or Escape in an editor of `field`. */
  key(field: string, key: EditKey): void
  /** An editor of `field` gone, however its edit ended. */
  closed(field: string): void
}

/** The keys an editor hands to the page: Tab, Shift+Tab, Enter and Escape. */
export type EditKey = 'next' | 'back' | 'end' | 'cancel'

/** The look of a text editor: the cell's own size, the room's ground and text, an edge the room draws; `--invalid` where it is. */
function look(invalid: boolean): CSSProperties {
  return {
    boxSizing: 'border-box',
    width: '100%',
    height: '100%',
    margin: 0,
    padding: '0 8px',
    font: 'inherit',
    color: 'var(--text)',
    background: 'var(--ground)',
    colorScheme: 'dark',
    border: invalid ? '2px solid var(--invalid)' : '1px solid var(--edge-strong)',
    borderRadius: '4px',
  }
}

/** The region a renderer's error summary focuses, in both renderers: the part a theme dresses it by. */
const SUMMARY = '[data-formancy-part="error-summary"]'

/** A checkbox: 24 pixels square, the least target WCAG 2.5.8 asks, in the violet a person acts with -- a row's box's look. */
const BOX_LOOK: CSSProperties = { width: '24px', height: '24px', margin: '6px 0 0', accentColor: 'var(--client)', cursor: 'pointer' }

/** What a field's answer is as an editor's text: a number's digits, a string as it is, nothing for none. */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

/** What an editor's text is as the field's answer, as the renderer's own control for its type would set it. */
function answerOf(editor: CellEditor, text: string): unknown {
  if (editor === 'number') return text.trim() === '' ? null : Number(text)
  if (editor === 'date' || editor === 'select') return text === '' ? null : text
  return text
}

/** The editor of one cell of the open row: AG Grid's custom editor, given the page's `edit` and the cell's field. */
export function CellEditorOf(props: CustomCellEditorProps<GridRow> & { edit: CellEditing; field: string }): ReactElement | null {
  const { edit, field } = props
  // The record's engine and the cell's editor, for the editor's life: a new record is a new edit.
  const [engine] = useState(() => edit.engine())
  const [editor] = useState(() => edit.editorFor(field))
  return engine === null || editor === null ? null : <Editor edit={edit} field={field} engine={engine} editor={editor} />
}

function Editor({ edit, field, engine, editor }: { edit: CellEditing; field: string; engine: FormEngine; editor: CellEditor }): ReactElement {
  const path = useMemo(() => parsePath(field), [field])
  const snapshot = useSyncExternalStore(
    (listener) => engine.subscribeField(path, listener),
    () => engine.getFieldSnapshot(path),
  )
  /** What the field held when the edit began: what Escape puts back. */
  const start = useRef(snapshot.value)
  const [text, setText] = useState(() => textOf(snapshot.value))
  const control = useRef<HTMLInputElement & HTMLSelectElement>(null)
  const id = useId()
  const text_ = useMemo(() => createFormText({ locale: resolvedLocale(engine.schema(), engine.locale()) }), [engine])
  const problems = snapshot.touched ? snapshot.errors.map((code) => errorSentence(text_, snapshot.def, code, snapshot.messages)) : []

  useEffect(() => {
    const element = control.current
    if (element === null) return undefined
    const onKey = (event: KeyboardEvent): void => {
      // Every key is the editor's: AG Grid hears none while it edits.
      event.stopPropagation()
      const key: EditKey | null =
        event.key === 'Tab' ? (event.shiftKey ? 'back' : 'next') : event.key === 'Enter' ? 'end' : event.key === 'Escape' ? 'cancel' : null
      if (key === null) return
      event.preventDefault()
      if (key === 'cancel') edit.put(field, start.current)
      edit.key(field, key)
    }
    const onLeave = (event: FocusEvent): void => {
      // The record's form's error summary focuses itself when its first problem appears, and a keystroke here can be what makes it --
      // after a save, which touches every field. AG Grid, which ends an edit whose cell loses the keyboard, never hears it go, and the
      // keyboard comes back here once the summary has taken it: this editor's description says the problem.
      if (!(event.relatedTarget instanceof Element) || !event.relatedTarget.matches(SUMMARY)) return
      event.stopPropagation()
      queueMicrotask(() => {
        if (element.isConnected) element.focus()
      })
    }
    element.addEventListener('keydown', onKey)
    element.addEventListener('focusout', onLeave)
    element.focus()
    return () => {
      element.removeEventListener('keydown', onKey)
      element.removeEventListener('focusout', onLeave)
      edit.closed(field)
    }
  }, [edit, field])

  const named = {
    'aria-label': edit.nameOf(field),
    'aria-invalid': problems.length > 0 ? ('true' as const) : undefined,
    'aria-describedby': problems.length > 0 ? `${id}-problems` : undefined,
  }
  const described =
    problems.length === 0 ? null : (
      <span id={`${id}-problems`} hidden>
        {problems.join(' ')}
      </span>
    )

  if (editor === 'checkbox')
    return (
      <>
        <input
          type="checkbox"
          ref={control}
          style={BOX_LOOK}
          {...named}
          checked={snapshot.value === true}
          onChange={(event) => edit.put(field, event.target.checked)}
        />
        {described}
      </>
    )
  if (editor === 'select') {
    const options = snapshot.def.options ?? []
    return (
      <>
        <select
          ref={control}
          style={look(problems.length > 0)}
          {...named}
          value={typeof snapshot.value === 'string' ? snapshot.value : ''}
          onChange={(event) => edit.put(field, answerOf('select', event.target.value))}
        >
          <option value="" />
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {engine.text(option.label) ?? option.value}
            </option>
          ))}
        </select>
        {described}
      </>
    )
  }
  return (
    <>
      <input
        type="text"
        ref={control}
        style={look(problems.length > 0)}
        {...named}
        autoComplete="off"
        spellCheck={false}
        inputMode={editor === 'number' ? 'decimal' : undefined}
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          edit.put(field, answerOf(editor, event.target.value))
        }}
      />
      {described}
    </>
  )
}
