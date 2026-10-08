import { createSnapshot } from '@formancy/data-core'
import type { MetadataSnapshot } from '@formancy/data-core'
import captured from './fixture-snapshot.json'

/**
 * A snapshot read from a file, checked before anything is generated from it.
 *
 * The fingerprint is recomputed over the contents with `createSnapshot`, the
 * one way a snapshot is made (0004), and a file whose contents do not hash to
 * the fingerprint it carries is refused: it was edited after it was captured,
 * and a form generated from it would describe a database that does not exist.
 * The server reads a published bundle the same way (0019).
 *
 * Returns the recomputed snapshot rather than the file's, so what the page
 * generates from is canonical whatever the file's key order.
 */
export function readSnapshot(raw: unknown): MetadataSnapshot {
  const { fingerprint, ...contents } = raw as MetadataSnapshot
  const recomputed = createSnapshot(contents)
  if (recomputed.fingerprint !== fingerprint) {
    throw new Error(
      `The snapshot's fingerprint is ${String(fingerprint)}, and its contents hash to ${recomputed.fingerprint}: it was edited after it was captured. Run scripts/capture-snapshot.mjs again.`,
    )
  }
  return recomputed
}

/**
 * The shared fixture (0005), discovered on PostgreSQL by its owner and
 * committed by `scripts/capture-snapshot.mjs`. Everything on the page is
 * generated from this, in the browser.
 */
export const FIXTURE_SNAPSHOT: MetadataSnapshot = readSnapshot(captured)
