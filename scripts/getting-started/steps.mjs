// docs/getting-started.md, read as the gate reads it and written where it is
// generated (0032).
//
// Two jobs, both pure, so steps.test.mjs checks them without Docker:
//
// - **Extract.** Every ```sh block of the guide is a command the gate runs,
//   in order, exactly as written. The one exception is the clone and cd an
//   operator types first, which CI does not need because it already has the
//   checkout; that block says so in a marker on the line before it, and the
//   marker excuses nothing else. A command in any other kind of block would be
//   one the operator runs and the gate does not, so any fence that is neither
//   ```sh nor ```text (expected output) is refused. So is a command with a
//   character sh, PowerShell and cmd read differently: the gate runs it under
//   one shell, and the operator may type it into another.
// - **Render.** The values an operator types into the studio and the host page
//   are the values the gate's journey sends, from journey.json, and the
//   controls are named as walk.mjs names them -- the names the studio's and
//   the host page's guide tests drive the apps by. They are written into the
//   guide between markers by `node scripts/getting-started/steps.mjs
//   --write`, and steps.test.mjs fails when the committed guide differs from
//   what this renders.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOST, labelOf, STUDIO, studioWalk } from './walk.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const GUIDE = join(repo, 'docs', 'getting-started.md')
export const JOURNEY = join(repo, 'scripts', 'getting-started', 'journey.json')

/** The line before a ```sh block the gate does not run. Anything after the colon is the reason. */
const SKIP_MARKER = /^<!-- not run by the gate: \S.* -->$/
/** What a skipped block may hold: cloning the repository and changing into it, nothing else. */
const SKIPPABLE = /^(git clone \S.*|cd \S+)$/
/** Any fence, at any indentation, so a block inside a list item cannot slip past. */
const FENCE = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)/
/**
 * What sh, PowerShell and cmd all pass to a program as written: letters,
 * digits, spaces and - _ . / : =. Everything else -- quotes, $, `, |, &, ;,
 * <, >, %, ^, parentheses, braces, globs, ~, #, !, a comma, @, a backslash --
 * is read by at least one of them as something of its own.
 */
const SHELL_NEUTRAL = /^[A-Za-z0-9 ._/:=-]+$/

/**
 * Throws a sentence naming `command`'s first character that sh, PowerShell
 * and cmd read differently, with `where` saying whose command it is.
 */
export function refuseShellSpecific(command, where) {
  if (SHELL_NEUTRAL.test(command)) return
  const character = [...command].find((candidate) => !SHELL_NEUTRAL.test(candidate))
  throw new Error(
    `${where}: "${command}" holds ${JSON.stringify(character)}, which sh, PowerShell and cmd do not all read alike; every command must mean the same in sh, PowerShell and cmd, so use only letters, digits, spaces and - _ . / : =.`,
  )
}

/**
 * The guide's ```sh blocks, in order: `run` for each one the gate runs, with
 * the line its command is on, and `skipped` for the marked clone and cd.
 * Throws a sentence naming the line for everything the gate could not run
 * as written.
 */
export function extractSteps(markdown) {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n')
  const run = []
  const skipped = []
  for (let index = 0; index < lines.length; index += 1) {
    const open = FENCE.exec(lines[index])
    if (open === null) {
      if (SKIP_MARKER.test(lines[index].trim()) && !/^\s*`{3,}sh\s*$/.test(lines[index + 1] ?? '')) {
        throw new Error(`docs/getting-started.md line ${String(index + 1)}: the "not run by the gate" marker is not on the line before a \`\`\`sh block.`)
      }
      continue
    }
    const [, indent, fence, language] = open
    // CommonMark's rule: closed by a run of the same character, at least as long.
    const close = new RegExp(`^\\s*${fence[0] === '`' ? '`' : '~'}{${String(fence.length)},}\\s*$`)
    const start = index + 1
    const body = []
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index]
      if (close.test(line)) break
      body.push(line.startsWith(indent) ? line.slice(indent.length) : line.trimStart())
    }
    if (index === lines.length) throw new Error(`docs/getting-started.md line ${String(start)}: a code block is never closed.`)
    if (language === 'text') continue
    if (language !== 'sh') {
      throw new Error(
        `docs/getting-started.md line ${String(start)}: a \`\`\`${language} block is neither run by the gate (\`\`\`sh) nor output (\`\`\`text), so a command in it would be one nothing runs.`,
      )
    }
    const commands = body.map((line) => line.trim()).filter((line) => line !== '')
    const marked = SKIP_MARKER.test((lines[start - 2] ?? '').trim())
    if (marked) {
      const other = commands.find((command) => !SKIPPABLE.test(command))
      if (commands.length === 0 || other !== undefined) {
        throw new Error(`docs/getting-started.md line ${String(start)}: a block the gate skips holds "${other ?? '(nothing)'}"; only git clone and cd may be skipped.`)
      }
      skipped.push({ line: start + 1, commands })
      continue
    }
    if (commands.length !== 1) {
      throw new Error(
        `docs/getting-started.md line ${String(start)}: a \`\`\`sh block holds ${String(commands.length)} commands; the gate runs one per block, so each shell -- sh, PowerShell, cmd -- runs it the same way.`,
      )
    }
    const [command] = commands
    if (SKIPPABLE.test(command)) {
      throw new Error(`docs/getting-started.md line ${String(start)}: "${command}" would be run by the gate; mark its block "<!-- not run by the gate: ... -->".`)
    }
    if (!command.startsWith('docker compose ')) {
      throw new Error(`docs/getting-started.md line ${String(start)}: "${command}" is not a docker compose command, and every step but the clone and cd is one.`)
    }
    refuseShellSpecific(command, `docs/getting-started.md line ${String(start + 1)}`)
    run.push({ line: start + 1, command })
  }
  if (run.length === 0) throw new Error('docs/getting-started.md has no ```sh block for the gate to run.')
  return { run, skipped }
}

/**
 * The `docker compose` commands the guide names in running text, as code
 * spans, with the line each starts on: the ones section 7 gives an operator
 * whose stack is not well, which the gate runs against the running stack.
 * One that is a ```sh block's command is that step, and left out, as is one
 * named a second time. Throws a sentence for one that would start or stop
 * the stack under the gate's checks, and for one the shells read differently.
 */
export function inlineCommands(markdown, run) {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n')
  // Code blocks blanked, line for line, so their text is not read as prose.
  const prose = []
  for (let index = 0; index < lines.length; index += 1) {
    const open = FENCE.exec(lines[index])
    if (open === null) {
      prose.push(lines[index])
      continue
    }
    const close = new RegExp(`^\\s*${open[2][0] === '`' ? '`' : '~'}{${String(open[2].length)},}\\s*$`)
    prose.push('')
    for (index += 1; index < lines.length && !close.test(lines[index]); index += 1) prose.push('')
    if (index < lines.length) prose.push('')
  }
  const text = prose.join('\n')
  const found = []
  for (const span of text.matchAll(/`([^`]+)`/g)) {
    // A code span ends at a blank line; one that seems to cross it is two backticks of different spans.
    if (/\n\s*\n/.test(span[1])) continue
    const command = span[1].replace(/\s+/g, ' ').trim()
    if (!command.startsWith('docker compose ')) continue
    if (run.some((step) => step.command === command) || found.some((entry) => entry.command === command)) continue
    const line = text.slice(0, span.index).split('\n').length
    if (isStart(command) || isDown(command)) {
      throw new Error(`docs/getting-started.md line ${String(line)}: "${command}" starts or stops the stack, and is no \`\`\`sh block the gate runs as a step.`)
    }
    refuseShellSpecific(command, `docs/getting-started.md line ${String(line)}`)
    found.push({ line, command })
  }
  return found
}

export const isStart = (command) => /\sup(\s|$)/.test(command)
export const isDown = (command) => /\sdown(\s|$)/.test(command)
const deletesVolumes = (command) => /\s-v(\s|$)/.test(command)

/**
 * The guide's steps in the order the gate runs them, or a sentence saying
 * why the gate cannot: exactly one step starts the stack, which the gate runs
 * again after the tokens are minted and again after each stop that keeps the
 * volumes (`keep`); every step from the first stop on is a stop, run after
 * the checks; and the last deletes the volumes (`last`), so the guide leaves
 * nothing behind.
 */
export function plan(steps) {
  const starts = steps.filter((step) => isStart(step.command))
  if (starts.length !== 1) throw new Error(`the guide has ${String(starts.length)} steps that start the stack (\`docker compose ... up\`); the gate runs exactly one, again after each stop`)
  const firstDown = steps.findIndex((step) => isDown(step.command))
  if (firstDown === -1) throw new Error('the guide never stops the stack')
  if (steps.indexOf(starts[0]) > firstDown) throw new Error('the guide stops the stack before it starts it')
  if (steps.slice(firstDown).some((step) => !isDown(step.command))) throw new Error('the guide stops the stack before its last step')
  const last = steps.at(-1)
  if (!deletesVolumes(last.command)) throw new Error("the guide's last step does not delete the stack's volumes with `down -v`")
  const keep = steps.slice(firstDown, -1)
  if (keep.length === 0 || keep.some((step) => deletesVolumes(step.command))) {
    throw new Error('the guide never stops the stack keeping its volumes before it deletes them, so the gate cannot show that a start after a stop finds everything as it was')
  }
  return { start: starts[0], before: steps.slice(0, firstDown), keep, last }
}

const START = (name) => `<!-- generated by scripts/getting-started/steps.mjs from scripts/getting-started/journey.json: ${name}; do not edit -->`
const END = '<!-- end generated -->'
/** The guide's generated regions, by name, in the order the guide has them. */
export const REGIONS = ['studio', 'host']

const code = (value) => `\`${value}\``
const rule = (entry) => `${code(entry.column)} = ${code(entry.attribute)}`

/** One row of a table with a column per engine: the same value once, or each engine's own. */
function row(step, control, values) {
  const cells = values.every((value) => value === values[0]) ? [values[0], 'the same'] : values
  return `| ${step} | ${control} | ${cells.join(' | ')} |`
}

/** What the guide tells the operator to do with a control, from walk.mjs's action. */
function cell(action) {
  const joined = (parts) => parts.filter((part) => part !== undefined).join('; ')
  switch (action.kind) {
    case 'discover':
      return `${code(action.group)}, then wait for **${action.seen}**`
    case 'press':
      return joined([
        'press it',
        action.opens === undefined ? undefined : `it opens **${action.opens}**, which shows **${action.shows}**`,
        action.says === undefined ? undefined : `the studio says *${action.says}*`,
      ])
    case 'select':
    case 'type':
      return code(action.value)
    case 'tick':
      return joined([
        'tick it',
        action.keep === undefined ? undefined : `under **${action.keep.group}** keep ${action.keep.ticked.map(code).join(', ')} ticked`,
        action.holds === undefined ? undefined : `**${action.holds.name}** says ${code(action.holds.value)}`,
      ])
    case 'none':
      return `nothing to choose: the studio says the table ${action.reads}`
    case 'rules':
      return `${action.rules.map(rule).join(', ')}, ${action.from}`
    case 'says':
      return `says *${action.text}*`
  }
  throw new Error(`walk.mjs: the guide has no words for an action of kind ${String(action.kind)}`)
}

/**
 * What the operator does in the studio, a row per control of walk.mjs, with
 * each engine's value side by side. Every form's walk must name the same
 * controls in the same order: a journey that differed there would need a
 * table this one is not.
 */
function studioTable(journey) {
  const { forms } = journey
  const walks = forms.map((form) => studioWalk(journey, form))
  const shape = (walk) => JSON.stringify(walk.map((entry) => [entry.step, entry.control]))
  for (const [index, walk] of walks.entries()) {
    if (shape(walk) !== shape(walks[0])) {
      throw new Error(`journey.json: ${forms[index].connection} walks through other controls than ${forms[0].connection}, and the guide's table names each control once`)
    }
  }
  const lines = [
    `| Step | Control | ${forms.map((form) => `${form.engine} (${code(form.connection)})`).join(' | ')} |`,
    `| --- | --- | ${forms.map(() => '---').join(' | ')} |`,
    ...walks[0].map((entry, index) =>
      row(
        entry.step ?? '',
        entry.action.kind === 'discover' ? `**${entry.control}**, in the group named` : `**${entry.control}**`,
        walks.map((walk) => cell(walk[index].action)),
      ),
    ),
  ]
  // What the gate's journey checks the proposal says, on both engines (0027).
  const { createOnly, rowLevelSecurity } = journey.generator
  return [
    ...lines,
    '',
    `On both engines, **${STUDIO.chose}** says that **${labelOf(journey, createOnly)}** is read-only on update, because the order form's account may not UPDATE ${code(createOnly)}, so it is written on create only; and that row-level security applies to this connection on ${code(rowLevelSecurity.table)}, which section 5 shows.`,
  ].join('\n')
}

/** What tenant 1's clerk types on the host page, the same on every form, which it opens one after the other. */
function hostTable(journey) {
  const { order, forms } = journey
  const lines = [
    `| Field | ${forms.map((form) => code(form.formId)).join(', then ')} |`,
    '| --- | --- |',
    `| **${order.customer.label}** | type ${code(order.customer.search)} and choose **${order.customer.choose}** |`,
    ...order.create.map((entry) => `| **${entry.label}** | ${code(entry.value)} |`),
  ]
  const stored = order.create.filter((entry) => entry.stored !== undefined)
  return [
    ...lines,
    '',
    `Then **${HOST.save}**. The form says **${HOST.created}**, and the record token after it is the order's.${
      stored.length === 0 ? '' : ` ${stored.map((entry) => `**${entry.label}** now shows ${code(entry.stored)}, as the database stores it.`).join(' ')}`
    } Set **${order.update.label}** to ${code(order.update.value)} and **${HOST.save}** again: the form says **${HOST.saved}**`,
  ].join('\n')
}

/** Every generated region's text, by name, from journey.json's data. */
export function render(journey) {
  return { studio: studioTable(journey), host: hostTable(journey) }
}

/** The generated regions of `markdown`, by name; throws when one is missing, repeated or unclosed. */
export function generatedRegions(markdown) {
  const text = markdown.replaceAll('\r\n', '\n')
  const found = {}
  for (const name of REGIONS) {
    const start = text.indexOf(START(name))
    if (start === -1 || text.indexOf(START(name), start + 1) !== -1) {
      throw new Error(`docs/getting-started.md must hold the generated region "${name}" exactly once, opened by ${START(name)}`)
    }
    const from = start + START(name).length
    const end = text.indexOf(END, from)
    if (end === -1) throw new Error(`docs/getting-started.md: the generated region "${name}" is never closed by ${END}`)
    found[name] = text.slice(from, end).trim()
  }
  return found
}

/** `markdown` with every generated region replaced by what `render` gives. */
export function rewrite(markdown, journey) {
  let text = markdown.replaceAll('\r\n', '\n')
  generatedRegions(text)
  const rendered = render(journey)
  for (const name of REGIONS) {
    const start = text.indexOf(START(name)) + START(name).length
    const end = text.indexOf(END, start)
    // Blank lines around, so Markdown reads the table as a table and not as part of the comment.
    text = `${text.slice(0, start)}\n\n${rendered[name]}\n\n${text.slice(end)}`
  }
  return text
}

export function readJourney() {
  return JSON.parse(readFileSync(JOURNEY, 'utf8'))
}

// `node scripts/getting-started/steps.mjs --write` rewrites the guide's generated regions.
if (process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/getting-started/steps.mjs')) {
  const guide = readFileSync(GUIDE, 'utf8')
  const next = rewrite(guide, readJourney())
  if (process.argv.includes('--write')) {
    writeFileSync(GUIDE, next, 'utf8')
    console.log(`docs/getting-started.md: ${REGIONS.length} regions written from journey.json`)
  } else {
    process.stdout.write(next)
  }
}
