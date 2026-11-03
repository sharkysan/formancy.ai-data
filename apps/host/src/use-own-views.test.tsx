import { useState } from 'react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { DataClient, ListView, PublishedForm } from '@formancy/data-client'
import { OwnViewsScope, useOwnViews } from './use-own-views.js'

/*
 * A person's own views across the grids of one open form (0128), without a
 * server: what one grid's save or remove answered is what every grid of
 * that form shows, a grid drawn later from a definition read before the
 * save included, and nothing of another form's. What the server keeps and
 * offers is the routes' suites'; the page against it is view-picker.test.tsx.
 */

afterEach(cleanup)

const RUSH: ListView = { name: 'Rush', filter: [{ field: 'notes', op: 'contains', text: 'rush' }], sort: [] }
const LARGE: ListView = { name: 'Large', filter: [{ field: 'amount', op: 'range', from: '1000', to: null }], sort: [] }

/** A form as opened, holding `own`. */
const opened = (own: ListView[]): PublishedForm => ({ list: { own } }) as unknown as PublishedForm

/** A client whose save keeps the view after those it was told of, and whose remove leaves none; `refuse` makes it refuse instead. */
function serverOf(start: ListView[], refuse = false): DataClient {
  let kept = [...start]
  return {
    saveView: async (_formId: string, view: ListView) => {
      if (refuse) return { ok: false, status: 400, code: 'invalid-view', message: 'It asks what your view “Rush” asks.' }
      kept = [...kept, view]
      return { ok: true, value: { own: kept } }
    },
    removeView: async (_formId: string, name: string) => {
      kept = kept.filter((view) => view.name !== name)
      return { ok: true, value: { own: kept } }
    },
  } as unknown as DataClient
}

/** One grid's views, named for `name`, with a save of Large and a remove of Rush. */
function Grid({ name, client, formId, definition }: { name: string; client: DataClient; formId: string; definition: PublishedForm }): ReactElement {
  const mine = useOwnViews(client, formId, definition)
  const [said, setSaid] = useState('')
  return (
    <section aria-label={name}>
      <ul aria-label={`${name} views`}>
        {mine.own.map((view) => (
          <li key={view.name}>{view.name}</li>
        ))}
      </ul>
      <button type="button" onClick={() => void mine.save(LARGE).then((refused) => setSaid(refused ?? 'saved'))}>
        Save in {name}
      </button>
      <button type="button" onClick={() => void mine.remove('Rush').then((refused) => setSaid(refused ?? 'removed'))}>
        Remove in {name}
      </button>
      <p role="status" aria-label={`${name} said`}>
        {said}
      </p>
    </section>
  )
}

const views = (name: string): string[] =>
  within(screen.getByRole('list', { name: `${name} views` }))
    .queryAllByRole('listitem')
    .map((item) => item.textContent ?? '')

describe('a person’s own views across one open form’s grids (0128)', () => {
  // A save in the Records panel is offered at once in a child section of
  // the same form, and a remove there leaves the Records panel without it;
  // another form's grid hears neither. Watched failing with each grid
  // keeping its own: the child section still offered Rush alone.
  test('shows every grid of the form what one grid’s save or remove answered, and no other form’s', async () => {
    const user = userEvent.setup()
    const client = serverOf([RUSH])
    const before = opened([RUSH])
    render(
      <OwnViewsScope>
        <Grid name="Records" client={client} formId="order" definition={before} />
        <Grid name="Employee" client={client} formId="order" definition={before} />
        <Grid name="Customer" client={client} formId="customer" definition={opened([RUSH])} />
      </OwnViewsScope>,
    )
    await user.click(screen.getByRole('button', { name: 'Save in Records' }))
    await waitFor(() => expect(views('Employee')).toEqual(['Rush', 'Large']))
    expect(views('Records')).toEqual(['Rush', 'Large'])
    await user.click(screen.getByRole('button', { name: 'Remove in Employee' }))
    await waitFor(() => expect(views('Records')).toEqual(['Large']))
    expect(views('Customer')).toEqual(['Rush'])
  })

  // A child section opened after a save draws from a definition read when
  // the form was opened, before it: the answer is what it shows. Watched
  // failing with the definition taken over the answer: Large was missing.
  test('shows a grid drawn later the answer, not the older definition it was given', async () => {
    const user = userEvent.setup()
    const client = serverOf([RUSH])
    const before = opened([RUSH])
    const { rerender } = render(
      <OwnViewsScope>
        <Grid name="Records" client={client} formId="order" definition={before} />
      </OwnViewsScope>,
    )
    await user.click(screen.getByRole('button', { name: 'Save in Records' }))
    await waitFor(() => expect(views('Records')).toEqual(['Rush', 'Large']))
    rerender(
      <OwnViewsScope>
        <Grid name="Records" client={client} formId="order" definition={before} />
        <Grid name="Employee" client={client} formId="order" definition={before} />
      </OwnViewsScope>,
    )
    expect(views('Employee')).toEqual(['Rush', 'Large'])
  })

  // A refusal changes nothing anywhere, and the sentence is the grid's to
  // say; outside a scope a grid keeps its own, as before 0128.
  test('changes nothing on a refusal, and keeps a grid’s own outside a scope', async () => {
    const user = userEvent.setup()
    render(
      <OwnViewsScope>
        <Grid name="Records" client={serverOf([RUSH], true)} formId="order" definition={opened([RUSH])} />
        <Grid name="Employee" client={serverOf([RUSH], true)} formId="order" definition={opened([RUSH])} />
      </OwnViewsScope>,
    )
    await user.click(screen.getByRole('button', { name: 'Save in Records' }))
    await waitFor(() => expect(screen.getByRole('status', { name: 'Records said' }).textContent).toBe('It asks what your view “Rush” asks.'))
    expect([views('Records'), views('Employee')]).toEqual([['Rush'], ['Rush']])
    cleanup()

    const client = serverOf([RUSH])
    render(
      <>
        <Grid name="Records" client={client} formId="order" definition={opened([RUSH])} />
        <Grid name="Employee" client={client} formId="order" definition={opened([RUSH])} />
      </>,
    )
    await user.click(screen.getByRole('button', { name: 'Save in Records' }))
    await waitFor(() => expect(views('Records')).toEqual(['Rush', 'Large']))
    expect(views('Employee')).toEqual(['Rush'])
  })
})
