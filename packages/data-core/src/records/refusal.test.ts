import { describe, expect, test } from 'vitest'
import { deploymentRefusal, REFUSAL_LONGEST, REFUSAL_PREFIX } from './refusal.js'

/** A whole message of exactly `length` code units, the prefix included. */
const ofLength = (length: number): string => `${REFUSAL_PREFIX}${'x'.repeat(length - REFUSAL_PREFIX.length)}`

describe('deploymentRefusal (0156)', () => {
  // The prefix is the deployment's opt-in. A message that only resembles it
  // -- another case, no space, a trigger that happens to start with
  // "formancy" -- would put text nobody meant for a person in front of one,
  // and would change what an existing trigger's error says.
  test('reads the reason after the exact prefix, and nothing that only resembles it', () => {
    expect(deploymentRefusal('formancy: refused: The books for this period are closed.')).toEqual({
      kind: 'declined',
      reason: 'The books for this period are closed.',
    })
    for (const message of [
      'The books for this period are closed.',
      'Formancy: refused: closed',
      'formancy: refused:closed',
      'formancy:refused: closed',
      'formancy: refused closed',
      ' formancy: refused: closed',
      'formancy: an INSTEAD OF trigger decides what this write stores',
    ]) {
      expect(deploymentRefusal(message), message).toEqual({ kind: 'none' })
    }
  })

  // The reason is the deployment's sentence as written: trimmed, quoted or
  // reworded, it would be a sentence nobody wrote.
  test('keeps the reason exactly as written, its spaces and punctuation included', () => {
    expect(deploymentRefusal('formancy: refused:  Zürich: «closed»  ')).toEqual({ kind: 'declined', reason: ' Zürich: «closed»  ' })
  })

  // A bracketed column puts the reason beside its field. The column is read
  // up to the first `]: `, so a reason may itself hold brackets.
  test('reads a column the refusal names, and the reason after it', () => {
    expect(deploymentRefusal('formancy: refused [note]: Notes are closed [until June].')).toEqual({
      kind: 'declined',
      reason: 'Notes are closed [until June].',
      column: 'note',
    })
    expect(deploymentRefusal('formancy: refused [order date]: Too late.')).toEqual({ kind: 'declined', reason: 'Too late.', column: 'order date' })
  })

  // Fail closed on shape: a message that would be cut, would break the line
  // it is shown on, or says nothing, is the engine's ordinary refusal in the
  // server's own words. A cut sentence can say the opposite of the whole one.
  test('passes on no message longer than SQL Server carries uncut, with a control character, or with no reason', () => {
    expect(deploymentRefusal(ofLength(REFUSAL_LONGEST))).toEqual({ kind: 'declined', reason: 'x'.repeat(REFUSAL_LONGEST - REFUSAL_PREFIX.length) })
    expect(deploymentRefusal(ofLength(REFUSAL_LONGEST + 1))).toEqual({ kind: 'unshaped', why: 'too long' })
    expect(deploymentRefusal(`formancy: refused [n]: ${'x'.repeat(REFUSAL_LONGEST)}`)).toEqual({ kind: 'unshaped', why: 'too long' })
    for (const control of ['\n', '\r', '\t', '\u0000', '\u001b', '\u007f', '\u0085']) {
      expect(deploymentRefusal(`formancy: refused: one${control}two`), JSON.stringify(control)).toEqual({ kind: 'unshaped', why: 'a control character' })
    }
    expect(deploymentRefusal('formancy: refused [no\tte]: closed')).toEqual({ kind: 'unshaped', why: 'a control character' })
    expect(deploymentRefusal('formancy: refused: ')).toEqual({ kind: 'unshaped', why: 'no reason' })
    expect(deploymentRefusal('formancy: refused:    ')).toEqual({ kind: 'unshaped', why: 'no reason' })
    expect(deploymentRefusal('formancy: refused [note]: ')).toEqual({ kind: 'unshaped', why: 'no reason' })
    expect(deploymentRefusal('formancy: refused [note] closed')).toEqual({ kind: 'unshaped', why: 'an unclosed column' })
    expect(deploymentRefusal('formancy: refused []: closed')).toEqual({ kind: 'unshaped', why: 'an empty column' })
  })

  // Counted as SQL Server's nvarchar counts, in UTF-16 code units: a
  // character past the Basic Multilingual Plane is two, so a reason of them
  // is held to the same bound THROW cuts at.
  test('counts a character past the Basic Multilingual Plane as two', () => {
    const pairs = '😀'.repeat(Math.floor((REFUSAL_LONGEST - REFUSAL_PREFIX.length) / 2))
    expect(deploymentRefusal(`${REFUSAL_PREFIX}${pairs}`)).toMatchObject({ kind: 'declined' })
    expect(deploymentRefusal(`${REFUSAL_PREFIX}${pairs}😀`)).toEqual({ kind: 'unshaped', why: 'too long' })
  })
})
