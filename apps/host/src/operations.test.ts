import { describe, expect, test } from 'vitest'
import { operationTags } from './operations.js'

/*
 * What the open form's header says a person may do with it, from the
 * server's `operations` (0029, 0047). The page has no control for a delete
 * yet: the workspace's confirmation comes with 0053. Tagged anyway, "Delete"
 * would promise a control the page does not have.
 */
describe('the tags of what a person may do', () => {
  // Watched failing with the server's operations tagged as they came: "Read, Create, Update, delete", the last in the server's own word, since the page has none for it.
  test('tag read, create and update in the server’s order, and leave delete out until the page can delete', () => {
    expect(operationTags(['read', 'create', 'update', 'delete'])).toEqual(['Read', 'Create', 'Update'])
    expect(operationTags(['read', 'delete'])).toEqual(['Read'])
    expect(operationTags(['read', 'update'])).toEqual(['Read', 'Update'])
    expect(operationTags([])).toEqual([])
  })
})
