import { useContext, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { exportFileName } from '@formancy/data-client'
import type { DataClient, RecordExportQuery } from '@formancy/data-client'
import { SaveContext } from './save-file.js'

/** Where a file is: not asked for, being made, made and handed to the browser, or refused in the server's words. */
type FileState = { kind: 'idle' } | { kind: 'making' } | { kind: 'made' } | { kind: 'refused'; message: string }

/** The line's colour for each state, as a grid's line has it: muted while asking, the server's teal for an answer, `--warn` for a refusal. */
const KIND = { idle: 'answer', making: 'loading', made: 'answer', refused: 'refused' } as const

/**
 * Download CSV (0080), in a section's head after New: one CSV file of every
 * record the section's grid would page through, made by the server
 * (`records/export`, 0079) and saved by the browser.
 *
 * `query` is asked when the button is pressed: the search as submitted, the
 * grid's sort -- the last its datasource asked with -- and a child's parent,
 * so the file is of the records the grid shows. Not a link: the token is in
 * the Authorization header and nowhere else (0029), so the page fetches the
 * file and hands the browser its bytes (save-file.ts).
 *
 * While the file is made the button is `aria-disabled`, never `disabled`,
 * which would drop the keyboard (0029), and a press sends nothing; its line,
 * a status the button names and is described by, says what is happening,
 * on a row of its own under the head, and is out of the flow while it has
 * nothing to say.
 * Pressing again after a refusal is the retry. The section leaving the page
 * -- another form, signing out, a child section's other parent -- aborts a
 * file in the making and says nothing: there is nobody left to tell.
 */
export function DownloadCsv({ client, formId, idBase, query }: { client: DataClient; formId: string; idBase: string; query: () => RecordExportQuery }): ReactElement {
  const save = useContext(SaveContext)
  const [state, setState] = useState<FileState>({ kind: 'idle' })
  const running = useRef<AbortController | null>(null)
  useEffect(() => () => running.current?.abort(), [])
  const name = exportFileName(formId)

  function press(): void {
    if (running.current !== null) return
    const controller = new AbortController()
    running.current = controller
    setState({ kind: 'making' })
    client.exportRecords(formId, query(), controller.signal).then(
      (answer) => {
        if (controller.signal.aborted) return
        running.current = null
        if (!answer.ok) {
          setState({ kind: 'refused', message: answer.message })
          return
        }
        save(answer.value.file, answer.value.name)
        setState({ kind: 'made' })
      },
      // Only the abort above rejects: the section has left the page.
      () => undefined,
    )
  }

  const said = state.kind === 'making' ? `Making ${name}.` : state.kind === 'made' ? `Made ${name}; your browser saves it.` : state.kind === 'refused' ? state.message : ''
  return (
    <>
      <button type="button" className="button" id={`${idBase}-button`} aria-disabled={state.kind === 'making' ? 'true' : undefined} aria-describedby={`${idBase}-line`} onClick={press}>
        Download CSV
      </button>
      <p role="status" id={`${idBase}-line`} className="status export-line" data-kind={KIND[state.kind]} aria-labelledby={`${idBase}-button`}>
        {said}
      </p>
    </>
  )
}
