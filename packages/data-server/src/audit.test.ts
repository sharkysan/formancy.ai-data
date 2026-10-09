import type { FastifyBaseLogger } from 'fastify'
import { describe, expect, test } from 'vitest'
import type { AuditEvent } from './audit.js'
import { logAuditSink } from './audit.js'

describe('logAuditSink', () => {
  // The default trail is a structured log line an operator's collector can
  // pick out by its message and field, one per event, carrying the event as is.
  test('writes each event as one structured info line', async () => {
    const lines: Array<{ fields: unknown; message: unknown }> = []
    const log = { info: (fields: unknown, message: unknown) => lines.push({ fields, message }) } as unknown as FastifyBaseLogger
    const event: AuditEvent = { at: 't', actor: 'a', operation: 'read', form: 'f', formVersion: 1, status: 200, outcome: 'ok', record: null }
    await logAuditSink(log)(event)
    expect(lines).toEqual([{ fields: { audit: event }, message: 'audit' }])
  })
})
