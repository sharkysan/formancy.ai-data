import type { PublishedForm } from '@formancy/data-client'

/** What each operation is called on its tag. */
const TAGS: Readonly<Record<string, string>> = { read: 'Read', create: 'Create', update: 'Update' }

/**
 * The open form's tags of what this person may do with it, in the server's
 * order (UX-SPEC §5.6). A delete is offered by the server since 0050, and the
 * page deletes nothing until the workspace's confirmation in place (0053):
 * until then it is left out, or the header would say "Delete" with no way
 * to. Any other operation is tagged in the server's own word.
 */
export function operationTags(operations: PublishedForm['operations']): string[] {
  return operations.filter((operation) => operation !== 'delete').map((operation) => TAGS[operation] ?? operation)
}
