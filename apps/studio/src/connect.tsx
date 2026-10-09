import { useState } from 'react'
import type { ReactElement } from 'react'
import type { MetadataSnapshot, ServerIdentity } from '@formancy/data-core'
import type { AdminClient, Outcome } from './api.js'
import { ENGINE_NAMES, MetadataView } from './metadata.js'

type Tested = Outcome<ServerIdentity> | 'testing'

/**
 * Step 2: the connections the deployment allows, a test of each, and what
 * one of them can see.
 *
 * The list is the server's allowlist and nothing else: a connection is
 * configured by the operator in a reviewed file, with a secret reference
 * rather than a password (0014), and the studio has no way to add one. A
 * failure says that the database did not answer, never why in the driver's
 * words -- those name hosts and ports, and the server keeps them in its log.
 */
export function ConnectStep({
  client,
  connections,
  discovered,
  onDiscovered,
  onChoose,
}: {
  client: AdminClient
  connections: readonly string[]
  discovered: { connection: string; snapshot: MetadataSnapshot } | null
  onDiscovered: (connection: string, snapshot: MetadataSnapshot) => void
  onChoose: () => void
}): ReactElement {
  const [tested, setTested] = useState<Record<string, Tested>>({})
  const [discovering, setDiscovering] = useState<string | null>(null)
  const [refused, setRefused] = useState<{ connection: string; message: string } | null>(null)

  // A press while the last one is on its way does nothing. The buttons are
  // not disabled for it: a disabled button drops the keyboard's focus.
  async function test(connection: string): Promise<void> {
    if (tested[connection] === 'testing') return
    setTested((before) => ({ ...before, [connection]: 'testing' }))
    const outcome = await client.test(connection)
    setTested((before) => ({ ...before, [connection]: outcome }))
  }

  async function discover(connection: string): Promise<void> {
    if (discovering !== null) return
    setDiscovering(connection)
    setRefused(null)
    const outcome = await client.metadata(connection)
    setDiscovering(null)
    if (outcome.ok) onDiscovered(connection, outcome.value)
    else setRefused({ connection, message: outcome.message })
  }

  return (
    <>
      <p className="lede">
        The databases this deployment allows forms to bind to, as the server&rsquo;s connections file names them. Test one
        to see what answers; discover it to see what it can see, and what it cannot.
      </p>
      {connections.length === 0 ? (
        <p className="none">The server allows no connection: its connections file lists none.</p>
      ) : (
        <ul className="connections">
          {connections.map((connection) => {
            const result = tested[connection]
            return (
              <li key={connection}>
                <div role="group" aria-labelledby={`connection-${connection}`} className="connection">
                  <h3 id={`connection-${connection}`}>
                    <code>{connection}</code>
                  </h3>
                  <div className="actions">
                    <button type="button" className="button" onClick={() => void test(connection)}>
                      Test{' '}<span className="visually-hidden">{connection}</span>
                    </button>
                    <button type="button" className="button" onClick={() => void discover(connection)}>
                      Discover{' '}<span className="visually-hidden">{connection}</span>
                    </button>
                  </div>
                  {result === undefined || result === 'testing' ? null : result.ok ? (
                    <p role="status" className="answered">
                      {ENGINE_NAMES[result.value.kind]} {result.value.version} answered.
                    </p>
                  ) : (
                    <p role="alert" className="problem-box">
                      {result.message}
                    </p>
                  )}
                  {refused?.connection === connection ? (
                    <p role="alert" className="problem-box">
                      {refused.message}
                    </p>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {discovered === null ? null : (
        <>
          <MetadataView connection={discovered.connection} snapshot={discovered.snapshot} />
          <p className="next">
            <button type="button" className="primary" onClick={onChoose}>
              Choose a root
            </button>
          </p>
        </>
      )}
    </>
  )
}
