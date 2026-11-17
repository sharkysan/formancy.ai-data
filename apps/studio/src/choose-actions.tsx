import { useId } from 'react'
import type { ReactElement } from 'react'
import { describeRoutine } from '@formancy/data-core'
import type { ActionChoice, ActionGround, MetadataSnapshot, ObjectMeta, RoutineMeta } from '@formancy/data-core'
import type { ActionReasons } from './actions.js'
import { routineFacts, routineKey, sameRoutine, sourceOptions, sourceValue, startingAction, withSource } from './actions.js'
import type { Choice } from './choice.js'

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

/** A routine chosen as an action: its name, and where each of its parameters comes from. */
function ActionMapping({
  id,
  root,
  ground,
  routine,
  action,
  onAction,
}: {
  id: string
  root: ObjectMeta
  ground: ActionGround
  routine: RoutineMeta
  action: ActionChoice
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

/**
 * The routines of the approved schemas, each offered as an action over
 * the open record (0159, 0163): a box per routine, never ticked for
 * anybody, and once ticked its name and a select per parameter offering
 * only the sources the generator binds for it, none chosen. Every routine
 * is listed, the ones the generator refuses too, disabled with its words;
 * the form's own refusal, where it offers none -- no confirmed version,
 * a view, a rowversion with no touch column -- is said above them, in the
 * generator's words; and an action as mapped is said under its mapping
 * in the generator's note, which changes as its sources do. A snapshot
 * discovered without routines offers none, and says how to.
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
  const routines = snapshot.routines
  const header = (
    <>
      <legend>Actions</legend>
      <p id={hint} className="hint">
        An action runs a function or procedure of this database over the open record, once its person has answered its dialog, in one transaction that locks the
        record and moves its version. Each parameter is given its value by the form -- the record&rsquo;s key or a column of it, an answer in the dialog, a
        trusted attribute or the person&rsquo;s id -- and none is given one for you.
      </p>
    </>
  )
  if (routines === undefined) {
    return (
      <fieldset aria-describedby={hint}>
        {header}
        <p className="none">
          {connection} was discovered without its routines. Tick Include routines on the Connect step and discover it again to offer one as an action.
        </p>
      </fieldset>
    )
  }
  const hidden = snapshot.gaps.filter((gap) => gap.aspect === 'routines')
  const set = (actions: ActionChoice[]) => onChoice({ ...choice, actions: ordered(actions, routines) })
  // By its routine, which one box ticks once: two actions may share a name until the generator's refusal of it is answered.
  const replace = (routine: RoutineMeta, next: ActionChoice) => set(choice.actions.map((action) => (sameRoutine(action.routine, routine.ref) ? next : action)))
  const stray = choice.actions.filter((action) => !routines.some((routine) => sameRoutine(routine.ref, action.routine)))
  return (
    <fieldset aria-describedby={hint}>
      {header}
      {reasons.unoffered === null ? null : <p className="cannot-tell">No action can be offered on this form: {reasons.unoffered}.</p>}
      {routines.length === 0 ? (
        <p className={hidden.length > 0 ? 'cannot-tell' : 'none'}>
          {hidden.length > 0
            ? 'This connection sees no function or procedure in the approved schemas, and cannot see them all.'
            : 'The approved schemas hold no function or procedure.'}
        </p>
      ) : null}
      {routines.map((routine, index) => {
        const id = `action-${String(index)}`
        const chosen = choice.actions.find((action) => sameRoutine(action.routine, routine.ref))
        const refused = reasons.routines.get(routineKey(routine.ref)) ?? null
        const note = chosen === undefined ? null : (reasons.chosen.get(chosen.name) ?? null)
        return (
          <div className="choice" key={routineKey(routine.ref)}>
            <div className="check">
              <input
                type="checkbox"
                id={id}
                checked={chosen !== undefined}
                disabled={chosen === undefined && (refused !== null || reasons.unoffered !== null)}
                aria-describedby={`${id}-about`}
                onChange={(event) =>
                  set(
                    event.target.checked
                      ? [
                          ...choice.actions,
                          startingAction(
                            routine,
                            choice.actions.map((action) => action.name),
                          ),
                        ]
                      : choice.actions.filter((action) => action !== chosen),
                  )
                }
              />
              <label htmlFor={id}>
                Offer <code>{describeRoutine(routine.ref)}</code> as an action
              </label>
            </div>
            <p id={`${id}-about`} className={refused === null ? 'hint' : 'cannot-tell'}>
              {routineFacts(routine)}.{refused === null ? null : ` The generator refuses it: ${refused}.`}
            </p>
            {chosen === undefined || reasons.ground === null ? null : (
              <ActionMapping id={id} root={root} ground={reasons.ground} routine={routine} action={chosen} onAction={(next) => replace(routine, next)} />
            )}
            <div aria-live="polite">{note === null ? null : <p className="cannot-tell">{note}</p>}</div>
          </div>
        )
      })}
      {stray.map((action, index) => {
        const id = `action-gone-${String(index)}`
        return (
          <div className="choice" key={routineKey(action.routine)}>
            <div className="check">
              <input
                type="checkbox"
                id={id}
                checked
                aria-describedby={`${id}-about`}
                onChange={() => set(choice.actions.filter((entry) => entry !== action))}
              />
              <label htmlFor={id}>
                Offer <code>{describeRoutine(action.routine)}</code> as an action
              </label>
            </div>
            <p id={`${id}-about`} className="cannot-tell">
              {action.name}: this connection&rsquo;s routines no longer include it. {reasons.chosen.get(action.name) ?? null}
            </p>
          </div>
        )
      })}
      {hidden.length === 0 ? null : <p className="cannot-tell">Cannot tell whether there are more: {hidden.map((gap) => gap.detail).join('; ')}.</p>}
      <div aria-live="polite">
        {reasons.thrown === null ? null : <p className="cannot-tell">The generator refuses the request with these actions: {reasons.thrown}.</p>}
      </div>
    </fieldset>
  )
}
