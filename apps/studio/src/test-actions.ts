import { screen, within } from '@testing-library/react'
import { discover, offerOnly, step } from './test-studio.js'
import type { User } from './test-studio.js'

/*
 * How the suites drive an action over the open record (0163), as a
 * person would: the fixture's `ship_order` (0158), discovered with the
 * routines and bound to the order on PostgreSQL.
 */

/** The fixture's routine on PostgreSQL, as the Choose step and the notes name it. */
export const SHIP_ORDER = 'sales.ship_order(pg_catalog.int8, pg_catalog.int4)'

/** Its box on the Choose step. */
export const OFFER_SHIP_ORDER = `Offer ${SHIP_ORDER} as an action`

/** The select of where one of its parameters comes from, by the parameter's name and type. */
export const SOURCE_OF = (parameter: string, type: string, routine = SHIP_ORDER): string => `Where ${parameter} (${type}) comes from for ${routine}`

/** Discover `connection` from the Connect step with Include routines ticked. */
export async function discoverRoutines(user: User, connection = 'fixture'): Promise<void> {
  const include = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Include routines' })
  if (!include.checked) await user.click(include)
  await discover(user, connection)
}

/**
 * The order on the fixture chosen as `chooseOrder` chooses it -- the
 * customer lookup, the tenant pinned, the version column confirmed -- but
 * discovered with its routines, and `ship_order` offered as an action:
 * given the order's key, and the trusted tenant its pin is filtered by.
 */
export async function chooseShipping(user: User): Promise<HTMLElement> {
  await discoverRoutines(user)
  await user.click(screen.getByRole('button', { name: 'Choose a root' }))
  const choose = step('Choose')
  await user.selectOptions(within(choose).getByLabelText('Root table or view'), 'sales.order')
  await offerOnly(user, choose, ['fk_order_customer'])
  await user.click(within(choose).getByRole('checkbox', { name: 'Pin tenant_id' }))
  await user.selectOptions(within(choose).getByLabelText('Version column'), 'row_version')
  await user.click(within(choose).getByRole('checkbox', { name: OFFER_SHIP_ORDER }))
  await user.selectOptions(within(choose).getByRole('combobox', { name: SOURCE_OF('order_id', 'bigint') }), 'Key id')
  await user.selectOptions(within(choose).getByRole('combobox', { name: SOURCE_OF('tenant', 'integer') }), 'A trusted attribute')
  return choose
}

/** `chooseShipping`, generated, landing on the Generate step. */
export async function generateShipping(user: User): Promise<HTMLElement> {
  const choose = await chooseShipping(user)
  await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
  return screen.findByRole('main', { name: 'Generate' })
}
