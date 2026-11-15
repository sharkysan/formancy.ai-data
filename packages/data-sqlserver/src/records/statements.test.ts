import { describe, expect, test } from 'vitest'
import * as statements from './statements.js'

/*
 * The numbers the write batches raise for themselves, as statements.ts
 * exports them. errors.ts answers each by its number and exact message, and
 * reads none of them as a deployment's reason for the person (0156): a
 * trigger may THROW one too, with the prefix, and is refused. That holds
 * only while OWN_NUMBERS names every one of them, a list written by hand
 * beside the constants; what a server does with one is
 * records-failures.integration.test.ts's.
 */

describe("the write batches' own error numbers", () => {
  // A number added to statements.ts and left out of OWN_NUMBERS would let a
  // trigger THROW it with `formancy: refused: ` and be declined, its words
  // in front of the person under a number the adapter answers by, and no
  // suite would notice: only 51706 is provoked with the prefix. Watched
  // failing with NEXT_NOT_INSERTED taken out of the list.
  test('are every user error number statements.ts exports, each once', () => {
    const exported = Object.values(statements as Record<string, unknown>)
      .filter((value): value is number => typeof value === 'number' && value >= 50000)
      .sort((a, b) => a - b)
    expect(exported.length).toBeGreaterThan(0)
    expect([...statements.OWN_NUMBERS].sort((a, b) => a - b)).toEqual(exported)
  })
})
