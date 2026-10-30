import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'
import type { DataClient, FormRecord, PublishedForm } from '@formancy/data-client'
import { LIST_PAGE_SIZE } from '@formancy/data-client'
import { recordName } from './crumbs.js'
import type { OpenHow } from './grid-options.js'
import { emptyLevelLine } from './tree-lines.js'

/*
 * A form that is its own child -- an employee and the employees whose
 * manager they are -- as a tree of its records (0110): its roots, the
 * records whose field names no record of it, and under each record the
 * records naming it, a level asked for when it is first expanded. Each
 * level is the form's own list (0044) with `parent` -- `{ field, record:
 * null }` for the roots -- a page at a time, the next asked for after the
 * last row it showed (0108) by a "More" item at the level's end.
 *
 * A WAI-ARIA tree: one item in the tab order, the arrows move and
 * expand, Enter opens the record and moves there, Space opens it beside,
 * as a grid's row does (0047). A record whose level holds none says so
 * once and is a leaf from then on. What a record is called is its crumb's
 * name (`crumbs.ts`), else its token.
 */

/** One record of the tree, and what is known below it. */
interface Node {
  record: string
  name: string
  /** Undefined until the level below is asked for. */
  below?: Level
  expanded: boolean
}

/** One level: its records in their order, and the cursor of the page after it, or null when none follows. */
interface Level {
  records: string[]
  next: string | null
}

/** An item as the arrows walk it: a record, or a level's "More". */
type Item =
  | { kind: 'record'; record: string; depth: number; parent: string | null; size: number; position: number }
  | { kind: 'more'; parent: string | null; depth: number; size: number; position: number }

const key = (item: Item): string => (item.kind === 'record' ? item.record : `more:${item.parent ?? ''}`)

/** The items the tree shows, in order: each record, then its expanded level's, then that level's "More". */
function visible(roots: Level, nodes: ReadonlyMap<string, Node>): Item[] {
  const items: Item[] = []
  const walk = (level: Level, parent: string | null, depth: number): void => {
    const size = level.records.length + (level.next === null ? 0 : 1)
    level.records.forEach((record, index) => {
      items.push({ kind: 'record', record, depth, parent, size, position: index + 1 })
      const node = nodes.get(record)
      if (node?.expanded === true && node.below !== undefined) walk(node.below, record, depth + 1)
    })
    if (level.next !== null) items.push({ kind: 'more', parent, depth, size, position: size })
  }
  walk(roots, null, 1)
  return items
}

export function RecordTree({
  client,
  formId,
  definition,
  field,
  labelledBy,
  openToken,
  onOpen,
}: {
  client: DataClient
  formId: string
  definition: PublishedForm
  /** The lookup field through which the form's records name their parent: the menu's child of the form itself. */
  field: string
  labelledBy: string
  openToken: string | null
  /** A record opened from the tree, and how; `back` gives the keyboard back to its item. */
  onOpen: (token: string, how: OpenHow, back: () => void) => void
}): ReactElement {
  const [roots, setRoots] = useState<Level | null>(null)
  const [nodes, setNodes] = useState<ReadonlyMap<string, Node>>(new Map())
  const [focused, setFocused] = useState<string | null>(null)
  const [line, setLine] = useState('Loading the records with no parent.')
  const items = useRef(new Map<string, HTMLLIElement>())

  const nameOf = (row: FormRecord): string => recordName(definition.form.model.fields, row.answers, field) ?? row.record ?? ''

  /** One page of a level: the records whose field names `parent`, or none; after `after`. */
  async function page(parent: string | null, after: string | null): Promise<{ rows: FormRecord[]; next: string | null } | { refused: string }> {
    const answer = await client.list(formId, { parent: { field, record: parent }, after, limit: LIST_PAGE_SIZE })
    if (!answer.ok) return { refused: answer.message }
    return { rows: answer.value.rows.filter((row) => row.record !== null), next: answer.value.next }
  }

  /** The rows of a page as nodes, kept beside those already known. */
  function known(rows: readonly FormRecord[]): void {
    setNodes((before) => {
      const after = new Map(before)
      for (const row of rows)
        if (!after.has(row.record as string)) after.set(row.record as string, { record: row.record as string, name: nameOf(row), expanded: false })
      return after
    })
  }

  useEffect(() => {
    let current = true
    void page(null, null).then((answer) => {
      if (!current) return
      if ('refused' in answer) return setLine(answer.refused)
      known(answer.rows)
      setRoots({ records: answer.rows.map((row) => row.record as string), next: answer.next })
      setFocused(answer.rows[0]?.record ?? null)
      setLine(answer.rows.length === 0 ? emptyLevelLine(definition, field, null) : '')
    })
    return () => {
      current = false
    }
    // Mounted again for another form or field.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- page, known and the definition are made from the client, the form and the field, and a form's view is mounted again whenever a form is opened, so none of them changes under the tree
  }, [client, formId, field])

  const shown = roots === null ? [] : visible(roots, nodes)

  function focus(item: Item | undefined): void {
    if (item === undefined) return
    setFocused(key(item))
    items.current.get(key(item))?.focus()
  }

  async function expand(record: string): Promise<void> {
    const node = nodes.get(record)
    if (node === undefined) return
    if (node.below !== undefined) return setNodes((before) => new Map(before).set(record, { ...node, expanded: true }))
    const answer = await page(record, null)
    if ('refused' in answer) return setLine(answer.refused)
    known(answer.rows)
    setNodes((before) =>
      new Map(before).set(record, { ...node, expanded: true, below: { records: answer.rows.map((row) => row.record as string), next: answer.next } }),
    )
    setLine(answer.rows.length === 0 ? emptyLevelLine(definition, field, node.name) : '')
  }

  function collapse(record: string): void {
    const node = nodes.get(record)
    if (node !== undefined) setNodes((before) => new Map(before).set(record, { ...node, expanded: false }))
  }

  /** The next page of a level, after the last record it showed. */
  async function more(parent: string | null): Promise<void> {
    const level = parent === null ? roots : nodes.get(parent)?.below
    if (level === undefined || level === null || level.next === null) return
    const answer = await page(parent, level.next)
    if ('refused' in answer) return setLine(answer.refused)
    known(answer.rows)
    const grown: Level = { records: [...level.records, ...answer.rows.map((row) => row.record as string)], next: answer.next }
    if (parent === null) setRoots(grown)
    else setNodes((before) => new Map(before).set(parent, { ...(before.get(parent) as Node), below: grown }))
    const first = answer.rows[0]?.record
    if (first !== undefined && first !== null) {
      setFocused(first)
      requestAnimationFrame(() => items.current.get(first)?.focus())
    }
  }

  function onKey(event: KeyboardEvent<HTMLLIElement>, item: Item, index: number): void {
    const node = item.kind === 'record' ? nodes.get(item.record) : undefined
    const leaf = node?.below !== undefined && node.below.records.length === 0 && node.below.next === null
    const handled = (): void => {
      event.preventDefault()
      event.stopPropagation()
    }
    switch (event.key) {
      case 'ArrowDown':
        handled()
        return focus(shown[index + 1])
      case 'ArrowUp':
        handled()
        return focus(shown[index - 1])
      case 'Home':
        handled()
        return focus(shown[0])
      case 'End':
        handled()
        return focus(shown[shown.length - 1])
      case 'ArrowRight':
        handled()
        if (item.kind !== 'record' || leaf) return
        if (node?.expanded !== true) return void expand(item.record)
        return focus(shown[index + 1])
      case 'ArrowLeft':
        handled()
        if (item.kind === 'record' && node?.expanded === true) return collapse(item.record)
        return focus(shown.find((each) => each.kind === 'record' && each.record === item.parent))
      case 'Enter':
      case ' ':
        handled()
        if (item.kind === 'more') return void more(item.parent)
        return onOpen(item.record, event.key === 'Enter' ? 'enter' : 'space', () => items.current.get(item.record)?.focus())
    }
  }

  /** The items of one level and those below them, as nested groups. */
  function levelOf(level: Level, parent: string | null): ReactElement[] {
    const elements: ReactElement[] = []
    for (const record of level.records) {
      const node = nodes.get(record)
      if (node === undefined) continue
      const index = shown.findIndex((item) => item.kind === 'record' && item.record === record)
      const item = shown[index] as Item
      const leaf = node.below !== undefined && node.below.records.length === 0 && node.below.next === null
      elements.push(
        <li
          key={record}
          role="treeitem"
          className="tree-item"
          // Named by its own name alone: from its content, an expanded item's name would hold every one below it.
          aria-labelledby={`${labelledBy}-tree-${record}`}
          aria-level={item.depth}
          aria-setsize={item.size}
          aria-posinset={item.position}
          aria-expanded={leaf ? undefined : node.expanded}
          aria-selected={openToken === record}
          tabIndex={focused === record ? 0 : -1}
          ref={(element) => {
            if (element === null) items.current.delete(record)
            else items.current.set(record, element)
          }}
          onKeyDown={(event) => onKey(event, item, index)}
          onFocus={(event) => {
            if (event.target === event.currentTarget) setFocused(record)
          }}
          onClick={(event) => {
            event.stopPropagation()
            setFocused(record)
            onOpen(record, 'click', () => items.current.get(record)?.focus())
          }}
        >
          <span className="tree-name" id={`${labelledBy}-tree-${record}`}>
            {node.name}
          </span>
          {node.expanded && node.below !== undefined && !leaf ? <ul role="group">{levelOf(node.below, record)}</ul> : null}
        </li>,
      )
    }
    if (level.next !== null) {
      const moreKey = `more:${parent ?? ''}`
      const index = shown.findIndex((item) => key(item) === moreKey)
      const item = shown[index] as Item
      elements.push(
        <li
          key={moreKey}
          role="treeitem"
          className="tree-item tree-more"
          aria-level={item.depth}
          aria-setsize={item.size}
          aria-posinset={item.position}
          tabIndex={focused === moreKey ? 0 : -1}
          ref={(element) => {
            if (element === null) items.current.delete(moreKey)
            else items.current.set(moreKey, element)
          }}
          onKeyDown={(event) => onKey(event, item, index)}
          onFocus={(event) => {
            if (event.target === event.currentTarget) setFocused(moreKey)
          }}
          onClick={(event) => {
            event.stopPropagation()
            void more(parent)
          }}
        >
          More records
        </li>,
      )
    }
    return elements
  }

  return (
    <div className="record-tree">
      {roots === null || roots.records.length === 0 ? null : (
        <ul role="tree" aria-labelledby={labelledBy} className="tree">
          {levelOf(roots, null)}
        </ul>
      )}
      <p role="status" className="status">
        {line}
      </p>
    </div>
  )
}
