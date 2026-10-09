import type { FastifyBaseLogger } from 'fastify'
import { describe, expect, test } from 'vitest'
import type { AuditEvent } from './audit.js'
import { logAuditSink } from './audit.js'

describe('logAuditSink', () => {
  // The default trail is a structured log line an operator's collector can
  // pick out by its message and field, one per event, carrying the event as
  // is -- for both planes alike, so the collector tells them apart by
  // `audit.plane` and by nothing the sink adds or drops (0033).
  test('writes each event as one structured info line, on either plane', async () => {
    const lines: Array<{ fields: unknown; message: unknown }> = []
    const log = { info: (fields: unknown, message: unknown) => lines.push({ fields, message }) } as unknown as FastifyBaseLogger
    const runtime: AuditEvent = { at: 't', plane: 'runtime', actor: 'a', operation: 'read', form: 'f', formVersion: 1, status: 200, outcome: 'ok', record: null }
    const admin: AuditEvent = { at: 't', plane: 'admin', actor: 'a', operation: 'publish', connection: 'erp', form: 'f', formVersion: 2, expectedBase: 1, restoredFrom: null, status: 201, outcome: 'ok' }
    await logAuditSink(log)(runtime)
    await logAuditSink(log)(admin)
    expect(lines).toEqual([{ fields: { audit: runtime }, message: 'audit' }, { fields: { audit: admin }, message: 'audit' }])
  })
})
