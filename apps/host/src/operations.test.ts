import { describe, expect, test } from 'vitest'
import { operationTags } from './operations.js'

/*
 * What the open form's header says a person may do with it, from the
 * server's `operations` (0029, 0047). Since 0053 the page has a control for
 * every operation the server offers, a delete's confirmation in place
 * included, so every one is tagged: a tag left out would hide a grant the
 * page acts on.
 */
describe('the tags of what a person may do', () => {
  // Watched failing with 0050's filter kept: "Read, Create, Update" over a form whose detail and rows offer Delete.
  test('tag every operation the server offers, delete included, in its order', () => {
    expect(operationTags(['read', 'create', 'update', 'delete'])).toEqual(['Read', 'Create', 'Update', 'Delete'])
    expect(operationTags(['read', 'delete'])).toEqual(['Read', 'Delete'])
    expect(operationTags(['read', 'update'])).toEqual(['Read', 'Update'])
    expect(operationTags([])).toEqual([])
  })
})
