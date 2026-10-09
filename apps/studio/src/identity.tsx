import type { ReactElement } from 'react'
import type { HostIdentity } from '@formancy/data-server'

/**
 * What `/v1/whoami` said a token names, exactly as it said it: the actor, the
 * roles, and each attribute a row filter can compare with.
 *
 * Shown, never interpreted. A wrong issuer, audience or claim mapping is the
 * usual reason a host's token does not do what its author meant, and the only
 * way to see that is to read what the server derived from it.
 */
export function IdentityList({ identity }: { identity: HostIdentity }): ReactElement {
  const attributes = Object.entries(identity.attributes)
  return (
    <dl className="identity">
      <dt>Actor</dt>
      <dd>
        <code>{identity.actor.id}</code>
      </dd>
      <dt>Roles</dt>
      <dd>{identity.actor.roles.length === 0 ? <em>none</em> : identity.actor.roles.map((role) => <code key={role}>{role}</code>)}</dd>
      {attributes.map(([name, value]) => (
        <div key={name} className="identity-attribute">
          <dt>{name}</dt>
          <dd>
            <code>{value}</code>
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** The one sentence about where the token is kept, said wherever it matters. */
export const TOKEN_KEPT =
  "The token is held in this tab's memory and sent only to this server, in the Authorization header. It is not written to storage, a cookie or the address, and reloading the page signs you out."
