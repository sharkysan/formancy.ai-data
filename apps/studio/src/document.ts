import { useCallback, useSyncExternalStore } from 'react'
import type { BuilderSession } from '@formancy/builder-core'
import type { FormSchema } from '@formancy/spec'

/**
 * The document a builder session holds, as React state.
 *
 * The session notifies once per accepted command and returns the same frozen
 * object between them, which is exactly what `useSyncExternalStore` needs.
 */
export function useDocument(session: BuilderSession): FormSchema {
  const subscribe = useCallback((listener: () => void) => session.subscribe(listener), [session])
  return useSyncExternalStore(subscribe, () => session.document())
}

/** A field's label as a person reads it, or its key when it has none. */
export function labelOf(document: FormSchema, key: string): string {
  const label = document.model.fields.find((field) => field.key === key)?.label
  return typeof label === 'string' && label !== '' ? label : key
}
