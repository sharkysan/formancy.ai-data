// What docs/getting-started.md has the operator do in the studio and on the
// host page, control by control, by the names the two apps give them (0032).
//
// One source for three readers, so a name cannot change in one of them alone:
//
// - steps.mjs writes the guide's tables from it;
// - steps.test.mjs fails when a name the guide's sections 4 and 5 set in bold
//   or italics is not one of these, or one of these is not in the guide;
// - apps/studio/src/guide.test.tsx and apps/host/src/guide.test.tsx do every
//   row by these names, against the real server, so a control renamed in an
//   app fails that app's suite until the name here -- and with it the guide --
//   changes too.
//
// No import at all, so the apps' suites and the gate import it as it is.

/** What the studio calls what the guide names outside the table. */
export const STUDIO = Object.freeze({
  token: 'Host token',
  signIn: 'Sign in',
  steps: 'Steps',
  chose: 'What the generator chose',
  policyCheck: 'Policy check',
  fits: 'The policy fits this form.',
})

/** The studio's steps the guide names, as its Steps list numbers them. */
export const STUDIO_STEPS = Object.freeze({
  connect: '1. Connect',
  choose: '2. Choose',
  generate: '3. Generate',
  policy: '4. Policy',
  publish: '7. Publish',
})

/** What the host page calls the controls and the messages the guide names. */
export const HOST = Object.freeze({
  token: 'Host token',
  formId: 'Form id',
  open: 'Open the form',
  newRecord: 'New record',
  save: 'Save',
  created: 'Created record',
  saved: 'Saved.',
  signOut: 'Sign out',
  record: 'Record token',
  load: 'Load',
  notFound: 'No such record.',
})

/** The heading a step's main landmark is named by: "4. Policy" is the step "Policy". */
export const stepTitle = (step) => step.replace(/^\d+\.\s+/, '')

/**
 * The studio's half of the guide for one of journey.json's forms: a row per
 * control, in the order the operator uses them. `step` starts a step of the
 * Steps list, `control` is the control's accessible name, and `action` is
 * what is done with it:
 *
 * - `discover`: press `button` in the group named `group`, then wait for the
 *   region `seen`;
 * - `press`: press it; `opens` is the step it opens and `shows` a region on
 *   that step, `says` what the step says after it;
 * - `select` and `type`: choose `value` in a select box, or type it into a
 *   text box, cleared first;
 * - `tick`: tick a checkbox; `keep` names a group under it whose `ticked`
 *   boxes stay ticked, `holds` a text box that says `value`;
 * - `none`: there is no control of that name, and the step reads `reads`;
 * - `rules`: a group of row-filter rules that hold `rules`, `from` saying
 *   where they came from;
 * - `says`: a region whose status says `text`.
 */
export function studioWalk(journey, form) {
  const { policy } = journey
  const root = `${form.root.schema}.${form.root.name}`
  const attribute = (column) => policy.rowFilters.find((entry) => entry.column === column)?.attribute ?? '(none)'
  return [
    {
      step: STUDIO_STEPS.connect,
      control: 'Discover',
      action: { kind: 'discover', group: form.connection, button: `Discover ${form.connection}`, seen: `What ${form.connection} can see` },
    },
    { control: 'Choose a root', action: { kind: 'press' } },
    { step: STUDIO_STEPS.choose, control: 'Root table or view', action: { kind: 'select', value: root } },
    { control: 'Form id', action: { kind: 'type', value: form.formId } },
    { control: 'Title', action: { kind: 'type', value: form.title } },
    ...form.lookups.map((lookup) => ({
      control: `Offer ${lookup.foreignKey} as a lookup`,
      action: { kind: 'tick', keep: { group: `Columns to show for ${lookup.foreignKey}`, ticked: lookup.display } },
    })),
    ...form.pinned.map((column) => ({ control: `Pin ${column}`, action: { kind: 'tick', holds: { name: `Attribute ${column} is pinned to`, value: attribute(column) } } })),
    {
      control: 'Version column',
      action: form.versionColumn === undefined ? { kind: 'none', reads: 'has a rowversion column' } : { kind: 'select', value: form.versionColumn },
    },
    { control: 'Generate the form', action: { kind: 'press', opens: STUDIO_STEPS.generate, shows: STUDIO.chose } },
    ...['read', 'create', 'update'].map((operation, index) => ({
      ...(index === 0 ? { step: STUDIO_STEPS.policy } : {}),
      control: `Roles that may ${operation}`,
      action: { kind: 'type', value: policy.operations[operation].join(', ') },
    })),
    { control: 'Fill every field from the operations', action: { kind: 'press' } },
    { control: `Row filters on ${root}`, action: { kind: 'rules', rules: policy.rowFilters, from: 'from the pin' } },
    ...Object.entries(policy.lookups).map(([field, rules]) => ({
      control: `Rows the ${labelOf(journey, field)} list may offer`,
      action: { kind: 'rules', rules, from: 'filled in from the pin' },
    })),
    { control: STUDIO.policyCheck, action: { kind: 'says', text: STUDIO.fits } },
    { step: STUDIO_STEPS.publish, control: 'Publish version 1', action: { kind: 'press', says: `Published version 1 of ${form.formId}.` } },
  ]
}

/** The label the generator gives a field, as journey.json records it for the host page; the key where it records none. */
export function labelOf(journey, field) {
  const { order } = journey
  return [{ field: 'customer', label: order.customer.label }, ...order.create, order.update].find((entry) => entry.field === field)?.label ?? field
}

/**
 * Every name the guide may set in bold or italics in its sections 4 and 5:
 * the studio's and the host page's, each form's walk, and the labels and the
 * customer journey.json gives the host page -- the gate holds those to what
 * the generator and the database answer.
 */
export function guideNames(journey) {
  const names = new Set([...Object.values(STUDIO), ...Object.values(STUDIO_STEPS), ...Object.values(HOST)])
  for (const form of journey.forms) {
    for (const { control, action } of studioWalk(journey, form)) {
      names.add(control)
      for (const name of [action.seen, action.shows, action.says, action.text, action.keep?.group, action.holds?.name]) if (name !== undefined) names.add(name)
    }
  }
  const { order } = journey
  for (const name of [order.customer.label, order.customer.choose, ...order.create.map((entry) => entry.label), order.update.label]) names.add(name)
  return names
}
