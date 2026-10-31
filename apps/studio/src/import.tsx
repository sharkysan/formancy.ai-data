import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ReactElement } from 'react'
import { describeReassigned } from '@formancy/data-core'
import type { DriftChange, DriftReport, ReassignedKey } from '@formancy/data-core'
import type { PublishedBundle } from '@formancy/data-server'
import type { AdminClient, Failure, Published } from './api.js'
import { describeRef, isFormId } from './choice.js'
import { Change, Changes } from './drift-change.js'
import { useFocusAfterRender } from './focus.js'

/** What sending a file came to: a version imported, or under review a draft submitted (0065), with the drift that let it through. */
type Sent = Failure | { ok: true; drift: DriftReport; version: number } | { ok: true; drift: DriftReport; draft: number }

/** The import button's id, for the keyboard to return to when the keys' confirmation closes. */
const IMPORT = 'import-version'

/** A chosen file that names a form to import into: the studio reads no more of it than it says. */
interface VersionFile {
  formId: string
  /** The file as it was parsed, sent as it is: the server checks it, not the studio. */
  bundle: unknown
  /** The file in one line, as a version is described elsewhere in the studio. */
  described: string
}

type Chosen =
  | { state: 'not-a-version-file'; message: string }
  | { state: 'reading'; file: VersionFile }
  /** `newest`: this deployment's newest version of the form, the base the import names; `null` for none. */
  | { state: 'read'; file: VersionFile; newest: number | null }
  | { state: 'failed'; file: VersionFile; message: string }

type Imported =
  | { kind: 'imported'; formId: string; version: number; drift: DriftReport; published: Published }
  /** Under review (0065): the file submitted as a draft, and the drift the server let it through with. */
  | { kind: 'submitted'; formId: string; draft: number; drift: DriftReport; published: Published }
  | { kind: 'incompatible'; message: string; changes: DriftChange[]; published: Published }
  | { kind: 'keys'; message: string; keys: ReassignedKey[] }
  | { kind: 'conflict'; formId: string; current: number | null }
  | { kind: 'refused'; message: string; problems: string[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * What a chosen file is, read only as far as naming the form it would be
 * imported into and describing it: everything else about it is the server's
 * to check (0019, 0030). A file that is not JSON, or names no form id, no
 * connection or no bound table, is not a version file, and the studio says so
 * without sending it -- it could only ask about a form id it made up.
 */
export function readVersionFile(name: string, text: string): { ok: true; file: VersionFile } | { ok: false; message: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, message: `${name} is not a version file: it is not JSON. Nothing was sent.` }
  }
  const form = isRecord(parsed) ? parsed['form'] : undefined
  const model = isRecord(form) ? form['model'] : undefined
  const bindings = isRecord(parsed) ? parsed['bindings'] : undefined
  const root = isRecord(bindings) ? bindings['root'] : undefined
  const connection = isRecord(parsed) ? parsed['connection'] : undefined
  if (
    !isRecord(form) ||
    typeof form['id'] !== 'string' ||
    !isFormId(form['id']) ||
    !isRecord(model) ||
    !Array.isArray(model['fields']) ||
    typeof connection !== 'string' ||
    !isRecord(root) ||
    typeof root['schema'] !== 'string' ||
    typeof root['name'] !== 'string'
  ) {
    return { ok: false, message: `${name} is not a version file: it names no form, connection or bound table. Nothing was sent.` }
  }
  const formId = form['id']
  const title = typeof form['title'] === 'string' ? form['title'] : formId
  const fields = model['fields'].length
  const table = describeRef({ schema: root['schema'], name: root['name'] })
  return {
    ok: true,
    file: {
      formId,
      bundle: parsed,
      described: `${formId} version file: “${title}”, ${String(fields)} ${fields === 1 ? 'field' : 'fields'}, bound to ${table} on ${connection}.`,
    },
  }
}

/**
 * Import a version another deployment published (0062): the file its
 * studio downloads, written here as the next version of the form it names.
 * The server checks it as it checks a publish -- it validates, its
 * connection's name is one this allowlist has, this server's generator
 * writes its base -- and gates it on this deployment's database as it gates
 * a restore: refused for another engine or a change that blocks, with the
 * changes to review returned. The file keeps its form id and its
 * connection's name; nothing is mapped.
 *
 * The import names the newest version here, read when the file is chosen,
 * so one published since is a conflict, not a version written over. Keys
 * that stand for something else here than in that version are listed in
 * the server's words and confirmed exactly as the server listed them
 * (0039). Pressing a button that stays keeps the keyboard on it; the
 * confirmation, which closes, sends it back to the import button.
 *
 * Under review (0065) -- `review`, the server's sentence for it -- the file
 * is submitted as a draft instead, sent as it was read, over the same base
 * and checked the same way, for a publisher other than its submitter to
 * approve. Nothing is written to the versions, so the step is not told of
 * a version and the base stays the one read.
 */
export function ImportPanel({
  client,
  written = 0,
  review = null,
  onImported,
}: {
  client: AdminClient
  /** Changes when the step wrote a version itself -- a restore -- so the newest version the import names is read again. */
  written?: number
  /** Under review, the server's sentence for why the file is submitted as a draft (`reviewedBy`); `null` where it is imported. */
  review?: string | null
  onImported: (formId: string) => void
}): ReactElement {
  const [chosen, setChosen] = useState<Chosen | null>(null)
  const [pending, setPending] = useState(false)
  const [imported, setImported] = useState<Imported | null>(null)
  // The newest file chosen: an answer about one chosen before it is not shown.
  const choice = useRef(0)
  const focusAfter = useFocusAfterRender()

  async function readNewest(file: VersionFile, asked: number): Promise<void> {
    const listed = await client.versions(file.formId)
    if (asked !== choice.current) return
    if (listed.ok) setChosen({ state: 'read', file, newest: listed.value.at(-1) ?? null })
    // No version of the form here yet: the import is its first.
    else if (listed.code === 'unknown-form') setChosen({ state: 'read', file, newest: null })
    else setChosen({ state: 'failed', file, message: listed.message })
  }

  // A version written on the step since the file was chosen moves the base
  // an import names; one it named before would be refused as a conflict.
  // Only a write is a reason to read again: a file is read when it is chosen.
  const file = chosen === null || chosen.state === 'not-a-version-file' ? null : chosen.file
  useEffect(() => {
    if (written !== 0 && file !== null) void readNewest(file, choice.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a write on the step is a reason to read again; a file is read when it is chosen, and the render that saw the write reads the current file
  }, [written])

  async function choose(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const picked = event.target.files?.[0]
    const asked = (choice.current += 1)
    setImported(null)
    if (picked === undefined) {
      setChosen(null)
      return
    }
    const text = await picked.text()
    if (asked !== choice.current) return
    const read = readVersionFile(picked.name, text)
    if (!read.ok) {
      setChosen({ state: 'not-a-version-file', message: read.message })
      return
    }
    setChosen({ state: 'reading', file: read.file })
    await readNewest(read.file, asked)
  }

  /** The file sent: imported as a version, or under review submitted as a draft. */
  async function send(file: VersionFile, newest: number | null, keysConfirmed: readonly ReassignedKey[] | undefined): Promise<Sent> {
    if (review === null) {
      const outcome = await client.importVersion(file.formId, newest, file.bundle, keysConfirmed)
      return outcome.ok ? { ok: true, drift: outcome.value.drift, version: outcome.value.version } : outcome
    }
    const outcome = await client.submitDraft(file.formId, newest, file.bundle, keysConfirmed)
    return outcome.ok ? { ok: true, drift: outcome.value.drift, draft: outcome.value.draft } : outcome
  }

  async function importFile(keysConfirmed?: readonly ReassignedKey[]): Promise<void> {
    // A second press while the first is on its way does nothing; the button stays enabled, so it keeps the keyboard.
    if (pending || chosen?.state !== 'read') return
    const { file, newest } = chosen
    const asked = choice.current
    setPending(true)
    setImported(null)
    const outcome = await send(file, newest, keysConfirmed)
    if (asked !== choice.current) {
      // Another file was chosen meanwhile: this answer is about one nobody has
      // chosen any more, and its keys are not that file's to confirm. A
      // version it wrote is still news to the step.
      setPending(false)
      if (outcome.ok && 'version' in outcome) onImported(file.formId)
      return
    }
    // Validated by the server before it answered anything but a refusal of the file itself.
    const published: Published = { version: newest ?? 0, bundle: file.bundle as PublishedBundle }
    if (outcome.ok && 'version' in outcome) {
      setImported({
        kind: 'imported',
        formId: file.formId,
        version: outcome.version,
        drift: outcome.drift,
        published: { ...published, version: outcome.version },
      })
      await readNewest(file, asked)
      onImported(file.formId)
    } else if (outcome.ok) {
      // A draft: no version was written, so nothing is read again and the step is told nothing.
      setImported({ kind: 'submitted', formId: file.formId, draft: outcome.draft, drift: outcome.drift, published })
    } else if (outcome.code === 'incompatible') {
      setImported({ kind: 'incompatible', message: outcome.message, changes: outcome.changes ?? [], published })
    } else if (outcome.code === 'keys-reassigned') {
      setImported({ kind: 'keys', message: outcome.message, keys: outcome.keys ?? [] })
    } else if (outcome.code === 'conflict') {
      setImported({ kind: 'conflict', formId: file.formId, current: outcome.current ?? null })
      await readNewest(file, asked)
    } else {
      setImported({ kind: 'refused', message: outcome.message, problems: outcome.problems ?? [] })
    }
    setPending(false)
    if (keysConfirmed !== undefined) focusAfter(IMPORT)
  }

  return (
    <section className="versions import" aria-labelledby="import-heading">
      <h3 id="import-heading">Import a version</h3>
      <p className="hint">
        A version file is one version as a studio downloads it, from this deployment or another. It keeps its form id and its connection&rsquo;s name, which
        this deployment&rsquo;s allowlist resolves to its own database. The server checks it as it checks a publish, and against this database as it checks a
        restore.
      </p>
      {review === null ? null : <p className="reviewed">{review}</p>}
      <div className="field">
        <label htmlFor="import-file">Version file</label>
        <input id="import-file" type="file" accept=".json,application/json" onChange={(event) => void choose(event)} />
      </div>
      {chosen?.state === 'not-a-version-file' ? (
        <p role="alert" className="problem-box">
          {chosen.message}
        </p>
      ) : null}
      {file === null ? null : <p className="described">{file.described}</p>}
      {chosen?.state === 'reading' ? <p>Reading which versions of {chosen.file.formId} are published here…</p> : null}
      {chosen?.state === 'failed' ? <p className="problem-box">{chosen.message}</p> : null}
      {chosen?.state === 'read' ? (
        <p className="next">
          <button type="button" id={IMPORT} className="button" onClick={() => void importFile()}>
            {review === null ? `Import as version ${String((chosen.newest ?? 0) + 1)}` : 'Submit as a draft'}
          </button>
        </p>
      ) : null}
      {imported === null ? null : <ImportOutcome imported={imported} reviewed={review !== null} onConfirm={(keys) => void importFile(keys)} />}
    </section>
  )
}

/** What the drift a file was let through with says, as an import and a draft of one both show it. */
function Differs({ imported }: { imported: Extract<Imported, { drift: DriftReport }> }): ReactElement | null {
  return (
    <Changes
      changes={imported.drift.changes}
      published={imported.published}
      id="import-differs"
      heading="What differs here, and blocks nothing"
      level="h4"
      none="Nothing it rests on differs between this database and the one it was published from."
    />
  )
}

/** What the server answered an import, each answer as the step shows its kind elsewhere. */
function ImportOutcome({
  imported,
  reviewed,
  onConfirm,
}: {
  imported: Imported
  reviewed: boolean
  onConfirm: (keys: readonly ReassignedKey[]) => void
}): ReactElement {
  if (imported.kind === 'imported') {
    return (
      <>
        <p role="status" className="done">
          Imported as version {imported.version} of {imported.formId}: the runtime here serves it from now on, with the policy and the snapshot it was published
          with. The database was not changed.
        </p>
        <Differs imported={imported} />
      </>
    )
  }
  if (imported.kind === 'submitted') {
    return (
      <>
        <p role="status" className="done">
          Draft {imported.draft} of {imported.formId} submitted: a publisher other than you approves it.
        </p>
        <Differs imported={imported} />
      </>
    )
  }
  if (imported.kind === 'incompatible') {
    return (
      <div role="alert" className="problem-box">
        <p>{imported.message}</p>
        <h4 id="import-blocks">What blocks it</h4>
        <ul aria-labelledby="import-blocks">
          {imported.changes.map((change, index) => (
            <Change key={index} change={change} published={imported.published} />
          ))}
        </ul>
      </div>
    )
  }
  if (imported.kind === 'keys') {
    return (
      <div role="alert" className="problem-box">
        <p>{imported.message}</p>
        <h4 id="import-keys">Keys that stand for something else here</h4>
        <ul aria-labelledby="import-keys">
          {imported.keys.map((key) => (
            <li key={key.field}>{describeReassigned(key)}</li>
          ))}
        </ul>
        <button type="button" className="button" onClick={() => onConfirm(imported.keys)}>
          {reviewed ? 'Confirm these keys and submit' : 'Confirm these keys and import'}
        </button>
      </div>
    )
  }
  if (imported.kind === 'conflict') {
    const current = imported.current
    const next = (current ?? 0) + 1
    return (
      <p role="alert" className="problem-box">
        Somebody published {current === null ? 'a version' : `version ${String(current)}`} of {imported.formId} here since its versions were read.{' '}
        {reviewed
          ? `Nothing was submitted; a draft submitted now, once approved, makes version ${String(next)}.`
          : `Nothing was imported; importing now makes version ${String(next)}.`}
      </p>
    )
  }
  return (
    <div role="alert" className="problem-box">
      <p>{imported.message}</p>
      {imported.problems.length === 0 ? null : (
        <ul>
          {imported.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
