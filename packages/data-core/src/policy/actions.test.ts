import { describe, expect, test } from 'vitest'
import { ACTION_POLICY, actionForm, routineSnapshot } from '../actions/test-actions.js'
import { AUDITOR, actor, CLERK, INTAKE, ORDER_POLICY, orderForm } from '../records/test-support.js'
import { authorizeAction, runnableActions } from './evaluate.js'
import { readPolicy } from './inputs.js'
import type { FormPolicy } from './types.js'
import { validatePolicy } from './validate.js'

/*
 * Who may run an action (0159): deny by default, a role that may read
 * and is granted the action -- never update -- and a policy refused where
 * a run would hand its routine what its person may not read, or rest on an
 * attribute no context need carry.
 */

const { bindings } = actionForm(routineSnapshot())
const problems = (policy: FormPolicy) => {
  const checked = validatePolicy(policy, bindings)
  return checked.ok ? [] : checked.problems
}

describe('who may run an action', () => {
  // Absent, an action is nobody's, and a policy written before 0159 keeps
  // its meaning: the clerk, who may do everything else, runs nothing.
  // Watched failing with an absent grant read as every reader's.
  test('is nobody, by default', () => {
    expect(problems(ORDER_POLICY)).toEqual([])
    expect(authorizeAction(ORDER_POLICY, CLERK, bindings, 'ship')).toMatchObject({ ok: false, code: 'operation-denied' })
    expect(authorizeAction({ ...ORDER_POLICY, actions: { close: { roles: ['clerk'] } } }, CLERK, bindings, 'ship')).toMatchObject({
      ok: false,
      code: 'operation-denied',
    })
    expect(runnableActions(ORDER_POLICY, CLERK, bindings)).toEqual([])
  })

  // An action is an operation of its own, as EXECUTE is without UPDATE:
  // the auditor, who may read and update nothing, runs `ship`. Requiring
  // update would make every action an editor's. Watched failing with
  // update asked of every role an action names.
  test('needs read and the action, and not update', () => {
    expect(problems(ACTION_POLICY)).toEqual([])
    expect(authorizeAction(ACTION_POLICY, AUDITOR, bindings, 'ship')).toEqual({ ok: true })
    expect(runnableActions(ACTION_POLICY, AUDITOR, bindings)).toEqual(['ship'])
    expect(runnableActions(ACTION_POLICY, CLERK, bindings)).toEqual(['ship', 'close'])
  })

  // A run names the version its person read: a role that may not read has
  // only a guess. Watched failing with the read check taken out of
  // `actionFitProblems`: intake was granted `ship`.
  test('is refused to a role that may not read', () => {
    const policy = { ...ACTION_POLICY, actions: { ship: { roles: ['intake'] } } }
    expect(problems(policy)).toEqual(['actions.ship grants intake, who may not read with this form: a run names the version its person read'])
    expect(authorizeAction(policy, INTAKE, bindings, 'ship')).toMatchObject({ ok: false, code: 'invalid-policy' })
  })

  // `close` passes the amount to its routine, from the locked row: an
  // auditor, who may not read the amount, would hand the routine a value
  // they are kept from (0011). Watched failing with the field check taken
  // out of `actionFitProblems`: the auditor was granted `close`.
  test('is refused to a role that may not read a field the action passes', () => {
    const policy = { ...ACTION_POLICY, actions: { close: { roles: ['clerk', 'auditor'] } } }
    expect(problems(policy)).toEqual(['actions.close grants auditor, who may not read amount, which the action passes to its routine'])
  })

  // A key is always passable -- the token is the address the person holds
  // -- so `ship`, passing the key alone, is the auditor's though the
  // auditor may not read every column of it. Watched failing with a key
  // source held to the field rule: the auditor's grant was refused.
  test('passes a key whatever the role may read', () => {
    const policy: FormPolicy = { ...ACTION_POLICY, fields: { ...ACTION_POLICY.fields, id: { read: ['clerk'], write: [] } } }
    expect(problems(policy)).toEqual([])
  })

  // An attribute no row filter or through compares with is one a context
  // need not carry, so every run could be refused for it: said before
  // publication. Watched failing with the attribute check taken out.
  test('is refused an attribute no row filter or through of the form compares with', () => {
    const policy: FormPolicy = { ...ACTION_POLICY, rowFilters: [], lookups: { customer: [], employee: [] } }
    expect(problems(policy)).toEqual([
      "actions.ship passes the context's tenant, which no row filter or through of this form compares with, so a context need not carry it",
    ])
  })

  // A through's attribute is resolved for every operation, as a row
  // filter's is (0043), so it is established too. Watched failing with
  // throughs left out of what is established.
  test('takes an attribute a through compares with', () => {
    const policy: FormPolicy = {
      ...ACTION_POLICY,
      rowFilters: [],
      lookups: { customer: [], employee: [{ column: 'tenant_id', attribute: 'tenant' }] },
      through: ['employee'],
    }
    expect(problems(policy)).toEqual([])
  })

  // A run is no more taken back than a delete: on a form whose records
  // nothing scopes while a lookup's options are filtered, a guessed token
  // would run on any tenant's record -- the delete's rule. Watched failing
  // with the scope check taken out.
  test('is refused on a form whose records nothing scopes', () => {
    const policy: FormPolicy = { ...ACTION_POLICY, rowFilters: [], actions: { ship: { roles: ['clerk'] } } }
    expect(problems(policy).filter((problem) => problem.startsWith('actions grants roles'))).toHaveLength(1)
    expect(problems({ ...policy, actions: { ship: { roles: [] } } }).filter((problem) => problem.startsWith('actions grants roles'))).toEqual([])
  })

  // A grant for an action the bindings do not bind says something untrue,
  // and is refused as a field the form lacks is. Watched failing with the
  // check taken out: `archive` passed.
  test('is refused for an action the form does not bind', () => {
    expect(problems({ ...ACTION_POLICY, actions: { archive: { roles: ['clerk'] } } })).toEqual(['actions.archive: the form binds no action archive'])
    const none = validatePolicy({ ...ACTION_POLICY, actions: { ship: { roles: ['clerk'] } } }, orderForm(routineSnapshot()).bindings)
    expect(none.ok ? [] : none.problems).toEqual(['actions.ship: the form binds no action ship'])
  })

  // Read as every grant is: own keys, exact roles, and nothing this
  // release does not read. Watched failing with `actions` left out of the
  // properties read: every policy naming one was refused.
  test('is read as a policy reads every grant', () => {
    expect(readPolicy({ ...ACTION_POLICY, actions: { ship: { roles: 'clerk' } } }).problems).toEqual(['actions.ship.roles is not a list of roles'])
    expect(readPolicy({ ...ACTION_POLICY, actions: { ship: { roles: ['clerk'], when: 'open' } } }).problems).toEqual([
      'actions.ship.when is not something this release reads, so nothing would enforce it',
    ])
    expect(readPolicy({ ...ACTION_POLICY, actions: [] }).problems).toEqual(['actions is not an object of action names'])
    expect(readPolicy({ ...ACTION_POLICY, actions: { ship: 'clerk' } }).problems).toEqual(['actions.ship is not { roles }'])
  })

  // A run is scoped as a read is: a context without the row filter's
  // attribute is refused, never handed an unscoped run. Watched failing
  // with the filter left unresolved in `authorizeAction`.
  test('is refused to a context that cannot scope it', () => {
    expect(authorizeAction(ACTION_POLICY, actor(['clerk'], {}), bindings, 'ship')).toMatchObject({ ok: false, code: 'missing-attribute' })
  })
})
