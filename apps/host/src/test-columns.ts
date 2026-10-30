import { expect } from 'vitest'
import { waitFor, within } from '@testing-library/react'
import type { KeptGrid } from './columns.js'
import { gridKey } from './prefs.js'
import type { GridSection } from './prefs.js'
import { gridSection } from './test-host.js'
import type { User } from './test-host.js'

/*
 * How the suites drive a grid's Columns (0106), as a person does: by role
 * and accessible name (formancy.ai 0034), inside the section whose heading
 * names the grid -- the Records panel, or a child section, each with
 * Columns of its own -- and what the browser kept of it, read from
 * `localStorage` by the key the page writes.
 */

/** Columns, the disclosure button of the grid `heading` names. */
export const columnsButton = (heading: string): HTMLElement => within(gridSection(heading)).getByRole('button', { name: 'Columns' })

/** The panel of the grid `heading` names, open: Columns pressed when it is not expanded. */
export async function openColumns(user: User, heading: string): Promise<void> {
  const button = columnsButton(heading)
  if (button.getAttribute('aria-expanded') !== 'true') await user.click(button)
}

/** The list of the grid's columns in its panel, named by Columns. */
export const columnList = (heading: string): HTMLElement => within(gridSection(heading)).getByRole('list', { name: 'Columns' })

/** What the panel lists, in order: each column's label, from its Show's name, and whether it is shown. */
export function listed(heading: string): Array<{ label: string; shown: boolean }> {
  return within(columnList(heading))
    .getAllByRole('checkbox')
    .map((box) => ({ label: (box.getAttribute('aria-label') ?? '').replace(/^Show /, ''), shown: (box as HTMLInputElement).checked }))
}

/** A column's Show in the panel. */
export const showBox = (heading: string, label: string): HTMLInputElement =>
  within(columnList(heading)).getByRole<HTMLInputElement>('checkbox', { name: `Show ${label}` })

/** A column's move in the panel. */
export const moveButton = (heading: string, label: string, way: 'up' | 'down'): HTMLElement =>
  within(columnList(heading)).getByRole('button', { name: `Move ${label} ${way}` })

/**
 * The grid's column headers, in the order drawn: each one's text, with the
 * number AG Grid adds to a header sorted among several taken off. A hidden
 * column draws no header.
 */
export function headers(heading: string): string[] {
  const grid = within(gridSection(heading)).getByRole('grid', { name: heading })
  return within(grid)
    .getAllByRole('columnheader')
    .map((header) => (header.textContent ?? '').trim().replace(/\s*\d+$/, ''))
}

/** Wait until the grid's headers are `labels`, in order. */
export async function headed(heading: string, labels: readonly string[]): Promise<void> {
  await waitFor(() => expect(headers(heading)).toEqual(labels), { timeout: 15_000 })
}

/** The Records panel's grid, and a child section's by the field its rows are narrowed by: what `keptFor` and `gridKey` name. */
export const RECORDS_GRID: GridSection = { kind: 'records' }
export const childGrid = (field: string): GridSection => ({ kind: 'child', field })

/** What this browser kept for a form's grid in one kind of section, as written: null when nothing. */
export function keptFor(section: GridSection, formId: string): KeptGrid | null {
  const text = localStorage.getItem(gridKey(section, formId))
  return text === null ? null : (JSON.parse(text) as KeptGrid)
}
