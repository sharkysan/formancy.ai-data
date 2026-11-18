import { useId } from 'react'
import type { ReactElement } from 'react'
import { describeRoutine } from '@formancy/data-core'
import type { ActionChoice, ActionGround, MetadataSnapshot, ObjectMeta, RoutineMeta } from '@formancy/data-core'
import type { ActionReasons } from './actions.js'
import { routineFacts, routineKey, sameRoutine, SCOPES, sourceOptions, sourceValue, startingAction, withScope, withSource } from './actions.js'
import type { Choice } from './choice.js'
import { useFocusAfterRender } from './focus.js'

/** `actions` in the snapshot's order of their routines, those of a routine it no longer records last, as they were. */
function ordered(actions: readonly ActionChoice[], routines: readonly RoutineMeta[]): ActionChoice[] {
  const at = (action: ActionChoice) => {
    const index = routines.findIndex((routine) => sameRoutine(routine.ref, action.routine))
    return index < 0 ? routines.length : index
  }
  return [...actions].sort((left, right) => at(left) - at(right))
}

/**
 * One parameter's source: a select of the sources the generator binds for
 * it (`sourceOptions`), none chosen for anybody, and, for a trusted
 * attribute, its name.
 */
function ParameterSource({
  id,
  root,
  ground,
  routine,
  action,
  index,
  onAction,
}: {
  id: string
  root: ObjectMeta
  ground: ActionGround
  routine: RoutineMeta
  action: ActionChoice
  index: number
  onAction: (next: ActionChoice) => void
}): ReactElement {
  const parameter = routine.parameters[index] as RoutineMeta['parameters'][number]
  const current = action.parameters.find((entry) => entry.parameter === parameter.name)?.from
  const options = sourceOptions(root, ground, parameter, current)
  const box = `${id}-parameter-${String(index)}`
  const named = describeRoutine(routine.ref)
  return (
    <div className="field">
      <label htmlFor={box}>
        Where {parameter.name} ({parameter.databaseType}) comes from <span className="visually-hidden">for {named}</span>
      </label>
      <select
        id={box}
        value={current === undefined ? '' : sourceValue(current)}
        onChange={(event) => onAction(withSource(action, routine, parameter.name, options.find((option) => option.value === event.target.value)?.from))}
      >
        <option value="">Nothing yet</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {current === undefined || !('attribute' in current) ? null : (
        <div className="field">
          <label htmlFor={`${box}-attribute`}>
            Attribute {parameter.name} is given <span className="visually-hidden">for {named}</span>
          </label>
          <input
            id={`${box}-attribute`}
            value={current.attribute}
            spellCheck={false}
            onChange={(event) => onAction(withSource(action, routine, parameter.name, { attribute: event.target.value }))}
          />
        </div>
      )}
    </div>
  )
}

/**
 * What an action runs over (0165, 0166): the open record, as every action
 * starts and every bundle before 0165 binds it, or the records a person
 * chooses of the page a list shows. A radio group with its legend in
 * view, the arrow keys moving between its two; under it, once the
 * generator binds the action, the generator's own note of what it does,
 * which for a selection says what holding every record until the last
 * call returns costs -- read with the group, so it is heard as the
 * keyboard enters it.
 */
function ScopeChoice({
  id,
  named,
  action,
  bound,
  onAction,
}: {
  id: string
  named: string
  action: ActionChoice
  bound: string | null
  onAction: (next: ActionChoice) => void
}): ReactElement {
  return (
    <fieldset aria-describedby={bound === null ? undefined : `${id}-scope-note`}>
      <legend>
        What it runs over <span className="visually-hidden">for {named}</span>
      </legend>
      {SCOPES.map(({ scope, label }) => (
        <div className="check" key={scope}>
          <input
            type="radio"
            id={`${id}-scope-${scope}`}
            name={`${id}-scope`}
            value={scope}
            checked={action.scope === scope}
            onChange={() => onAction(withScope(action, scope))}
          />
          <label htmlFor={`${id}-scope-${scope}`}>{label}</label>
        </div>
      ))}
      {bound === null ? null : (
        <p id={`${id}-scope-note`} className="hint">
          {bound}
        </p>
      )}
    </fieldset>
  )
}

/** A routine chosen as an action: its name, what it runs over, and where each of its parameters comes from. */
function ActionMapping({
  id,
  root,
  ground,
  routine,
  action,
  bound,
  onAction,
}: {
  id: string
  root: ObjectMeta
  ground: ActionGround
  routine: RoutineMeta
  action: ActionChoice
  /** The generator's note of the action as it binds it; null while it does not. */
  bound: string | null
  onAction: (next: ActionChoice) => void
}): ReactElement {
  const named = describeRoutine(routine.ref)
  return (
    <fieldset className="nested">
      <legend>The action over {routine.ref.name}</legend>
      <div className="field">
        <label htmlFor={`${id}-name`}>
          Action name <span className="visually-hidden">for {named}</span>
        </label>
        <input
          id={`${id}-name`}
          value={action.name}
          spellCheck={false}
          aria-describedby={`${id}-name-hint`}
          onChange={(event) => onAction({ ...action, name: event.target.value })}
        />
        <p id={`${id}-name-hint`} className="hint">
          What a run&rsquo;s address carries, and the Policy and Presentation steps name it by: lower-case letters, digits and hyphens.
        </p>
      </div>
      <ScopeChoice id={id} named={named} action={action} bound={bound} onAction={onAction} />
      {routine.parameters.length === 0 ? (
        <p className="hint">It takes no parameter.</p>
      ) : (
        routine.parameters.map((parameter, index) => (
          <ParameterSource key={parameter.name} id={id} root={root} ground={ground} routine={routine} action={action} index={index} onAction={onAction} />
        ))
      )}
    </fieldset>
  )
}

/** A routine of the snapshot offered as an action: its box, what it is and the generator's refusal of it, and once ticked its mapping and the generator's note. */
function RoutineRow({
  id,
  root,
  routine,
  chosen,
  reasons,
  onTick,
  onUntick,
  onAction,
}: {
  id: string
  root: ObjectMeta
  routine: RoutineMeta
  chosen: ActionChoice | undefined
  reasons: ActionReasons
  onTick: () => void
  onUntick: (action: ActionChoice) => void
  onAction: (next: ActionChoice) => void
}): ReactElement {
  const refused = reasons.routines.get(routineKey(routine.ref)) ?? null
  const note = chosen === undefined ? null : (reasons.chosen.get(chosen.name) ?? null)
  return (
    <div className="choice">
      <div className="check">
        <input
          type="checkbox"
          id={id}
          checked={chosen !== undefined}
          disabled={chosen === undefined && (refused !== null || reasons.unoffered !== null)}
          aria-describedby={`${id}-about`}
          onChange={() => (chosen === undefined ? onTick() : onUntick(chosen))}
        />
        <label htmlFor={id}>
          Offer <code>{describeRoutine(routine.ref)}</code> as an action
        </label>
      </div>
      <p id={`${id}-about`} className={refused === null ? 'hint' : 'cannot-tell'}>
        {routineFacts(routine)}.{refused === null ? null : ` The generator refuses it: ${refused}.`}
      </p>
      {chosen === undefined || reasons.ground === null ? null : (
        <ActionMapping
          id={id}
          root={root}
          ground={reasons.ground}
          routine={routine}
          action={chosen}
          bound={reasons.bound.get(chosen.name) ?? null}
          onAction={onAction}
        />
      )}
      <div aria-live="polite">{note === null ? null : <p className="cannot-tell">{note}</p>}</div>
    </div>
  )
}

/** An action chosen over a routine the snapshot does not record: ticked, to be unticked, and why it is not listed with the others. */
function StrayRow({ id, action, why, onUntick }: { id: string; action: ActionChoice; why: string; onUntick: (action: ActionChoice) => void }): ReactElement {
  return (
    <div className="choice">
      <div className="check">
        <input type="checkbox" id={id} checked aria-describedby={`${id}-about`} onChange={() => onUntick(action)} />
        <label htmlFor={id}>
          Offer <code>{describeRoutine(action.routine)}</code> as an action
        </label>
      </div>
      <p id={`${id}-about`} className="cannot-tell">
        {action.name}: {why}
      </p>
    </div>
  )
}

/** The snapshot's routines, as the step offers them: the form's refusal of every one, a word where there is none, and a row for each. */
function OfferedRoutines({
  routines,
  hidden,
  root,
  actions,
  reasons,
  onTick,
  onUntick,
  onAction,
}: {
  routines: readonly RoutineMeta[]
  /** Whether a gap hides routines from this connection. */
  hidden: boolean
  root: ObjectMeta
  actions: readonly ActionChoice[]
  reasons: ActionReasons
  onTick: (routine: RoutineMeta) => void
  onUntick: (action: ActionChoice) => void
  onAction: (routine: RoutineMeta, next: ActionChoice) => void
}): ReactElement {
  return (
    <>
      {reasons.unoffered === null ? null : <p className="cannot-tell">No action can be offered on this form: {reasons.unoffered}.</p>}
      {routines.length === 0 ? (
        <p className={hidden ? 'cannot-tell' : 'none'}>
          {hidden
            ? 'This connection sees no function or procedure in the approved schemas, and cannot see them all.'
            : 'The approved schemas hold no function or procedure.'}
        </p>
      ) : null}
      {routines.map((routine, index) => (
        <RoutineRow
          key={routineKey(routine.ref)}
          id={`action-${String(index)}`}
          root={root}
          routine={routine}
          chosen={actions.find((action) => sameRoutine(action.routine, routine.ref))}
          reasons={reasons}
          onTick={() => onTick(routine)}
          onUntick={onUntick}
          onAction={(next) => onAction(routine, next)}
        />
      ))}
    </>
  )
}

/**
 * Where the keyboard goes once `action` is unticked, where its box leaves
 * the page -- an action over a routine the snapshot does not record -- or
 * stays there disabled -- a routine the generator refuses, or a form that
 * offers none: the next box that can still be pressed, else the one
 * before, else the group (`null`). `undefined` where its box stays and can
 * be ticked again, which keeps the keyboard.
 */
function focusAfterUntick(
  action: ActionChoice,
  routines: readonly RoutineMeta[],
  actions: readonly ActionChoice[],
  strays: readonly ActionChoice[],
  offerable: (routine: RoutineMeta) => boolean,
): string | null | undefined {
  const at = routines.findIndex((routine) => sameRoutine(routine.ref, action.routine))
  if (at >= 0 && offerable(routines[at] as RoutineMeta)) return undefined
  const left = actions.filter((entry) => entry !== action)
  const remaining = strays.filter((entry) => entry !== action)
  // Each box as it is drawn now, by the id it has after the untick where it can still be pressed: a stray after the one removed moves up.
  const boxes = [
    ...routines.map((routine, index) =>
      index !== at && (left.some((entry) => sameRoutine(entry.routine, routine.ref)) || offerable(routine)) ? `action-${String(index)}` : null,
    ),
    ...strays.map((entry) => (entry === action ? null : `action-gone-${String(remaining.indexOf(entry))}`)),
  ]
  const position = at >= 0 ? at : routines.length + strays.indexOf(action)
  return boxes.slice(position + 1).find((id) => id !== null) ?? boxes.slice(0, position).findLast((id) => id !== null) ?? null
}

/**
 * The routines of the approved schemas, each offered as an action (0159,
 * 0163): a box per routine, never ticked for anybody, and once ticked its
 * name, what it runs over -- the open record, or a page's records a
 * person chooses (0166) -- and a select per parameter offering only the
 * sources the generator binds for it, none chosen. Every routine
 * is listed, the ones the generator refuses too, disabled with its words;
 * the form's own refusal, where it offers none -- no confirmed version,
 * a view, a rowversion with no touch column -- is said above them, in the
 * generator's words; and an action as mapped is said under its mapping
 * in the generator's note, which changes as its sources do. A snapshot
 * discovered without routines offers none, and says how to. An action
 * chosen over a routine the snapshot does not record -- one gone from
 * the database, or any, from a discovery that did not read the routines
 * -- stays listed, ticked, to be unticked, since the request still names
 * it; and an untick that takes its box away or disables it leaves the
 * keyboard on the next box, never on the page.
 */
export function ActionsChoice({
  snapshot,
  connection,
  root,
  choice,
  reasons,
  onChoice,
}: {
  snapshot: MetadataSnapshot
  connection: string
  root: ObjectMeta
  choice: Choice
  reasons: ActionReasons
  onChoice: (next: Choice) => void
}): ReactElement {
  const hint = useId()
  const group = `${hint}group`
  const focusAfter = useFocusAfterRender()
  const routines = snapshot.routines
  const listed = routines ?? []
  const hidden = snapshot.gaps.filter((gap) => gap.aspect === 'routines')
  const set = (actions: ActionChoice[]) => onChoice({ ...choice, actions: ordered(actions, listed) })
  // By its routine, which one box ticks once: two actions may share a name until the generator's refusal of it is answered.
  const replace = (routine: RoutineMeta, next: ActionChoice) => set(choice.actions.map((action) => (sameRoutine(action.routine, routine.ref) ? next : action)))
  const strays = choice.actions.filter((action) => !listed.some((routine) => sameRoutine(routine.ref, action.routine)))
  const offerable = (routine: RoutineMeta) => !reasons.routines.has(routineKey(routine.ref)) && reasons.unoffered === null
  const untick = (action: ActionChoice) => {
    const next = focusAfterUntick(action, listed, choice.actions, strays, offerable)
    set(choice.actions.filter((entry) => entry !== action))
    if (next !== undefined) focusAfter(next ?? group)
  }
  const unread = 'still chosen, and sent with the request, which the server discovers with the routines to bind it: this discovery did not read them.'
  const gone = (action: ActionChoice) => `this connection’s routines no longer include it. ${reasons.chosen.get(action.name) ?? ''}`.trimEnd()
  return (
    <fieldset id={group} tabIndex={-1} aria-describedby={hint}>
      <legend>Actions</legend>
      <p id={hint} className="hint">
        An action runs a function or procedure of this database over the open record, or over the records a person chooses in the list, once its person has
        answered its dialog, in one transaction that locks each record and moves its version. Each parameter is given its value by the form -- the
        record&rsquo;s key or a column of it, an answer in the dialog, a trusted attribute or the person&rsquo;s id -- and none is given one for you.
      </p>
      {routines === undefined ? (
        <p className="none">
          {connection} was discovered without its routines. Tick Include routines on the Connect step and discover it again to offer one as an action.
        </p>
      ) : (
        <OfferedRoutines
          routines={routines}
          hidden={hidden.length > 0}
          root={root}
          actions={choice.actions}
          reasons={reasons}
          onTick={(routine) =>
            set([
              ...choice.actions,
              startingAction(
                routine,
                choice.actions.map((action) => action.name),
              ),
            ])
          }
          onUntick={untick}
          onAction={replace}
        />
      )}
      {strays.map((action, index) => (
        <StrayRow
          key={routineKey(action.routine)}
          id={`action-gone-${String(index)}`}
          action={action}
          why={routines === undefined ? unread : gone(action)}
          onUntick={untick}
        />
      ))}
      {hidden.length === 0 ? null : <p className="cannot-tell">Cannot tell whether there are more: {hidden.map((gap) => gap.detail).join('; ')}.</p>}
      <div aria-live="polite">
        {reasons.thrown === null ? null : <p className="cannot-tell">The generator refuses the request with these actions: {reasons.thrown}.</p>}
      </div>
    </fieldset>
  )
}
