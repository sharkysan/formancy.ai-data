import type { ReactElement } from 'react'
import { findObject } from '@formancy/data-core'
import type { ColumnMeta, CoverageGap, DatabaseKind, ForeignKeyMeta, MetadataSnapshot, ObjectMeta } from '@formancy/data-core'
import { describeRef, gapsAbout, gapsHiding } from './choice.js'

/** How a database kind is written for a person. */
export const ENGINE_NAMES: Readonly<Record<DatabaseKind, string>> = { postgres: 'PostgreSQL', sqlserver: 'SQL Server' }

function where(gap: CoverageGap): string {
  const subject = gap.subject
  if (subject.kind === 'scope') return 'The whole scope'
  return subject.kind === 'schema' ? `Schema ${subject.schema}` : describeRef(subject.object)
}

/**
 * What one connection could not see, before anything it could.
 *
 * A permission-filtered catalog looks exactly like a complete one with fewer
 * things in it (0004). So the gaps come first and say what they mean: each is
 * "this connection cannot tell", and a table or a relationship missing below
 * may exist. An empty list is said too, as the adapter's finding, because an
 * absent section would read the same as a page that forgot.
 */
function Gaps({ snapshot }: { snapshot: MetadataSnapshot }): ReactElement {
  return (
    <section className="gaps" aria-labelledby="gaps-heading" data-gaps={snapshot.gaps.length > 0}>
      <h4 id="gaps-heading">What this connection could not see</h4>
      {snapshot.gaps.length === 0 ? (
        <p>No gap was reported: everything in the approved schemas was visible to this connection.</p>
      ) : (
        <>
          <p>
            Each of these is <strong>cannot tell</strong>, not <strong>does not exist</strong>: a table, key or relationship
            missing below may be there, out of this account&rsquo;s sight.
          </p>
          <ul aria-labelledby="gaps-heading">
            {snapshot.gaps.map((gap, index) => (
              // A gap has no identity of its own, and the adapter's order is the order to read them in.
              <li key={index}>
                <code>{where(gap)}</code> <span className="aspect">{gap.aspect}</span> {gap.detail}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function columnFacts(column: ColumnMeta): string {
  const facts = [column.databaseType, column.nullable ? 'may be null' : 'not null']
  if (column.generated !== 'none') facts.push(`generated (${column.generated})`)
  else if (column.hasDefault) facts.push('has a default')
  // What this connection's account may do with it (0027), said only when it may not do everything.
  const { select, insert, update } = column.access
  if (!select) facts.push('this connection may not read it')
  else if (!insert || !update) facts.push('may read', ...(insert ? [] : ['may not insert']), ...(update ? [] : ['may not update']))
  return facts.join(' · ')
}

/** Whether row security applies to this connection on an object, said when it does or cannot be told. */
const ROW_SECURITY: Readonly<Record<ObjectMeta['rowSecurity'], string | null>> = {
  none: null,
  applies: 'Row-level security applies to this connection.',
  unknown: 'Cannot tell whether row-level security applies.',
}

/** One foreign key, and what this connection can say about where it points. */
function foreignKeyLine(snapshot: MetadataSnapshot, foreignKey: ForeignKeyMeta): string {
  const from = `${foreignKey.name} (${foreignKey.columns.join(', ')})`
  if (foreignKey.references === null) return `${from} → a target this connection cannot see`
  const target = foreignKey.references.table
  const to = `${from} → ${describeRef(target)} (${foreignKey.references.columns.join(', ')})`
  const flags = [foreignKey.enforced ? null : 'not enforced', foreignKey.validated ? null : 'existing rows not checked'].filter((flag) => flag !== null)
  const suffix = flags.length === 0 ? '' : `; ${flags.join(', ')}`
  if (findObject(snapshot, target) !== undefined) return `${to}${suffix}`
  // Any gap that could hide it: about the target, or about its schema's or
  // the scope's objects. Only with none is "outside the approved schemas" true.
  const gaps = gapsHiding(snapshot, target)
  return gaps.length > 0
    ? `${to}${suffix}, which this connection cannot see: ${gaps.map((gap) => gap.detail).join('; ')}`
    : `${to}${suffix}, outside the approved schemas`
}

/**
 * An object's foreign keys, or the difference between having none and not
 * being able to tell: a gap on the object's foreign keys means the list may be
 * incomplete, and says so instead of "No foreign key".
 */
/** The id of the element that names an object, so its lists can be named "Columns sales.customer" and told apart. */
function objectId(object: ObjectMeta): string {
  return `object-${object.ref.schema}-${object.ref.name}`
}

function ForeignKeys({ snapshot, object }: { snapshot: MetadataSnapshot; object: ObjectMeta }): ReactElement {
  const hidden = gapsAbout(snapshot, object.ref).filter((gap) => gap.aspect === 'foreign-keys')
  const id = `fk-${object.ref.schema}-${object.ref.name}`
  return (
    <>
      <h5 id={id}>Foreign keys</h5>
      {object.foreignKeys.length > 0 ? (
        // Named with the object too: the PostgreSQL reader describes every table, so "Foreign keys" alone names many lists.
        <ul aria-labelledby={`${id} ${objectId(object)}`}>
          {object.foreignKeys.map((foreignKey) => (
            <li key={foreignKey.name}>{foreignKeyLine(snapshot, foreignKey)}</li>
          ))}
        </ul>
      ) : null}
      {hidden.length > 0 ? (
        <p className="cannot-tell">Cannot tell whether there are more: {hidden.map((gap) => gap.detail).join('; ')}</p>
      ) : object.foreignKeys.length === 0 ? (
        <p className="none">No foreign key.</p>
      ) : null}
    </>
  )
}

function ObjectDetails({ snapshot, object }: { snapshot: MetadataSnapshot; object: ObjectMeta }): ReactElement {
  const name = describeRef(object.ref)
  const id = `columns-${object.ref.schema}-${object.ref.name}`
  const other = gapsAbout(snapshot, object.ref).filter((gap) => gap.aspect !== 'foreign-keys')
  return (
    <details className="object">
      <summary>
        <code id={objectId(object)}>{name}</code> <span className="kind">{object.kind}</span>
      </summary>
      {object.comment === null ? null : <p className="comment">{object.comment}</p>}
      {ROW_SECURITY[object.rowSecurity] === null ? null : (
        <p className={object.rowSecurity === 'unknown' ? 'cannot-tell' : 'row-security'}>{ROW_SECURITY[object.rowSecurity]}</p>
      )}
      <h5 id={id}>Columns</h5>
      <ul aria-labelledby={`${id} ${objectId(object)}`}>
        {object.columns.map((column) => (
          <li key={column.name}>
            <code>{column.name}</code> {columnFacts(column)}
          </li>
        ))}
      </ul>
      <h5>Keys</h5>
      <p>
        {object.primaryKey === null ? 'No primary key.' : `Primary key ${object.primaryKey.name} (${object.primaryKey.columns.join(', ')}).`}
        {object.uniqueKeys.map((key) => ` Unique ${key.name} (${key.columns.join(', ')}).`).join('')}
      </p>
      <ForeignKeys snapshot={snapshot} object={object} />
      {other.length === 0 ? null : (
        <p className="cannot-tell">
          Could not see: {other.map((gap) => `${gap.aspect}, ${gap.detail}`).join('; ')}
        </p>
      )}
    </details>
  )
}

/** Step 2's result: what a connection can see, with what it cannot see first. */
export function MetadataView({ connection, snapshot }: { connection: string; snapshot: MetadataSnapshot }): ReactElement {
  const tables = snapshot.objects.filter((object) => object.kind === 'table').length
  const views = snapshot.objects.length - tables
  const { user, login } = snapshot.account
  return (
    <section className="metadata" aria-labelledby="seen-heading">
      <h3 id="seen-heading">What {connection} can see</h3>
      <p>
        {ENGINE_NAMES[snapshot.kind]} {snapshot.serverVersion}, schemas {snapshot.scope.schemas.join(', ')}: {tables}{' '}
        {tables === 1 ? 'table' : 'tables'} and {views} {views === 1 ? 'view' : 'views'}. Discovered as <code>{user}</code>
        {login === user ? null : (
          <>
            , connected as <code>{login}</code>
          </>
        )}
        . Fingerprint <code>{snapshot.fingerprint.slice(0, 12)}</code>.
      </p>
      <Gaps snapshot={snapshot} />
      <h4 id="objects-heading">Tables and views</h4>
      <ul className="objects" aria-labelledby="objects-heading">
        {snapshot.objects.map((object) => (
          <li key={describeRef(object.ref)}>
            <ObjectDetails snapshot={snapshot} object={object} />
          </li>
        ))}
      </ul>
    </section>
  )
}
