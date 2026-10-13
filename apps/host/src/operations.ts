import type { PublishedForm } from '@formancy/data-client'

/** What each operation is called on its tag. */
const TAGS: Readonly<Record<string, string>> = { read: 'Read', create: 'Create', update: 'Update', delete: 'Delete' }

/**
 * The open form's tags of what this person may do with it, in the server's
 * order (UX-SPEC §5.6). Every operation the server offers has a control on
 * the page -- a delete its confirmation in place, from the detail and from
 * each row (0053) -- so every one is tagged. Any other operation is tagged in
 * the server's own word.
 */
export function operationTags(operations: PublishedForm['operations']): string[] {
  return operations.map((operation) => TAGS[operation] ?? operation)
}
